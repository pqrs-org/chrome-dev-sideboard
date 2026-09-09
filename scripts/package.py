"""Build a store ZIP containing only extension runtime files."""

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "manifest.json").read_text())
files = [root / "manifest.json"]
files += sorted((root / "src").glob("*.js"))
files += sorted((root / "src").glob("*.html"))
files += sorted((root / "src").glob("*.css"))
files += [root / path for path in sorted(set(manifest["icons"].values()))]
output = root / "dist" / f"dev-sideboard-{manifest['version']}.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, path.relative_to(root))
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert "manifest.json" in archive.namelist()
print(output)
