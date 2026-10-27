"""Create explicitly synthetic UI fixtures, never official market data."""
import datetime as dt
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from update import atomic_json, load_registry, shift_month, window_start

def generate():
    registry = load_registry()
    today = dt.date(2026, 10, 26)
    trades = []
    for index, c in enumerate(registry["complexes"]):
        if c.get("comparisonEligible") is False:
            continue  # National rental complexes never get synthetic sale prices either.
        if c["id"] in {"walkerhill", "pangyo11", "hansol-lg", "jeongdeun-shinhwa"}:
            continue  # UI must exercise legitimate missing-area states.
        bands = [59] if c["id"] == registry["baseId"] else [59, 74, 84]
        for months_ago in range(13):
            if (months_ago + index) % 5 == 2:
                continue
            month = shift_month(today.replace(day=1), -months_ago)
            for band in bands:
                for nth in range(1 if index % 4 == 0 else 2):
                    date = month.replace(day=27 if months_ago == 12 else 5 + nth * 12)
                    if date < window_start(today) or date > today:
                        continue
                    amount = 101000 + index * 2300 + (band - 59) * 900 - months_ago * 650 + nth * 1500
                    trades.append({
                        "id": f"sample-{index}-{band}-{months_ago}-{nth}",
                        "complexId": c["id"], "name": c["aliases"][0],
                        "legalDongCode": c["legalDongCode"], "districtCode": c["districtCode"],
                        "legalDong": c["legalDong"], "jibun": c["jibuns"][0],
                        "area": band + (0.87 if nth == 0 else 0.97), "priceManwon": amount,
                        "date": date.isoformat(), "floor": str(5 + nth * 8),
                        "canceled": False, "dealingType": "가상 거래"
                    })
    payload = {
        "schemaVersion": 2, "mode": "sample", "asOf": today.isoformat(),
        "updatedAt": None, "windowStart": window_start(today).isoformat(),
        "source": "UI 검증용 가상 데이터 · 실제 가격 아님",
        "trades": sorted(trades, key=lambda t: t["date"], reverse=True)
    }
    atomic_json(ROOT / "data" / "sample.json", payload)
    print(f"Created {len(trades)} synthetic sample records")

if __name__ == "__main__":
    generate()

