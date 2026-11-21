import unittest

from scripts.build_budget import district_budget


class BudgetDataTests(unittest.TestCase):
    def test_retains_each_distinct_recent_price_and_uses_the_latest_contract_for_equal_prices(self):
        complex_ = {'id': 'a', 'name': '아파트', 'legalDongCode': '1168010100', 'legalDong': '동', 'households': 300}
        base = {'complexId': 'a', 'legalDongCode': '1168010100', 'area': 84.95}
        transactions = [
            dict(base, date='2026-05-20', priceManwon=110000),
            dict(base, date='2026-05-21', priceManwon=130000),
            dict(base, date='2026-10-10', priceManwon=130000),
            dict(base, date='2026-11-06', priceManwon=145000),
            dict(base, date='2026-11-06', priceManwon=146000, area=84.72),
            dict(base, date='2026-11-13', priceManwon=100000, canceled=True),
            dict(base, date='2026-11-19', priceManwon=120000, area=59.5),
            dict(base, date='2026-11-18', priceManwon=150000, area=101),
            dict(base, complexId='small', date='2026-11-20', priceManwon=150000),
            dict(base, complexId='unknown', date='2026-11-20', priceManwon=150000),
        ]
        data = district_budget({'districtCode': '11680', 'asOf': '2026-11-20',
                                'complexes': [complex_, dict(complex_, id='small', households=299),
                                              dict(complex_, id='unknown', households=None)], 'trades': transactions}, '강남구')
        self.assertEqual(data['from'], '2026-05-21')
        self.assertEqual(data['dongs'][0]['sales'], [
            ['a', '아파트', '59', [[120000, '2026-11-19', 59.5, 1]], 300],
            ['a', '아파트', '84', [[146000, '2026-11-06', 84.72, 1],
                                   [145000, '2026-11-06', 84.95, 3],
                                   [130000, '2026-10-10', 84.95, 3]], 300],
            ['a', '아파트', 'other', [[150000, '2026-11-18', 101, 1]], 300],
        ])
