"""Compile TypeScript and copy extension assets into build/."""

import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
output = root / "build"
# Type checking happens before replacing the last successful build.
subprocess.run([str(root / "node_modules/.bin/tsc"), "--noEmit"], cwd=root, check=True)
shutil.rmtree(output, ignore_errors=True)
subprocess.run([str(root / "node_modules/.bin/tsc")], cwd=root, check=True)
shutil.copy2(root / "manifest.json", output / "manifest.json")
shutil.copytree(root / "icons", output / "icons")
for pattern in ("*.html", "*.css"):
    for source in (root / "src").glob(pattern):
        shutil.copy2(source, output / "src" / source.name)
