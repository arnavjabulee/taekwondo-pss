"""Check integration anchors and ensure a rebuild preserves live application data."""

import contextlib
import importlib.util
import io
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "build", Path(__file__).with_name("build_english.py")
)
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

assets = build.build_assets()
assert "leda-athletes" in assets["170.index.js"]
assert "leda-impact" in assets["777.index.js"]
assert assets["index.html"].index("pss-core.js") < assets["index.html"].index(
    "controller-fixes.js"
)
assert "window.onerror" not in assets["index.html"]
try:
    build.replace_once("missing", "expected", "replacement", "Test anchor")
    raise AssertionError("Missing integration anchor was accepted")
except ValueError:
    pass

with tempfile.TemporaryDirectory() as directory:
    build.OUTPUT = Path(directory)
    sentinels = [
        "config",
        "LocalStorage/athletes.db",
        "native.exe",
        "Athletes-English.csv",
    ]
    for name in sentinels:
        target = build.OUTPUT / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"preserve existing working data")
    with contextlib.redirect_stdout(io.StringIO()):
        build.main()
    for name in sentinels:
        assert (build.OUTPUT / name).read_bytes() == b"preserve existing working data"

print(
    "Build checks passed: integration anchors, asset order, and runtime data preservation."
)
