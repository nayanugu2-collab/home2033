"""Public, district-sharded search index. No service key is published."""
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
import re
import threading
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import update

DEST = ROOT / 'data' / 'nationwide'


def district_payload(code, name, months, today, registry, fetcher):
    complexes, trades = {}, []
    for month in months:
        for row in fetcher(code, month):
            if update.canceled(row):
                continue
            try:
                date = dt.date(int(row['dealYear']), int(row['dealMonth']), int(row['dealDay']))
                if not update.window_start(today) <= date <= today:
                    continue
                dong = str(row['umdCd']).zfill(5)
                if row['sggCd'] != code or len(dong) != 5 or not dong.isdigit() or date.strftime('%Y%m') != month:
                    raise ValueError()
                area, price = float(row['excluUseAr']), int(row['dealAmount'].replace(',', '').strip())
                if not 0 < area < 10000 or price <= 0:
                    raise ValueError()
                # Require an actual parcel as well as district, dong and apartment name.
                parcel = update.normalize_jibun(row.get('jibun', ''))
                if not re.fullmatch(r'\d+(?:-\d+)?', parcel) or not row.get('aptNm') or not row.get('umdNm'):
                    continue
            except (KeyError, ValueError):
                raise update.CollectionError(f'{code}/{month} 전국 거래 필드 오류') from None
            known = update.match_complex(row, registry)
            if known and known.get('comparisonEligible') is False:
                continue
            identity = '|'.join([code + dong, update.normalize_name(row['aptNm']), parcel])
            ident = known['id'] if known else 'n-' + hashlib.sha256(identity.encode()).hexdigest()[:20]
            if ident not in complexes:
                complexes[ident] = known or {
                    'id': ident, 'name': row['aptNm'], 'aliases': [row['aptNm']],
                    'region': name, 'districtCode': code, 'legalDongCode': code + dong,
                    'legalDong': row['umdNm'], 'jibuns': [parcel], 'households': None,
                    'verification': 'api-identity', 'checkedAt': today.isoformat(),
                    'sources': [{'label': '국토교통부 공식 실거래', 'url': 'https://www.data.go.kr/data/15126468/openapi.do'}],
                    'note': '공식 거래의 지역·법정동·명칭·지번 기준. 세대수는 확인되지 않았습니다.'
                }
            trades.append({
                'id': hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()[:20] + '-' + str(len(trades)),
                'complexId': ident, 'legalDongCode': code + dong, 'date': date.isoformat(),
                'area': area, 'priceManwon': price, 'floor': row.get('floor', ''),
                'buildYear': update.build_year(row.get('buildYear'), date.year),
                'dealingType': row.get('dealingGbn', ''), 'canceled': False
            })
    return {'schemaVersion': 2, 'mode': 'official', 'asOf': today.isoformat(),
            'updatedAt': dt.datetime.now(update.KST).isoformat(),
            'districtCode': code, 'complexes': list(complexes.values()), 'trades': trades}


def main():
    key = os.environ.get('MOLIT_SERVICE_KEY', '').strip()
    if not key:
        print('전국 수집: MOLIT_SERVICE_KEY 없음', file=sys.stderr)
        return 1
    registry = update.load_registry()
    today = dt.datetime.now(update.KST).date()
    months = update.contract_months(today)
    districts = json.loads((ROOT / 'data/districts.json').read_text(encoding='utf-8'))['districts']
    DEST.mkdir(parents=True, exist_ok=True)
    failures = []
    failed_count = 0
    stop = threading.Event()
    lock = threading.Lock()
    def job(district):
        nonlocal failed_count
        code = district['code']
        if stop.is_set():
            return code, False, 0
        try:
            def fetch(code, month):
                if stop.is_set():
                    raise update.CollectionError('전국 수집 중단')
                return update.fetch_month(key, code, month)
            payload = district_payload(code, district['name'], months, today, registry,
                                       fetch)
            path = DEST / (code + '.json')
            if not payload['trades'] and path.exists() and json.loads(path.read_text(encoding='utf-8'))['trades']:
                raise update.CollectionError('빈 응답: 이전 지역 데이터 유지')
            update.atomic_json(DEST / (code + '.json'), payload)
            return code, True, len(payload['trades'])
        except Exception:
            with lock:
                failed_count += 1
                if failed_count >= 10:
                    stop.set()  # Avoid thousands of retries during quota/authentication outages.
            # Preserve this district's last good snapshot, including its original timestamp.
            return code, False, 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for index, (code, ok, count) in enumerate(pool.map(job, districts), 1):
            if not ok:
                failures.append(code)
            print(f'전국 {index}/{len(districts)} · {code} · ' + (f'{count}건' if ok else '실패: 마지막 정상 자료 유지'), flush=True)
    complexes, timestamps, available = {}, [], 0
    for district in districts:
        path = DEST / (district['code'] + '.json')
        if path.exists():
            payload = json.loads(path.read_text(encoding='utf-8'))
            available += 1
            timestamps.append(payload['updatedAt'])
            complexes.update({c['id']: c for c in payload['complexes']})
    index = {'schemaVersion': 1, 'updatedAt': min(timestamps) if timestamps else None,
             'attemptedAt': dt.datetime.now(update.KST).isoformat(),
             'availableDistricts': available, 'totalDistricts': len(districts),
             'failedDistricts': failures, 'complexes': list(complexes.values()),
             'note': '최근 12개월에 매매 신고가 있는 전국 아파트. 거래가 없는 단지는 검색되지 않을 수 있습니다. 세대수 미확인 단지 포함.'}
    update.atomic_json(DEST / 'index.json', index)
    print(f'전국 검색 명부 {len(complexes)}개, 지역 자료 {available}/{len(districts)}, 실패 {len(failures)}개')
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
