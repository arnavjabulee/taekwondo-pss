"""Reproducible English web-interface build; vendor package stays untouched."""

from pathlib import Path
import json
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "LedaSportXunLian_V202"
OUTPUT = ROOT / "LedaSport-English"
TRANSLATIONS_PATH = ROOT / "src/translations.json"
TRANSLATIONS = json.loads(TRANSLATIONS_PATH.read_text(encoding="utf-8"))
RUNTIME = ROOT / "src/runtime"
STYLES = ROOT / "src/styles"
COURT_BUNDLES = ["698.index.js", "777.index.js", "586.index.js", "410.index.js"]
LITERAL = re.compile(r'"(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27')


def translate_literal(match):
    text = match[0]
    # Large literals belong to spreadsheet encoding tables, not interface text.
    if len(text) > 300 or "\ufffd" in text:
        return text
    # Sex markers used by the legacy weight-category parser are protocol/data tokens.
    if text in ('"男"', '"女"'):
        return text
    for chinese in sorted(TRANSLATIONS, key=len, reverse=True):
        text = text.replace(chinese, TRANSLATIONS[chinese])
    return text


def patch_sensor_messages(text):
    old = 'if(t=""+t,"DevData"==e)null!=this.devdata_cb&&this.devdata_cb(t);'
    new = 'if(t=""+t,"DevData"==e){window.LEDA_SENSOR_MONITOR.receive(t);null!=this.devdata_cb&&this.devdata_cb(t);}'
    if old not in text:
        raise ValueError("Cannot find DevData message dispatch")
    return text.replace(old, new, 1)


def replace_once(text, old, new, description):
    """Fail clearly if a different vendor build changes an integration anchor."""
    if text.count(old) != 1:
        raise ValueError(f"{description}: expected one integration anchor")
    return text.replace(old, new, 1)


def patch_controller(text):
    text = replace_once(
        text,
        'return e("div",{staticStyle:',
        'return e("div",{staticClass:"leda-training",staticStyle:',
        "Training root",
    )
    text = text.replace(
        'staticClass:"navbar navbar-fixed-bottom"',
        'staticClass:"navbar navbar-fixed-bottom leda-training-controls"',
        1,
    )
    text = text.replace(
        'staticClass:"text-center",staticStyle:{height:"10vh",background:"yellow"',
        'staticClass:"text-center leda-round",staticStyle:{height:"10vh",background:"yellow"',
        1,
    )
    text = text.replace(
        'e("div",{staticStyle:{height:"10vh",background:"yellow"',
        'e("div",{staticClass:"leda-timer",staticStyle:{height:"10vh",background:"yellow"',
        1,
    )
    text = text.replace("Area x ", "Courts × ")
    start = text.index("gamer_changed:function")
    end = text.index(",warning_plus:function", start)
    text = (
        text[:start]
        + "gamer_changed:function(t,e){return window.LEDA_CONTROLLER_FIXES.changeAthlete(this,s.Z,t,e)}"
        + text[end:]
    )
    text = text.replace(
        "gameControl:function(){",
        "gameControl:function(){if(2!==this.gvi.game_state&&!window.LEDA_CONTROLLER_FIXES.canStart(this))return;",
    )
    start = text.index("handleDevData:function")
    end = text.index(",handleVkSpace:function", start)
    text = (
        text[:start]
        + "handleDevData:function(t){return window.LEDA_CONTROLLER_FIXES.scoreHit(this,s.Z,t)}"
        + text[end:]
    )
    text = text.replace(
        "this.Update_Changdi_Data(),",
        "this.Update_Changdi_Data(),window.LEDA_SENSOR_MONITOR.clamp(this,s.Z),",
    )
    text = text.replace("view_mode:0,", "view_mode:s.Z.court_view_mode||0,")
    start = text.index("lidu_plus:function")
    end = text.index(",toukui_changed:function", start)
    text = (
        text[:start]
        + "lidu_plus:function(t){return window.LEDA_SENSOR_MONITOR.step(this,s.Z,t,1)}"
        + text[end:]
    )
    start = text.index("lidu_reduce:function")
    end = text.index(",lidu_plus:function", start)
    text = (
        text[:start]
        + "lidu_reduce:function(t){return window.LEDA_SENSOR_MONITOR.step(this,s.Z,t,-1)}"
        + text[end:]
    )
    text = text.replace(
        "handleVkSpace:function(){",
        "handleVkSpace:function(){if(window.LEDA_SENSOR_MONITOR.isOpen())return;",
    )
    text = text.replace(
        "mounted:function(){var t=this;",
        "mounted:function(){window.LEDA_SENSOR_MONITOR.attach(this,s.Z);var t=this;",
    )
    text = text.replace(
        "beforeDestroy:function(){this.$parent.stopGame()",
        "beforeDestroy:function(){window.LEDA_SENSOR_MONITOR.detach();this.$parent.stopGame()",
    )
    return text


def patch_athletes(text):
    start = text.index("to_game:function")
    end = text.index(",changci_changed:function", start)
    text = (
        text[:start]
        + 'to_game:function(){try{window.LEDA_CONTROLLER_FIXES.prepareCourts(n.Z,this.settings)}catch(e){window.alert(e.message);return}n.Z.SaveGameInfo();this.$router.push({name:"GameCtrl"})}'
        + text[end:]
    )
    text = text.replace(
        'staticClass:"container-fluid text-center"',
        'staticClass:"container-fluid text-center leda-athletes"',
        1,
    )
    text = text.replace(
        "methods:{",
        "methods:{courtLabel:function(e){return window.LEDA_CONTROLLER_FIXES.courtLabel(this.data,e)},assignCourt:function(i,e){return window.LEDA_CONTROLLER_FIXES.assignCourt(this,i,e,n.Z)},",
        1,
    )
    columns = (ROOT / "src/integration/athlete-columns.js").read_text(encoding="utf-8")
    columns = columns[columns.index("[") :].strip().rstrip(";")[1:-1]
    cell = 'a("td",[t._v(t._s(e.huju))])'
    text = replace_once(text, cell, cell + "," + columns, "Athlete columns")
    text = text.replace(
        'a("td",[t._v("Body Protector ID")])',
        'a("td",[t._v("Body Protector ID")]),a("td",[t._v("Court")]),a("td",[t._v("Colour")])',
    )
    text = text.replace(
        'a("thead",[t._m(0)',
        'a("caption",[t._v("Choose a court for each athlete. Two athletes per court; blue and red are assigned automatically.")]),a("thead",[t._m(0)',
    )
    text = text.replace(
        "null!=(a=n.Z.ReadGameData(t))&&this.data.push(a)",
        'null!=(a=n.Z.ReadGameData(t))&&(Object.defineProperty(a,"_storageIndex",{value:t,configurable:true}),this.data.push(a))',
    )
    return text


def patch_court_readings(text):
    text = text.replace('background:"#070656"', 'background:"#152e57"').replace(
        'background:"#621B1C"', 'background:"#542b38"'
    )
    text = replace_once(
        text,
        'return i("div",[',
        'return i("div",{staticClass:"leda-courts"},[',
        "Court view",
    )
    for side in ["left", "right"]:
        score = (
            'i("div",{staticClass:"game-score"},[t._v(t._s(t.gvi.game[e].'
            + side
            + ".score))])"
        )
        reading = (ROOT / "src/integration/court-reading.js").read_text(
            encoding="utf-8"
        )
        reading = (
            reading[reading.index("i(") :].strip().rstrip(";").replace("__SIDE__", side)
        )
        if score not in text:
            raise ValueError("Cannot find " + side + " court score")
        text = text.replace(score, score + "," + reading)
    return text


def build_assets():
    """Prepare all patched files before touching the working application."""
    web = SOURCE / "nginx/html/train"
    if not (web / "index.js").is_file():
        raise FileNotFoundError(f"Original Leda v2.02 package not found: {SOURCE}")
    assets = {}
    patchers = {
        "index.js": patch_sensor_messages,
        "45.index.js": patch_controller,
        "170.index.js": patch_athletes,
    }
    for source in web.glob("*.js"):
        original = source.read_text(encoding="utf-8")
        translated = (
            original
            if source.name == "84.index.js"
            else LITERAL.sub(translate_literal, original)
        )
        if source.name == "index.js":
            translated = replace_once(
                translated,
                "if(s===f.label)",
                "if(s===f.label||window.LEDA_EN_HEADERS[s]===f.label)",
                "Spreadsheet headers",
            )
        if source.name in patchers:
            translated = patchers[source.name](translated)
        if source.name in COURT_BUNDLES:
            translated = patch_court_readings(translated)
        assets[source.name] = translated

    aliases = {
        key: TRANSLATIONS[key] for key in ["序号", "姓名", "体重", "头盔", "护具"]
    }
    assets["english-headers.js"] = (
        "window.LEDA_EN_HEADERS=" + json.dumps(aliases, ensure_ascii=True) + ";"
    )
    html = (
        (web / "index.html")
        .read_text(encoding="utf-8")
        .replace("<html>", '<html lang="en">')
    )
    scripts = [
        "pss-core.js",
        "ui.js",
        "controller-fixes.js",
        "sensor-monitor.js",
        "english-headers.js",
    ]
    additions = "".join(f'<script src="{name}"></script>' for name in scripts)
    # Load our overrides after the vendor stylesheet, including lazy-loaded scoped CSS.
    html = html.replace(
        "</head>", '<link rel="stylesheet" href="english-controls.css"></head>'
    )
    html = html.replace("<head>", "<head>" + additions)
    html = re.sub(r"<title>.*?</title>", "<title>Leda PSS Training</title>", html)
    html = re.sub(r"<script>window.onerror=.*?</script>", "", html, flags=re.DOTALL)
    assets["index.html"] = html
    for source, target in [
        ("core.js", "pss-core.js"),
        ("ui.js", "ui.js"),
        ("controller.js", "controller-fixes.js"),
        ("sensors.js", "sensor-monitor.js"),
    ]:
        assets[target] = (RUNTIME / source).read_text(encoding="utf-8")
    assets["english-controls.css"] = (STYLES / "app.css").read_text(encoding="utf-8")
    return assets


def main():
    assets = build_assets()
    initial_build = not OUTPUT.exists()
    if initial_build:
        shutil.copytree(SOURCE, OUTPUT)
    web = OUTPUT / "nginx/html/train"
    web.mkdir(parents=True, exist_ok=True)
    for name, content in assets.items():
        (web / name).write_text(content, encoding="utf-8")
    launcher = (
        '@echo off\ncd /d "%~dp0"\nfor %%F in ("%~dp0*.exe") do (\n'
        '    start "" "%%~fF"\n    exit /b\n)\necho Application executable not found.\npause\n'
    )
    (OUTPUT / "Start-English.cmd").write_text(launcher, encoding="ascii")
    template = OUTPUT / "Athletes-English.csv"
    if not template.exists():
        template.write_text(
            "Number,Name,Weight,Helmet,Body Protector\n1,Athlete 1,60,,\n",
            encoding="utf-8-sig",
        )
    print(f"English package: {OUTPUT}")
    print(
        f"Updated {len(assets)} interface assets. Existing runtime data preserved."
        if not initial_build
        else f"Created application copy with {len(assets)} interface assets."
    )


if __name__ == "__main__":
    main()
