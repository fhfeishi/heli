"""模型通道：DeepSeek（OpenAI 兼容 /chat/completions），零新依赖。

三条纪律：

1. key 只留在内存里——不进日志、不进运行输入、不进成果正文。
2. 模型只能依据调用方给的摘录作答；摘录不够必须明说，不许拿常识补。
3. 每次调用回传 model / usage / 耗时，调用方写进运行输出，事后可审。

为什么不用 openai SDK：整个后端只有这一处 HTTP 调用，urllib 够用；
少一个依赖，就少一处和 venv 状态耦合的地方。
"""
from __future__ import annotations

import json
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

import config

# 上游临时故障值得重试；401/402/403/422 重试只会重复计费或重复报错
_RETRY_STATUS = {408, 429, 500, 502, 503, 504}


class LLMNotConfigured(RuntimeError):
    """没有配置 key。调用方应回退到无模型草稿，而不是让整次运行失败。"""


class LLMError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


@dataclass(frozen=True)
class Result:
    text: str
    model: str
    usage: dict = field(default_factory=dict)
    latency_ms: int = 0
    finish_reason: str = ""
    reasoning: str = ""

    @property
    def truncated(self) -> bool:
        return self.finish_reason == "length"

    def brief(self) -> dict:
        """给运行输出用的元信息：不含 prompt、不含 key。"""
        return {"model": self.model, "usage": self.usage, "latency_ms": self.latency_ms,
                "finish_reason": self.finish_reason, "truncated": self.truncated}


def _post(cfg: config.LLMConfig, payload: dict) -> dict:
    request = urllib.request.Request(
        cfg.base.rstrip("/") + "/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {cfg.key}"},
        method="POST")
    with urllib.request.urlopen(request, timeout=cfg.timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def chat(messages: list[dict], *, cfg: config.LLMConfig | None = None, temperature: float = 0.3,
         max_tokens: int | None = None, json_mode: bool = False, retries: int = 1) -> Result:
    """一次对话补全。失败抛 LLMError（带是否可重试），未配置抛 LLMNotConfigured。"""
    cfg = cfg or config.llm_config()
    if not cfg.available:
        raise LLMNotConfigured("未配置 DEEPSEEK_API_KEY（写在项目根 .env）")

    payload = {"model": cfg.model, "messages": messages, "temperature": temperature,
               "max_tokens": max_tokens or cfg.max_output_tokens, "stream": False}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    attempt, last_error = 0, None
    started = time.time()
    while attempt <= max(0, retries):
        attempt += 1
        try:
            data = _post(cfg, payload)
            break
        except urllib.error.HTTPError as error:
            detail = ""
            try:
                detail = error.read().decode("utf-8", "replace")
            except Exception:
                detail = ""
            message = _upstream_message(detail) or f"HTTP {error.code}"
            last_error = LLMError(f"DeepSeek 拒绝请求：{message}", status=error.code,
                                  retryable=error.code in _RETRY_STATUS)
            # 鉴权/额度/参数错重试没有意义
            if error.code not in _RETRY_STATUS:
                raise last_error from None
        except (urllib.error.URLError, socket.timeout, TimeoutError) as error:
            last_error = LLMError(f"连不上 DeepSeek：{error}", retryable=True)
        except json.JSONDecodeError as error:
            last_error = LLMError(f"DeepSeek 返回的不是 JSON：{error}", retryable=True)

        if attempt <= max(0, retries):
            time.sleep(1.5 * attempt)  # 线性退避，最多一次
    else:
        raise last_error  # type: ignore[misc]

    latency = int((time.time() - started) * 1000)
    try:
        choice = data["choices"][0]
        message = choice.get("message") or {}
        text = (message.get("content") or "").strip()
        reasoning = (message.get("reasoning_content") or "").strip()
        finish = choice.get("finish_reason") or ""
    except (KeyError, IndexError, TypeError):
        raise LLMError(f"DeepSeek 返回结构异常：{str(data)[:200]}") from None

    if not text and finish == "length":
        raise LLMError("输出被 max_tokens 截断且没有正文（推理占满了额度），请调高 "
                       "HELI_LLM_MAX_TOKENS 或换 deepseek-chat")
    if not text:
        raise LLMError(f"DeepSeek 返回空正文（finish_reason={finish or 'unknown'}）")

    return Result(text=text, model=data.get("model") or cfg.model, usage=data.get("usage") or {},
                  latency_ms=latency, finish_reason=finish, reasoning=reasoning)


def _upstream_message(detail: str) -> str:
    try:
        payload = json.loads(detail)
    except (TypeError, ValueError):
        return detail.strip()[:200]
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        return str(error.get("message") or "")[:200]
    return str(error or "")[:200]


def budget(text: str, limit: int) -> str:
    """按字符裁剪长文，保留头部——摘录的价值集中在前文。"""
    text = str(text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "\n\n…（此处截断，原文更长）"
