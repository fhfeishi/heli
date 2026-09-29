"""范围分页完整性、版本定位与重建失败保留旧索引的端到端路径。"""
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from kbctl import management, search
from kbctl.core import Kb, KbError

with tempfile.TemporaryDirectory() as root:
    kb = Kb.init(Path(root) / 'search-test', name='检索验收')
    for i in range(502):
        path = kb.source_dir / ('last' if i == 501 else 'first') / f'{i:03}.md'
        path.parent.mkdir(exist_ok=True)
        path.write_text(f'# Doc {i}\n\nshared term evidence {i}', encoding='utf-8')
    management.organize(kb)
    search.build_index(kb)
    result = search.search(kb, 'shared', limit=20, offset=500)
    assert result['total'] == 502 and len(result['hits']) == 2
    section = next(s for s in management.tree(kb)['sections'] if s['title'] == 'last')
    result = search.search(kb, 'shared', section['section_id'])
    assert result['total'] == 1
    hit = result['hits'][0]
    content = management.read_section(kb, hit['source_id'], hit['section_index'], hit['sha256'])
    assert content['text'][hit['char_start']:hit['char_end']] == 'shared'
    before = search.status(kb)
    snapshot = kb.source_dir / '.snapshots' / hit['sha256'][:2] / hit['sha256']
    snapshot.unlink()  # disposable fixture only
    try:
        search.build_index(kb)
    except KbError:
        pass
    else:
        raise AssertionError('missing snapshot must reject rebuild')
    assert search.status(kb) == before
    assert search.search(kb, 'shared')['total'] == 502
    print('PASS: >500 pagination, scoped hit, exact source version, failed rebuild rollback')
