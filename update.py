"""Fetch a complete rolling year; preserve the previous snapshot on any failure."""
import argparse
import calendar
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev"
KST = dt.timezone(dt.timedelta(hours=9))
PAGE_SIZE = 1000


class CollectionError(RuntimeError):
    pass


def shift_month(day, count):
    index = day.year * 12 + day.month - 1 + count
    year, month = divmod(index, 12)
    return dt.date(year, month + 1, min(day.day, calendar.monthrange(year, month + 1)[1]))


def window_start(today, months=12):
    return shift_month(today, -months) + dt.timedelta(days=1)


def contract_months(today):
    cursor = window_start(today).replace(day=1)
    months = []
    while cursor <= today:
        months.append(cursor.strftime("%Y%m"))
        cursor = shift_month(cursor, 1)
    return months


def load_registry(path=ROOT / "data" / "complexes.json"):
    registry = json.loads(path.read_text(encoding="utf-8"))
    ids = set()
    for c in registry["complexes"]:
        if c["id"] in ids or not re.fullmatch(r"\d{10}", c["legalDongCode"]):
            raise CollectionError("단지 명부 ID/법정동 코드 오류")
        ids.add(c["id"])
        if c["districtCode"] != c["legalDongCode"][:5]:
            raise CollectionError("단지 명부 지역 코드 불일치")
        if not c["jibuns"] or c["households"] < registry["minimumHouseholds"]:
            raise CollectionError("단지 명부 주소/세대수 오류")
        if not c["sources"] or c["verification"] != "reviewed":
            raise CollectionError("검증 출처 없는 단지")
    if registry["baseId"] not in ids:
        raise CollectionError("기준 단지 누락")
    return registry


def normalize_name(value):
    # Preserve digits and '단지'; no substring matching.
    return re.sub(r"[\s()（）·.,_\-]", "", str(value)).casefold()


def normalize_jibun(value):
    value = str(value).strip()
    if not re.fullmatch(r"\d+(?:-\d+)?", value):
        return value
    parts = [int(p) for p in value.split("-")]
    return str(parts[0]) + (f"-{parts[1]}" if len(parts) > 1 and parts[1] else "")


def address_matches(c, row):
    jibun = normalize_jibun(row.get("jibun", ""))
    if jibun in [normalize_jibun(x) for x in c["jibuns"]]:
        return True
    road_matches = any(
        normalize_name(row.get("roadNm", "")) == normalize_name(a["name"])
        and str(row.get("roadNmBonbun", "")).isdigit()
        and int(row["roadNmBonbun"]) == a["main"]
        and str(row.get("roadNmBubun", "0") or "0").isdigit()
        and int(row.get("roadNmBubun", "0") or "0") == a["sub"]
        for a in c.get("roadAddresses", [])
    )
    placeholder = not jibun or jibun.upper().startswith("BL")
    legacy = jibun in c.get("legacyJibuns", [])
    return road_matches and (placeholder or legacy)


def match_complex(row, registry):
    district = row.get("sggCd", "")
    umd_code = str(row.get("umdCd", "")).zfill(5)
    matches = [
        c for c in registry["complexes"]
        if c["districtCode"] == district
        and c["legalDongCode"] == district + umd_code
        and c["legalDong"] == row.get("umdNm", "").strip()
        and normalize_name(row.get("aptNm", "")) in {normalize_name(x) for x in c["aliases"]}
        and address_matches(c, row)
    ]
    return matches[0] if len(matches) == 1 else None


def area_class(area):
    for label, low, high in (("59", 58, 60), ("74", 73, 75), ("84", 83, 85.01)):
        if low <= area < high:
            return label
    return None


def canceled(row):
    return bool(row.get("cdealDay", "").strip()) or row.get("cdealType", "").strip().upper() in {
        "O", "Y", "YES", "1", "TRUE", "해제", "취소"
    }


def parse_response(xml):
    try:
        root = ET.fromstring(xml)
        code = root.findtext("./header/resultCode")
        if code not in ("000", "00", "0"):
            safe = code if code and re.fullmatch(r"[A-Za-z0-9_]{1,40}", code) else "INVALID_RESPONSE"
            raise CollectionError(f"API 응답 오류 ({safe})")
        body = root.find("body")
        if body is None:
            raise CollectionError("API body 누락")
        total = int(body.findtext("totalCount", "-1"))
        if total < 0 or total > 500000:
            raise CollectionError("API totalCount 오류")
        items = [{child.tag: (child.text or "").strip() for child in item}
                 for item in body.findall("./items/item")]
        return total, items
    except (ET.ParseError, ValueError) as exc:
        raise CollectionError("API XML/건수 형식 오류") from exc


def fetch_page(key, district, month, page, opener=urllib.request.urlopen, sleeper=time.sleep):
    params = {"serviceKey": urllib.parse.unquote(key), "LAWD_CD": district,
              "DEAL_YMD": month, "pageNo": page, "numOfRows": PAGE_SIZE}
    request = urllib.request.Request(
        ENDPOINT + "?" + urllib.parse.urlencode(params),
        headers={"User-Agent": "2033-home-gap/2.0"}
    )
    for attempt in range(3):
        try:
            with opener(request, timeout=25) as response:
                return parse_response(response.read())
        except (urllib.error.URLError, TimeoutError, OSError, CollectionError) as exc:
            if attempt == 2:
                if isinstance(exc, CollectionError):
                    raise
                raise CollectionError("API 네트워크/HTTP 요청 실패") from None
            sleeper(2 ** attempt)
    raise CollectionError("API 요청 실패")


def fetch_month(key, district, month, fetcher=fetch_page):
    total, items = fetcher(key, district, month, 1)
    result = list(items)
    seen = {json.dumps(items, sort_keys=True, ensure_ascii=False)}
    for page in range(2, math.ceil(total / PAGE_SIZE) + 1):
        next_total, batch = fetcher(key, district, month, page)
        signature = json.dumps(batch, sort_keys=True, ensure_ascii=False)
        if total != next_total or not batch or signature in seen:
            raise CollectionError("API 페이지 누락/중복/조회 중 건수 변경")
        seen.add(signature)
        result.extend(batch)
    if len(result) != total:
        raise CollectionError("API 전체 페이지 수집 건수 불일치")
    return result


def collect(key, registry, today, fetcher=fetch_month):
    districts = sorted({c["districtCode"] for c in registry["complexes"]})
    months = contract_months(today)
    start = window_start(today)
    trades, stats = [], {"received": 0, "canceled": 0, "unmatched": 0, "outsideWindow": 0}
    for district in districts:
        for month in months:
            try:
                rows = fetcher(key, district, month)
            except Exception:
                raise CollectionError(f"{district}/{month} 수집 실패: 마지막 정상 데이터 유지") from None
            stats["received"] += len(rows)
            for row in rows:
                if canceled(row):
                    stats["canceled"] += 1
                    continue
                c = match_complex(row, registry)
                if c is None or c.get("comparisonEligible") is False:
                    stats["unmatched"] += 1
                    continue
                try:
                    date = dt.date(int(row["dealYear"]), int(row["dealMonth"]), int(row["dealDay"]))
                    amount_text = row["dealAmount"].replace(",", "").strip()
                    if not re.fullmatch(r"\d+", amount_text):
                        raise ValueError()
                    amount, area = int(amount_text), float(row["excluUseAr"])
                    if amount <= 0 or not math.isfinite(area) or area <= 0:
                        raise ValueError()
                    if row.get("sggCd") != district or date.strftime("%Y%m") != month:
                        raise ValueError()
                except (KeyError, ValueError):
                    raise CollectionError(f"{district}/{month} 후보 거래 필드 오류") from None
                if not start <= date <= today:
                    stats["outsideWindow"] += 1
                    continue
                fingerprint = hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]
                # Do not collapse distinct contracts with identical disclosed fields.
                trades.append({
                    "id": fingerprint + "-" + str(len(trades)), "complexId": c["id"],
                    "name": row["aptNm"], "legalDongCode": c["legalDongCode"],
                    "districtCode": district, "legalDong": row["umdNm"], "jibun": row.get("jibun", ""),
                    "roadName": row.get("roadNm", ""), "area": area, "areaClass": area_class(area),
                    "priceManwon": amount, "date": date.isoformat(), "floor": row.get("floor", ""),
                    "aptDong": row.get("aptDong", ""), "aptSeq": row.get("aptSeq", ""),
                    "dealingType": row.get("dealingGbn", ""), "canceled": False
                })
    if stats["received"] == 0:
        raise CollectionError("전 지역 응답 0건: 비정상 응답 가능성으로 마지막 정상 데이터 유지")
    return {
        "schemaVersion": 2, "mode": "official", "updatedAt": dt.datetime.now(KST).isoformat(),
        "asOf": today.isoformat(), "windowStart": start.isoformat(), "months": months,
        "source": "국토교통부 아파트 매매 실거래가 상세 자료",
        "sourceUrl": "https://www.data.go.kr/data/15126468/openapi.do",
        "registryCheckedAt": registry["checkedAt"], "statistics": stats,
        "trades": sorted(trades, key=lambda row: (row["date"], row["id"]), reverse=True)
    }


def atomic_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def run(data_dir=ROOT / "data", today=None, fetcher=fetch_month):
    now = dt.datetime.now(KST)
    today = today or now.date()
    key = os.environ.get("MOLIT_SERVICE_KEY", "").strip()
    try:
        if not key:
            raise CollectionError("MOLIT_SERVICE_KEY Secret이 설정되지 않았습니다.")
        registry = load_registry(data_dir / "complexes.json")
        payload = collect(key, registry, today, fetcher)
        atomic_json(data_dir / "trades.json", payload)
    except Exception as exc:
        message = str(exc) if isinstance(exc, CollectionError) else "수집 처리 오류: 마지막 정상 데이터 유지"
        atomic_json(data_dir / "status.json", {
            "lastAttemptAt": now.isoformat(), "ok": False, "message": message
        })
        print(message, file=sys.stderr)
        return 1
    atomic_json(data_dir / "status.json", {
        "lastAttemptAt": now.isoformat(), "ok": True, "message": "전체 지역·계약월 수집 완료"
    })
    print(f"수집 완료: {len(payload['trades'])}건 / 기준일 {today}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    args = parser.parse_args()
    sys.exit(run(args.data_dir))

