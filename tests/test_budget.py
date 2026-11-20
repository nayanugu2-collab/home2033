import unittest

from scripts.build_budget import district_budget


class BudgetDataTests(unittest.TestCase):
    def test_uses_six_month_band_minima_with_real_date_and_excludes_cancellations(self):
        complex_ = {'id': 'a', 'name': '아파트', 'legalDongCode': '1168010100', 'legalDong': '동'}
        base = {'complexId': 'a', 'legalDongCode': '1168010100', 'area': 84.95}
        transactions = [
            dict(base, date='2026-05-20', priceManwon=110000),
            dict(base, date='2026-05-21', priceManwon=130000),
            dict(base, date='2026-10-10', priceManwon=130000),
            dict(base, date='2026-11-13', priceManwon=100000, canceled=True),
            dict(base, date='2026-11-19', priceManwon=120000, area=59.5),
            dict(base, date='2026-11-18', priceManwon=150000, area=101),
        ]
        data = district_budget({'districtCode': '11680', 'asOf': '2026-11-20',
                                'complexes': [complex_], 'trades': transactions}, '강남구')
        self.assertEqual(data['from'], '2026-05-21')
        self.assertEqual(data['dongs'][0]['sales'], [
            ['a', '아파트', '59', 120000, '2026-11-19', 59.5],
            ['a', '아파트', '84', 130000, '2026-10-10', 84.95],
            ['a', '아파트', 'other', 150000, '2026-11-18', 101],
        ])
