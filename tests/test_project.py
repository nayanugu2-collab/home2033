import json
from pathlib import Path
import re
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
TEST_TEMP = ROOT / ".test-output"
TEST_TEMP.mkdir(exist_ok=True)


class ProjectContractTests(unittest.TestCase):
    def test_workflow_at_repository_root_and_direct_pages_deploy(self):
        workflow = (ROOT / ".github/workflows/update.yml").read_text(encoding="utf-8")
        for expected in ("17 22 * * *", "MOLIT_SERVICE_KEY: ${{ secrets.MOLIT_SERVICE_KEY }}",
                         "continue-on-error: true", "git add data/trades.json data/status.json",
                         "actions/configure-pages@", "actions/upload-pages-artifact@",
                         "actions/deploy-pages@", "pages: write", "id-token: write",
                         "steps.collect.outcome == 'failure'"):
            self.assertIn(expected.replace("\\${", "${"), workflow)
        self.assertLess(workflow.index("name: Deploy latest"), workflow.index("name: Report collection failure"))
        self.assertFalse((ROOT / "realestate_site").exists())

    def test_relative_asset_paths_support_pages_repository_subpath(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        for path in re.findall(r'(?:src|href)="(\./[^"#]+)', html):
            self.assertTrue((ROOT / path.split("?", 1)[0]).is_file(), path)

    def test_unique_element_ids_and_all_static_app_references_exist(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        ids = re.findall(r'\bid="([^"]+)"', html)
        self.assertEqual(len(ids), len(set(ids)))
        js = (ROOT / "assets/app.js").read_text(encoding="utf-8")
        for name in re.findall(r'\$\("([^"]+)"\)', js):
            self.assertIn(name, ids)

    def test_svg_favicon_well_formed(self):
        ET.parse(ROOT / "assets/favicon.svg")

    def test_sample_and_official_have_distinct_labels(self):
        for name, mode in (("sample", "sample"), ("trades", "official")):
            data = json.loads((ROOT / f"data/{name}.json").read_text(encoding="utf-8"))
            self.assertEqual(data["mode"], mode)

    def test_public_build_allowlist_excludes_secrets_workflows_and_source(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("build_site", ROOT / "scripts/build_site.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(dir=TEST_TEMP) as folder:
            module.DEST = Path(folder) / "site"
            module.build()
            self.assertTrue((module.DEST / "index.html").exists())
            self.assertTrue((module.DEST / "data/trades.json").exists())
            for excluded in (".env", ".github", "update.py", "tests", "scripts"):
                self.assertFalse((module.DEST / excluded).exists())

if __name__ == "__main__":
    unittest.main()

