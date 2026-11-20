"""Package only public static assets; credentials never enter the Pages artifact."""
import datetime as dt
import json
import shutil
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.build_budget import build_budgets
from scripts.collect_trends import TREND_REGIONS, compact_json, months_for, seed_recent_months, valid_stored_month
from scripts.trend_households import MIN_HOUSEHOLDS, filter_snapshot, stored_household_counts
import update
DEST = ROOT / "site"


def publish_regional_data(source, dest):
    counts = stored_household_counts(source/'trends')
    districts = json.loads((source/'districts.json').read_text(encoding='utf-8'))['districts']
    wanted = months_for(dt.datetime.now(update.KST).date())
    published = {'nationwide': set(), 'trends': set()}
    for district in districts:
        code = district['code']
        snapshot = source/'nationwide'/f'{code}.json'
        raw = None
        if snapshot.exists():
            raw = json.loads(snapshot.read_text(encoding='utf-8'))
            compact_json(dest/'nationwide'/snapshot.name, filter_snapshot(raw, counts))
            published['nationwide'].add(snapshot.name)
        if not code.startswith(TREND_REGIONS):
            continue
        history = source/'trends'/f'{code}.json'
        state = json.loads(history.read_text(encoding='utf-8')) if history.exists() else {'months': []}
        months = {m['month']: m for m in state['months'] if m['month'] in wanted and valid_stored_month(m, code, counts)}
        if raw:
            seed_recent_months(months, raw, wanted, lambda c: c.get('households') or counts.get(c['id']))
        compact_json(dest/'trends'/history.name, {
            'schemaVersion': 1, 'minimumHouseholds': MIN_HOUSEHOLDS, 'kind': 'regional-monthly-median',
            'districtCode': code, 'months': [months[key] for key in sorted(months)], 'failedMonths': state.get('failedMonths', [])
        })
        published['trends'].add(history.name)
    search_index = source/'nationwide'/'index.json'
    if search_index.exists():
        value = filter_snapshot(json.loads(search_index.read_text(encoding='utf-8')), counts)
        value.update(minimumHouseholds=MIN_HOUSEHOLDS, note='최근 12개월에 거래 신고가 있는 300세대 이상 확인 단지입니다.')
        compact_json(dest/'nationwide'/'index.json', value)
        published['nationwide'].add('index.json')
    for directory, names in published.items():
        for obsolete in (dest/directory).glob('*.json'):
            if obsolete.name not in names and obsolete.is_file():
                obsolete.unlink()


def build():
    DEST.mkdir(exist_ok=True)
    for name in ("index.html", ".nojekyll", "README.md"):
        shutil.copy2(ROOT / name, DEST / name)
    for name in ("assets", "docs"):
        shutil.copytree(ROOT / name, DEST / name, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("*.tmp"))
    data = DEST / "data"
    data.mkdir(exist_ok=True)
    for name in ("complexes.json", "districts.json", "sample.json", "status.json", "trades.json"):
        shutil.copy2(ROOT / "data" / name, data / name)
    publish_regional_data(ROOT / "data", data)
    build_budgets(data, data / "budget")
    print("Static Pages artifact ready: site/")

if __name__ == "__main__":
    build()

