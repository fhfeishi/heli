"""真实 HTTP + 文件重开：识别方案丢失、覆盖旧版本及非法 schema 入库。"""
import json
import hashlib
import sys
import tempfile
import threading
from pathlib import Path
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from kbctl.core import Kb
from kbctl.server import handler_for
from kbctl import pipeline2, extraction, management, search


def main():
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        kb = Kb.init(root / 'test-kb', name='test')
        schema = {'name': '技术应用分析', 'record_scope': 'document', 'instructions': '仅提取原文明示事实',
                  'fields': [{'name': name, 'type': 'string', 'hint': '', 'required': False, 'missing': '未提及'}
                             for name in ['应用场景', '问题', '技术方法', '成果指标', '作者', '时间']]}
        def start():
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(root))
            threading.Thread(target=server.serve_forever, daemon=True).start()
            return server
        server = start()
        def request(body=None):
            url = f'http://127.0.0.1:{server.server_port}/api/libraries/test-kb/extraction-plans'
            req = Request(url, data=json.dumps(body).encode() if body else None,
                          headers={'Content-Type': 'application/json'})
            try:
                with urlopen(req) as response:
                    return response.status, json.load(response)
            except HTTPError as error:
                return error.code, json.load(error)
        try:
            code, first = request({'schema': schema})
            assert code == 200
            assert (kb.root / 'target' / first['id'] / 'target-schema.json').is_file()
            schema['fields'][0]['type'] = 'string[]'
            code, second = request({'schema': schema, 'id': first['id'], 'base_version': first['version']})
            assert code == 200 and second['history'][0]['version'] == first['version']
            assert request({'schema': schema, 'id': first['id'], 'base_version': first['version']})[0] == 400
            schema['fields'][0]['required'] = 'false'
            assert request({'schema': schema})[0] == 400
            assert request({'schema': second['schema'], 'id': '../../escape'})[0] == 400
            server.shutdown(); server.server_close()
            server = start()
            # 外部结果 → PDF 解析正文 → BM25 → 证据定位，通过同一个 HTTP 契约。
            raw = b'%PDF-1.4 imported fixture'
            (kb.source_dir / 'paper.pdf').write_bytes(raw)
            parsed = kb.parsed_dir / 'paper.pdf' / 'markdown.md'
            parsed.parent.mkdir(parents=True)
            parsed.write_text('# Research\n\nA unique research finding.', encoding='utf-8')
            (kb.root / 'target' / 'external.json').write_text(json.dumps({
                'doc_id': 'external', 'version': 'external-v1', 'source_hash': hashlib.sha256(raw).hexdigest(),
                'facets': [{'key': '成果', 'state': 'has', 'items': [{'id': 'finding', 'name': 'Finding',
                    'evidence': [{'quote': 'unique research finding', 'version': 'external-v1',
                                  'locator': {'basis': 'pdf_page', 'page': 1}}]}]}]
            }), encoding='utf-8')
            refresh_req = Request(f'http://127.0.0.1:{server.server_port}/api/libraries/test-kb/refresh', data=b'{}', headers={'Content-Type': 'application/json'})
            with urlopen(refresh_req) as response:
                assert json.load(response)['content']['imported_results'] == 1
            def get(path):
                with urlopen(f'http://127.0.0.1:{server.server_port}/api/libraries/test-kb/' + path) as response:
                    return json.load(response)
            imported = get('extraction-results')
            assert imported['total'] == 1
            sid = imported['results'][0]['sources'][0]['source_id']
            hit = get('search?q=unique')['hits'][0]
            evidence = get(f'extraction-results/external/evidence?source_id={sid}&facet=0&item=0&evidence=0')
            assert evidence['verified'] and evidence['sha256'] == hit['sha256']
            outline = get(f'documents/{sid}/outline')
            assert outline['content_kind'] == 'parsed' and outline['source_sha256'] != outline['sha256']
            assert get(f'documents/{sid}/sections/0')['text'][evidence['char_start']:evidence['char_end']] == evidence['quote']
            (kb.source_dir / 'paper.pdf').write_bytes(raw + b' changed')
            assert get('extraction-results/external')['sources'][0]['stale']
            management.organize(kb)
            assert search.build_index(kb)['indexed'] == 0  # 旧解析不能跟随新原文发布
            pipeline2.backup(kb, root / 'restored')
            assert extraction.list_plans(Kb(root / 'restored'))['plans'] == [second]
            code, result = request()
            assert code == 200 and result['plans'] == [second]
            print(json.dumps({'http_persistence': 'PASS', 'restart': 'PASS', 'backup_restore': 'PASS', 'imported_result_evidence': 'PASS', 'stale_parsed_rejected': True, 'history': 'PASS',
                              'stale_write_rejected': True, 'invalid_schema_rejected': True}))
        finally:
            server.shutdown(); server.server_close()

if __name__ == '__main__':
    main()
