/* Helen & Sons HRIS | Mobile-First Break Management | uses existing authenticated HRIS session */
(() => {
 'use strict';
 const $ = id => document.getElementById(id);
 const escape = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const gstDay = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const gstStamp = t => t ? new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true}).format(new Date(t)) : '—';
 const duration = sec => {const m=Math.max(0,Math.ceil(Number(sec||0)/60));return m+' min';};
 const msec = s => Math.max(0,Math.floor((Date.now()-Date.parse(s))/1000));
 let ctx=null, mine=null, hrData=null, notifications=[],seenCount=0;
 let tab='mine',working=false,camera=null,activeCamera=false,refreshTimer=null,noteTimer=null,channel=null;
 let pendingToken=null,pendingMethod='qr',pendingRequestId=null,scanInProgress=false,lastToastId=null;
 let adminQR=null,historyData=null,selectedCode=null,uiCreated=false,mappingData=null,mappingOpen=false;
 const urlParams = new URLSearchParams(location.search);
 if (/^[a-f0-9]{64}$/.test(urlParams.get('break_desk')||'')) {
   pendingToken=urlParams.get('break_desk');
   pendingMethod=urlParams.get('via')==='nfc'?'nfc':'qr';
 }
 const isHR=()=>ctx?.profile && ['hr','admin'].includes(ctx.profile.role);
 const isAdmin=()=>ctx?.profile?.role==='admin';
 function banner(message,problem=false){
   const n=$('break-toast'); if(!n)return;
   n.textContent=message;n.className='break-toast show'+(problem?' problem':'');
   clearTimeout(banner.timer); banner.timer=setTimeout(()=>n.classList.remove('show'),6500);
 }
 async function invoke(action,extra={}){
   if(!ctx?.client)throw Error('Please sign in first');
   const {data,error}=await ctx.client.functions.invoke('hris-break',{body:{action,...extra}});
   if(error){let detail=error.message||'Break service unavailable';try{const extraError=await error.context?.json();detail=extraError?.error||detail;}catch{}throw Error(detail);}
   if(!data?.ok)throw Error(data?.error||'Unable to complete break action');
   return data;
 }
 function addUI(){
   if(uiCreated)return;
   const nav=$('sidebar-nav'),wrap=document.querySelector('.page-wrap');if(!nav||!wrap)return;
   nav.insertAdjacentHTML('beforeend','<button type="button" class="nav-item" data-page="breaks" title="Break Management"><span class="nav-icon" aria-hidden="true">☕</span> Break Management</button>');
   const main=document.createElement('section');main.className='page hidden';main.id='page-breaks';
   main.innerHTML=`<div class="break-heading"><div><span class="panel-kicker">HELEN &amp; SONS · MOBILE-FIRST</span><h1>Break Management</h1><p>Start and end each break by scanning the HR Desk QR or tapping its NFC tag. All times are Gulf Standard Time.</p></div><span class="break-pill">60 min / day</span></div>
   <div class="break-tabs"><button type="button" id="break-tab-mine" class="break-tab current" data-break-tab="mine">☕ My Break Hours</button><button type="button" id="break-tab-hr" class="break-tab" data-break-tab="hr" hidden>📋 HR Break Monitor</button></div>
   <div id="break-mine-content" aria-live="polite"><div class="break-skeleton">Loading your break hours…</div></div>
   <div id="break-hr-content" class="hidden" aria-live="polite"><div class="break-skeleton">Loading HR break monitor…</div></div>`;
   wrap.appendChild(main);
   const top=$('top-leave-btn');if(top){top.insertAdjacentHTML('afterend','<button class="notification-bell hidden" type="button" id="top-break-btn" title="HR break notifications" aria-label="Open HR break notifications">☕ <span id="top-break-count" class="bell-count hidden">0</span></button>');}
   const toast=document.createElement('div');toast.id='break-toast';toast.className='break-toast';toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');document.body.appendChild(toast);
   document.addEventListener('click',handleClick);
   document.addEventListener('change',e=>{if(e.target?.id==='break-hr-date')loadHR(true).catch(x=>banner(x.message,true));});
   document.addEventListener('input',e=>{if(e.target?.id==='break-hr-search')renderHR();});
   uiCreated=true;
 }
 function card(label,val,detail='',color=''){
   return `<div class="break-stat"><small>${escape(label)}</small><strong class="${color}">${escape(val)}</strong><span>${escape(detail)}</span></div>`;
 }
 function currentSeconds(){
   if(!mine)return 0;
   let total=Number(mine.used_seconds||0);
   // The server gave time as of refresh; for an open break, add the elapsed seconds since that refresh.
   if(mine.on_break && mine.open?.break_day===gstDay() && mine._readAt)total+=Math.max(0,Math.floor((Date.now()-mine._readAt)/1000));
   return total;
 }
 function renderMine(){
   const root=$('break-mine-content');if(!root)return;
   if(!ctx){root.innerHTML='<p>Sign in to see your break hours.</p>';return;}
   if(!mine){root.innerHTML='<div class="break-skeleton">Connecting to secure break service…</div>';return;}
   const allowance=Number(mine.allowance_seconds||3600),used=currentSeconds(),remaining=allowance-used;
   const pct=Math.min(100,Math.round(100*used/allowance));
   const noCode=!!mine.mapping_pending;
   const open=!!mine.on_break;
   const rows=(mine.sessions||[]).slice(0,20).map(s=>`<tr><td>${escape(s.break_day)}</td><td>${escape(gstStamp(s.started_at))}</td><td>${escape(s.ended_at?gstStamp(s.ended_at):'In progress')}</td><td>${escape(s.ended_at?duration(s.duration_seconds):duration(msec(s.started_at)))}</td></tr>`).join('');
   root.innerHTML=`<div class="break-grid-cards">
    ${card('Daily allowance',duration(allowance),'Per UAE calendar day')}
    ${card('Used today',duration(used),open?'Live timer running':'Completed sessions',used>allowance?'break-danger':'')}
    ${card('Remaining',duration(Math.max(0,remaining)),remaining<0?`${duration(-remaining)} over limit`:'Before daily limit',remaining<0?'break-danger':'break-success')}
   </div>
   <div class="break-progress-shell"><div class="break-progress-top"><strong>${escape(mine.employee_code||'EMP Code pending HR mapping')}</strong><span>${Math.round(used/60)} / ${Math.round(allowance/60)} min</span></div><div class="break-track"><span class="${used>allowance?'over':''}" style="width:${pct}%"></span></div></div>
   <div class="break-scan-panel">
     <div class="break-scan-icon">${open?'⏱️':'📷'}</div>
     <h2>${noCode?'EMP Code verification required':open?'You are currently on break':'Ready for your next break'}</h2>
     <p>${noCode?'Your existing HRIS login could not be matched to an approved EMP Code. Contact HR. Do not use somebody else’s account.':open?'Scan the same HR Desk QR or tap the NFC tag again to END your break.':'At the HR Desk, scan the QR with your phone or tap the NFC tag. The first scan starts your break.'}</p>
     ${open?`<div class="break-live-timer">Break started ${escape(gstStamp(mine.open?.started_at))}</div>`:''}
     <button type="button" class="break-main-button" data-break-action="camera" ${noCode?'disabled':''}>▣ &nbsp; Scan HR Desk QR</button>
     <p class="break-help">NFC: tap the HR Desk NFC sticker with your phone. Its link opens this same screen; confirm the scan below.</p>
     <div id="break-camera-panel" class="break-camera-panel hidden"><div id="break-reader"></div><div class="break-camera-actions"><button type="button" class="btn btn-outline" data-break-action="stop-camera">Close camera</button><label class="break-file-label">Use camera photo<input id="break-qr-photo" type="file" accept="image/*" capture="environment" hidden></label></div></div>
     <div id="break-confirm-panel" class="break-confirm ${pendingToken?'':'hidden'}"><strong>HR Desk ${escape(pendingMethod.toUpperCase())} detected</strong><p>${open?'Confirm END BREAK for your EMP Code.':'Confirm START BREAK for your EMP Code.'}</p><button type="button" class="break-main-button" data-break-action="confirm" ${noCode?'disabled':''}>${open?'✓ Confirm Break End':'✓ Confirm Break Start'}</button><button type="button" class="btn btn-outline" data-break-action="cancel">Cancel</button></div>
   </div>
   <section class="break-history"><div class="break-section-head"><h2>My Break History</h2><button type="button" class="btn btn-outline" data-break-action="refresh">↻ Refresh</button></div><div class="break-scroll"><table><thead><tr><th>UAE DAY</th><th>START</th><th>END</th><th>DURATION</th></tr></thead><tbody>${rows||'<tr><td colspan="4">No break scans yet.</td></tr>'}</tbody></table></div></section>`;
   const photo=$('break-qr-photo');if(photo)photo.addEventListener('change',async e=>{const f=e.target.files?.[0];if(f)await scanFile(f);e.target.value='';});
 }
 function renderHR(){
   const root=$('break-hr-content');if(!root||!isHR())return;
   if(!hrData){root.innerHTML='<div class="break-skeleton">Loading HR records…</div>';return;}
   const search=($('break-hr-search')?.value||'').trim().toLowerCase();
   const existingTag=$('break-admin-tag')?.firstElementChild || null;
   const existingDetails=$('break-employee-details')?.innerHTML || '';
   const existingLogin=$('break-map-login')?.value||'';
   const existingCode=$('break-map-emp')?.value||'';
   const selectedDate=$('break-hr-date')?.value||hrData.date;
   const list=(hrData.rows||[]).filter(r=>!search||[r.employee_code,r.full_name,r.department].some(v=>String(v||'').toLowerCase().includes(search)));
   const onBreak=(hrData.rows||[]).filter(x=>x.on_break).length;
   const over=(hrData.rows||[]).filter(x=>x.over_limit).length;
   const notes=notifications.slice(0,30).map(n=>`<li><span>${n.kind==='started'?'🟢':n.kind==='ended'?'✅':'⚠️'} <strong>${escape(n.employee_code)}</strong> — ${escape(n.kind==='started'?'Break Started':n.kind==='ended'?'Break Ended':'Exceeded 60-minute allowance')}</span><time>${escape(gstStamp(n.created_at))}</time></li>`).join('');
   root.innerHTML=`<div class="break-grid-cards">${card('Employees',String(hrData.rows?.length||0),'HR roster')}${card('On break now',String(onBreak),'Live status')}${card('Over allowance',String(over),'Daily 60-minute limit',over?'break-danger':'')}</div>
   <div class="break-admin-tools" ${isAdmin()?'':'hidden'}><div><strong>HR Desk QR / NFC setup</strong><p>Administrator only. Create the one-time printable QR and NFC URL; new setup disables any previous tag.</p></div><button class="btn btn-outline" type="button" data-break-action="create-tag">Generate / Rotate Desk QR</button><div id="break-admin-tag"></div><button class="btn btn-outline" type="button" data-break-action="manage-mappings">Verify EMP Code mappings</button><div id="break-admin-mappings"></div></div>
   <div class="break-history"><div class="break-section-head"><div><h2>All Employee Break Records</h2><p>Click an EMP Code to view one employee's detailed history.</p></div><div class="break-filters"><label>Date (GST)<input id="break-hr-date" type="date" value="${escape(selectedDate)}"></label><label>Search<input id="break-hr-search" type="search" value="${escape(search)}" placeholder="EMP Code / employee name"></label></div></div>
   <div class="break-scroll"><table><thead><tr><th>EMP CODE / EMPLOYEE</th><th>STATUS</th><th>BREAKS</th><th>USED</th><th>REMAINING</th></tr></thead><tbody>${list.map(r=>`<tr><td><button type="button" class="break-emp-button" data-break-emp="${escape(r.employee_code)}"><strong>${escape(r.employee_code)}</strong><small>${escape(r.full_name)}</small></button></td><td>${r.on_break?'<span class="break-tag on">On Break</span>':'<span class="break-tag">Working / No open break</span>'}</td><td>${Number(r.break_count||0)}</td><td class="${r.over_limit?'break-danger':''}">${escape(duration(r.used_seconds))}</td><td>${escape(duration(Math.max(0,r.remaining_seconds)))}</td></tr>`).join('')||'<tr><td colspan="5">No matching employees</td></tr>'}</tbody></table></div>
   <div id="break-employee-details">${selectedCode?'<p class="break-help">Select EMP Code again to refresh that employee’s history.</p>':''}</div></div>
   <div class="break-history"><div class="break-section-head"><h2>HR Live Scan Notifications</h2><button type="button" class="btn btn-outline" data-break-action="mark-seen">Mark notifications seen</button></div><ul class="break-notification-list">${notes||'<li>No break notifications yet.</li>'}</ul></div>`;
   if(existingTag)$('break-admin-tag')?.appendChild(existingTag);
   if(existingDetails&&$('break-employee-details'))$('break-employee-details').innerHTML=existingDetails;
   if(mappingOpen&&mappingData){renderMappings();if($('break-map-login'))$('break-map-login').value=existingLogin;if($('break-map-emp'))$('break-map-emp').value=existingCode;}
 }
 function renderMappings(){
   const box=$('break-admin-mappings');if(!box||!isAdmin()||!mappingOpen||!mappingData)return;
   const profiles=mappingData.profiles||[],roster=mappingData.roster||[],links=mappingData.links||[];
   const linked=new Map(links.map(x=>[x.auth_user_id,x]));
   const emailMatch=p=>roster.find(r=>String(r.email).toLowerCase()===String(p.email).toLowerCase());
   box.innerHTML=`<div class="break-mapping"><h3>Admin · Verify Existing Login → EMP Code</h3>
     <p>Each login gets the Break Management menu. Exact verified Auth email/HR roster matches can scan automatically. For unmatched logins, the Administrator must verify the person's identity before linking.</p>
     <div class="break-scroll"><table><thead><tr><th>HRIS LOGIN</th><th>EMP CODE</th><th>METHOD</th></tr></thead><tbody>${profiles.map(p=>{
       const explicit=linked.get(p.id),exact=emailMatch(p),code=explicit?.employee_code||exact?.employee_code||'Pending verification';
       const mode=explicit?(explicit.active?'HR approved':'HR disabled'):(exact?'Email match (verify Auth email)':'No match');
       return `<tr><td>${escape(p.full_name)}<small>${escape(p.email)}</small></td><td>${escape(code)}</td><td>${escape(mode)}</td></tr>`;
     }).join('')}</tbody></table></div>
     <div class="break-mapping-form"><label>Existing HRIS Login<select id="break-map-login"><option value="">Choose login</option>${profiles.map(p=>`<option value="${escape(p.id)}">${escape(p.full_name)} · ${escape(p.email)}</option>`).join('')}</select></label>
     <label>HR-verified EMP Code<select id="break-map-emp"><option value="">Choose EMP Code</option>${roster.map(r=>`<option value="${escape(r.employee_code)}">${escape(r.employee_code)} · ${escape(r.full_name)}</option>`).join('')}</select></label>
     <button type="button" class="btn btn-primary" data-break-action="save-mapping">Approve EMP Link</button></div>
     <p><strong>Important:</strong> Check the staff member and HR roster independently. Never guess a code from a name or scanner ID.</p></div>`;
 }
 async function loadMappings(){
   if(!isAdmin())return;
   mappingOpen=true;mappingData=await invoke('admin-mapping-data');renderMappings();
 }
 async function saveMapping(){
   if(!isAdmin()||!mappingData)return;
   const uid=$('break-map-login')?.value,code=$('break-map-emp')?.value;
   const account=(mappingData.profiles||[]).find(p=>p.id===uid),roster=(mappingData.roster||[]).find(r=>r.employee_code===code);
   if(!account||!roster)throw Error('Select both an existing HRIS login and an EMP Code');
   if(!window.confirm(`HR IDENTITY VERIFICATION\n\nLink ${account.full_name} (${account.email}) to ${roster.employee_code} — ${roster.full_name}?\n\nOnly confirm after independently checking the correct employee.`))return;
   await invoke('admin-map-employee',{auth_user_id:uid,employee_code:code});
   await loadMappings();await loadMine();banner(`${code} linked to verified HRIS login.`);
 }
 function isEditingHR(){const active=document.activeElement;return !!active?.closest?.('#break-admin-mappings,#break-admin-tag,#break-hr-search,#break-hr-date');}
 async function loadMine(){
   if(!ctx)return;
   try{const d=await invoke('me');d._readAt=Date.now();mine=d;renderMine();}
   catch(e){$('break-mine-content').innerHTML=`<div class="break-error">${escape(e.message)} <button type="button" class="btn btn-outline" data-break-action="refresh">Retry</button></div>`;}
 }
 async function loadHR(force=false){
   if(!isHR()||!ctx)return;
   const date=$('break-hr-date')?.value || hrData?.date || gstDay();
   const search=$('break-hr-search')?.value||'';
   const data=await invoke('hr-report',{date});
   hrData=data;hrData._readAt=Date.now();notifications=data.notifications||[];seenCount=data.unread_count||0;updateBell();
   renderHR();if($('break-hr-search'))$('break-hr-search').value=search;
   if(force && tab==='hr')await markSeen();
 }
 async function loadNotifications(){
   if(!isHR()||!ctx)return;
   const r=await invoke('hr-notifications');
   const latest=r.notifications?.[0];
   if(lastToastId && latest && latest.id!==lastToastId && !document.hidden){
     banner(`${latest.employee_code} — ${latest.kind==='started'?'Break Started':latest.kind==='ended'?'Break Ended':'Daily allowance exceeded'}`);
   }
   lastToastId=latest?.id||null;notifications=r.notifications||[];seenCount=r.unread_count||0;updateBell();
   if(tab==='hr'&&$('page-breaks')&&!$('page-breaks').classList.contains('hidden')&&!isEditingHR())renderHR();
 }
 function updateBell(){
   const bell=$('top-break-btn'),count=$('top-break-count');if(!bell||!count)return;
   bell.classList.toggle('hidden',!isHR());
   count.textContent=String(Math.min(99,seenCount));count.classList.toggle('hidden',seenCount===0);
 }
 async function markSeen(){
   if(!isHR())return;
   try {await invoke('mark-seen');seenCount=0;updateBell();}catch(e){banner(e.message,true);}
 }
 async function showDetails(code){
   if(!isHR())return;
   selectedCode=code;const data=await invoke('hr-employee',{employee_code:code});
   const target=$('break-employee-details');if(!target)return;
   target.innerHTML=`<h3>Break History · ${escape(code)}</h3><div class="break-scroll"><table><thead><tr><th>DATE</th><th>START</th><th>END</th><th>DURATION</th></tr></thead><tbody>${(data.sessions||[]).map(s=>`<tr><td>${escape(s.break_day)}</td><td>${escape(gstStamp(s.started_at))}</td><td>${escape(s.ended_at?gstStamp(s.ended_at):'Open')}</td><td>${escape(s.ended_at?duration(s.duration_seconds):duration(msec(s.started_at)))}</td></tr>`).join('')||'<tr><td colspan="4">No break history</td></tr>'}</tbody></table></div>`;
 }
 function showPending(token,method){
   if(!/^[a-f0-9]{64}$/.test(token))throw Error('This is not a valid Helen & Sons HR Desk QR code');
   pendingToken=token;pendingMethod=method==='nfc'?'nfc':'qr';pendingRequestId=crypto.randomUUID();
   renderMine();
   $('break-confirm-panel')?.scrollIntoView({behavior:'smooth',block:'nearest'});
 }
 function parseQR(content){
   let u;try{u=new URL(content);}catch{throw Error('Scan the HR Desk QR sticker, not an ordinary QR code');}
   if(u.origin!==location.origin)throw Error('This is not a Helen & Sons HRIS QR code');
   const token=u.searchParams.get('break_desk');if(!/^[a-f0-9]{64}$/.test(token||''))throw Error('Invalid HR Desk QR code');
   return token;
 }
 function loadScript(src,check){
   if(check())return Promise.resolve();
   return new Promise((resolve,reject)=>{
     const s=document.createElement('script');s.src=src;s.async=true;
     s.onload=()=>check()?resolve():reject(Error('Scanner library unavailable'));
     s.onerror=()=>reject(Error('Scanner failed to load. Check internet connectivity.'));document.head.append(s);
   });
 }
 async function stopCamera(){
   if(camera && activeCamera){try{await camera.stop();}catch{}activeCamera=false;}
   if(camera){try{camera.clear();}catch{}camera=null;}
   $('break-camera-panel')?.classList.add('hidden');
 }
 async function openCamera(){
   if(!ctx||mine?.mapping_pending)throw Error('EMP mapping not verified');
   $('break-camera-panel')?.classList.remove('hidden');
   await loadScript('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',()=>!!window.Html5Qrcode);
   camera=new window.Html5Qrcode('break-reader',{formatsToSupport:[window.Html5QrcodeSupportedFormats.QR_CODE],verbose:false});
   try{
     await camera.start({facingMode:'environment'},{fps:12,qrbox:{width:220,height:220}},async text=>{
       if(scanInProgress)return;scanInProgress=true;
       try {const token=parseQR(text);await stopCamera();showPending(token,'qr');}
       catch(e){banner(e.message,true);}finally{scanInProgress=false;}
     },()=>{});
     activeCamera=true;
   }catch(e){await stopCamera();throw Error('Camera unavailable. Grant camera permission, use Chrome/Safari HTTPS, or tap the NFC tag.');}
 }
 async function scanFile(file){
   try{
     await loadScript('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',()=>!!window.Html5Qrcode);
     await stopCamera();
     camera=new window.Html5Qrcode('break-reader',{verbose:false});
     $('break-camera-panel')?.classList.remove('hidden');
     const raw=await camera.scanFile(file,true);
     const token=parseQR(raw);await stopCamera();showPending(token,'qr');
   }catch(e){banner(e.message||'Could not read the QR photo',true);}
 }
 async function confirm(){
   if(working||!pendingToken)return;
   working=true;
   const requestId=pendingRequestId||(pendingRequestId=crypto.randomUUID());
   try{
     const out=await invoke('scan',{desk_token:pendingToken,request_id:requestId,method:pendingMethod});
     pendingToken=null;pendingRequestId=null;
     banner(`${out.employee_code} — Break ${out.action==='started'?'Started':'Ended'}${out.action==='ended'?' · '+duration(out.duration_seconds):''}`);
     await loadMine();
     if(isHR())await loadNotifications();
   }catch(e){banner(e.message,true);}finally{working=false;}
 }
 async function createTag(){
   if(!isAdmin())return;
   if(!window.confirm('Generate a NEW HR desk tag? This permanently invalidates the previous printed QR and NFC sticker URL.'))return;
   working=true;
   try{
     const data=await invoke('admin-tag-create');
     const box=$('break-admin-tag');if(!box)return;
     box.innerHTML=`<div class="break-tag-generated"><p><strong>ONE-TIME DESK TAG — print/save now</strong></p><div id="break-qr-image" aria-label="Printable HR Desk QR code"></div><label>QR sticker URL<input type="text" readonly value="${escape(data.qr_url)}" aria-label="QR URL"></label><label>NFC sticker URL<input type="text" readonly value="${escape(data.nfc_url)}" aria-label="NFC URL"></label><p>QR: print the code below. NFC: program your NFC sticker as an NDEF URL using an NFC writing app. The URL is shown only this once.</p><button class="btn btn-outline" data-break-action="print-qr">Print QR</button></div>`;
     await loadScript('https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',()=>!!window.QRCode);
     new window.QRCode($('break-qr-image'),{text:data.qr_url,width:220,height:220,correctLevel:window.QRCode.CorrectLevel.M});
     banner('New HR Desk QR / NFC tag created. Old tags are now invalid.');
   }catch(e){banner(e.message,true);}finally{working=false;}
 }
 async function handleClick(e){
   const b=e.target.closest('button,[data-break-action]');if(!b)return;
   if(b.id==='top-break-btn'){document.querySelector('#sidebar-nav [data-page="breaks"]')?.click();tab='hr';toggleTab();return;}
   if(b.dataset.breakTab){tab=b.dataset.breakTab;toggleTab();return;}
   if(b.dataset.breakEmp){await showDetails(b.dataset.breakEmp).catch(x=>banner(x.message,true));return;}
   const action=b.dataset.breakAction;if(!action)return;
   e.preventDefault();
   if(action==='camera'){try{await openCamera();}catch(x){banner(x.message,true);}return;}
   if(action==='stop-camera'){await stopCamera();return;}
   if(action==='confirm'){await confirm();return;}
   if(action==='cancel'){pendingToken=null;pendingRequestId=null;await stopCamera();renderMine();return;}
   if(action==='refresh'){await loadMine();if(isHR()&&tab==='hr')await loadHR();return;}
   if(action==='mark-seen'){await markSeen();return;}
   if(action==='create-tag'){await createTag();return;}
   if(action==='manage-mappings'){try{await loadMappings();}catch(x){banner(x.message,true);}return;}
   if(action==='save-mapping'){try{await saveMapping();}catch(x){banner(x.message,true);}return;}
   if(action==='print-qr'){
     const img=$('break-qr-image')?.querySelector('img,canvas');if(!img)return;
     const imgURL=img.tagName==='CANVAS'?img.toDataURL():img.src;
     const w=window.open('','_blank');if(!w){banner('Allow pop-ups to print the QR',true);return;}
     // The print window only receives a generated image URL; no backend access.
     w.document.write(`<html><head><title>Helen &amp; Sons HR Desk Break QR</title></head><body style="font-family:Arial;text-align:center;padding:40px"><h2>HELEN &amp; SONS · BREAK SCAN</h2><p>Scan at HR Desk with your own HRIS login</p><img width="260" height="260" src="${imgURL}"><p>Scan to START / END your break</p></body></html>`);
     w.document.close();w.focus();setTimeout(()=>w.print(),350);return;
   }
 }
 function toggleTab(){
   if(tab==='hr'&&!isHR())tab='mine';
   $('break-tab-mine')?.classList.toggle('current',tab==='mine');$('break-tab-hr')?.classList.toggle('current',tab==='hr');
   $('break-mine-content')?.classList.toggle('hidden',tab!=='mine');$('break-hr-content')?.classList.toggle('hidden',tab!=='hr');
   if(tab==='hr'){loadHR(true).catch(e=>banner(e.message,true));}
   else{renderMine();}
 }
 function subscribeHR(){
   if(!ctx?.client||!isHR())return;
   // Realtime INSERT is authorized with the HR account's RLS; polling is fallback.
   channel=ctx.client.channel('helen-break-notifications')
     .on('postgres_changes',{event:'INSERT',schema:'public',table:'break_notifications'},payload=>{
       const n=payload.new;if(!n)return;
       banner(`${n.employee_code} — ${n.kind==='started'?'Break Started':n.kind==='ended'?'Break Ended':'Daily allowance exceeded'}`);
       void loadNotifications().catch(()=>{});
       if(tab==='hr')void loadHR().catch(()=>{});
     }).subscribe();
   void loadNotifications().catch(e=>console.warn('Break notification refresh',e?.message));
   noteTimer=setInterval(()=>{if(ctx)void loadNotifications().catch(()=>{});},15000);
 }
 function onLogin(next){
   const switched=ctx?.user?.id!==next.user?.id;
   ctx=next;addUI();
   $('break-tab-hr')?.toggleAttribute('hidden',!isHR());updateBell();
   if(switched){mine=null;hrData=null;mappingData=null;mappingOpen=false;lastToastId=null;tab='mine';selectedCode=null;}
   if(refreshTimer)clearInterval(refreshTimer);
   if(noteTimer)clearInterval(noteTimer);
   if(channel){ctx.client.removeChannel(channel).catch(()=>{});channel=null;}
   subscribeHR();
   void loadMine();
   refreshTimer=setInterval(()=>{
     if(!ctx||!$('page-breaks')||$('page-breaks').classList.contains('hidden'))return;
     if(tab==='mine'){
       if(mine?.on_break){const now=currentSeconds(),totalLimit=mine.allowance_seconds||3600;
         const usedCard=$('break-mine-content')?.querySelector('.break-stat:nth-child(2) strong');if(usedCard)usedCard.textContent=duration(now);
         const remainingCard=$('break-mine-content')?.querySelector('.break-stat:nth-child(3) strong');if(remainingCard)remainingCard.textContent=duration(Math.max(0,totalLimit-now));
       }
       // Periodically refresh the server's record, including across devices.
       if(Date.now()-(mine?mine._readAt:0)>30000)void loadMine();
     } else if(tab==='hr'&&!isEditingHR()&&Date.now()-(hrData?hrData._readAt:0)>15000)void loadHR().catch(()=>{});
   },5000);
   if(pendingToken){
     // Remove the secret tag from the address bar once the same-page authenticated app is open.
     history.replaceState(null,'',location.pathname+location.hash);
     setTimeout(()=>{document.querySelector('#sidebar-nav [data-page="breaks"]')?.click();renderMine();},50);
   }
 }
 function onLogout(){
   if(refreshTimer)clearInterval(refreshTimer);refreshTimer=null;
   if(noteTimer)clearInterval(noteTimer);noteTimer=null;
   if(camera)void stopCamera();
   if(channel&&ctx?.client)ctx.client.removeChannel(channel).catch(()=>{});channel=null;
   ctx=null;mine=null;hrData=null;notifications=[];lastToastId=null;
   if(uiCreated){$('break-mine-content').textContent='Sign in to view Break Management';$('break-hr-content').textContent='';}
 }
 function onPageChange(page){if(page==='breaks'&&ctx){void loadMine();if(tab==='hr')void loadHR().catch(e=>banner(e.message,true));}}
 window.HRIS_BREAKS={onLogin,onLogout,onPageChange};
})();
