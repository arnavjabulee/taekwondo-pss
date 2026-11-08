/* Impact diagnostics. No undocumented device commands or RFID mode changes. */
(function(root){
  'use strict';
  var controller=null,store=null,events=[],panel=null,button=null,owned=false;
  var MAX_LEVEL=71,topics=['huju','xlhuju','toukui','xltoukui'];
  function parse(payload){
    var fields=String(payload).split(','),raw=fields[1],value;
    if(!/^[a-f0-9]{12}$/i.test(fields[0])||!raw||raw.indexOf(':')<0)return null;
    raw=raw.slice(raw.indexOf(':')+1).trim();
    if(!raw)return null;
    value=Number(raw);if(!isFinite(value)||value<0)return null;
    return {id:fields[0].toLowerCase(),value:value};
  }
  function locate(id){
    if(!controller)return null;
    for(var i=0;i<controller.gvi.game.length;i++)for(var j=0;j<2;j++){
      var side=j===0?'left':'right',slot=controller.gvi.game[i][side],type='';
      if(String(slot.toukui||'').toLowerCase()===id)type='Helmet';
      else if(String(slot.huju||'').toLowerCase()===id)type='Body';
      if(type)return {court:i+1,side:j===0?'Blue':'Red',type:type,threshold:Number(type==='Helmet'?controller.gameinfo.toukui_gate:controller.gvi.game[i].lidu)*40};
    }
    return null;
  }
  function receive(payload){
    var hit=parse(payload);if(!hit)return;
    hit.time=new Date().toLocaleTimeString();hit.assignment=locate(hit.id);
    if(hit.assignment&&controller){
      var a=hit.assignment,slot=controller.gvi.game[a.court-1][a.side==='Blue'?'left':'right'];
      var reading={raw:hit.value,level:hit.value/40,type:a.type,time:hit.time};
      if(controller.$set)controller.$set(slot,'last_hit',reading);else slot.last_hit=reading;
      controller.SendGameData();
    }
    events.unshift(hit);if(events.length>40)events.pop();
    if(panel&&!panel.hidden)renderEvents();
  }
  function formatHit(slot){
    var hit=slot&&slot.last_hit;
    return hit?hit.type+': '+hit.raw+' raw (L'+hit.level.toFixed(2)+')':'Impact: --';
  }
  function level(value){var n=Number(value);return isFinite(n)&&n>=0&&n<=MAX_LEVEL&&Math.floor(n)===n?n:null;}
  function setThreshold(ctx,data,court,value){
    var n=level(value);if(n===null)return false;
    ctx.gvi.game[court].lidu=n;
    data.SaveChangdiData(court,ctx.gvi.game[court]);ctx.SendGameData();return true;
  }
  function clamp(ctx,data){
    for(var i=0;i<ctx.gvi.game.length;i++){
      if(Number(ctx.gvi.game[i].lidu)>MAX_LEVEL){ctx.gvi.game[i].lidu=MAX_LEVEL;data.SaveChangdiData(i,ctx.gvi.game[i]);}
    }
    if(Number(ctx.gameinfo.toukui_gate)>MAX_LEVEL){ctx.gameinfo.toukui_gate=MAX_LEVEL;data.GAMEINFO.toukui_gate=MAX_LEVEL;data.SaveGameInfo(ctx.gameinfo);}
  }
  function step(ctx,data,court,delta){return setThreshold(ctx,data,court,Math.max(0,Math.min(MAX_LEVEL,Number(ctx.gvi.game[court].lidu)+delta)));}
  function element(tag,text,parent){var el=root.document.createElement(tag);if(text!==null)el.textContent=text;if(parent)parent.appendChild(el);return el;}
  function stopListening(){
    if(owned&&controller&&store&&!store.IS_GAMING)for(var i=0;i<topics.length;i++)controller.$parent.stop_devices(topics[i]);
    owned=false;
  }
  function listen(){
    if(!store.IS_ONLINE){root.alert('The receiver is offline. Connect it before listening for hits.');return;}
    if(controller.gvi.game_state===2){root.alert('Training is running. Incoming impacts are already being monitored.');return;}
    if(owned){stopListening();render();return;}
    for(var i=0;i<topics.length;i++)controller.$parent.start_devices(topics[i]);
    owned=true;render();
  }
  function renderEvents(){
    var body=panel.querySelector('[data-events]');body.textContent='';
    if(!events.length){element('p','No impact messages received yet. This does not prove the sensors are inactive.',body);return;}
    var table=element('table',null,body);table.style.width='100%';
    var row=element('tr',null,table);
    ['Time / Device','Assignment','Raw impact','Level (raw / 40)','Threshold then','Result then'].forEach(function(t){element('th',t,row);});
    events.forEach(function(hit){
      var a=hit.assignment,r=element('tr',null,table);
      [hit.time+' / '+hit.id,a?'Court '+a.court+' '+a.side+' '+a.type:'Unassigned',String(hit.value),(hit.value/40).toFixed(2),a?String(a.threshold):'-',a?(hit.value>=a.threshold?'Meets threshold':'Below threshold'):'Not assigned'].forEach(function(t){element('td',t,r);});
    });
  }
  function render(){
    panel.textContent='';
    var close=element('button','Close',panel);close.style.cssFloat='right';close.onclick=function(){stopListening();panel.hidden=true;};
    element('h2','Sensor levels',panel);
    element('p','Raw impact is the value received from the device. Level = raw / 40; these are not calibrated force units. Higher thresholds require stronger hits.',panel);
    element('p','Software threshold range: 0–71 levels (0–2840 raw). This is an interface range, not a confirmed sensor limit.',panel);
    var listenBtn=element('button',owned?'Stop listening':'Listen for hits',panel);listenBtn.onclick=listen;
    var clear=element('button','Clear readings',panel);clear.onclick=function(){events=[];renderEvents();};
    var sock=element('button','Pressure-only / no socks: check support',panel);sock.onclick=function(){root.alert('No RFID/NFC bypass command has been identified for this hardware. This app already scores received impact values without checking socks.\n\nUse Listen for hits and compare gentle impacts with and without socks. If no sockless impact message arrives, the app cannot recover it; a supported device mode or firmware change is needed.');};
    element('p','Listening activates all protector types without starting the scoring timer. Readings cannot confirm sock detection: these messages contain no identified RFID/NFC status.',panel);
    var settings=element('div',null,panel);
    for(var i=0;i<controller.gvi.game.length;i++){
      var game=controller.gvi.game[i];
      if(!root.LEDA_CONTROLLER_FIXES.assigned(game.left)&&!root.LEDA_CONTROLLER_FIXES.assigned(game.right))continue;
      (function(court){
        var label=element('label','Court '+(court+1)+' body threshold: ',settings),input=element('input',null,label),raw=element('span',' raw '+Number(controller.gvi.game[court].lidu)*40,label);
        input.type='number';input.min='0';input.max=String(MAX_LEVEL);input.step='1';input.value=controller.gvi.game[court].lidu;input.style.width='85px';
        input.onchange=function(){if(!setThreshold(controller,store,court,input.value)){root.alert('Enter a whole level from 0 to '+MAX_LEVEL);input.value=controller.gvi.game[court].lidu;}raw.textContent=' raw '+controller.gvi.game[court].lidu*40;};
        label.style.display='block';
      }(i));
    }
    var label=element('label','Helmet threshold (all courts): ',settings),helmet=element('input',null,label);
    helmet.type='number';helmet.min='0';helmet.max=String(MAX_LEVEL);helmet.step='1';helmet.value=controller.gameinfo.toukui_gate;helmet.style.width='85px';
    helmet.onchange=function(){var n=level(helmet.value);if(n===null){root.alert('Enter a whole level from 0 to '+MAX_LEVEL);helmet.value=controller.gameinfo.toukui_gate;return;}controller.gameinfo.toukui_gate=n;store.GAMEINFO.toukui_gate=n;store.SaveGameInfo(controller.gameinfo);};
    element('div',null,panel).setAttribute('data-events','');renderEvents();
  }
  function attach(ctx,data){
    controller=ctx;store=data;if(!root.document)return;
    button=element('button','Sensor levels',root.document.body);button.style.cssText='position:fixed;top:8px;left:8px;z-index:1090;font-size:16px;padding:8px;background:#eee;color:#111;border:1px solid #888;border-radius:4px';
    panel=element('section',null,root.document.body);panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Sensor levels');
    panel.style.cssText='position:fixed;top:4vh;bottom:4vh;left:3vw;right:3vw;z-index:1100;background:#161616;color:white;overflow:auto;padding:20px;border:2px solid #aaa;font-size:16px;text-align:left';
    button.onclick=function(){panel.hidden=false;render();};
  }
  function detach(){stopListening();if(button&&button.parentNode)button.parentNode.removeChild(button);if(panel&&panel.parentNode)panel.parentNode.removeChild(panel);button=null;panel=null;controller=null;store=null;}
  var api={parse:parse,receive:receive,attach:attach,detach:detach,level:level,setThreshold:setThreshold,step:step,clamp:clamp,formatHit:formatHit,readings:function(){return events.slice();}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LEDA_SENSOR_MONITOR=api;
}(typeof window!=='undefined'?window:globalThis));
