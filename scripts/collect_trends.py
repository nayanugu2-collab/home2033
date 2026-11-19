"""Resumable ten-year monthly statistics. Never publish API keys or raw history."""
import argparse
import concurrent.futures
import datetime as dt
import json
import os
from pathlib import Path
import statistics
import sys
import threading

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import update
from scripts.collect_nationwide import district_payload

PRIORITY = ['41135', '41465', '41597', '41290', '11740', '11215', '11710', '11200', '11590', '11650']


def months_for(today, length=120):
    first = update.shift_month(today.replace(day=1), 1-length)
    return [update.shift_month(first, i).strftime('%Y-%m') for i in range(length)]


def aggregate_month(payload, month):
    known = {c['id']: c for c in payload['complexes']}
    groups = {}
    for t in payload['trades']:
        c = known.get(t['complexId'])
        if not c or c.get('comparisonEligible') is False or t.get('canceled') or not t['date'].startswith(month):
            continue
        if t['legalDongCode'] != c['legalDongCode']:
            raise update.CollectionError('추세 거래 신원 오류')
        bands = ['all'] + ([update.area_class(t['area'])] if update.area_class(t['area']) else [])
        for dong, name in [('all', '전체'), (c['legalDongCode'], c['legalDong'])]:
            for band in bands:
                values, identities = groups.setdefault((dong, name, band), ([], set()))
                values.append(t['priceManwon'])
                identities.add(c['id'])
    return [dict(dongCode=dong, dongName=name, area=band, priceManwon=statistics.median(values),
                 count=len(values), complexCount=len(identities))
            for (dong, name, band), (values, identities) in sorted(groups.items())]


def compact_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    os.replace(temporary, path)


def collect_history(districts, today, registry, fetcher, budget=1400, dest=None, nationwide=None):
    dest = dest or ROOT/'data/trends'
    nationwide = nationwide or ROOT/'data/nationwide'
    wanted = months_for(today)
    states = {}
    for d in districts:
        code = d['code']; path = dest/(code+'.json')
        state = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {
            'schemaVersion': 1, 'kind': 'regional-monthly-median', 'districtCode': code, 'name': d['name'], 'months': []}
        existing = {m['month']: m for m in state['months'] if m['month'] in wanted}
        raw_path = nationwide/(code+'.json')
        if raw_path.exists():
            raw = json.loads(raw_path.read_text(encoding='utf-8'))
            # The first month in a rolling-year file is truncated: never seed it.
            cutoff = update.window_start(dt.date.fromisoformat(raw['asOf'])).strftime('%Y-%m')
            for month in wanted:
                if cutoff < month <= raw['asOf'][:7]:
                    existing[month] = {'month': month, 'updatedAt': raw['updatedAt'],
                                       'rows': aggregate_month(raw, month)}
        state['months'] = existing
        state['asOf'] = today.isoformat()
        state['failedMonths'] = []
        states[code] = state
    priority = {code: i for i, code in enumerate(PRIORITY)}
    ordered = sorted(districts, key=lambda d: (priority.get(d['code'], 999), d['code']))
    jobs = [(d, month) for d in ordered for month in reversed(wanted) if month not in states[d['code']]['months']]
    # Revalidate old snapshots after bootstrap, so late cancellations can be removed.
    old = sorted([(d, m) for d in ordered for m in states[d['code']]['months'].values()
                  if m['updatedAt'][:10] < (today-dt.timedelta(days=90)).isoformat()], key=lambda x:x[1]['updatedAt'])
    jobs += [(d, m['month']) for d, m in old]
    jobs = jobs[:max(0, budget)]
    stop = threading.Event(); failures = 0
    def job(task):
        d, month = task
        if stop.is_set(): return d['code'], month, None, False
        try:
            first = dt.date.fromisoformat(month+'-01')
            value = district_payload(d['code'], d['name'], [month.replace('-', '')], today, registry,
                                     fetcher, start=first)
            result = {'month': month, 'updatedAt': dt.datetime.now(update.KST).isoformat(),
                      'rows': aggregate_month(value, month)}
            return d['code'], month, result, True
        except Exception:
            return d['code'], month, None, True
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for i, (code, month, value, attempted) in enumerate(pool.map(job, jobs), 1):
            if value is not None:
                states[code]['months'][month] = value
            elif attempted:
                failures += 1; states[code]['failedMonths'].append(month)
                if failures >= 5: stop.set()
            if i % 100 == 0 or i == len(jobs):
                print(f'10년 추세 {i}/{len(jobs)} · 실패 {failures}', flush=True)
    index = []
    for d in districts:
        code = d['code']; state = states[code]
        state['months'] = sorted(state['months'].values(), key=lambda m:m['month'])
        stamps = [m['updatedAt'] for m in state['months']]
        state['updatedAt'] = max(stamps) if stamps else None
        state['windowStart'] = wanted[0]
        compact_json(dest/(code+'.json'), state)
        index.append({'code':code,'name':d['name'],'availableMonths':len(state['months']),
                      'totalMonths':len(wanted),'failedMonths':len(state['failedMonths'])})
    compact_json(dest/'index.json', {'schemaVersion':1,'asOf':today.isoformat(),'districts':index,
                                    'failedRequests':failures,'monthBudget':budget,
                                    'source':'https://www.data.go.kr/data/15126468/openapi.do'})
    print(f'10년 추세: 지역 {len(index)}개 · 완성 {sum(d["availableMonths"]==120 for d in index)}개 · 실패 {failures}', flush=True)
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--budget', type=int, default=int(os.environ.get('HISTORY_MONTH_BUDGET', '1400')))
    args = parser.parse_args()
    key = os.environ.get('MOLIT_SERVICE_KEY', '').strip()
    if args.budget and not key:
        print('10년 추세: MOLIT_SERVICE_KEY 없음', file=sys.stderr)
        return 1
    districts = json.loads((ROOT/'data/districts.json').read_text(encoding='utf-8'))['districts']
    return collect_history(districts, dt.datetime.now(update.KST).date(), update.load_registry(),
                           lambda code, month:update.fetch_month(key, code, month), args.budget)


if __name__ == '__main__':
    raise SystemExit(main())
