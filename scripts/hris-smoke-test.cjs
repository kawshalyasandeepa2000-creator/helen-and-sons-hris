/* Production static smoke checks: no privileged credentials or database writes. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const text = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const exists = (name) => fs.existsSync(path.join(root, name));
const html = text('index.html');
const check = (description, fn) => { fn(); console.log('PASS  ' + description); };

check('HRIS page has existing authentication and navigation', () => {
  assert(html.includes('id="auth-screen"'));
  assert(html.includes('id="page-attendance"'));
  assert(html.includes('window.HRIS_BREAKS?.onLogin'));
});
check('Employee scanner self-service is mounted', () => {
  assert(html.includes('function renderMyFingerprintPanel()'));
  assert(html.includes('installPersonalFingerprintPanel();'));
  assert(html.includes("scanner_employee_links"));
});
check('Approved HR corrections overlay device scans with clear audit labels', () => {
  assert(html.includes('function approvedCorrectionForScanRow(r)'));
  assert(html.includes("c.status==='approved'&&c.reviewed_at"));
  assert(html.includes("String(correction[field]).slice(0,5)"));
  assert(html.includes("HR approved · original:"));
  assert(html.includes("approvedCorrectionForScanRow(r)"));
});
check('10-second automatic refresh is safe and preserves page state', () => {
  assert(html.includes("},10000);"));
  assert(html.includes("if(inFlightDataRefresh)return inFlightDataRefresh;"));
  assert(html.includes("if(!state.profile||state.busy||document.hidden||inFlightDataRefresh)return;"));
  assert(html.includes("const requestedBy=state.user?.id;"));
  assert(html.includes("if(!state.profile||state.user?.id!==requestedBy)return;"));
  assert(html.includes('js/break-management.js?v=2'));
  const breaks = text('js/break-management.js');
  assert(breaks.includes("},10000);"), 'Break notifications must poll every 10 seconds');
  assert(breaks.includes("Date.now()-(mine?mine._readAt:0)>=10000"));
  assert(breaks.includes("Date.now()-(hrData?hrData._readAt:0)>=10000"));
});
check('Duplicate seven-day/all-staff cards remain unmounted', () => {
  assert(!/^\s*attachHistoryDashboardPanels\(\);/m.test(html));
  assert(!/^\s*attachTeamPanels\(\);/m.test(html));
});
check('HR setup navigation is role restricted', () => {
  assert(html.includes("page==='hr-core'&&!manager()"));
  assert(html.includes('window.HRIS_HR_CORE?.onLogin'));
  assert(html.includes('js/hr-core.js?v=1'));
});
check('No service-role credentials or secret key names embedded in live browser scripts', () => {
  for (const filename of ['index.html', 'js/config.js', 'js/hr-core.js', 'js/break-management.js']) {
    assert(!/SUPABASE_SERVICE_ROLE_KEY|sb_secret_[a-zA-Z0-9_-]+/i.test(text(filename)), filename);
  }
});
check('Navy/white light and black/white dark themes are loaded last and readable', () => {
  const theme = text('css/hris-two-tone-theme.css');
  assert(html.includes('css/hris-two-tone-theme.css?v=2'));
  assert(html.indexOf('css/hris-two-tone-theme.css?v=2') > html.indexOf('id="classic-live-addons"'));
  assert(theme.includes('html[data-theme="light"]'));
  assert(theme.includes('html[data-theme="dark"]'));
  assert(theme.includes('--hs-ink:#182147'));
  assert(theme.includes('--hs-ink:#ffffff'));
  assert(theme.includes('--hs-canvas:#000000'));
  assert(theme.includes('#page-hr-core .hrc-stat'));
  assert(theme.includes('#page-hr-core .hrc-panel'));
  assert(theme.includes('color:var(--hs-ink)!important'));
  let braces=0;
  for(const char of theme) {if(char==='{')braces++;if(char==='}')braces--;assert(braces>=0,'CSS unbalanced');}
  assert.equal(braces,0,'CSS braces unbalanced');
});

check('Verified attendance coverage charts render without deleted duplicate panels', () => {
  assert(html.includes('function publishTeamCoverage()'));
  assert(html.includes("new CustomEvent('hris:team-coverage'"));
  assert(html.includes("void loadSevenDayCoverage();"));
  assert(html.includes('function publishSevenDayCoverage()'));
  assert(html.includes('js/premium-blue-ui.js?v=3'));
  const js = text('js/premium-blue-ui.js');
  assert(!js.includes("const historyPanel=$('h7-overview-panel')"));
  assert(!js.includes("const roster=$('team-overview-staff')"));
  assert(js.includes("document.addEventListener('hris:team-coverage'"));
  const theme = text('css/hris-two-tone-theme.css');
  assert(theme.includes('button.reload-btn'));
  assert(theme.includes('background:#182147!important'));
  assert(theme.includes('color:#000000!important'));

  // Run the actual production chart JavaScript in a small fake DOM,
  // with both zero-scan dates and authorized 17-person report fixtures.
  const node = () => ({
    textContent:'',children:[],
    style:{setProperty(){}},
    classList:{hidden:false,contains(name){return name==='hidden'&&this.hidden;},add(){},toggle(){}},
    replaceChildren(...elements){this.children=elements;},
    append(...elements){this.children.push(...elements);},
    addEventListener(){},setAttribute(){},querySelectorAll(){return [];}
  });
  const ids = {};
  for(const id of ['app-screen','premium-bar-chart','premium-bar-days','premium-bar-note',
    'premium-donut','premium-covered','premium-coverage-note','premium-scanned-count',
    'premium-no-record-count','premium-roster-count','premium-raw-scans','metric-in'])
    ids[id]=node();
  const events = {};
  const doc = {
    getElementById(id){return ids[id]||null;},
    addEventListener(name,fn){(events[name]??=[]).push(fn);},
    createElement(){return node();}
  };
  class Observer{observe(){}}
  vm.runInNewContext(js,{document:doc,MutationObserver:Observer,
    requestAnimationFrame:(fn)=>fn(),console:{warn(){},log(){}}},{timeout:2000});
  const emit=(name,detail)=>(events[name]||[]).forEach(fn=>fn({detail}));
  emit('DOMContentLoaded');
  const days=[0,14,0,17,16,15,16].map((covered,i)=>({
    date:'2026-11-'+String(i+14).padStart(2,'0'),covered
  }));
  emit('hris:coverage-7',{authorized:true,loading:false,error:null,days});
  emit('hris:team-coverage',{authorized:true,loading:false,error:null,
    date:'2026-11-21',employees:17,scanned:16,fetchedAt:Date.now()});
  assert.equal(ids['premium-bar-chart'].children.length,7);
  assert.equal(ids['premium-bar-chart'].children[0].children[0].textContent,'0');
  assert.equal(ids['premium-covered'].textContent,'16/17');
  assert.equal(ids['premium-scanned-count'].textContent,'16');
  assert.equal(ids['premium-no-record-count'].textContent,'1');
  assert.equal(ids['premium-roster-count'].textContent,'17');
  ids['app-screen'].classList.hidden=true;
  emit('hris:coverage-7',{authorized:false,days:[]});
  emit('hris:team-coverage',{authorized:false,employees:null,scanned:null});
  assert.equal(ids['premium-covered'].textContent,'—');
  assert.equal(ids['premium-roster-count'].textContent,'—');
});

check('Standalone HRIS pages honor the same two-tone preference', () => {
  const companionCss = text('css/hris-two-tone-standalone.css');
  for (const filename of ['daily-attendance.html','fingerprint-live.html','reset-password.html']) {
    const page = text(filename);
    assert(page.includes('css/hris-two-tone-standalone.css?v=1'), filename);
    assert(page.includes("helen-sons-hris-studio-theme"), filename);
    assert(page.indexOf('css/hris-two-tone-standalone.css?v=1') < page.indexOf('</head>'), filename);
  }
  assert(companionCss.includes('background:#182147!important'));
  assert(companionCss.includes('background:#000000!important'));
  assert(companionCss.includes('--st-panel:#ffffff'));
  assert(companionCss.includes('--st-panel:#000000'));
});
check('All local CSS and JS assets referenced from index.html exist', () => {
  const assets = [...html.matchAll(/<(?:script|link)\s+[^>]*(?:src|href)="([^"]+)"/gi)]
    .map(m => m[1].split('?')[0])
    .filter(s => !/^https?:\/\//.test(s) && /\.(?:js|css)$/.test(s));
  for (const asset of assets) assert(exists(asset), 'Missing ' + asset);
});
check('All live inline browser scripts compile', () => {
  let n = 0;
  const tags = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const tag of tags) {
    if (!tag[0].includes(' src=') && tag[1].trim()) {
      new vm.Script(tag[1], {filename: 'index-inline-' + (++n) + '.js'});
    }
  }
  assert(n >= 2, 'Expected active inline scripts');
});
check('All active local browser JS files compile', () => {
  for (const asset of ['js/config.js', 'js/premium-blue-ui.js', 'js/break-management.js', 'js/hr-core.js']) {
    new vm.Script(text(asset), {filename:asset});
  }
});
console.log('Helen & Sons HRIS static smoke tests passed.');
