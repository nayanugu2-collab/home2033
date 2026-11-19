import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from scripts.collect_trends import aggregate_month, collect_history, months_for
from scripts.collect_nationwide import district_payload
import update


class TrendTests(unittest.TestCase):
    def raw(self, **changes):
        return dict(dict(sggCd='41135', umdCd='11000', umdNm='백현동', aptNm='시험', jibun='1',
                         dealYear='2017', dealMonth='01', dealDay='10', excluUseAr='84.9', dealAmount='100,000'), **changes)

    def test_historical_parser_preserves_old_rows_only_when_explicitly_requested(self):
        args = ('41135','분당',['201701'],dt.date(2026,11,19),update.load_registry(),lambda *_:[self.raw()])
        self.assertEqual(district_payload(*args)['trades'],[])
        self.assertEqual(len(district_payload(*args,start=dt.date(2017,1,1))['trades']),1)

    def test_all_area_and_district_medians_are_from_contracts_not_medians_of_medians(self):
        p = district_payload('41135','분당',['201701'],dt.date(2026,11,19),update.load_registry(),
            lambda *_:[self.raw(),self.raw(dealAmount='110,000'),self.raw(umdCd='10500',umdNm='서현동',jibun='2',excluUseAr='101',dealAmount='300,000')], start=dt.date(2017,1,1))
        rows=aggregate_month(p,'2017-01')
        all_row=next(r for r in rows if r['dongCode']=='all' and r['area']=='all')
        self.assertEqual((all_row['priceManwon'],all_row['count'],all_row['complexCount']),(110000,3,2))
        self.assertEqual(next(r for r in rows if r['dongCode']=='all' and r['area']=='84')['priceManwon'],105000)

    def test_month_window_is_120_buckets_including_current_month(self):
        values=months_for(dt.date(2026,11,19))
        self.assertEqual((len(values),values[0],values[-1]),(120,'2016-12','2026-11'))

    def test_resume_and_failure_preserve_month_values_and_never_publish_exception_text(self):
        with tempfile.TemporaryDirectory(dir=update.ROOT/'.test-output') as folder:
            root=Path(folder); dest=root/'trends'; dest.mkdir()
            old={'schemaVersion':1,'kind':'regional-monthly-median','districtCode':'41135','name':'분당','months':[
                {'month':'2017-01','updatedAt':'2026-11-01T00:00:00+09:00','rows':[{'keep':1}]}]}
            (dest/'41135.json').write_text(json.dumps(old),encoding='utf-8')
            def fail(*_):raise RuntimeError('secret-in-url')
            result=collect_history([{'code':'41135','name':'분당'}],dt.date(2026,11,19),update.load_registry(),fail,1,dest,root/'raw')
            value=json.loads((dest/'41135.json').read_text(encoding='utf-8'))
            self.assertEqual(result,1)
            self.assertEqual(next(m for m in value['months'] if m['month']=='2017-01'),old['months'][0])
            self.assertNotIn('secret-in-url',json.dumps(value))
            self.assertEqual(len(value['failedMonths']),1)

    def test_seed_does_not_mark_partial_first_month_as_complete_and_empty_months_are_known(self):
        with tempfile.TemporaryDirectory(dir=update.ROOT/'.test-output') as folder:
            root=Path(folder); raw=root/'raw'; raw.mkdir(); dest=root/'trends'
            p={'asOf':'2026-11-19','updatedAt':'2026-11-19T00:00:00+09:00','complexes':[],'trades':[]}
            (raw/'41135.json').write_text(json.dumps(p),encoding='utf-8')
            collect_history([{'code':'41135','name':'분당'}],dt.date(2026,11,19),update.load_registry(),lambda *_:[],0,dest,raw)
            value=json.loads((dest/'41135.json').read_text(encoding='utf-8'))
            self.assertEqual(len(value['months']),12)
            self.assertEqual(value['months'][0]['month'],'2025-12')
            self.assertEqual(value['months'][-1]['rows'],[])
