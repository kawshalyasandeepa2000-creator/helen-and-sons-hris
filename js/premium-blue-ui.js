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
  /* Charts render directly from RLS-authorized server report summaries.
     Removed duplicate employee-history/team panels are no longer dependencies. */
  let sevenDayCoverage={days:[],loading:false,error:null,authorized:false};
  let teamCoverage={authorized:false,loading:false,error:null,date:'',employees:null,scanned:null,fetchedAt:0};
  function renderChart(){
    const active=!!$('app-screen')&&!$('app-screen').classList.contains('hidden');
    const sevenAllowed=active&&sevenDayCoverage.authorized;
    const teamAllowed=active&&teamCoverage.authorized;
    const chart=$('premium-bar-chart'),labels=$('premium-bar-days'),note=$('premium-bar-note');
    const donut=$('premium-donut'),pct=$('premium-covered'),coverageNote=$('premium-coverage-note');
    if(!chart||!labels||!note||!donut||!pct||!coverageNote)return;

    const days=sevenAllowed?sevenDayCoverage.days:[];
    const verified=days.filter(d=>d&&Number.isInteger(d.covered)&&d.covered>=0);
    const maxValue=Math.max(1,...verified.map(d=>d.covered));
    chart.replaceChildren();labels.replaceChildren();
    for(let i=0;i<7;i++){
      const day=days[i],n=day&&Number.isInteger(day.covered)&&day.covered>=0?day.covered:null;
      const col=document.createElement('div');col.className='premium-bar-col';
      const label=document.createElement('span');label.className='premium-bar-number';
      label.textContent=n===null?'—':String(n);
      const bar=document.createElement('span');bar.className='premium-bar';
      bar.style.setProperty('--bar-height',n===null?'5%':n===0?'0%':`${Math.max(5,100*n/maxValue)}%`);
      if(n===null)bar.classList.add('premium-bar-unavailable');
      col.append(label,bar);chart.append(col);
      const tick=document.createElement('span');tick.textContent=day?shortDay(day.date):'—';labels.append(tick);
    }
    note.textContent=!sevenAllowed?'7-day scan coverage is available to authorized Admin / HR accounts only.':
      sevenDayCoverage.loading?'Loading verified scanner coverage…':
      sevenDayCoverage.error?sevenDayCoverage.error:
      days.length===7?'Verified employees with at least one scanner record per day · not approved IN/OUT.':
      'Waiting for the authorized 7-day scanner report.';

    const total=teamCoverage.employees,withScans=teamCoverage.scanned;
    const valid=teamAllowed&&Number.isInteger(total)&&total>0
      &&Number.isInteger(withScans)&&withScans>=0&&withScans<=total;
    pct.textContent=valid?`${withScans}/${total}`:'—';
    donut.style.setProperty('--coverage',valid?`${100*withScans/total}%`:'0%');
    const scannedEl=$('premium-scanned-count'),missingEl=$('premium-no-record-count');
    if(scannedEl)scannedEl.textContent=valid?String(withScans):'—';
    if(missingEl)missingEl.textContent=valid?String(total-withScans):'—';
    coverageNote.textContent=!teamAllowed?'Team scan coverage is restricted to Admin / HR.':
      teamCoverage.loading&&!valid?'Loading verified team scan report…':
      teamCoverage.error?teamCoverage.error:
      valid?`${shortDay(teamCoverage.date)} · ${withScans} of ${total} verified staff have a recorded scan. No scan does not prove absence.`:
      'Verified team report is currently unavailable; no counts are assumed.';
  }
  function setupCharts(){
    document.addEventListener('hris:coverage-7',e=>{
      const d=e.detail||{};
      sevenDayCoverage={authorized:d.authorized===true,days:Array.isArray(d.days)?d.days:[],
        loading:!!d.loading,error:d.error||null};
      renderChart();
    });
    document.addEventListener('hris:team-coverage',e=>{
      const d=e.detail||{};
      teamCoverage={authorized:d.authorized===true,loading:!!d.loading,error:d.error||null,
        date:typeof d.date==='string'?d.date:'',
        employees:Number.isInteger(d.employees)?d.employees:null,
        scanned:Number.isInteger(d.scanned)?d.scanned:null,
        fetchedAt:Number(d.fetchedAt)||0};
      renderChart();
    });
    $('logout-btn')?.addEventListener('click',()=>requestAnimationFrame(renderChart));
    if($('app-screen'))new MutationObserver(renderChart).observe($('app-screen'),
      {attributes:true,attributeFilter:['class']});
    renderChart();
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
    const source=$('metric-in');
    const raw=$('premium-raw-scans');const count=$('premium-roster-count');
    function sync(){
      if(!raw||!count)return;
      if($('app-screen')?.classList.contains('hidden')){raw.textContent='—';count.textContent='—';return;}
      raw.textContent=source?.textContent?.trim()||'—';
      const verified=teamCoverage.authorized?teamCoverage.employees:null;
      count.textContent=Number.isInteger(verified)&&verified>0?String(verified):'—';
    }
    if(source)new MutationObserver(sync).observe(source,{childList:true,characterData:true,subtree:true});
    document.addEventListener('hris:team-coverage',sync);
    $('logout-btn')?.addEventListener('click',()=>requestAnimationFrame(sync));
    if($('app-screen'))new MutationObserver(sync).observe($('app-screen'),{attributes:true,attributeFilter:['class']});
    sync();
  }
  document.addEventListener('DOMContentLoaded',()=>{setupSearch();setupCharts();setupPeoplePreview();setupActivityPreview();});
})();
