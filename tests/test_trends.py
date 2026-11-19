import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from scripts.collect_trends import aggregate_month, collect_history, months_for
from scripts.collect_nationwide import district_payload
import update


class TrendTests(unittest.TestCase):
    def test_seoul_backfill_covers_each_district_before_older_months_and_leaves_other_regions_untouched(self):
        with tempfile.TemporaryDirectory(dir=update.ROOT/'.test-output') as folder:
            root = Path(folder)
            calls = []

            def fetch(code, month):
                calls.append((code, month))
                return []

            districts = [{'code': code, 'name': code} for code in ('41135', '11680', '11710')]
            result = collect_history(districts, dt.date(2026, 11, 19), update.load_registry(), fetch,
                                     2, root/'trends', root/'raw', seoul_backfill=True)
            self.assertEqual(result, 0)
            self.assertCountEqual(calls, [('11680', '202611'), ('11710', '202611')])
            index = json.loads((root/'trends/index.json').read_text(encoding='utf-8'))
            self.assertEqual([d['memberMonths'] for d in index['districts']], [0, 1, 1])

    def test_backfill_resumes_across_trend_regions_and_skips_other_regions(self):
        with tempfile.TemporaryDirectory(dir=update.ROOT/'.test-output') as folder:
            root = Path(folder)
            today = dt.date(2026, 11, 19)
            districts = [{'code': code, 'name': code}
                         for code in ('11680', '41111', '26110', '27110', '30110', '52111')]
            calls = []

            def fetch(code, month):
                calls.append((code, month))
                return []

            for budget in (1, 600):
                result = collect_history(districts, today, update.load_registry(), fetch,
                                         budget, root/'trends', root/'raw', backfill_only=True)
                self.assertEqual(result, 0)
                if budget == 1:
                    saved_path = root/'trends/11680.json'
                    saved = json.loads(saved_path.read_text(encoding='utf-8'))
                    saved['months'][0]['updatedAt'] = '2025-01-01T00:00:00+09:00'
                    saved_path.write_text(json.dumps(saved), encoding='utf-8')
            self.assertCountEqual(calls, [(code, month.replace('-', ''))
                                          for code in ('11680', '41111', '26110', '27110', '30110')
                                          for month in months_for(today)])
            index = json.loads((root/'trends/index.json').read_text(encoding='utf-8'))
            self.assertEqual([d['memberMonths'] for d in index['districts']], [120, 120, 120, 120, 120, 0])

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
                {'month':'2017-01','updatedAt':'2026-11-01T00:00:00+09:00','rows':[{'dongCode':'all','dongName':'전체','area':'all','priceManwon':100000,'count':1,'complexCount':1,'keep':1}]}]}
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

    def test_month_end_seed_keeps_complete_first_month_and_does_not_downgrade_newer_history(self):
        with tempfile.TemporaryDirectory(dir=update.ROOT/'.test-output') as folder:
            root=Path(folder); raw=root/'raw'; raw.mkdir(); dest=root/'trends'; dest.mkdir()
            p={'asOf':'2026-10-31','updatedAt':'2026-10-31T00:00:00+09:00','complexes':[],'trades':[]}
            (raw/'41135.json').write_text(json.dumps(p),encoding='utf-8')
            newer={'schemaVersion':1,'kind':'regional-monthly-median','districtCode':'41135','name':'분당','months':[
                {'month':'2026-01','updatedAt':'2026-11-01T00:00:00+09:00','rows':[{'dongCode':'all','dongName':'전체','area':'all','priceManwon':100000,'count':1,'complexCount':1,'keep':2}]}]}
            (dest/'41135.json').write_text(json.dumps(newer),encoding='utf-8')
            collect_history([{'code':'41135','name':'분당'}],dt.date(2026,10,31),update.load_registry(),lambda *_:[],0,dest,raw)
            result=json.loads((dest/'41135.json').read_text(encoding='utf-8'))
            self.assertEqual(len(result['months']),12)
            self.assertEqual(result['months'][0]['month'],'2025-11')
            self.assertEqual(next(m for m in result['months'] if m['month']=='2026-01')['rows'],[{'dongCode':'all','dongName':'전체','area':'all','priceManwon':100000,'count':1,'complexCount':1,'keep':2}])

    def test_conflicting_dong_names_with_same_code_are_excluded_from_both_dong_and_whole_region(self):
        from scripts.collect_trends import summarize
        p=district_payload('41135','분당',['201701'],dt.date(2026,11,19),update.load_registry(),
            lambda *_:[self.raw(),self.raw(umdNm='다른동',aptNm='다른단지',jibun='2'),self.raw(umdCd='10500',umdNm='서현동',jibun='3',dealAmount='900,000')],start=dt.date(2017,1,1))
        result=summarize(p,'2017-01','2026-11-19T00:00:00+09:00')
        self.assertEqual(result['excludedIdentityConflicts'],2)
        self.assertFalse(any(r['dongCode']=='4113511000' for r in result['rows']))
        total=next(r for r in result['rows'] if r['dongCode']=='all' and r['area']=='all')
        self.assertEqual((total['count'],total['priceManwon']),(1,900000))

    def test_official_households_require_one_apartment_matching_parcel_code_and_name(self):
        from scripts.trend_households import household_count, read_households
        source = '필지고유번호,단지고유번호,단지종류,세대수,단지명_공시가격,단지명_건축물대장,단지명_도로명주소\n'
        source += '4113511000100010000,A,1,500,시험,시험아파트,\n'
        source += '4113511000100020000,B,2,900,시험,,\n'
        index = read_households(source)
        unit = {'name':'시험아파트','legalDongCode':'4113511000','jibuns':['1']}
        self.assertEqual(household_count(unit,index),500)
        self.assertIsNone(household_count(dict(unit,jibuns=['2']),index))
        self.assertIsNone(household_count(dict(unit,legalDongCode='4113510500'),index))
        self.assertIsNone(household_count(dict(unit,name='다른 단지'),index))
        self.assertIsNone(household_count(unit,read_households(source+'4113511000100010000,C,1,600,시험아파트,,\n')))

    def test_summary_records_distinct_complex_separately_from_transaction_count(self):
        from scripts.collect_trends import summarize
        rows = [self.raw(excluUseAr='59.5'),self.raw(),self.raw(),self.raw(umdCd='10500',umdNm='서현동',jibun='2',excluUseAr='101')]
        p = district_payload('41135','분당',['201701'],dt.date(2026,11,19),update.load_registry(),lambda *_:rows,start=dt.date(2017,1,1))
        value = summarize(p,'2017-01','2026-11-19T00:00:00+09:00',lambda c:500 if c['legalDong']=='백현동' else None)
        members = {dong:(mask,count) for _,dong,mask,count in value['members']}
        self.assertEqual(members,{'4113511000':(5,500),'4113510500':(0,None)})

    def test_dongtan_before_district_change_matches_exact_parcel_and_name(self):
        from hashlib import sha256
        from scripts.trend_households import counts_by_trade_id, household_count, read_households
        csv = '필지고유번호,단지고유번호,단지종류,세대수,단지명_공시가격,단지명_건축물대장,단지명_도로명주소\n'
        csv += '4159012900109640000,A,1,538,동탄역신미주,,\n'
        index = read_households(csv)
        unit = {'name':'동탄역신미주','legalDongCode':'4159711500','jibuns':['964']}
        self.assertEqual(household_count(unit,index),538)
        self.assertIsNone(household_count(dict(unit,jibuns=['965']),index))
        new_id = 'n-' + sha256('4159711500|동탄역신미주|964'.encode()).hexdigest()[:20]
        self.assertEqual(counts_by_trade_id(index,{'complexes':[]})[new_id],538)
