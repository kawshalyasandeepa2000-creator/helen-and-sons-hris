/* Helen & Sons: Supabase-powered raw scan monitor + provisional first/last scans.
 * Explicitly NOT an approved IN/OUT or payroll calculation.
 */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const cfg=window.HRIS_CONFIG||{};
  const configured=/^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(cfg.supabaseUrl||'') && !!cfg.supabasePublishableKey;
  let client=null, channel=null, currentRole=null;
  const status=text=>{$('status').textContent=text;};
  function row(values,klass='') {const tr=document.createElement('tr');tr.className=klass;for(const value of values){const td=document.createElement('td');td.textContent=String(value??'—');tr.appendChild(td);}return tr;}
  const show=page=>['setup','login','workspace'].forEach(id=>$(id).classList.toggle('hidden',id!==page));
  const fmt=iso=>{try{return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai',dateStyle:'medium',timeStyle:'short'}).format(new Date(iso));}catch{return '—';}};
  const hm=iso=>{try{return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));}catch{return '—';}};
  const getToday=()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const o=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${o.year}-${o.month}-${o.day}`;};
  async function loadData(){
    if(!client||!['admin','hr','attendance_viewer'].includes(currentRole))return;
    const today=getToday();
    // UAE midnight becomes 20:00 UTC the preceding day.
    const start=new Date(today+'T00:00:00+04:00').toISOString();
    const tomorrow=new Date(Date.parse(start)+24*60*60*1000).toISOString();
    const [events,daily,staff] = await Promise.all([
      client.from('scanner_events').select('event_key,device_key,scanner_user_id,scanned_at').order('scanned_at',{ascending:false}).limit(100),
      client.from('scanner_events').select('event_key,device_key,scanner_user_id,scanned_at').gte('scanned_at',start).lt('scanned_at',tomorrow).order('scanned_at',{ascending:true}).limit(1000),
      client.from('staff_directory').select('device_key,scanner_user_id,full_name,review_status,auth_profile_id')
    ]);
    for(const r of [events,daily,staff]) if(r.error)throw r.error;
    const directory=new Map(staff.data.map(x=>[x.device_key+'|'+x.scanner_user_id,x]));
    const explain=e=>directory.get(e.device_key+'|'+e.scanner_user_id);
    $('events').replaceChildren();
    const unmapped=new Set();
    for(const e of events.data){
      const person=explain(e);
      if(!person||person.review_status!=='verified')unmapped.add(e.device_key+'|'+e.scanner_user_id);
      $('events').appendChild(row([person?.full_name||'Unknown scanner ID',e.scanner_user_id,fmt(e.scanned_at),e.device_key,person?.review_status||'Unmapped'],person?.review_status==='verified'?'':'warning'));
    }
    if(!events.data.length)$('events').appendChild(row(['No scanner events yet','','','','']));
    const grouped=new Map();
    for(const e of daily.data){
      const key=e.device_key+'|'+e.scanner_user_id;
      if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push(e);
    }
    $('today-events').replaceChildren();
    for(const [key,records] of grouped){
      const first=records[0], last=records[records.length-1], person=directory.get(key);
      const label=(person?.full_name||'Unmapped')+' · ID '+first.scanner_user_id;
      const review=person?.review_status!=='verified' ? 'Staff ID review needed' : records.length===1?'One punch — review':'Provisional — HR review';
      $('today-events').appendChild(row([label,hm(first.scanned_at),records.length>=2?hm(last.scanned_at):'—',records.length,review],person?.review_status==='verified'?'':'warning'));
    }
    if(!grouped.size)$('today-events').appendChild(row(['No scans recorded today','—','—','0','—']));
    $('count').textContent=String(events.data.length);
    $('latest').textContent=events.data[0]?fmt(events.data[0].scanned_at):'—';
    $('unmapped').textContent=String(unmapped.size);
    $('event-status').textContent=`Updated ${new Date().toLocaleTimeString()} · Last 100 events · Today ${today} UAE · ${daily.data.length>=1000?'Daily display limited to 1000 scans.':''} RAW SCAN ≠ APPROVED IN/OUT`;
  }
  function subscribe(){
    if(channel)client.removeChannel(channel);
    channel=client.channel('helensons-scanner-monitor')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'scanner_events'},()=>loadData().catch(e=>status(e.message)))
      .subscribe(s=>{if(s==='SUBSCRIBED')status('Realtime connected');else if(s==='CHANNEL_ERROR'||s==='TIMED_OUT')status('Realtime delayed; use Refresh');});
  }
  async function authSession(){
    const {data:{user},error:err}=await client.auth.getUser();
    if(err||!user){show('login');status('Sign in required');return;}
    const {data:profile,error}=await client.from('profiles').select('role,active').eq('id',user.id).single();
    if(error||!profile?.active||!['admin','hr','attendance_viewer'].includes(profile.role)){
      show('login');$('login-error').textContent='Only active Administrator or Attendance Viewer accounts can view scanner attendance.';
      await client.auth.signOut();status('Access restricted');return;
    }
    currentRole=profile.role;show('workspace');status('Loading events…');
    await loadData();subscribe();
  }
  $('preview-btn').addEventListener('click',()=>{
    show('workspace');status('SAMPLE ONLY — not connected');
    $('count').textContent='2';$('latest').textContent='Sample 09:18';$('unmapped').textContent='1';
    $('events').replaceChildren(row(['Example employee','101','Sample 08:52','demo-office','verified']),row(['Unmapped','102','Sample 09:18','demo-office','needs_review'],'warning'));
    $('today-events').replaceChildren(row(['Example employee · ID 101','08:52','—','1','One punch — review']));
    $('event-status').textContent='SAMPLE DATA — no live records.';
    $('reload').disabled=true;$('logout').textContent='Close sample';
  });
  $('login-form').addEventListener('submit',async e=>{
    e.preventDefault();$('login-error').textContent='';
    try {const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;await authSession();}
    catch(err){$('login-error').textContent=err.message;}
  });
  $('reload').addEventListener('click',()=>loadData().catch(e=>status(e.message)));
  $('logout').addEventListener('click',async()=>{
    if(!client){show('setup');status('Waiting for configuration');return;}
    if(channel)await client.removeChannel(channel);await client.auth.signOut();currentRole=null;show('login');status('Signed out');
  });
  if(!configured){show('setup');return;}
  if(!window.supabase?.createClient){show('setup');status('Supabase JS library failed to load');return;}
  client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
  authSession().catch(err=>{show('login');$('login-error').textContent=err.message;status('Sign in required');});
})();
