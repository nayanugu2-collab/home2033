import copy
import datetime as dt
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.parse

import update

TODAY = dt.date(2026, 10, 26)
TEST_TEMP = update.ROOT / ".test-output"
TEST_TEMP.mkdir(exist_ok=True)


class CollectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = update.load_registry()
        cls.base = next(c for c in cls.registry["complexes"] if c["id"] == "base")

    def raw(self, c=None, **changes):
        c = c or self.base
        row = {
            "sggCd": c["districtCode"], "umdCd": c["legalDongCode"][5:],
            "umdNm": c["legalDong"], "aptNm": c["aliases"][0], "jibun": c["jibuns"][0],
            "dealYear": "2026", "dealMonth": "10", "dealDay": "5", "excluUseAr": "59.8732",
            "dealAmount": "112,000", "floor": "10", "cdealType": "", "cdealDay": ""
        }
        row.update(changes)
        return row

    def fake_fetcher(self, extra=None):
        def fetcher(key, district, month):
            if district == self.base["districtCode"] and month == "202610":
                return [self.raw(), *(extra or [])]
            return []
        return fetcher

    def test_rolling_year_queries_partial_boundary_month(self):
        self.assertEqual(update.window_start(TODAY), dt.date(2025, 10, 27))
        months = update.contract_months(TODAY)
        self.assertEqual((months[0], months[-1], len(months)), ("202510", "202610", 13))
        self.assertEqual(update.shift_month(dt.date(2024, 3, 31), -1), dt.date(2024, 2, 29))

    def test_optional_build_year_is_preserved_without_losing_valid_prices(self):
        for value, expected in [("2019", 2019), (" 2019 ", 2019), (None, None), ("", None),
                                ("0", None), ("1899", None), ("2027", None), ("2019.5", None), ("bad", None)]:
            with self.subTest(value=value):
                result = update.collect("test", self.registry, TODAY, self.fake_fetcher([self.raw(buildYear=value)]))
                self.assertEqual(len(result["trades"]), 2)
                self.assertEqual(sum(t["buildYear"] == expected for t in result["trades"]), 2 if expected is None else 1)
                self.assertTrue(all(t["priceManwon"] == 112000 for t in result["trades"]))

    def test_each_registry_identity_is_unambiguous(self):
        self.assertEqual(len({c["id"] for c in self.registry["complexes"]}), len(self.registry["complexes"]))
        for c in self.registry["complexes"]:
            with self.subTest(c=c["id"]):
                self.assertGreaterEqual(c["households"], 500)
                self.assertEqual(update.match_complex(self.raw(c), self.registry)["id"], c["id"])

    def test_bundang_expansion_preserves_requested_complexes_and_minimum_households(self):
        by_id = {c["id"]: c for c in self.registry["complexes"]}
        self.assertTrue({"botdeul1", "botdeul2", "botdeul3", "botdeul4", "botdeul5", "botdeul7",
                         "botdeul9", "seohyeon-samsung-hanshin", "seohyeon-hanyang", "hyoja-greentown",
                         "pangyowon5", "pangyowon9", "sanun11", "sanun12", "sanun13"} <= set(by_id))
        for ident in ("botdeul5", "botdeul6"):
            self.assertIs(by_id[ident]["comparisonEligible"], False)
            self.assertEqual(by_id[ident]["tenure"], "national-rental")
        excluded = {c["id"]: c for c in self.registry["excludedCandidates"]}
        self.assertEqual(excluded["botdeul8"]["households"], 447)
        self.assertNotIn("botdeul8", by_id)

    def test_shared_management_complex_aliases_match_but_neighboring_parcels_do_not(self):
        by_id = {c["id"]: c for c in self.registry["complexes"]}
        for ident, aliases in {"seohyeon-samsung-hanshin": ["시범삼성", "시범한신"],
                               "hyoja-greentown": ["효자촌(대우)", "효자촌(럭키)", "효자촌(화성)"]}.items():
            for alias in aliases:
                self.assertEqual(update.match_complex(self.raw(by_id[ident], aptNm=alias), self.registry)["id"], ident)
        self.assertIsNone(update.match_complex(self.raw(by_id["hyoja-greentown"], aptNm="효자촌(대창)", jibun="310"), self.registry))
        self.assertIsNone(update.match_complex(self.raw(by_id["botdeul5"], jibun="722"), self.registry))

    def test_national_rental_never_produces_sale_prices_even_if_api_row_is_present(self):
        by_id = {c["id"]: c for c in self.registry["complexes"]}
        def fetcher(key, district, month):
            if month != "202610":
                return []
            if district == self.base["districtCode"]:
                return [self.raw()]
            if district == "41135":
                return [self.raw(by_id[ident]) for ident in ("botdeul3", "botdeul5", "botdeul6")]
            return []
        result = update.collect("test", self.registry, TODAY, fetcher)
        self.assertEqual({t["complexId"] for t in result["trades"]}, {"base", "botdeul3"})

    def test_same_name_wrong_district_dong_code_dong_name_or_parcel_rejected(self):
        for change in ({"sggCd": "41135"}, {"umdCd": "99999"}, {"umdNm": "다른동"},
                       {"jibun": "999"}, {"jibun": ""}, {"aptNm": "동천센트럴자이2차"}):
            with self.subTest(change=change):
                self.assertIsNone(update.match_complex(self.raw(**change), self.registry))

    def test_missing_code_is_never_name_only_match(self):
        row = self.raw()
        del row["umdCd"]
        self.assertIsNone(update.match_complex(row, self.registry))

    def test_observed_official_api_identity_fixtures(self):
        path = update.ROOT / "tests/fixtures/observed-identities.json"
        fixtures = json.loads(path.read_text(encoding="utf-8"))
        for identity in fixtures["identities"]:
            with self.subTest(complex=identity["complexId"], name=identity["raw"]["aptNm"]):
                match = update.match_complex(identity["raw"], self.registry)
                self.assertIsNotNone(match)
                self.assertEqual(match["id"], identity["complexId"])

    def test_outdated_gwacheon_dong_codes_are_rejected(self):
        old_codes = {"gwacheon-xi": "10400", "prugio-summit": "10600",
                     "central-summit": "10500", "central-suite": "10400",
                     "eco-palace": "10600"}
        for complex_id, code in old_codes.items():
            c = next(c for c in self.registry["complexes"] if c["id"] == complex_id)
            self.assertIsNone(update.match_complex(self.raw(c, umdCd=code), self.registry))

    def test_other_sadang_lotte_parcel_is_not_goldenfore(self):
        c = next(c for c in self.registry["complexes"] if c["id"] == "goldenfore")
        row = self.raw(c, jibun="1149", roadNm="사당로", roadNmBonbun="90", roadNmBubun="0")
        self.assertIsNone(update.match_complex(row, self.registry))

    def test_placeholder_parcel_requires_exact_verified_road_number(self):
        row = self.raw(jibun="BL-", roadNm="고기로45번길", roadNmBonbun="00040", roadNmBubun="00018")
        self.assertEqual(update.match_complex(row, self.registry)["id"], "base")
        row["roadNmBubun"] = "19"
        self.assertIsNone(update.match_complex(row, self.registry))

    def test_known_wrong_parcel_cannot_be_rescued_by_road(self):
        row = self.raw(jibun="999", roadNm="고기로45번길", roadNmBonbun="40", roadNmBubun="18")
        self.assertIsNone(update.match_complex(row, self.registry))

    def test_cancel_type_and_cancel_date_excluded(self):
        extra = [self.raw(cdealType="O"), self.raw(cdealDay="26.10.10"), self.raw(cdealType="Y")]
        result = update.collect("test", self.registry, TODAY, self.fake_fetcher(extra))
        self.assertEqual(len(result["trades"]), 1)
        self.assertEqual(result["statistics"]["canceled"], 3)
        self.assertEqual(result["trades"][0]["priceManwon"], 112000)

    def test_future_and_old_trades_excluded(self):
        def fetcher(key, district, month):
            if district != self.base["districtCode"]:
                return []
            if month == "202510":
                return [self.raw(dealYear="2025", dealMonth="10", dealDay="26"),
                        self.raw(dealYear="2025", dealMonth="10", dealDay="27")]
            if month == "202610":
                return [self.raw(dealDay="27"), self.raw()]
            return []
        result = update.collect("test", self.registry, TODAY, fetcher)
        self.assertEqual([t["date"] for t in result["trades"]], ["2026-10-05", "2025-10-27"])

    def test_invalid_candidate_date_fails_closed(self):
        with self.assertRaises(update.CollectionError):
            update.collect("test", self.registry, TODAY, self.fake_fetcher([self.raw(dealDay="32")]))

    def test_no_collapse_of_indistinguishable_disclosed_contracts(self):
        result = update.collect("test", self.registry, TODAY, self.fake_fetcher([self.raw()]))
        self.assertEqual(len(result["trades"]), 2)
        self.assertNotEqual(result["trades"][0]["id"], result["trades"][1]["id"])

    def test_area_classes_do_not_mix_77_or_81_into_74_or_84(self):
        examples = {59.8732: "59", 59.9999: "59", 74.99: "74", 84.99: "84",
                    77.83: None, 81.99: None, 60: None, 85.1: None}
        for area, expected in examples.items():
            self.assertEqual(update.area_class(area), expected)

    def test_successful_xml_empty_result_is_valid(self):
        xml = b"<response><header><resultCode>000</resultCode></header><body><items/><totalCount>0</totalCount></body></response>"
        self.assertEqual(update.parse_response(xml), (0, []))

    def test_xml_errors_missing_header_and_total_rejected(self):
        for xml in (b"<response/>", b"invalid", b"<response><header><resultCode>30</resultCode></header></response>",
                    b"<response><header><resultCode>000</resultCode></header><body/></response>"):
            with self.assertRaises(update.CollectionError):
                update.parse_response(xml)

    def test_pagination_all_pages_collected(self):
        def page(key, district, month, number):
            return (1001, [{"id": str(i)} for i in range(1000)]) if number == 1 else (1001, [{"id": "last"}])
        self.assertEqual(len(update.fetch_month("test", "41465", "202610", page)), 1001)

    def test_pagination_truncation_or_duplicate_rejected(self):
        for second in [(1001, []), (1002, [{"id": "last"}]), (1001, [{"id": "first"}] * 1000)]:
            def page(key, district, month, number):
                return (1001, [{"id": "first"}] * 1000) if number == 1 else second
            with self.assertRaises(update.CollectionError):
                update.fetch_month("test", "41465", "202610", page)

    def test_network_retry_and_secret_redaction(self):
        attempts, pauses = [], []
        def opener(request, timeout):
            attempts.append(request)
            raise urllib.error.URLError("URL includes secret-123")
        with self.assertRaises(update.CollectionError) as context:
            update.fetch_page("secret-123", "41465", "202610", 1, opener, pauses.append)
        self.assertEqual((len(attempts), pauses), (3, [1, 2]))
        self.assertNotIn("secret-123", str(context.exception))

    def test_percent_encoded_key_only_decoded_once(self):
        captured = []
        def opener(request, timeout):
            captured.append(request.full_url)
            return io.BytesIO(b"<response><header><resultCode>000</resultCode></header><body><items/><totalCount>0</totalCount></body></response>")
        update.fetch_page("abc%2Bdef%3D", "41465", "202610", 1, opener)
        params = urllib.parse.parse_qs(urllib.parse.urlsplit(captured[0]).query)
        self.assertEqual(params["serviceKey"], ["abc+def="])

    def prepare_dir(self, directory):
        path = Path(directory)
        (path / "complexes.json").write_text(json.dumps(self.registry), encoding="utf-8")
        previous = b'{"schemaVersion":2,"updatedAt":"last-good","trades":[{"id":"keep"}]}'
        (path / "trades.json").write_bytes(previous)
        return path, previous

    def test_partial_failure_preserves_previous_file_bytes(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP) as folder:
            path, previous = self.prepare_dir(folder)
            def broken(key, district, month):
                if month == "202601":
                    raise urllib.error.URLError("secret-in-url")
                return []
            with patch.dict(os.environ, {"MOLIT_SERVICE_KEY": "secret-in-url"}):
                self.assertEqual(update.run(path, TODAY, broken), 1)
            self.assertEqual((path / "trades.json").read_bytes(), previous)
            status = json.loads((path / "status.json").read_text(encoding="utf-8"))
            self.assertIs(status["ok"], False)
            self.assertNotIn("secret-in-url", json.dumps(status))

    def test_missing_key_preserves_prices(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP) as folder:
            path, previous = self.prepare_dir(folder)
            with patch.dict(os.environ, {"MOLIT_SERVICE_KEY": ""}):
                self.assertEqual(update.run(path, TODAY), 1)
            self.assertEqual((path / "trades.json").read_bytes(), previous)

    def test_success_updates_prices_and_status_atomically(self):
        with tempfile.TemporaryDirectory(dir=TEST_TEMP) as folder:
            path, _ = self.prepare_dir(folder)
            with patch.dict(os.environ, {"MOLIT_SERVICE_KEY": "test"}):
                self.assertEqual(update.run(path, TODAY, self.fake_fetcher()), 0)
            payload = json.loads((path / "trades.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["mode"], "official")
            self.assertEqual(len(payload["trades"]), 1)
            self.assertIs(json.loads((path / "status.json").read_text(encoding="utf-8"))["ok"], True)
            self.assertFalse((path / "trades.json.tmp").exists())

    def test_all_zero_response_does_not_wipe_good_data(self):
        with self.assertRaises(update.CollectionError):
            update.collect("test", self.registry, TODAY, lambda *args: [])

    def test_valid_response_with_no_candidates_produces_no_invented_prices(self):
        def fetcher(key, district, month):
            return [self.raw(aptNm="미등록단지")] if district == self.base["districtCode"] and month == "202610" else []
        result = update.collect("test", self.registry, TODAY, fetcher)
        self.assertEqual(result["trades"], [])
        self.assertGreater(result["statistics"]["unmatched"], 0)


if __name__ == "__main__":
    unittest.main()

