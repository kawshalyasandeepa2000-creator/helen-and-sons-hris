/* Helen & Sons HRIS Premium Blue — UI-only enhancements.
   No database/API requests, no auth mutations, no fingerprint sync changes.
   Existing application markup, permissions, login and click handlers remain authoritative. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const $q = sel => document.querySelector(sel);
  const modules = () => [...document.querySelectorAll('#sidebar-nav .nav-item[data-page]')]
    .filter(b => !b.classList.contains('hidden') && getComputedStyle(b).display !== 'none')
    .map(b => ({button:b,label:b.textContent.replace(/\s+/g,' ').trim().replace(/\b\d+$/,'').trim()}));

  function setupSearch(){
    const input=$('premium-module-search'),box=$('premium-search-results');
    if(!input||!box)return;
    function close(){box.hidden=true;box.replaceChildren();input.setAttribute('aria-expanded','false');}
    function show(){
      const q=input.value.trim().toLowerCase();box.replaceChildren();
      if(!q){close();return;}
      const hits=modules().filter(x=>x.label.toLowerCase().includes(q)).slice(0,7);
      if(!hits.length){const p=document.createElement('p');p.textContent='No matching page available for your account.';box.append(p);}
      for(const {button,label} of hits){
        const item=document.createElement('button');item.type='button';item.textContent=label;
        item.addEventListener('click',()=>{close();input.value='';button.click();});
        box.append(item);
      }
      box.hidden=false;input.setAttribute('aria-expanded','true');
    }
    input.addEventListener('input',show);
    input.addEventListener('keydown',e=>{
      if(e.key==='Escape'){close();input.blur();}
      if(e.key==='Enter'){
        e.preventDefault();const first=box.querySelector('button');if(first)first.click();
      }
    });
    document.addEventListener('keydown',e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){
        const app=$('app-screen');if(app&&!app.classList.contains('hidden')){e.preventDefault();input.focus();input.select();}
      }
    });
    document.addEventListener('pointerdown',e=>{if(!e.target.closest('.premium-search-wrap'))close();});
    // After profile/role changes, cached suggestions are never retained.
    $('logout-btn')?.addEventListener('click',()=>{input.value='';close();});
  }
  function shortDay(day){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return '—';
    const d=new Date(day+'T12:00:00Z');
    return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(d);
  }
  const valueFrom=(id)=>Number.parseInt($(id)?.textContent?.trim()||'',10);
  let sevenDayCoverage={days:[],loading:false,error:null};
  function renderChart(){
    const historyPanel=$('h7-overview-panel');
    const allowed=!$('app-screen')?.classList.contains('hidden')&&!!historyPanel&&!historyPanel.classList.contains('hidden');
    const chart=$('premium-bar-chart'),labels=$('premium-bar-days'),note=$('premium-bar-note');
    const donut=$('premium-donut'),pct=$('premium-covered'),coverageNote=$('premium-coverage-note');
    if(!chart||!labels||!note||!donut||!pct||!coverageNote)return;
    // Do not derive the chart from the historical-review-only HTML table.
    // Admin/HR report below merges verified historical + live scanner events.
    const days=sevenDayCoverage.days;
    const maxValue=Math.max(1,...days.filter(d=>Number.isFinite(d.covered)).map(d=>d.covered));
    chart.replaceChildren();labels.replaceChildren();
    for(let i=0;i<7;i++){
      const day=days[i],n=day&&Number.isFinite(day.covered)?day.covered:null;
      const col=document.createElement('div');col.className='premium-bar-col';
      const label=document.createElement('span');label.className='premium-bar-number';label.textContent=n===null?'—':String(n);
      const bar=document.createElement('span');bar.className='premium-bar';
      bar.style.setProperty('--bar-height',n===null?'6%':`${Math.max(4,100*n/maxValue)}%`);
      if(n===null)bar.classList.add('premium-bar-unavailable');
      col.append(label,bar);chart.append(col);
      const tick=document.createElement('span');tick.textContent=day?shortDay(day.date):'—';labels.append(tick);
    }
    note.textContent=!allowed?'7-day scan coverage is available to authorized Admin / HR accounts only.':
      sevenDayCoverage.loading?'Loading the verified 7-day fingerprint report…':
      sevenDayCoverage.error?sevenDayCoverage.error:
      days.length===7?'Verified employee IDs with at least one scan per day · live + historical records · not approved IN/OUT.':
      'Waiting for the authorized 7-day scanner report.';

    const teamPanel=$('team-overview-panel');
    const teamAllowed=!!teamPanel&&!teamPanel.classList.contains('hidden')&&allowed;
    const teamFiltered=!!$('team-overview-search')?.value?.trim();
    const teamRows=teamAllowed&&!teamFiltered?[...($('team-overview-body')?.querySelectorAll('tr')||[])]:[];
    let withScans=0,parsed=0;
    for(const row of teamRows){
      const cells=row.cells;if(cells.length<6)continue;
      const count=Number.parseInt(cells[4].textContent.trim(),10);
      if(!Number.isFinite(count))continue;
      parsed++;if(count>0)withScans++;
    }
    const total=valueFrom('team-overview-staff');
    const valid=teamAllowed&&parsed>0&&Number.isFinite(total)&&total>0;
    pct.textContent=valid?`${withScans}/${total}`:'—';
    donut.style.setProperty('--coverage',valid?`${100*Math.min(withScans,total)/total}%`:'0%');
    $('premium-scanned-count').textContent=valid?String(withScans):'—';
    $('premium-no-record-count').textContent=valid?String(Math.max(0,total-withScans)):'—';
    const date=$('team-overview-date')?.value||'';
    coverageNote.textContent=!teamAllowed?'Team scan coverage is restricted to Admin / HR.':
      teamFiltered?'Clear the team employee filter below for complete coverage.':
      valid?`${shortDay(date)} · At least one recorded scan. No scan record does not establish absence.`:
      'Waiting for the verified team report. No scan count is assumed.';
  }
  function setupCharts(){
    document.addEventListener('hris:coverage-7',e=>{
      const d=e.detail||{};
      sevenDayCoverage={days:Array.isArray(d.days)?d.days:[],loading:!!d.loading,error:d.error||null};
      renderChart();
    });
    renderChart();
    for(const id of ['h7-overview-body','team-overview-body']){
      const el=$(id);if(el)new MutationObserver(renderChart).observe(el,{childList:true});
    }
    for(const id of ['h7-overview-panel','team-overview-panel']){
      const el=$(id);if(el)new MutationObserver(renderChart).observe(el,{attributes:true,attributeFilter:['class']});
    }
    $('team-overview-date')?.addEventListener('change',()=>requestAnimationFrame(renderChart));
    $('h7-overview-date')?.addEventListener('change',()=>requestAnimationFrame(renderChart));
    $('h7-overview-status')?.addEventListener('change',()=>requestAnimationFrame(renderChart));
    $('h7-overview-search')?.addEventListener('input',()=>requestAnimationFrame(renderChart));
    $('team-overview-search')?.addEventListener('input',()=>requestAnimationFrame(renderChart));
    $('logout-btn')?.addEventListener('click',()=>requestAnimationFrame(renderChart));
    if($('app-screen'))new MutationObserver(renderChart).observe($('app-screen'),{attributes:true,attributeFilter:['class']});
  }
  function setupPeoplePreview(){
    const source=$('live-people-body'),target=$('premium-people-body'),filter=$('premium-people-filter');
    if(!source||!target||!filter)return;
    function mirror(){
      // The source table is already populated under Supabase RLS and session permissions.
      // Clone visible account rows; never fetch accounts or grant any new capability here.
      const app=$('app-screen');
      if(app?.classList.contains('hidden')){
        target.replaceChildren();
        const r=target.insertRow();const c=r.insertCell();c.colSpan=6;c.textContent='Awaiting secure sign-in.';
        return;
      }
      const q=filter.value.trim().toLowerCase();
      for(const badge of source.querySelectorAll('.subtle-badge')){
        const status=badge.textContent.trim().toLowerCase();
        badge.classList.toggle('pb-status-active',status==='active');
        badge.classList.toggle('pb-status-inactive',status==='inactive');
      }
      const rows=[...source.querySelectorAll('tr')].filter(row=>!q||row.textContent.toLowerCase().includes(q));
      target.replaceChildren(...rows.map(r=>r.cloneNode(true)));
      if(!rows.length){const r=target.insertRow();const c=r.insertCell();c.colSpan=6;c.textContent='No matching accounts.';}
    }
    new MutationObserver(mirror).observe(source,{childList:true});
    filter.addEventListener('input',mirror);
    $('logout-btn')?.addEventListener('click',()=>requestAnimationFrame(mirror));
    if($('app-screen'))new MutationObserver(mirror).observe($('app-screen'),{attributes:true,attributeFilter:['class']});
    mirror();
  }
  function setupActivityPreview(){
    const source=$('metric-in');const roster=$('team-overview-staff');
    const raw=$('premium-raw-scans');const count=$('premium-roster-count');
    function sync(){
      if(!raw||!count)return;
      if($('app-screen')?.classList.contains('hidden')){raw.textContent='—';count.textContent='—';return;}
      raw.textContent=source?.textContent?.trim()||'—';
      const verified=roster?.textContent?.trim()||'';
      count.textContent=/^\d+$/.test(verified)?verified:'—';
    }
    if(source)new MutationObserver(sync).observe(source,{childList:true,characterData:true,subtree:true});
    if(roster)new MutationObserver(sync).observe(roster,{childList:true,characterData:true,subtree:true});
    $('logout-btn')?.addEventListener('click',()=>requestAnimationFrame(sync));
    if($('app-screen'))new MutationObserver(sync).observe($('app-screen'),{attributes:true,attributeFilter:['class']});
    sync();
  }
  document.addEventListener('DOMContentLoaded',()=>{setupSearch();setupCharts();setupPeoplePreview();setupActivityPreview();});
})();
