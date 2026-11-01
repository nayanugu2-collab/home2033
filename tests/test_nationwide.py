import datetime as dt
import unittest
from scripts.collect_nationwide import district_payload
import update


class NationwideTests(unittest.TestCase):
    def raw(self, **overrides):
        row = dict(sggCd='26110', umdCd='10100', umdNm='중앙동1가', aptNm='전국검색시험', jibun='1-1',
                   dealYear='2026', dealMonth='10', dealDay='10', excluUseAr='84.9', dealAmount='100,000', buildYear='2019')
        return dict(row, **overrides)

    def payload(self, rows):
        return district_payload('26110', '부산광역시 중구', ['202610'], dt.date(2026,10,26), update.load_registry(), lambda *_:rows)

    def test_unknown_apartments_have_stable_identity_and_unknown_households(self):
        p = self.payload([self.raw(), self.raw(excluUseAr='74.9'), self.raw(jibun='1-2')])
        self.assertEqual(len(p['complexes']), 2)
        self.assertEqual(p['trades'][0]['complexId'], p['trades'][1]['complexId'])
        self.assertNotEqual(p['trades'][0]['complexId'], p['trades'][2]['complexId'])
        self.assertIsNone(p['complexes'][0]['households'])
        self.assertEqual(p['trades'][0]['legalDongCode'], '2611010100')

    def test_canceled_old_and_unidentifiable_contracts_are_not_catalog_entries(self):
        p = self.payload([self.raw(cdealType='O'), self.raw(jibun=''), self.raw(dealYear='2024')])
        self.assertEqual(p['complexes'], [])
        self.assertEqual(p['trades'], [])

    def test_wrong_district_is_failure_not_a_misidentified_price(self):
        with self.assertRaises(update.CollectionError): self.payload([self.raw(sggCd='11110')])
