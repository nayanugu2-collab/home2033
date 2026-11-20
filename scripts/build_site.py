"""Package only public static assets; credentials never enter the Pages artifact."""
import shutil
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.build_budget import build_budgets
DEST = ROOT / "site"

def build():
    DEST.mkdir(exist_ok=True)
    for name in ("index.html", ".nojekyll", "README.md"):
        shutil.copy2(ROOT / name, DEST / name)
    for name in ("assets", "data", "docs"):
        shutil.copytree(ROOT / name, DEST / name, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("*.tmp"))
    build_budgets(ROOT / "data", DEST / "data" / "budget")
    print("Static Pages artifact ready: site/")

if __name__ == "__main__":
    build()

