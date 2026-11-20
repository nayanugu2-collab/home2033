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
import time
from itertools import zip_longest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import update
from scripts.collect_nationwide import district_payload
from scripts.trend_households import MIN_HOUSEHOLDS, counts_by_trade_id, download_households, household_count, stored_household_counts

GYEONGGI_BACKFILL_CODES = ('41171', '41173', '41210', '41285', '41287', '41111', '41113', '41115', '41117')
PRIORITY = ('41135', '41465', '41597', *GYEONGGI_BACKFILL_CODES,
            '41290', '11740', '11215', '11710', '11200', '11590', '11650')
TREND_REGIONS = ('11', '41', '26', '27', '30')
AREA_MASKS = {'59': 1, '74': 2, '84': 4}


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


def aggregate_month(payload, month, members=None, household_lookup=None):
    known = {}
    for c in payload['complexes']:
        count = household_lookup(c) if household_lookup else c.get('households')
        if c.get('comparisonEligible') is not False and type(count) is int and count >= MIN_HOUSEHOLDS:
            known[c['id']] = (c, count)
    groups = {}
    conflicts = identity_conflicts(payload, month)
    for t in payload['trades']:
        match = known.get(t['complexId'])
        if not match or t.get('canceled') or not t['date'].startswith(month):
            continue
        c, households = match
        if c['legalDongCode'] in conflicts:
            continue
        if t['legalDongCode'] != c['legalDongCode']:
            raise update.CollectionError('추세 거래 신원 오류')
        band = update.area_class(t['area'])
        bands = ['all', band] if band else ['all']
        if members is not None:
            if c['id'] not in members:
                members[c['id']] = [c['id'], c['legalDongCode'], 0, households]
            members[c['id']][2] |= AREA_MASKS.get(band, 0)
        for dong, name in [('all', '전체'), (c['legalDongCode'], c['legalDong'])]:
            for band in bands:
                values, identities = groups.setdefault((dong, name, band), ([], set()))
                values.append(t['priceManwon'])
                identities.add(c['id'])
    return [dict(dongCode=dong, dongName=name, area=band, priceManwon=statistics.median(values),
                 count=len(values), complexCount=len(identities))
            for (dong, name, band), (values, identities) in sorted(groups.items())]


def summarize(payload, month, updated_at, household_lookup=None):
    conflicts = identity_conflicts(payload, month)
    members = {}
    rows = aggregate_month(payload, month, members, household_lookup)
    return {'month': month, 'updatedAt': updated_at, 'minimumHouseholds': MIN_HOUSEHOLDS,
            'rows': rows, 'members': [members[key] for key in sorted(members)],
            'excludedIdentityConflicts': sum(t['legalDongCode'] in conflicts and not t.get('canceled')
                                             and t['date'].startswith(month) for t in payload['trades'])}


def valid_stored_month(month, code, counts=None):
    if month.get('minimumHouseholds') != MIN_HOUSEHOLDS or not isinstance(month.get('members'), list):
        return False
    for entry in month['members']:
        if not isinstance(entry, list) or len(entry) != 4 or type(entry[3]) is not int or entry[3] < MIN_HOUSEHOLDS:
            return False
        if counts and counts.get(entry[0], entry[3]) < MIN_HOUSEHOLDS:
            return False
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


def seed_recent_months(existing, raw, wanted, household_lookup):
    # The first month of a rolling-year snapshot may start mid-month.
    start = update.window_start(dt.date.fromisoformat(raw['asOf']))
    cutoff = start.strftime('%Y-%m')
    for month in wanted:
        full = cutoff < month or (cutoff == month and start.day == 1)
        newer = month not in existing or raw['updatedAt'] >= existing[month]['updatedAt']
        if full and month <= raw['asOf'][:7] and newer:
            existing[month] = summarize(raw, month, raw['updatedAt'], household_lookup)


def collect_history(districts, today, registry, fetcher, budget=1400, dest=None, nationwide=None,
                    household_lookup=None, verified_counts=None, seoul_backfill=False, backfill_only=False):
    dest = dest or ROOT/'data/trends'
    nationwide = nationwide or ROOT/'data/nationwide'
    wanted = months_for(today)
    states = {}
    verified_counts = verified_counts or {}
    for d in districts:
        code = d['code']; path = dest/(code+'.json')
        state = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {
            'schemaVersion': 1, 'kind': 'regional-monthly-median', 'districtCode': code, 'name': d['name'], 'months': []}
        existing = {m['month']: m for m in state['months'] if m['month'] in wanted and valid_stored_month(m, code, verified_counts)}
        raw_path = nationwide/(code+'.json')
        if raw_path.exists():
            raw = json.loads(raw_path.read_text(encoding='utf-8'))
            seed_recent_months(existing, raw, wanted, household_lookup)
        state['months'] = existing
        state['asOf'] = today.isoformat()
        state['failedMonths'] = []
        states[code] = state
    priority = {code: i for i, code in enumerate(PRIORITY)}
    active = [d for d in districts if d['code'].startswith(TREND_REGIONS)]
    ordered = sorted(active, key=lambda d: (priority.get(d['code'], 999), d['code']))
    groups = [[d for d in ordered if d['code'].startswith(prefix)] for prefix in TREND_REGIONS]
    balanced = [d for group in zip_longest(*groups) for d in group if d is not None]
    jobs = [(d, month) for month in reversed(wanted) for d in balanced if month not in states[d['code']]['months']]
    # Update each Seoul district's recent months before moving on to older years.
    seoul = [d for d in ordered if d['code'].startswith('11')]
    seoul_jobs = [(d, month) for month in reversed(wanted) for d in seoul
                  if 'members' not in states[d['code']]['months'].get(month, {})]
    # Revalidate old snapshots after bootstrap, so late cancellations can be removed.
    old = sorted([(d, m) for d in ordered for m in states[d['code']]['months'].values()
                  if m['updatedAt'][:10] < (today-dt.timedelta(days=90)).isoformat()], key=lambda x:x[1]['updatedAt'])
    if seoul_backfill:
        jobs = seoul_jobs
    else:
        tasks = jobs
        if not backfill_only:
            tasks.extend((d, m['month']) for d, m in old)
        jobs = list({(d['code'], month): (d, month) for d, month in tasks}.values())
    jobs = jobs[:max(0, budget)]
    stop = threading.Event()
    failures = consecutive_failures = attempts = 0
    reasons = {}
    def job(task):
        d, month = task
        if stop.is_set(): return d['code'], month, None, False, ''
        try:
            first = dt.date.fromisoformat(month+'-01')
            value = district_payload(d['code'], d['name'], [month.replace('-', '')], today, registry,
                                     fetcher, start=first)
            result = summarize(value, month, dt.datetime.now(update.KST).isoformat(), household_lookup)
            return d['code'], month, result, True, ''
        except Exception as exc:
            # Log only a whitelisted API result code or exception class, never a URL/key.
            code = exc.code if isinstance(exc, update.APIRequestError) else None
            reason = 'API_' + code if code is not None else type(exc).__name__
            if isinstance(exc, update.APIRequestError) and exc.stops_batch:
                stop.set()
            return d['code'], month, None, True, reason
    with concurrent.futures.ThreadPoolExecutor(max_workers=8 if seoul_backfill or backfill_only else 6) as pool:
        for i, (code, month, value, attempted, reason) in enumerate(pool.map(job, jobs), 1):
            attempts += attempted
            if value is not None:
                states[code]['months'][month] = value
                consecutive_failures = 0
            elif attempted:
                failures += 1
                consecutive_failures += 1
                states[code]['failedMonths'].append(month)
                reasons[reason] = reasons.get(reason, 0)+1
                print(f'10년 추세 {code}/{month} 수신 실패 ({reason})', flush=True)
                if consecutive_failures >= 5: stop.set()
            if i % 100 == 0 or i == len(jobs):
                print(f'10년 추세 조회 {attempts}/{len(jobs)} · 실패 {failures}', flush=True)
    index = []
    for d in districts:
        code = d['code']; state = states[code]
        state['months'] = sorted(state['months'].values(), key=lambda m:m['month'])
        stamps = [m['updatedAt'] for m in state['months']]
        state['updatedAt'] = max(stamps) if stamps else None
        state['windowStart'] = wanted[0]
        compact_json(dest/(code+'.json'), state)
        index.append({'code':code,'name':d['name'],'availableMonths':len(state['months']),
                      'memberMonths':sum('members' in m for m in state['months']),
                      'totalMonths':len(wanted),'failedMonths':len(state['failedMonths'])})
    compact_json(dest/'index.json', {'schemaVersion':1,'asOf':today.isoformat(),'minimumHouseholds':MIN_HOUSEHOLDS,'districts':index,
                                    'attemptedRequests':attempts,'failedRequests':failures,'failureReasons':reasons,'monthBudget':budget,
                                    'source':'https://www.data.go.kr/data/15126468/openapi.do'})
    if not failures:
        compact_json(dest/'v2.complete.json', {'collectorVersion':2,'checkedAt':today.isoformat()})
    compact_json(dest/'complex-coverage.json', {'started': True})
    if verified_counts:
        compact_json(dest/'complex-coverage-v2.json', {'verifiedHouseholds': True})
    if seoul_backfill or (seoul and all(row['memberMonths'] == len(wanted) for row in index if row['code'].startswith('11'))):
        complete = sum(row['memberMonths'] == len(wanted) for row in index if row['code'].startswith('11'))
        compact_json(dest/'seoul-coverage.json', {'districts': len(seoul), 'completeDistricts': complete})
    print(f'10년 추세: 지역 {len(index)}개 · 완성 {sum(d["availableMonths"]==120 for d in index)}개 · 실패 {failures}', flush=True)
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--budget', type=int, default=int(os.environ.get('HISTORY_MONTH_BUDGET', '1400')))
    parser.add_argument('--households-csv', type=Path, help='Use an official local CSV instead of downloading it')
    parser.add_argument('--seoul-backfill', action='store_true', default=os.environ.get('SEOUL_TREND_BACKFILL') == 'true')
    parser.add_argument('--backfill-only', action='store_true', default=os.environ.get('HISTORY_BACKFILL_ONLY') == 'true')
    args = parser.parse_args()
    key = os.environ.get('MOLIT_SERVICE_KEY', '').strip()
    if args.budget and not key:
        print('10년 추세: MOLIT_SERVICE_KEY 없음', file=sys.stderr)
        return 1
    districts = json.loads((ROOT/'data/districts.json').read_text(encoding='utf-8'))['districts']
    index = {}
    try:
        if args.households_csv:
            from scripts.trend_households import read_households
            raw_csv = args.households_csv.read_bytes()
            try:
                csv_text = raw_csv.decode('utf-8-sig')
            except UnicodeDecodeError:
                csv_text = raw_csv.decode('cp949')
            index = read_households(csv_text)
        elif args.budget or os.environ.get('REFRESH_TREND_HOUSEHOLDS') == '1':
            index = download_households()
        if index:
            print(f'공식 세대수 주소·이름 조합 {len(index):,}개', flush=True)
    except (OSError, ValueError, KeyError):
        print('공식 세대수 자료 수신 실패 · 기존 확인값 유지', flush=True)
    registry = update.load_registry()
    trends = ROOT/'data/trends'
    counts = stored_household_counts(trends)
    counts.update(counts_by_trade_id(index, registry))
    if counts:
        compact_json(trends/'households.json', counts)
    request_lock = threading.Lock()
    next_request = 0.0

    def fetch(code, month):
        nonlocal next_request
        with request_lock:
            now = time.monotonic()
            wait = max(0, next_request - now)
            next_request = now + wait + .25
        if wait:
            time.sleep(wait)
        return update.fetch_month(key, code, month)

    return collect_history(districts, dt.datetime.now(update.KST).date(), registry,
                           fetch, args.budget,
                           household_lookup=lambda c: household_count(c, index) or counts.get(c['id']),
                           verified_counts=counts,
                           seoul_backfill=args.seoul_backfill,
                           backfill_only=args.backfill_only)


if __name__ == '__main__':
    raise SystemExit(main())
