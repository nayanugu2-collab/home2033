"""Inspect official API identity differences without accepting approximate matches."""
import datetime as dt
import difflib
import getpass
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import update


def audit():
    key = os.environ.get("MOLIT_SERVICE_KEY", "").strip() or getpass.getpass("MOLIT_SERVICE_KEY (hidden): ")
    registry = update.load_registry()
    today = dt.datetime.now(update.KST).date()
    output = ROOT / ".test-output" / "molit-audit"
    output.mkdir(parents=True, exist_ok=True)
    snapshots = {}
    for district in sorted({c["districtCode"] for c in registry["complexes"]}):
        for month in update.contract_months(today):
            snapshots[f"{district}/{month}"] = update.fetch_month(key, district, month)
        print(f"District {district} collected", flush=True)
    snapshot = {
        "collectedAt": dt.datetime.now(update.KST).isoformat(),
        "asOf": today.isoformat(), "responses": snapshots
    }
    update.atomic_json(output / "responses.json", snapshot)
    # Approximate name matches are audit suggestions only; they never approve trades.
    report = []
    rows = [row for batch in snapshots.values() for row in batch]
    for c in registry["complexes"]:
        scoped = [row for row in rows
                  if row.get("sggCd", "") + row.get("umdCd", "") == c["legalDongCode"]
                  and row.get("umdNm") == c["legalDong"]]
        aliases = {update.normalize_name(name) for name in c["aliases"]}
        matching = [row for row in scoped if update.match_complex(row, registry) == c]
        relevant = [row for row in scoped
                    if update.normalize_name(row.get("aptNm", "")) in aliases
                    or update.normalize_jibun(row.get("jibun", "")) in c["jibuns"]]
        if not relevant:
            names = sorted({row.get("aptNm", "") for row in scoped})
            close = difflib.get_close_matches(c["name"], names, n=3, cutoff=0.3)
            relevant = [row for row in scoped if row.get("aptNm") in close]
        identities = {}
        for row in relevant:
            fields = {k: row.get(k, "") for k in (
                "aptNm", "sggCd", "umdCd", "umdNm", "jibun", "roadNm", "roadNmBonbun",
                "roadNmBubun", "aptSeq", "buildYear"
            )}
            signature = json.dumps(fields, ensure_ascii=False, sort_keys=True)
            entry = identities.setdefault(signature, {"fields": fields, "count": 0, "areas": set()})
            entry["count"] += 1
            entry["areas"].add(row.get("excluUseAr", ""))
        entries = [{**v, "areas": sorted(v["areas"])} for v in identities.values()]
        report.append({"id": c["id"], "name": c["name"], "matched": len(matching), "observed": entries})
    update.atomic_json(output / "report.json", {
        "collectedAt": snapshot["collectedAt"], "note": "Suggestions only; no automatic identity changes.",
        "complexes": report
    })
    for c in report:
        if c["matched"] == 0:
            print(json.dumps(c, ensure_ascii=False), flush=True)
    print("Public API response cache and review report saved in ignored .test-output/molit-audit/")


if __name__ == "__main__":
    try:
        audit()
    except update.CollectionError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

