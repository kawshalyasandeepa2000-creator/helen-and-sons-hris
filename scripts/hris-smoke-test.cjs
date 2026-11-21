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
