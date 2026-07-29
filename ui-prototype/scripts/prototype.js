(function () {
  'use strict';
  var PHASES = { dawn:{base:'base-dawn.svg'}, day:{base:'base-day.svg'}, dusk:{base:'base-dusk.svg'}, night:{base:'base-night.svg'} };
  var WEATHERS = {
    sunny:{label:'晴',icon:'overlay-sun.svg',animation:'anim-sun',temp:'31'}, cloudy:{label:'多云',icon:'overlay-clouds-a.svg',animation:'anim-clouds',temp:'29'},
    overcast:{label:'阴',icon:'overlay-overcast.svg',animation:'anim-overcast',temp:'27'}, rain:{label:'小雨',icon:'overlay-rain.svg',animation:'anim-rain',temp:'24'},
    thunder:{label:'雷阵雨',icon:'overlay-thunder.svg',animation:'anim-lightning',temp:'25'}, snow:{label:'小雪',icon:'overlay-snow.svg',animation:'anim-snow',temp:'2'}, fog:{label:'雾',icon:'overlay-fog.svg',animation:'anim-fog',temp:'22'}
  };
  function query(name) { return new URLSearchParams(window.location.search).get(name); }
  function heroMarkup() {
    return '<div class="hero-top"><div class="solar"><span class="solar-name">大暑</span><span class="solar-meaning">腐草为萤 · 土润溽暑</span><span class="solar-custom">荷风送香气，竹露滴清响</span></div><div class="hero-weather"><div class="hw-main"><span class="hw-temp">29℃</span><span class="hw-desc">多云</span></div><div class="hw-sub">成都 · 72% RH</div></div></div>' +
      '<div class="hero-date"><span class="hero-day">26</span><span class="hero-date-divider"></span><span class="hero-date-side"><span class="hero-week">星期日</span><span class="hero-lunar">农历六月十三</span></span></div>' +
      '<div class="hero-sub"><span class="hero-sub-script">顺时而饮</span><span class="hero-sub-text">松花酿酒，春水煎茶</span></div>';
  }
  function applyScene(root, phaseId, weatherId) {
    var phase=PHASES[phaseId]||PHASES.day, weather=WEATHERS[weatherId]||WEATHERS.cloudy, scene=root.querySelector('.scene-container');
    root.classList.remove('phase-dawn','phase-day','phase-dusk','phase-night'); root.classList.add('phase-'+phaseId);
    scene.className='scene-container scene-ready phase-'+phaseId; scene.querySelector('.scene-base').src='/images/'+phase.base;
    var overlay=scene.querySelector('.scene-overlay'), icon=weather.icon, animation=weather.animation;
    if(weatherId==='sunny'&&phaseId==='night'){icon='overlay-moon.svg';animation='anim-twinkle';}
    overlay.src='/images/'+icon; overlay.className='scene-overlay '+animation; scene.querySelector('.scene-tint').className='scene-tint tint-'+phaseId;
    root.querySelectorAll('.hw-desc').forEach(function(n){n.textContent=weather.label;}); root.querySelectorAll('.hw-temp').forEach(function(n){n.textContent=weather.temp+'℃';});
  }
  function addSceneControls(root,bar) {
    if(root.dataset.page!=='recommendation')return;
    root.querySelectorAll('header.hero[data-section="weather"]').forEach(function(h){h.innerHTML=heroMarkup();});
    var phaseId=query('phase')||'day', weatherId=query('weather')||'cloudy';
    if(!root.classList.contains('is-embedded')){
      var controls=document.createElement('span'); controls.className='prototype-scene-controls';
      controls.innerHTML='<select aria-label="时段"><option value="dawn">清晨</option><option value="day">白天</option><option value="dusk">黄昏</option><option value="night">夜晚</option></select><select aria-label="天气"><option value="sunny">晴</option><option value="cloudy">多云</option><option value="overcast">阴</option><option value="rain">雨</option><option value="thunder">雷</option><option value="snow">雪</option><option value="fog">雾</option></select>';
      bar.appendChild(controls); var ps=controls.querySelector('[aria-label="时段"]'), ws=controls.querySelector('[aria-label="天气"]'); ps.value=phaseId;ws.value=weatherId;
      controls.addEventListener('change',function(){phaseId=ps.value;weatherId=ws.value;var u=new URL(location.href);u.searchParams.set('phase',phaseId);u.searchParams.set('weather',weatherId);history.replaceState({},'',u);applyScene(root,phaseId,weatherId);});
    }
    applyScene(root,phaseId,weatherId);
  }
  function setupPage(){
    var root=document.querySelector('[data-page]'),panels=Array.from(document.querySelectorAll('[data-state]'));if(!root||!panels.length)return;if(query('embedded')==='1')root.classList.add('is-embedded');
    var bar=document.createElement('div');bar.className='gi';bar.innerHTML='<label for="state-switcher">原型状态</label><select id="state-switcher"></select>';root.insertBefore(bar,root.firstChild);var select=bar.querySelector('select');
    panels.forEach(function(panel){var o=document.createElement('option');o.value=panel.dataset.state;o.textContent=panel.dataset.stateLabel||panel.dataset.state;select.appendChild(o);});
    function show(state){var found=false;panels.forEach(function(panel){var active=panel.dataset.state===state;panel.hidden=!active;if(active)found=true;});if(!found)state=panels[0].dataset.state;select.value=state;root.dataset.activeState=state;parent.postMessage({type:'ui-prototype-state',page:root.dataset.page,state:state},'*');}
    select.addEventListener('change',function(){var u=new URL(location.href);u.searchParams.set('state',select.value);history.replaceState({},'',u);show(select.value);});addSceneControls(root,bar);show(query('state')||panels[0].dataset.state);
  }
  function setupHub(){
    var frame=document.querySelector('#prototype-frame');if(!frame)return;var pageSelect=document.querySelector('#hub-page'),stateSelect=document.querySelector('#hub-state'),viewportSelect=document.querySelector('#hub-viewport'),phaseSelect=document.querySelector('#hub-phase'),weatherSelect=document.querySelector('#hub-weather'),device=document.querySelector('.device'),manifest;
    function renderStates(page){stateSelect.innerHTML='';page.states.forEach(function(state){var o=document.createElement('option');o.value=state;o.textContent=state;stateSelect.appendChild(o);});}
    function navigate(){var page=manifest.pages.find(function(x){return x.id===pageSelect.value;});frame.src='/'+page.prototype.replace(/\\/g,'/')+'?embedded=1&state='+encodeURIComponent(stateSelect.value)+'&phase='+phaseSelect.value+'&weather='+weatherSelect.value;}
    fetch('/ui-prototype/manifest.json').then(function(r){return r.json();}).then(function(data){manifest=data;data.pages.forEach(function(page){var o=document.createElement('option');o.value=page.id;o.textContent=page.label+' · '+page.id;pageSelect.appendChild(o);});data.viewports.forEach(function(v){var o=document.createElement('option');o.value=v.id;o.textContent=v.label;viewportSelect.appendChild(o);});renderStates(data.pages[0]);viewportSelect.value=data.viewports[0].id;phaseSelect.value='day';weatherSelect.value='cloudy';pageSelect.dispatchEvent(new Event('change'));});
    pageSelect.addEventListener('change',function(){var page=manifest.pages.find(function(x){return x.id===pageSelect.value;});renderStates(page);var enabled=page.id==='recommendation';phaseSelect.disabled=!enabled;weatherSelect.disabled=!enabled;navigate();});stateSelect.addEventListener('change',navigate);phaseSelect.addEventListener('change',navigate);weatherSelect.addEventListener('change',navigate);
    viewportSelect.addEventListener('change',function(){var v=manifest.viewports.find(function(x){return x.id===viewportSelect.value;});device.style.width=v.width+'px';device.style.height=v.height+'px';});window.addEventListener('message',function(e){if(e.data&&e.data.type==='ui-prototype-state'&&e.data.page===pageSelect.value)stateSelect.value=e.data.state;});
  }
  function setupCarouselDots(){
    document.querySelectorAll('.rec-track').forEach(function(track){
      var dots=track.parentElement.querySelectorAll('.rec-dot');
      if(!dots.length)return;
      var slides=track.querySelectorAll('.rec-slide');
      track.addEventListener('scroll',function(){
        var scrollLeft=track.scrollLeft, trackWidth=track.offsetWidth;
        var idx=Math.round(scrollLeft/(trackWidth*0.82+14));
        idx=Math.max(0,Math.min(idx,slides.length-1));
        dots.forEach(function(d,i){d.classList.toggle('active',i===idx);});
      },{passive:true});
    });
  }
  document.addEventListener('DOMContentLoaded',function(){setupPage();setupHub();setupCarouselDots();});
}());