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
assert "free-training.js" in assets
assert 'equipment.js' in assets and 'modes.js' in assets
assert 'equipment-page.js' in assets
assert 'competition.js' in assets
assert 'spectator.js' in assets and 'spectator.html' in assets
assert 'spectator-display.js' in assets and 'spectator.css' in assets
assert 'display: grid' not in assets['spectator.css']
assert 'grid-template' not in assets['spectator.css']
assert 'PSS_SPECTATOR.detach(this)' in assets['45.index.js']
assert 'connection.js' in assets
assert 'PSS_CONNECTION.attach(this,$s.Z)' in assets['index.js']
assert 'window.OnConnectEvent=function(){}' in assets['index.js']
assert 'PSS_CONNECTION.detachController(this)' in assets['45.index.js']
assert 'index.js' not in assets['spectator.html']
assert 'PSS_COMPETITION.attach(this,s.Z)' in assets['45.index.js']
assert 'PSS_COMPETITION.renderSettings(t,e)' in assets['45.index.js']
assert 'PSS_EQUIPMENT_PAGE.createComponent()' in assets['index.js']
for name in ['controller-fixes.js','modes.js','free-training.js','equipment.js']:
    assert 'ReadGameData' not in assets[name], name
assert 'Existing athlete' not in assets['free-training.js']
assert 'setParticipantEquipment' in assets['45.index.js']
assert 'PSS_EQUIPMENT.battery(r)' in assets['index.js']
assert 'name:"CompetitionSetup"' in assets['index.js']
assert "PSS_FREE_TRAINING.createComponent(a(8462).Z)" in assets["index.js"]
assert 'destination||"GameData"' in assets["744.index.js"]
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

test_root = Path(__file__).resolve().parents[1] / "test-results"
test_root.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir=test_root) as directory:
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
