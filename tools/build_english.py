"""Reproducible English web-interface build; vendor package stays untouched."""
from pathlib import Path
import json
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'LedaSportXunLian_V202'
OUTPUT = ROOT / 'LedaSport-English'
PAIRS = '''
训练系统|Training System
返回首页|Home
多人训练系统|Multi-Athlete Training System
队 员 信 息 修 改|Edit Athlete
队 员 信 息|Athletes
队 员|Athlete
队员姓名|Athlete Name
队员体重(kg)|Weight (kg)
队员导入|Import Athletes
队员管理|Athletes
信息修改|Edit Details
去训练|Train
护具编号|Body Protector ID
头盔编号|Helmet ID
头盔力度值|Helmet Impact Threshold
头盔|Helmet
护具|Body Protector
序 号|Number
序号|Number
姓名|Name
体 重|Weight
体重|Weight
空|None
无|None
确 定|OK
确定|OK
取消|Cancel
操作不支持|Operation unavailable
数据已导出|Data exported
数据导出失败|Export failed
比赛成绩|Results
场次|Match
场地|Area
级别|Category
青方单位|Blue Team
青方选手|Blue Athlete
红方单位|Red Team
红方选手|Red Athlete
胜方单位|Winning Team
胜方选手|Winning Athlete
比分|Score
获胜方式|Win Method
胜者|Winner
传统赛制|Traditional Rules
大满贯赛制|Grand Slam Rules
跆 拳 道|Taekwondo
乐打智能体育|Leda Smart Sports
南京乐打体育科技有限公司|Nanjing Leda Sports Technology Co., Ltd.
多 人 训 练|Multi-Athlete Training
设 置|Settings
系统设置|Settings
确认设置|Save Settings
设置已保存|Settings saved
每局训练时间|Round Duration
局间休息时间|Rest Duration
局间休息|Rest
局 数|Rounds
全部关机|Power Off All
开 始|Start
停 止|Stop
暂 停|Pause
继 续|Resume
等 待|Waiting
训练中|Training
青 胜|Blue Wins
红 胜|Red Wins
双 败|Double Loss
双败结束！|Both athletes lose.
判定胜|Win by Decision
前三局平，应该进入抢分局！！！|Three rounds tied. Begin the golden-point round.
平局,进入抢分局|Tie. Begin the golden-point round.
抢分局结束：left_score=|Golden-point round ended: left_score=
比分平|Tied score
比分胜:left|Win on points: left
比分胜:right|Win on points: right
检查2:0,left_result=|Check 2:0, left_result=
检查2:1,left_result=|Check 2:1, left_result=
犯规|Penalty
比|vs
加分|Add Point
减分|Remove Point
单位名称|Team Name
版 权 申 明|Copyright
列表|List
没有权限|Access unavailable
男子|Male
女子|Female
导出数据|Export
搜索|Search
刷新|Refresh
切换|Toggle
列|Columns
清空过滤|Clear Filters
隐藏/显示分页|Toggle Pagination
没有找到匹配的记录|No matching records
正在努力地加载数据中，请稍候……|Loading, please wait...
每页显示 |Rows per page:\u0020
显示第 |Showing\u0020
 到第 | to\u0020
 条记录，总共 | rows, total\u0020
 条记录| rows
'''
TRANSLATIONS = dict(line.split('|', 1) for line in PAIRS.strip('\n').splitlines())
LITERAL = re.compile(r'"(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27')

def translate_literal(match):
    text = match[0]
    # Large literals belong to spreadsheet encoding tables, not interface text.
    if len(text) > 300 or '\ufffd' in text:
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
        raise ValueError('Cannot find DevData message dispatch')
    return text.replace(old, new, 1)

def patch_controller(text):
    start = text.index('gamer_changed:function')
    end = text.index(',warning_plus:function', start)
    text = text[:start] + 'gamer_changed:function(t,e){return window.LEDA_CONTROLLER_FIXES.changeAthlete(this,s.Z,t,e)}' + text[end:]
    text = text.replace('gameControl:function(){', 'gameControl:function(){if(2!==this.gvi.game_state&&!window.LEDA_CONTROLLER_FIXES.canStart(this))return;')
    start = text.index('handleDevData:function')
    end = text.index(',handleVkSpace:function', start)
    text = text[:start] + 'handleDevData:function(t){return window.LEDA_CONTROLLER_FIXES.scoreHit(this,s.Z,t)}' + text[end:]
    text = text.replace('this.Update_Changdi_Data(),', 'this.Update_Changdi_Data(),window.LEDA_SENSOR_MONITOR.clamp(this,s.Z),')
    text = text.replace('view_mode:0,', 'view_mode:s.Z.court_view_mode||0,')
    start = text.index('lidu_plus:function')
    end = text.index(',toukui_changed:function', start)
    text = text[:start] + 'lidu_plus:function(t){return window.LEDA_SENSOR_MONITOR.step(this,s.Z,t,1)}' + text[end:]
    start = text.index('lidu_reduce:function')
    end = text.index(',lidu_plus:function', start)
    text = text[:start] + 'lidu_reduce:function(t){return window.LEDA_SENSOR_MONITOR.step(this,s.Z,t,-1)}' + text[end:]
    text = text.replace('mounted:function(){var t=this;', 'mounted:function(){window.LEDA_SENSOR_MONITOR.attach(this,s.Z);var t=this;')
    text = text.replace('beforeDestroy:function(){this.$parent.stopGame()', 'beforeDestroy:function(){window.LEDA_SENSOR_MONITOR.detach();this.$parent.stopGame()')
    return text

def patch_athletes(text):
    start = text.index('to_game:function')
    end = text.index(',changci_changed:function', start)
    text = text[:start] + 'to_game:function(){try{window.LEDA_CONTROLLER_FIXES.prepareCourts(n.Z,this.settings)}catch(e){window.alert(e.message);return}n.Z.SaveGameInfo();this.$router.push({name:"GameCtrl"})}' + text[end:]
    text = text.replace('methods:{', 'methods:{courtLabel:function(e){return window.LEDA_CONTROLLER_FIXES.courtLabel(this.data,e)},assignCourt:function(i,e){return window.LEDA_CONTROLLER_FIXES.assignCourt(this,i,e,n.Z)},', 1)
    text = text.replace('a("td",[t._v(t._s(e.huju))])', 'a("td",[t._v(t._s(e.huju))]),a("td",[a("select",{staticClass:"form-control",domProps:{value:e.court||""},on:{change:function(v){t.assignCourt(i,v.target.value)}}},[a("option",{attrs:{value:""}},[t._v("Unassigned")]),t._l(16,function(c){return a("option",{key:c,attrs:{value:c}},[t._v("Court "+c)])})],2)]),a("td",[t._v(t.courtLabel(e))])')
    text = text.replace('a("td",[t._v("Body Protector ID")])', 'a("td",[t._v("Body Protector ID")]),a("td",[t._v("Court")]),a("td",[t._v("Colour")])')
    return text

def patch_court_readings(text):
    for side in ['left', 'right']:
        score = 'i("div",{staticClass:"game-score"},[t._v(t._s(t.gvi.game[e].'+side+'.score))])'
        reading = 'i("div",{staticStyle:{position:"absolute",top:"2px",left:"0",width:"100%","font-size":"1.6vh","line-height":"1.2",color:"white",background:"rgba(0,0,0,0.35)","pointer-events":"none"}},[t._v(window.LEDA_SENSOR_MONITOR.formatHit(t.gvi.game[e].'+side+'))])'
        if score not in text:
            raise ValueError('Cannot find '+side+' court score')
        text = text.replace(score, score+','+reading)
    return text

def main():
    shutil.copytree(SOURCE, OUTPUT, dirs_exist_ok=True)
    web = OUTPUT / 'nginx/html/train'
    changed = []
    for source in (SOURCE / 'nginx/html/train').glob('*.js'):
        original = source.read_text('utf-8')
        # Leave spreadsheet/date/encoding implementation intact.
        if source.name == '84.index.js':
            continue
        translated = LITERAL.sub(translate_literal, original)
        if source.name == 'index.js':
            translated = translated.replace('if(s===f.label)', 'if(s===f.label||window.LEDA_EN_HEADERS[s]===f.label)')
            translated = patch_sensor_messages(translated)
        if source.name == '45.index.js':
            translated = patch_controller(translated)
        if source.name == '170.index.js':
            translated = patch_athletes(translated)
        if source.name in ['698.index.js','777.index.js','586.index.js','410.index.js']:
            translated = patch_court_readings(translated)
        (web / source.name).write_text(translated, encoding='utf-8')
        if translated != original:
            changed.append(source.name)
    aliases = {k: v for k, v in TRANSLATIONS.items() if k in ['序号','姓名','体重','头盔','护具']}
    # Older Chinese templates remain importable; new templates use English headers.
    (web / 'english-headers.js').write_text('window.LEDA_EN_HEADERS='+json.dumps(aliases, ensure_ascii=True)+';', encoding='utf-8')
    html = (SOURCE / 'nginx/html/train/index.html').read_text('utf-8')
    html = html.replace('<html>', '<html lang="en">').replace('<head>', '<head><script src="english-headers.js"></script>')
    html = html.replace('<head>', '<head><script src="controller-fixes.js"></script><script src="sensor-monitor.js"></script><link rel="stylesheet" href="english-controls.css">')
    html = re.sub(r'<title>.*?</title>', '<title>Leda PSS Training</title>', html)
    (web / 'index.html').write_text(html, encoding='utf-8')
    shutil.copyfile(ROOT / 'tools/controller_fixes.js', web / 'controller-fixes.js')
    shutil.copyfile(ROOT / 'tools/sensor_monitor.js', web / 'sensor-monitor.js')
    (web / 'english-controls.css').write_text('.gamer_select{appearance:auto!important;-webkit-appearance:menulist!important;border:1px solid #aaa!important;cursor:pointer!important} .gamer_select:focus{outline:2px solid #ff0!important}', encoding='utf-8')
    # Preserve the native executable filename; an English shortcut launches it.
    (OUTPUT / 'Start-English.cmd').write_text('@echo off\ncd /d "%~dp0"\nfor %%F in ("%~dp0*.exe") do (\n    start "" "%%~fF"\n    exit /b\n)\necho Application executable not found.\npause\n', encoding='ascii')
    (OUTPUT / 'Athletes-English.csv').write_text('Number,Name,Weight,Helmet,Body Protector\n1,Athlete 1,60,,\n', encoding='utf-8-sig')
    (ROOT / 'translation-map.json').write_text(json.dumps(TRANSLATIONS, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'English package: {OUTPUT}\nTranslated {len(changed)} JavaScript bundles.')

if __name__ == '__main__':
    main()
