"""Reproducible English web-interface build; vendor package stays untouched."""

from pathlib import Path
import json
import re
import shutil
import os
import stat
import subprocess
from PIL import Image
from prepare_native import prepare_native

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "vendor-source"
OUTPUT = ROOT / "UoBTKD Training Suite"
APP_NAME = json.loads((ROOT / "src/app.json").read_text(encoding="utf-8"))["name"]
TRANSLATIONS_PATH = ROOT / "src/translations.json"
TRANSLATIONS = json.loads(TRANSLATIONS_PATH.read_text(encoding="utf-8"))
TRANSLATIONS = {
    key: value.replace("{app_name}", APP_NAME) for key, value in TRANSLATIONS.items()
}
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
    if text in ('"\u7537"', '"\u5973"'):
        return text
    for chinese in sorted(TRANSLATIONS, key=len, reverse=True):
        text = text.replace(chinese, TRANSLATIONS[chinese])
    return text


def patch_sensor_messages(text):
    old = 'if(t=""+t,"DevData"==e)null!=this.devdata_cb&&this.devdata_cb(t);'
    new = 'if(t=""+t,"DevData"==e){window.UOBTKD_SENSOR_MONITOR.receive(t);null!=this.devdata_cb&&this.devdata_cb(t);}'
    if old not in text:
        raise ValueError("Cannot find DevData message dispatch")
    text = text.replace(old, new, 1)
    text = replace_once(text, '{path:"/gamedata",name:"GameData",component:function(e){return a.e(170).then(function(){var t=[a(2170)];e.apply(null,t)}.bind(this)).catch(a.oe)}}', '{path:"/gamedata",name:"GameData",component:window.PSS_EQUIPMENT_PAGE.createComponent()}', 'Equipment inventory route')
    text = replace_once(text, 'mounted:function(){if("Chrome"==$s.Z.GetBrowser())', 'mounted:function(){window.PSS_MODES.recover($s.Z);window.PSS_EQUIPMENT.attach(this,$s.Z);if("Chrome"==$s.Z.GetBrowser())', 'Equipment manager attachment')
    text=text.replace('window.PSS_EQUIPMENT.attach(this,$s.Z);','window.PSS_EQUIPMENT.attach(this,$s.Z);window.PSS_CONNECTION.attach(this,$s.Z);',1)
    text=replace_once(text,'window.OnConnectEvent=function(e){var t=parseInt(e);n.onClientState(t)}','window.OnConnectEvent=function(){}','MQTT-owned receiver state')
    text=replace_once(text,'i.on("close",(function(){console.log("mqtt ["+t.clientId+"] => onClose"),null!=a&&a(!1)})),','i.on("close",(function(){null!=a&&a(!1)})),i.on("offline",(function(){null!=a&&a(!1)})),i.on("error",(function(){null!=a&&a(!1)})),','MQTT disconnect/error listeners')
    text = replace_once(text, 'this.devstate_payload=e}', 'this.devstate_payload=e;window.PSS_EQUIPMENT.discover(e)}', 'Equipment discovery')
    text = text.replace('$s.Z.IS_ONLINE=e,this.online_cb', '$s.Z.IS_ONLINE=e,window.PSS_EQUIPMENT.setOnline(e),this.online_cb')
    text = text.replace('$s.Z.IS_ONLINE=!1,null!=this.online_cb', '$s.Z.IS_ONLINE=!1,window.PSS_EQUIPMENT.setOnline(!1),null!=this.online_cb')
    text = replace_once(text, '"DevBattery"==r.res&&null!=this.battery_cb&&this.battery_cb(r.from,r.batt_id)', '"DevBattery"==r.res&&(window.PSS_EQUIPMENT.battery(r),null!=this.battery_cb&&this.battery_cb(r.from,r.batt_id))', 'Equipment battery responses')
    return replace_once(
        text,
        'routes:[{path:"/",name:"Index"',
        'routes:[{path:"/settings",name:"AppSettings",component:window.PSS_SETTINGS.createComponent(a(8462).Z)},{path:"/competition",name:"CompetitionSetup",component:window.PSS_MODES.createComponent(a(8462).Z)},{path:"/free-training",name:"FreeTraining",component:window.PSS_FREE_TRAINING.createComponent(a(8462).Z)},{path:"/",name:"Index"',
        "Free training route",
    )


def replace_once(text, old, new, description):
    """Fail clearly if a different vendor build changes an integration anchor."""
    if text.count(old) != 1:
        raise ValueError(f"{description}: expected one integration anchor")
    return text.replace(old, new, 1)


def patch_controller(text):
    text = text.replace('methods:{','methods:{adjustCompetitionTechnical:function(side,type,delta){return window.UOBTKD_CONTROLLER_FIXES.adjustTechnical(this,s.Z,side,type,delta)},adjustCompetitionScore:function(side,delta){return window.UOBTKD_CONTROLLER_FIXES.adjustScore(this,s.Z,side,delta)},adjustCompetitionGamJeom:function(side,delta){return window.UOBTKD_CONTROLLER_FIXES.adjustGamJeom(this,s.Z,side,delta)},setParticipantName:function(area,side,value){return window.UOBTKD_CONTROLLER_FIXES.renameParticipant(this,s.Z,area,side,value)},setParticipantEquipment:function(area,side,key,value){return window.UOBTKD_CONTROLLER_FIXES.changeEquipment(this,s.Z,area,side,key,value)},',1)
    start=text.index('Update_Changdi_Data:function')
    end=text.index(',beforeDestroy:function',start)
    text=text[:start]+'Update_Changdi_Data:function(){return window.UOBTKD_CONTROLLER_FIXES.loadCourts(this,s.Z)}}'+text[end:]
    text = replace_once(
        text,
        'return e("div",{staticStyle:',
        'return e("div",{staticClass:"uobtkd-training",staticStyle:',
        "Training root",
    )
    text = text.replace(
        'staticClass:"navbar navbar-fixed-bottom"',
        'staticClass:"navbar navbar-fixed-bottom uobtkd-training-controls"',
        1,
    )
    text = text.replace(
        'staticClass:"text-center",staticStyle:{height:"10vh",background:"yellow"',
        'staticClass:"text-center uobtkd-round",staticStyle:{height:"10vh",background:"yellow"',
        1,
    )
    text = text.replace(
        'e("div",{staticStyle:{height:"10vh",background:"yellow"',
        'e("div",{staticClass:"uobtkd-timer",staticStyle:{height:"10vh",background:"yellow"',
        1,
    )
    text = text.replace("Area x ", "Courts × ")
    start = text.index("gamer_changed:function")
    end = text.index(",warning_plus:function", start)
    text = (
        text[:start]
        + "gamer_changed:function(){}"
        + text[end:]
    )
    text = text.replace(
        "gameControl:function(){",
        "gameControl:function(){if(2!==this.gvi.game_state&&!window.UOBTKD_CONTROLLER_FIXES.canStart(this))return;",
    )
    start = text.index("handleDevData:function")
    end = text.index(",handleVkSpace:function", start)
    text = (
        text[:start]
        + "handleDevData:function(t){return window.UOBTKD_CONTROLLER_FIXES.scoreHit(this,s.Z,t)}"
        + text[end:]
    )
    text = text.replace(
        "this.Update_Changdi_Data(),",
        "this.Update_Changdi_Data(),window.UOBTKD_UI.cleanDefaults(this.gameinfo),window.UOBTKD_SENSOR_MONITOR.clamp(this,s.Z),",
    )
    text = text.replace("view_mode:0,", "view_mode:s.Z.court_view_mode||0,")
    start = text.index("lidu_plus:function")
    end = text.index(",toukui_changed:function", start)
    text = (
        text[:start]
        + "lidu_plus:function(t){return window.UOBTKD_SENSOR_MONITOR.step(this,s.Z,t,1)}"
        + text[end:]
    )
    start = text.index("lidu_reduce:function")
    end = text.index(",lidu_plus:function", start)
    text = (
        text[:start]
        + "lidu_reduce:function(t){return window.UOBTKD_SENSOR_MONITOR.step(this,s.Z,t,-1)}"
        + text[end:]
    )
    text = text.replace(
        "handleVkSpace:function(){",
        "handleVkSpace:function(){if(window.UOBTKD_CONTROLLER_FIXES.ignoreSpaceShortcut())return;",
    )
    text = text.replace(
        "mounted:function(){var t=this;",
        "mounted:function(){window.PSS_CONNECTION.attachController(this);this.$nextTick(function(){window.PSS_COMPETITION.attach(this,s.Z);if(!window.PSS_MODES.isCompetition())window.PSS_SPECTATOR.attach(this)});window.UOBTKD_SENSOR_MONITOR.attach(this,s.Z);window.PSS_AUDIO.attachCourt(this);var t=this;",
    )
    text = text.replace(
        "beforeDestroy:function(){this.$parent.stopGame()",
        "beforeDestroy:function(){window.PSS_CONNECTION.detachController(this);window.PSS_SPECTATOR.detach(this);window.UOBTKD_SENSOR_MONITOR.detach();this.$parent.stopGame()",
    )
    old_name_input = (
        'e("input",{directives:[{name:"model",rawName:"v-model.lazy",'
        'value:t.gameinfo.game_name,expression:"gameinfo.game_name",modifiers:{lazy:!0}}],'
        'staticClass:"form-control",attrs:{type:"text"},domProps:{value:t.gameinfo.game_name},'
        'on:{change:function(e){return t.$set(t.gameinfo,"game_name",e.target.value)}}})'
    )
    name_input = (ROOT / "src/integration/team-name-input.js").read_text(
        encoding="utf-8"
    )
    name_input = name_input[name_input.index("e(") :].strip().rstrip(";")
    text = replace_once(text, old_name_input, name_input, "Team name input")
    text = replace_once(
        text,
        'e("label",[t._v("Team Name")])',
        'e("label",{attrs:{for:"uobtkd-team-name"}},[t._v("Team Name")])',
        "Team name label",
    )
    text = replace_once(text, 'e("div",{staticClass:"modal-body",staticStyle:{"text-align":"center"}},[', 'e("div",{staticClass:"modal-body",staticStyle:{"text-align":"center"}},[window.PSS_COMPETITION.renderSettings(t,e),', 'Competition modal settings')
    # These cues are emitted by the state-aware audio observer, once per transition.
    text = text.replace('s.Z.PlaySound("start.wav")', 'void 0')
    text = text.replace('s.Z.PlaySound("stop.wav")', 'void 0')
    text = replace_once(text, 'change_view_mode:function(t){', 'change_view_mode:function(t){if(window.PSS_MODES.isCompetition())return;s.Z.court_view_mode=t;localStorage.setItem("uobtkd_court_layout",String(t));', 'Competition court limit')
    text = replace_once(text, 's.Z.SaveChangdiData(e,this.gvi.game[e]);this.$router.push({name:"GameData"})', 's.Z.SaveChangdiData(e,this.gvi.game[e]);this.$router.push({name:window.PSS_MODES.isCompetition()?"CompetitionSetup":"GameData"})', 'Competition return navigation')
    text = text.replace('window.UOBTKD_SENSOR_MONITOR.detach();this.$parent.stopGame()', 'window.UOBTKD_SENSOR_MONITOR.detach();window.PSS_MODES.leaveCompetition(s.Z);this.$parent.stopGame()')
    text = text.replace('staticClass:"uobtkd-training",staticStyle:', 'staticClass:"uobtkd-training",class:{"pss-competition":window.PSS_MODES.isCompetition()},staticStyle:',1)
    text = text.replace('t._v("Athletes")','t._v(window.PSS_MODES.isCompetition()?"Protector test":"Equipment")')
    return text


def patch_court_readings(text, count):
    start = text.index("var a=function(){") + len("var a=")
    end = text.index(";a._withStripped", start)
    render = (ROOT / "src/integration/court-view.js").read_text(encoding="utf-8")
    render = (
        render[render.index("(function ()") :]
        .strip()
        .rstrip(";")
        .replace("__COUNT__", str(count))
    )
    return text[:start] + render + text[end:]


def patch_home(text):
    text = replace_once(text, 'mounted:function(){var t=this;', 'beforeDestroy:function(){document.body.classList.remove("pss-menu-open")},mounted:function(){document.body.classList.add("pss-menu-open");this.$parent.vkspace_cb=null;this.$parent.online_cb=null;this.$parent.devdata_cb=null;this.$parent.devstate_cb=null;var t=this;', 'Main menu presentation')
    start = text.index("var i=function(){") + len("var i=")
    end = text.index(";i._withStripped", start)
    render = (
        (ROOT / "src/integration/home-view.js")
        .read_text(encoding="utf-8")
        .strip()
        .rstrip(";")
    )
    text = text[:start] + render + text[end:]
    text = replace_once(
        text,
        "loginAction:function(){",
        "loginAction:function(destination){",
        "Home navigation",
    )
    start = text.index("loginAction:function(destination){") + len("loginAction:function(destination){")
    end = text.index('this.$router.push({name:"GameData"})', start)
    text = text[:start] + text[end:]
    text = replace_once(text, 'this.$router.push({name:"GameData"})', 'if(destination==="GameCtrl"){try{window.UOBTKD_CONTROLLER_FIXES.prepareCourts(o.Z)}catch(error){window.UOBTKD_UI.notify(error.message);return}}this.$router.push({name:"GameData"})', 'Direct court setup')
    return replace_once(
        text,
        'this.$router.push({name:"GameData"})',
        'this.$router.push({name:destination||"GameData"})',
        "Home destination",
    )


def strip_images(css):
    """Remove file-backed and embedded imagery while retaining font resources."""

    def clean(match):
        url = match.group(0)
        return (
            "none"
            if re.search(
                r"data:image/|\.(png|jpe?g|gif|webp|svg|ico|bmp)(?:[?\"')]|$)",
                url,
                re.I,
            )
            else url
        )

    return re.sub(r"url\([^)]*\)", clean, css, flags=re.I)


def build_assets():
    """Prepare all patched files before touching the working application."""
    web = SOURCE / "nginx/html/train"
    if not (web / "index.js").is_file():
        raise FileNotFoundError(f"Original v2.02 package not found: {SOURCE}")
    assets = {}
    patchers = {
        "index.js": patch_sensor_messages,
        "45.index.js": patch_controller,
        "744.index.js": patch_home,
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
                "if(s===f.label||window.UOBTKD_EN_HEADERS[s]===f.label)",
                "Spreadsheet headers",
            )
        if source.name in patchers:
            translated = patchers[source.name](translated)
        if source.name in COURT_BUNDLES:
            translated = patch_court_readings(
                translated,
                {
                    "698.index.js": 1,
                    "777.index.js": 4,
                    "586.index.js": 8,
                    "410.index.js": 16,
                }[source.name],
            )
        translated = translated.replace("t._s(t.$parent.core_version)", '""')
        translated = translated.replace('t._v("Training System ")', 't._v("")')
        translated = translated.replace('t._v(" Training System "+"")', 't._v("")')
        if source.name == "index.js":
            translated = replace_once(
                translated,
                'PlaySound:function(e){"Chrome"==f()&&"undefined"!=typeof HostPlaySound&&HostPlaySound(e)}',
                "PlaySound:function(e){return window.PSS_AUDIO.legacy(e)}",
                "Sound effects",
            )
            translated = translated.replace(
                'game_name:"Taekwondo"', "game_name:" + json.dumps(APP_NAME)
            )
        translated = translated.replace('leda_', 'uobtkd_')
        assets[source.name] = translated

    aliases = {
        key: TRANSLATIONS[key] for key in ["\u5e8f\u53f7", "\u59d3\u540d", "\u4f53\u91cd", "\u5934\u76d4", "\u62a4\u5177"]
    }
    assets["english-headers.js"] = (
        "window.UOBTKD_EN_HEADERS=" + json.dumps(aliases, ensure_ascii=True) + ";"
    )
    html = (
        (web / "index.html")
        .read_text(encoding="utf-8")
        .replace("<html>", '<html lang="en">')
    )
    assets["app-config.js"] = (
        "window.PSS_APP_CONFIG=" + json.dumps({"name": APP_NAME}) + ";"
    )
    assets['audio-config.js'] = 'window.PSS_AUDIO_CONFIG=' + (ROOT / 'src/audio.json').read_text(encoding='utf-8') + ';'
    scripts = [
        "app-config.js",
        "pss-core.js",
        "ui.js",
        "audio-config.js",
        "audio.js",
        "equipment.js",
        "equipment-page.js",
        "modes.js",
        "settings.js",
        "competition.js",
        "spectator.js",
        "navigation.js",
        "connection.js",
        "controller-fixes.js",
        "sensor-monitor.js",
        "free-training.js",
        "english-headers.js",
    ]
    additions = "".join(f'<script src="{name}"></script>' for name in scripts)
    # Load our overrides after the vendor stylesheet, including lazy-loaded scoped CSS.
    html = html.replace(
        "</head>", '<link rel="stylesheet" href="english-controls.css"></head>'
    )
    html = html.replace("<head>", "<head>" + additions)
    html = re.sub(r"<title>.*?</title>", "<title>" + APP_NAME + "</title>", html)
    html = re.sub(r"<script>window.onerror=.*?</script>", "", html, flags=re.DOTALL)
    assets["index.html"] = html
    for source, target in [
        ("core.js", "pss-core.js"),
        ("ui.js", "ui.js"),
        ("audio.js", "audio.js"),
        ("equipment.js", "equipment.js"),
        ("equipment-page.js", "equipment-page.js"),
        ("modes.js", "modes.js"),
        ("settings.js", "settings.js"),
        ("competition.js", "competition.js"),
        ("spectator.js", "spectator.js"),
        ("navigation.js", "navigation.js"),
        ("connection.js", "connection.js"),
        ("controller.js", "controller-fixes.js"),
        ("sensors.js", "sensor-monitor.js"),
        ("free-training.js", "free-training.js"),
    ]:
        assets[target] = (RUNTIME / source).read_text(encoding="utf-8")
    assets["english-controls.css"] = (STYLES / "app.css").read_text(encoding="utf-8")
    for source,target in [('index.html','spectator.html'),('spectator.css','spectator.css'),('spectator-display.js','spectator-display.js')]:
        assets[target]=(ROOT/'src/spectator'/source).read_text(encoding='utf-8')
    for stylesheet in web.rglob("*.css"):
        if stylesheet.relative_to(web).parts[0] == "static":
            continue
        assets[stylesheet.relative_to(web).as_posix()] = strip_images(
            stylesheet.read_text(encoding="utf-8").replace("leda_", "uobtkd_")
        )
    return assets


def main():
    assets = build_assets()
    initial_build = not OUTPUT.exists()
    if initial_build:
        shutil.copytree(SOURCE, OUTPUT)
    # The native shell loads this library by its branded path.
    native_library = bytes.fromhex('4c65646153706f72742e646c6c').decode('ascii')
    shutil.copy2(SOURCE / native_library, OUTPUT / (APP_NAME + '.dll'))
    old_library = OUTPUT / native_library
    if old_library.exists():
        old_library.unlink()
    # Human-readable names for the bundled spreadsheet templates.
    template_names = {
        '\u5bfc\u5165\u8868\u6a21\u677f': 'import table template',
        '\u6c5f\u5317\u8dc6\u62f3\u9053\u961f.xlsx': 'Sample team.xlsx',
        '\u8bad\u7ec3\u7248\u6570\u636e\u6a21\u677f.xlsx': 'Training template.xlsx'
    }
    for item in sorted(OUTPUT.rglob('*'), key=lambda path: len(path.parts), reverse=True):
        legacy_prefix = bytes.fromhex('4c65646153706f7274').decode('ascii')
        new_name = template_names.get(item.name)
        if item.name.startswith(legacy_prefix):
            new_name = APP_NAME if item.name == legacy_prefix else 'runtime'
        if new_name:
            target = item.with_name(new_name)
            if not target.exists():
                item.rename(target)
    web = OUTPUT / "nginx/html/train"
    web.mkdir(parents=True, exist_ok=True)
    for name, content in assets.items():
        (web / name).parent.mkdir(parents=True, exist_ok=True)
        (web / name).write_text(content, encoding="utf-8")
    legacy = web / "static"
    if legacy.exists():
        if not legacy.resolve().is_relative_to(web.resolve()):
            raise ValueError("Legacy assets escaped the generated interface")

        def remove_readonly(operation, path, error):
            os.chmod(path, stat.S_IWRITE)
            operation(path)

        shutil.rmtree(legacy, onerror=remove_readonly)
    # Delete only image assets in the generated web directory, never the vendor source.
    for asset in web.rglob("*"):
        if asset.is_file() and asset.suffix.lower() in {
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".webp",
            ".svg",
            ".ico",
            ".bmp",
        }:
            if not asset.resolve().is_relative_to(web.resolve()):
                raise ValueError("Image path escaped the generated interface")
            asset.unlink()
    php_config = OUTPUT / 'nginx/php7.4.3nts/php.ini'
    if php_config.exists():
        settings = php_config.read_text(encoding='utf-8')
        paths = {'extension_dir':'ext', 'error_log':'php.log', 'session.save_path':'tmp',
                 'opcache.blacklist_filename':'blacklist', 'opcache.file_cache':'bin'}
        for key, relative in paths.items():
            value = str((php_config.parent / relative).resolve())
            settings = re.sub(r'^' + re.escape(key) + r'=.*$', lambda match: key + '=' + value, settings, flags=re.M)
        php_config.write_text(settings, encoding='utf-8')
    if os.name == "nt":
        staged = prepare_native(SOURCE, OUTPUT)
        try:
            shutil.copy2(staged, OUTPUT / staged.name)
        except PermissionError:
            print('Close the running app and reopen Start.cmd to apply the native update.')
        previous_names = json.loads((ROOT / 'src/app.json').read_text(encoding='utf-8')).get('previousNames', [])
        for name in [next(SOURCE.glob('*.exe')).name] + [name + '.exe' for name in previous_names]:
            legacy_executable = OUTPUT / name
            if legacy_executable.name != staged.name and legacy_executable.exists():
                try:
                    legacy_executable.unlink()
                except PermissionError:
                    print('The old executable is running; close it before using the renamed app.')
        for media in (OUTPUT / "res").glob("*"):
            if media.is_file() and media.suffix.lower() in {
                ".ico",
                ".png",
                ".jpg",
                ".jpeg",
                ".gif",
                ".bmp",
            }:
                media.unlink()
    subprocess.run(
        ["node", str(ROOT / "tools/build_audio.cjs"), str(OUTPUT / "res")],
        check=True,
    )
    shutil.copy2(ROOT / "src/audio/hit.mp3", web / "hit.mp3")
    (OUTPUT / "res").mkdir(exist_ok=True)
    # Pre-filter at the native client's display size. The legacy static bitmap
    # control's minification produces dark contours on gradients and fine edges.
    with Image.open(ROOT / "src/assets/splash.png") as artwork:
        artwork.convert("RGB").resize((540, 351), Image.Resampling.LANCZOS).save(
            OUTPUT / "res/splash.png", format="PNG", icc_profile=None
        )
    launcher = (
        '@echo off\ncd /d "%~dp0"\n'
        'for %%F in ("%~dp0native-update\\' + APP_NAME + '.exe") do (\n'
        '    copy /y "%%~fF" "%~dp0%%~nxF" >nul\n'
        "    if errorlevel 1 (\n"
        "        echo Close the running app, then open this launcher again.\n"
        "        pause\n        exit /b 1\n    )\n"
        '    start "" "%~dp0%%~nxF"\n'
        "    exit /b\n)\n"
        "echo Application executable not found. Run the build script first.\npause\n"
    )
    (OUTPUT / "Start.cmd").write_text(launcher, encoding="ascii")
    old_launcher = OUTPUT / "Start-English.cmd"
    if old_launcher.exists():
        old_launcher.unlink()
    print(f"Application package: {OUTPUT}")
    print(
        f"Updated {len(assets)} interface assets. Existing runtime data preserved."
        if not initial_build
        else f"Created application copy with {len(assets)} interface assets."
    )


if __name__ == "__main__":
    main()
