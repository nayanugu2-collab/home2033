"""Package only public static assets; credentials never enter the Pages artifact."""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "site"

def build():
    DEST.mkdir(exist_ok=True)
    for name in ("index.html", ".nojekyll", "README.md"):
        shutil.copy2(ROOT / name, DEST / name)
    for name in ("assets", "data", "docs"):
        shutil.copytree(ROOT / name, DEST / name, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("*.tmp"))
    print("Static Pages artifact ready: site/")

if __name__ == "__main__":
    build()

