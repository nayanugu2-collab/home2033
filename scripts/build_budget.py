"""Build small public indexes of observed six-month apartment purchase prices."""
import datetime as dt
import json
from collections import defaultdict

import update
from scripts.collect_trends import TREND_REGIONS, identity_conflicts


def district_budget(snapshot, name):
    as_of = dt.date.fromisoformat(snapshot['asOf'])
    cutoff = update.window_start(as_of, 6).isoformat()
    known = {c['id']: c for c in snapshot['complexes'] if c.get('comparisonEligible') is not False}
    conflicts = {month: identity_conflicts(snapshot, month) for month in
                 {t['date'][:7] for t in snapshot['trades'] if cutoff <= t['date'] <= snapshot['asOf']}}
    prices_by_complex = defaultdict(dict)
    for trade in snapshot['trades']:
        date = trade['date']
        complex_id = trade['complexId']
        district_complex = known.get(complex_id)
        if trade.get('canceled') or not district_complex or not cutoff <= date <= snapshot['asOf']:
            continue
        dong = district_complex['legalDongCode']
        if trade['legalDongCode'] != dong or dong in conflicts[date[:7]]:
            continue
        area = trade['area']
        band = update.area_class(area) or 'other'
        price = trade['priceManwon']
        prices = prices_by_complex[complex_id, band]
        if price not in prices or date > prices[price][0]:
            prices[price] = (date, area)
    by_dong = defaultdict(list)
    # Keep each observed price so a cheaper past trade cannot hide a recent
    # trade in the user's price range. Ties keep the latest supporting contract.
    for (complex_id, band), prices in sorted(prices_by_complex.items()):
        district_complex = known[complex_id]
        sales = [[price, *prices[price]] for price in sorted(prices, reverse=True)]
        by_dong[district_complex['legalDongCode']].append([complex_id, district_complex['name'], band, sales])
    names = {c['legalDongCode']: c['legalDong'] for c in known.values()}
    return {'code': snapshot['districtCode'], 'name': name, 'asOf': snapshot['asOf'], 'from': cutoff,
            'dongs': [{'code': dong, 'name': names[dong], 'sales': sales} for dong, sales in sorted(by_dong.items())]}


def build_budgets(data_dir, dest):
    districts = json.loads((data_dir/'districts.json').read_text(encoding='utf-8'))['districts']
    dest.mkdir(parents=True, exist_ok=True)
    for region in TREND_REGIONS:
        expected = [d for d in districts if d['code'].startswith(region)]
        covered = []
        for district in expected:
            path = data_dir/'nationwide'/f"{district['code']}.json"
            if not path.is_file():
                continue
            snapshot = json.loads(path.read_text(encoding='utf-8'))
            if snapshot.get('mode') == 'official' and snapshot.get('districtCode') == district['code']:
                covered.append(district_budget(snapshot, district['name']))
        value = {'schemaVersion': 2, 'region': region, 'districtCount': len(expected), 'districts': covered}
        (dest/f'{region}.json').write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
