"""Resumable ten-year monthly statistics. Never publish API keys or raw history."""
import argparse
import concurrent.futures
import datetime as dt
import json
import os
import math
import re
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


def identity_conflicts(payload, month):
    known = {c['id']: c for c in payload['complexes']}
    names = {}
    for t in payload['trades']:
        c = known.get(t['complexId'])
        if c and not t.get('canceled') and t['date'].startswith(month):
            names.setdefault(c['legalDongCode'], set()).add(c['legalDong'])
    return {code for code, values in names.items() if len(values) > 1}


def aggregate_month(payload, month):
    known = {c['id']: c for c in payload['complexes']}
    groups = {}
    conflicts = identity_conflicts(payload, month)
    for t in payload['trades']:
        c = known.get(t['complexId'])
        if not c or c.get('comparisonEligible') is False or t.get('canceled') or not t['date'].startswith(month) or c['legalDongCode'] in conflicts:
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


def summarize(payload, month, updated_at):
    conflicts = identity_conflicts(payload, month)
    return {'month': month, 'updatedAt': updated_at, 'rows': aggregate_month(payload, month),
            'excludedIdentityConflicts': sum(t['legalDongCode'] in conflicts and not t.get('canceled')
                                             and t['date'].startswith(month) for t in payload['trades'])}


def valid_stored_month(month, code):
    seen = set()
    for row in month['rows']:
        dong, band = row.get('dongCode'), row.get('area')
        key = (dong, band)
        if (key in seen or (dong != 'all' and (not isinstance(dong,str) or not re.fullmatch(r'\d{10}',dong) or not dong.startswith(code)))
                or band not in ('all','59','74','84') or not isinstance(row.get('dongName'),str)
                or not isinstance(row.get('priceManwon'),(int,float)) or not math.isfinite(row['priceManwon']) or row['priceManwon']<=0
                or not isinstance(row.get('count'),int) or row['count']<1 or not isinstance(row.get('complexCount'),int)
                or not 1<=row['complexCount']<=row['count']):
            return False
        seen.add(key)
    return True


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
        existing = {m['month']: m for m in state['months'] if m['month'] in wanted and valid_stored_month(m, code)}
        raw_path = nationwide/(code+'.json')
        if raw_path.exists():
            raw = json.loads(raw_path.read_text(encoding='utf-8'))
            # The first month in a rolling-year file is truncated: never seed it.
            start = update.window_start(dt.date.fromisoformat(raw['asOf']))
            cutoff = start.strftime('%Y-%m')
            for month in wanted:
                full = cutoff < month or (cutoff == month and start.day == 1)
                newer = month not in existing or raw['updatedAt'] >= existing[month]['updatedAt']
                if full and month <= raw['asOf'][:7] and newer:
                    existing[month] = summarize(raw, month, raw['updatedAt'])
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
    reasons = {}
    def job(task):
        d, month = task
        if stop.is_set(): return d['code'], month, None, False, ''
        try:
            first = dt.date.fromisoformat(month+'-01')
            value = district_payload(d['code'], d['name'], [month.replace('-', '')], today, registry,
                                     fetcher, start=first)
            result = summarize(value, month, dt.datetime.now(update.KST).isoformat())
            return d['code'], month, result, True, ''
        except Exception as exc:
            # Log only a whitelisted API result code or exception class, never a URL/key.
            match = re.fullmatch(r'API 응답 오류 \(([A-Za-z0-9_]{1,40})\)', str(exc)) if isinstance(exc, update.CollectionError) else None
            reason = 'API_'+match.group(1) if match else type(exc).__name__
            if match: stop.set()
            return d['code'], month, None, True, reason
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for i, (code, month, value, attempted, reason) in enumerate(pool.map(job, jobs), 1):
            if value is not None:
                states[code]['months'][month] = value
            elif attempted:
                failures += 1; states[code]['failedMonths'].append(month)
                reasons[reason] = reasons.get(reason, 0)+1
                print(f'10년 추세 {code}/{month} 수신 실패 ({reason})', flush=True)
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
                                    'failedRequests':failures,'failureReasons':reasons,'monthBudget':budget,
                                    'source':'https://www.data.go.kr/data/15126468/openapi.do'})
    if not failures:
        compact_json(dest/'v2.complete.json', {'collectorVersion':2,'checkedAt':today.isoformat()})
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
