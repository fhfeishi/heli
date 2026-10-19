# ==================================================================
#  从 Security Center 程序黑名单中移除 wsl.exe
#  ------------------------------------------------------------------
#  依据 app.asar 的 pickProgramBlacklist：sandbox.programBlacklist 一旦
#  存在，就整体替换内置默认数组 ["wsl.exe","wslconfig.exe","wmic.exe",
#  "sc.exe","reg.exe","schtasks.exe"]。这里只去掉 wsl.exe，其余 5 个
#  敏感程序（服务/注册表/计划任务）继续受限。
#
#  幂等：已配置则直接退出。每次修改前自动备份 settings.json。
#  生效条件：WorkBuddy 需要重启（策略在启动时加载）。
# ==================================================================

$ErrorActionPreference = 'Stop'
$path = Join-Path $env:USERPROFILE '.workbuddy\settings.json'
$keep = @('wslconfig.exe', 'wmic.exe', 'sc.exe', 'reg.exe', 'schtasks.exe')

if (-not (Test-Path -LiteralPath $path)) {
    Write-Host "找不到配置文件：$path" -ForegroundColor Red
    exit 1
}

$raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
try { $data = $raw | ConvertFrom-Json } catch {
    Write-Host "settings.json 不是合法 JSON，先修好再跑本脚本。" -ForegroundColor Red
    exit 1
}

$current = $null
if ($data.sandbox.PSObject.Properties.Name -contains 'programBlacklist') {
    $current = @($data.sandbox.programBlacklist)
}
if ($current -and ($current -notcontains 'wsl.exe')) {
    Write-Host "已配置：programBlacklist 不含 wsl.exe，无需改动。" -ForegroundColor Green
    exit 0
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$path.bak-$stamp"
Copy-Item -LiteralPath $path -Destination $backup
Write-Host "已备份：$(Split-Path -Leaf $backup)"

$json = ($keep | ConvertTo-Json -Compress)

if ($current) {
    $raw = [regex]::Replace($raw, '"programBlacklist"\s*:\s*\[[^\]]*\]', '"programBlacklist": ' + $json)
} else {
    $raw = [regex]::Replace($raw, '("sandbox"\s*:\s*\{)', ('$1' + "`r`n    `"programBlacklist`": " + $json + ','))
}

# 必须写无 BOM 的 UTF-8：PowerShell 5.1 的 -Encoding UTF8 会带 BOM，Node 解析会失败
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $raw, $utf8)

# 校验：仍是合法 JSON，且字段内容正确
$check = (Get-Content -LiteralPath $path -Raw -Encoding UTF8) | ConvertFrom-Json
$list = @($check.sandbox.programBlacklist)
if ($list -contains 'wsl.exe') {
    Write-Host "写入后仍含 wsl.exe，请检查文件：$path" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "完成。当前黑名单：" -ForegroundColor Green
$list | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "=== 下一步：完全退出 WorkBuddy 再启动 ===" -ForegroundColor Yellow
Write-Host "  策略在应用启动时加载；不重启仍然会被拦。"
Write-Host "  重启后可以让 Agent 跑一次  wsl.exe -l -q  验证。"
