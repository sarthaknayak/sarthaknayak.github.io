import { createRecords } from './records.js?v=18';
import { createGame } from './game.js?v=18';
import { createResults, formatTime } from './results.js?v=11';
import { createScene, screenToTray } from './scene.js?v=20';
import { createHandController } from './hands.js';
import { createDeviceController } from './device.js?v=11';
import { profile } from './profile.js';
import { createOpenAILogo } from './openai-mark.js';

const $=id=>document.getElementById(id);
$('profile-name').textContent=profile.name;
$('profile-company').textContent=profile.companyLine||`Currently at ${profile.company}`;
$('profile-company').append(createOpenAILogo());
document.title=profile.name;
$('linkedin').href=profile.linkedin;
$('sample-label').hidden=!profile.sample;
let storage;try{storage=window.localStorage;}catch{}
const records=createRecords(storage),game=createGame(records);
const stage=$('stage'),input={x:0,y:0},tilt={x:0,z:0},keys=new Set();
let graphics,observer,sceneAvailable=false,frame=0,last=performance.now(),lastRender=last,wonBefore=false,lastRespawns=0,noticeTimeout,renderDirty=true,settleUntil=0;
let touchOrigin=null,handsActive=false,deviceActive=false,profileHovered=false;
const trayProfile=$('tray-profile'),footer=$('game-controls');
const sensorActive=()=>handsActive||deviceActive;
const isProfileTarget=target=>target instanceof Element&&!!target.closest('#tray-profile');
const profileLocked=()=>profileHovered||trayProfile.contains(document.activeElement);
const clamp=v=>Math.max(-1,Math.min(1,v));
function clearInput(){input.x=input.y=tilt.x=tilt.z=0;keys.clear();touchOrigin=null;}
trayProfile.addEventListener('pointerenter',()=>{profileHovered=true;keys.clear();if(!sensorActive())input.x=input.y=0;});
trayProfile.addEventListener('pointerleave',()=>{profileHovered=false;});
trayProfile.addEventListener('focusin',()=>{keys.clear();if(!sensorActive())input.x=input.y=0;});
function refreshScores(){
  const best=records.best(game.level.id);$('best').hidden=!Number.isFinite(best);$('best').textContent=Number.isFinite(best)?`BEST ${formatTime(best)}`:'';
}
const results=createResults({dialog:$('results'),onReplay:()=>reset(true),onNext:()=>{if(game.nextLevel())prepareLevel(true);},onDismiss:()=>{
  if(!sceneAvailable)return;
  stage.focus({preventScroll:true});
}});
function showResults(){if(game.result)results.show({level:game.level,result:game.result,rows:records.readLevel(game.level.id)});}
refreshScores();
function dismissNotice(){clearTimeout(noticeTimeout);$('notice').hidden=true;}
function notice(message,recovery){
  dismissNotice();$('notice-message').textContent=message;$('notice-open').hidden=recovery!=='browser';$('notice').hidden=false;
  if(recovery!=='browser')noticeTimeout=setTimeout(dismissNotice,6500);
}
$('notice-open').href=new URL('./',document.baseURI).href;
$('notice-close').addEventListener('click',dismissNotice);
const handControl=createHandController({
  video:$('camera-video'),canvas:$('hand-overlay'),
  onTilt:(x,y)=>{if(sceneAvailable&&!game.state.won&&!game.state.falling){input.x=x;input.y=y;}},
  onActive:active=>{
    handsActive=active;clearInput();renderDirty=true;
    document.body.classList.toggle('camera-active',active);
    $('camera-panel').hidden=!active;
    $('hands-toggle').setAttribute('aria-pressed',String(active));
    $('hands-label').textContent=active?'Stop camera':'Use your hands';
  },
  onStatus:({kind,message})=>{
    $('camera-status-full').textContent=message;
    $('camera-status-short').textContent=kind==='tracking'?'Tracking your hands':kind==='loading'?'Starting…':message.includes('still')?'Hold still…':'Show your hands';
    $('camera-dot').classList.toggle('tracking',kind==='tracking');
    $('camera-search').hidden=kind==='tracking';
    $('camera-search').textContent=kind==='loading'?'Getting ready…':'Hold your hands up';
    if(kind==='error')notice(message);
  },
});
const deviceControl=createDeviceController({
  onTilt:(x,y)=>{if(sceneAvailable&&!game.state.won&&!game.state.falling){input.x=x;input.y=y;}},
  onActive:active=>{
    deviceActive=active;clearInput();renderDirty=true;
    $('motion-tools').hidden=!active;
    $('motion-toggle').setAttribute('aria-pressed',String(active));
    $('motion-label').textContent=active?'Stop tilting':'Tilt your phone';
  },
  onStatus:({kind,message,recovery})=>{
    $('motion-status').textContent=kind==='tracking'?'Tilt to move':kind==='permission'?'Allow motion to play':kind==='calibrating'?(message.includes('flatter')?'Hold a little flatter':'Hold still…'):'';
    $('motion-recenter').disabled=kind!=='tracking';renderDirty=true;
    if(kind==='error')notice(message,recovery);
  },
});
// Keep this invitation on mobile devices, including iPads using a desktop UA.
// A narrow desktop window or an exposed sensor API is not a mobile device.
const mobilePlatform=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const desktopModeIPad=navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
const offerDeviceTilt=navigator.userAgentData?.mobile===true||mobilePlatform||desktopModeIPad;
$('motion-toggle').hidden=!offerDeviceTilt;
$('input-options').classList.toggle('has-motion',offerDeviceTilt);
$('hands-toggle').addEventListener('click',()=>{
  if(!sceneAvailable||game.state.won)return;
  dismissNotice();
  if(handControl.active)handControl.stop();
  else{deviceControl.stop();handControl.start();}
});
$('motion-toggle').addEventListener('click',()=>{
  if(!sceneAvailable||game.state.won)return;
  dismissNotice();
  if(deviceControl.active)deviceControl.stop();
  else{handControl.stop();deviceControl.start();}
});
$('motion-recenter').addEventListener('click',()=>deviceControl.recenter());
$('camera-close').addEventListener('click',()=>handControl.stop());
$('recenter').addEventListener('click',()=>handControl.recenter());
function prepareLevel(focus=false){
  dismissNotice();clearInput();wonBefore=false;lastRespawns=game.state.respawns||0;renderDirty=true;settleUntil=performance.now()+1600;
  if(handControl.active)handControl.recenter();
  if(deviceControl.active)deviceControl.recenter();
  graphics.setLayout(game.level.layout);graphics.update(game.state,0,0,0);results.hide();refreshScores();
  $('timer').hidden=true;$('timer').textContent='00:00.0';$('input-options').hidden=false;stage.dataset.state='ready';
  stage.setAttribute('aria-label',`Level ${game.level.id}, ${game.level.name}. Guide the marble into the blue pocket. Move the pointer, drag, or use arrow keys or WASD to tilt. R resets.`);
  if(focus)stage.focus({preventScroll:true});
}
function reset(focus=false){if(!sceneAvailable)return;game.reset();prepareLevel(focus);}
$('reset').addEventListener('click',()=>reset());
stage.addEventListener('pointerdown',e=>{
  if(!sceneAvailable||game.state.falling||e.button!==0||e.target.closest('button,a')||sensorActive()||isProfileTarget(e.target))return;
  stage.dataset.keyboard='false';
  stage.focus({preventScroll:true});
  if(e.pointerType!=='mouse'){
    if(touchOrigin)return;
    touchOrigin={x:e.clientX,y:e.clientY,pointerId:e.pointerId};
    stage.setPointerCapture(e.pointerId);
  }
});
stage.addEventListener('pointermove',e=>{
  if(!sceneAvailable||sensorActive()||game.state.won||game.state.falling||isProfileTarget(e.target)||profileLocked())return;
  if(e.pointerType!=='mouse'){
    if(!touchOrigin||touchOrigin.pointerId!==e.pointerId)return;
    input.x=clamp((e.clientX-touchOrigin.x)/100);input.y=clamp((e.clientY-touchOrigin.y)/100);
  }else{
    const r=stage.getBoundingClientRect(),range=Math.min(r.width,r.height)*.29;
    input.x=clamp((e.clientX-r.left-r.width/2)/range);input.y=clamp((e.clientY-r.top-r.height/2)/range);
  }
  keys.clear();
});
function release(){touchOrigin=null;if(!sensorActive())input.x=input.y=0;}
stage.addEventListener('pointerup',e=>{
  if(touchOrigin&&touchOrigin.pointerId!==e.pointerId)return;
  if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);
  if(e.pointerType!=='mouse')release();
});
stage.addEventListener('pointercancel',e=>{if(!touchOrigin||touchOrigin.pointerId===e.pointerId)release();});
stage.addEventListener('lostpointercapture',e=>{if(!touchOrigin||touchOrigin.pointerId===e.pointerId)release();});
stage.addEventListener('pointerleave',()=>{if(!touchOrigin)release();});
const controls=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'];
const controlKey=e=>e.key.length===1?e.key.toLowerCase():e.key;
stage.addEventListener('keydown',e=>{
  if(!sceneAvailable||e.target.closest('button,a')||isProfileTarget(e.target))return;
  stage.dataset.keyboard='true';
  const key=controlKey(e);
  if(key==='r'){e.preventDefault();reset();return;}
  if(!controls.includes(key)||sensorActive())return;
  e.preventDefault();
  if(game.state.falling||(e.repeat&&!keys.has(key)))return;
  keys.add(key);
});
window.addEventListener('keyup',e=>{const key=controlKey(e);if(controls.includes(key)){keys.delete(key);if(!keys.size&&!sensorActive())input.x=input.y=0;}});
stage.addEventListener('blur',()=>{keys.clear();if(!sensorActive())input.x=input.y=0;});
window.addEventListener('blur',()=>{release();keys.clear();});
function animate(now){
  frame=requestAnimationFrame(animate);
  const dt=Math.min((now-last)/1000,.05);last=now;
  if(document.hidden)return;
  if(keys.size){input.x=(keys.has('ArrowRight')||keys.has('d')?1:0)-(keys.has('ArrowLeft')||keys.has('a')?1:0);input.y=(keys.has('ArrowDown')||keys.has('s')?1:0)-(keys.has('ArrowUp')||keys.has('w')?1:0);}
  const target=game.state.falling?{x:0,z:0}:screenToTray(input.x,input.y),smooth=1-Math.exp(-9*dt);
  if(!profileLocked()){
    tilt.x+=((game.state.won?0:target.x)-tilt.x)*smooth;tilt.z+=((game.state.won?0:target.z)-tilt.z)*smooth;
    // Patrols run independently while idle; the marble and score timer wait for input.
    game.step(dt,tilt.x,tilt.z);
  }
  if((game.state.respawns||0)!==lastRespawns){
    lastRespawns=game.state.respawns;clearInput();renderDirty=true;settleUntil=now+1200;
    if(handControl.active)handControl.recenter();
    if(deviceControl.active)deviceControl.recenter();
  }
  if(game.state.won&&!wonBefore)settleUntil=now+1800;
  if(game.state.started){$('timer').hidden=false;$('timer').textContent=formatTime(game.state.elapsed);stage.dataset.state=game.state.won?'won':game.state.falling?'falling':'playing';}
  if(game.state.won&&!wonBefore){
    wonBefore=true;handControl.stop();deviceControl.stop();clearInput();dismissNotice();refreshScores();
    $('input-options').hidden=true;showResults();
  }
  const idlePatrol=graphics.hasMovingParts&&!game.state.won&&!profileLocked()&&now-lastRender>=1000/30;
  const idleLight=graphics.needsIdleAnimation&&!game.state.started&&now-lastRender>=66;
  if(renderDirty||idlePatrol||idleLight||now<settleUntil||(!game.state.won&&game.state.started)||Math.abs(tilt.x)+Math.abs(tilt.z)>.001){
    graphics.update(game.state,tilt.x,tilt.z,Math.min((now-lastRender)/1000,.1));lastRender=now;renderDirty=false;
  }
}
function showFallback(){
  sceneAvailable=false;observer?.disconnect();clearInput();stage.tabIndex=-1;
  cancelAnimationFrame(frame);handControl.stop();deviceControl.stop();results.hide();trayProfile.hidden=false;trayProfile.inert=false;
  trayProfile.classList.remove('is-mounted');trayProfile.style.transform='';trayProfile.style.opacity='';
  document.body.dataset.phase='fallback';footer.hidden=true;$('loading').hidden=true;$('render-error').hidden=false;
}
try{
  graphics=createScene($('scene'),game.level.layout,trayProfile);
  graphics.update(game.state,0,0,0);sceneAvailable=true;
  $('scene').classList.add('ready');$('loading').hidden=true;footer.hidden=false;stage.dataset.state='ready';
  stage.setAttribute('aria-label',`Level ${game.level.id}, ${game.level.name}. Guide the marble into the blue pocket. Move the pointer, drag, or use arrow keys or WASD to tilt. R resets.`);
  observer=new ResizeObserver(()=>{if(sceneAvailable){graphics.resize();renderDirty=true;}});observer.observe(stage);
  frame=requestAnimationFrame(animate);
  $('scene').addEventListener('webglcontextlost',e=>{e.preventDefault();showFallback();});
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);clearTimeout(noticeTimeout);observer.disconnect();handControl.dispose();deviceControl.dispose();graphics.dispose();},{once:true});
}catch(error){console.error('3D scene could not start',error);showFallback();}
