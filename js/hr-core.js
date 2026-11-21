/* Helen & Sons HRIS | HR Operations Setup
   Scoped UI, no service credentials, no automatic payroll or legal entitlement assumptions.
   Every query is restricted by Supabase RLS to an active admin / HR login.
*/
(function(){
  'use strict';
  var ctx=null, data=null, fetching=false, saving=false, built=false;
  var $=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });};
  var manager=function(){return !!(ctx&&ctx.profile&&ctx.profile.active===true&&['admin','hr'].includes(ctx.profile.role));};
  var dayGST=function(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());};
  var selectEmp=function(){
    return '<option value="">Select verified HR roster employee</option>'+
      (data.roster||[]).map(function(r){return '<option value="'+esc(r.employee_code)+'">'+esc(r.full_name)+' ('+esc(r.employee_code)+')</option>';}).join('');
  };
  var empName=function(code){
    var r=(data.roster||[]).find(function(r){return r.employee_code===code;});
    return r ? r.full_name+' ('+code+')' : code;
  };
  var statusText=function(t){
    if(!t) return 'Not configured';
    return t;
  };
  var row=function(label,value){return '<span class="hrc-stat"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></span>';};
  var input=function(label,name,type,extra){
    return '<label>'+esc(label)+'<input name="'+esc(name)+'" type="'+esc(type)+'" '+(extra||'')+'></label>';
  };
  var select=function(label,name,options,extra){
    return '<label>'+esc(label)+'<select name="'+esc(name)+'" '+(extra||'')+'>'+options+'</select></label>';
  };
  var section=function(title,hint,body){
    return '<section class="hrc-panel"><h3>'+esc(title)+'</h3><p class="hrc-note">'+esc(hint)+'</p>'+body+'</section>';
  };
  var opt=function(value,title){return '<option value="'+esc(value)+'">'+esc(title)+'</option>';};
  var dateDiff=function(a,b){return Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);};
  function install(){
    if(built)return;
    var nav=document.querySelector('#sidebar-nav'),wrap=document.querySelector('.page-wrap');
    if(!nav||!wrap)return;
    var reports=nav.querySelector('[data-page="reports"]');
    if(reports)reports.insertAdjacentHTML('beforebegin','<button type="button" class="nav-item" data-page="hr-core" id="hrc-nav">▣ HR Operations Setup</button>');
    else nav.insertAdjacentHTML('beforeend','<button type="button" class="nav-item" data-page="hr-core" id="hrc-nav">▣ HR Operations Setup</button>');
    var page=document.createElement('section');
    page.id='page-hr-core';page.className='page hidden';
    page.innerHTML='<div class="page-heading"><div><span class="eyebrow">HR-ONLY CONFIGURATION</span>'+
      '<h1>HR Operations Setup</h1><p>Verified employee records, shift plans, leave allocations and document expiry dates.</p></div>'+
      '<button class="btn btn-outline" type="button" id="hrc-reload">Refresh</button></div>'+
      '<div id="hrc-content"><p class="section-helper">Open this page to load HR data.</p></div>';
    wrap.appendChild(page);
    var style=document.createElement('style');style.id='hrc-style';
    style.textContent=
      '#page-hr-core{--hrc-border:var(--border,#d9dfeb)}'+
      '#hrc-content{display:grid;gap:16px;padding-bottom:24px}'+
      '.hrc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:12px}'+
      '.hrc-stat,.hrc-panel{background:var(--card-bg,var(--surface,#fff));border:1px solid var(--hrc-border);border-radius:14px;padding:16px}'+
      '.hrc-stat small,.hrc-stat strong{display:block}.hrc-stat strong{font-size:23px;margin-top:5px}'+
      '.hrc-panel h3{margin:0 0 4px;font-size:17px}.hrc-note{font-size:12px;line-height:1.55;opacity:.75;margin:4px 0 14px}'+
      '.hrc-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:11px;align-items:end}'+
      '.hrc-fields label{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:600}'+
      '.hrc-fields input,.hrc-fields select{border:1px solid var(--hrc-border);background:var(--card-bg,#fff);color:inherit;border-radius:9px;padding:10px;min-height:40px;width:100%;box-sizing:border-box}'+
      '.hrc-form button{margin-top:12px}.hrc-days{display:flex;gap:9px;flex-wrap:wrap;margin:9px 0}'+
      '.hrc-days label{font-size:12px;display:inline-flex;gap:4px;align-items:center}'+
      '.hrc-tbl{overflow:auto;max-height:310px;border:1px solid var(--hrc-border);border-radius:10px}'+
      '.hrc-tbl table{border-collapse:collapse;width:100%;min-width:520px;font-size:12px}'+
      '.hrc-tbl td,.hrc-tbl th{text-align:left;padding:10px;border-bottom:1px solid var(--hrc-border)}'+
      '.hrc-table-label{font-size:12px;font-weight:600;margin:15px 0 7px}'+
      '.hrc-alert{border-left:3px solid #b87323;padding:10px 12px;font-size:12px;background:rgba(184,115,35,.08);border-radius:6px}'+
      '.hrc-error{color:#b42318}.hrc-urgent{font-weight:700;color:#b42318}.hrc-soon{font-weight:650;color:#916000}';
    document.head.appendChild(style);
    document.addEventListener('click',function(e){
      if(e.target.closest('#hrc-reload')&&manager())load();
    });
    document.addEventListener('submit',function(e){
      var form=e.target.closest('.hrc-form');
      if(!form||!manager())return;
      e.preventDefault();void save(form);
    });
    built=true;
  }
  function table(headers,rows,empty){
    return '<div class="hrc-tbl"><table><thead><tr>'+
      headers.map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+
      '</tr></thead><tbody>'+(rows.length?rows.join(''):'<tr><td colspan="'+headers.length+'">'+esc(empty)+'</td></tr>')+
      '</tbody></table></div>';
  }
  function cells(values){
    return '<tr>'+values.map(function(v){return '<td>'+v+'</td>';}).join('')+'</tr>';
  }
  function render(){
    if(!manager()||!data||!$('hrc-content'))return;
    var now=dayGST();
    var soon=data.docs.filter(function(d){var n=dateDiff(d.expires_on,now);return n>=0&&n<=30;}).length;
    var expired=data.docs.filter(function(d){return dateDiff(d.expires_on,now)<0;}).length;
    var emp=selectEmp();
    var types=opt('','Employment type not configured')+
      ['full_time','part_time','temporary','contract','other'].map(function(v){return opt(v,v.replace('_',' '));}).join('');
    var dayOptions=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(function(label,i){
      return '<label><input type="checkbox" name="work_days" value="'+i+'"> '+label+'</label>';
    }).join('');
    var shifts=opt('','Select shift')+data.shifts.filter(function(s){return s.active;}).map(function(s){return opt(s.id,s.shift_name+' ('+String(s.start_time).slice(0,5)+'–'+String(s.end_time).slice(0,5)+')');}).join('');
    var documentTypes=opt('','Select document')+[
      ['passport','Passport'],['visa','Residence visa'],['emirates_id','Emirates ID'],
      ['work_permit','Work permit'],['employment_contract','Employment contract']
    ].map(function(x){return opt(x[0],x[1]);}).join('');
    var out=[];
    out.push('<div class="hrc-alert"><strong>HR setup only:</strong> No staff details, shift rules or legal leave allowances have been inferred. '+
      'HR must verify and enter company policies. Raw scanner punches are not approved payroll.</div>');
    out.push('<div class="hrc-grid">'+row('HR roster employees',data.roster.length)+
      row('Profile details entered',data.details.length)+row('Active shift templates',data.shifts.filter(function(s){return s.active;}).length)+
      row('Documents expiring ≤30d',soon)+row('Documents already expired',expired)+
      row('Leave allocations entered',data.leave.length)+'</div>');

    var pRows=data.roster.map(function(r){
      var d=data.details.find(function(x){return x.employee_code===r.employee_code;});
      var a=data.assignments.find(function(x){return x.employee_code===r.employee_code&&x.effective_from<=now;});
      var t=a&&data.shifts.find(function(s){return s.id===a.shift_id;});
      return cells([esc(r.employee_code),esc(r.full_name),esc(r.department||'—'),
        esc(d&&d.joining_date?d.joining_date:'Not configured'),
        esc(d&&d.employment_type?d.employment_type:'Not configured'),
        esc(t?t.shift_name:'Not assigned')]);
    });
    var detailForm='<form class="hrc-form" data-form="details"><div class="hrc-fields">'+
      select('Employee *','employee_code',emp,'required')+
      input('Joining date','joining_date','date','')+
      select('Employment type','employment_type',types,'')+
      input('Reporting manager','reporting_manager','text','maxlength="120" placeholder="HR verified name"')+
      input('Work location','work_location','text','maxlength="120" placeholder="Office / site"')+
      '</div><button class="btn btn-primary" type="submit">Save employee details</button></form>';
    out.push(section('1. Employee master records','Never guess an employee joining date, reporting manager or employment contract.',
      '<div class="hrc-table-label">Verified HR roster</div>'+
      table(['EMP CODE','EMPLOYEE','DEPARTMENT','JOINED','EMPLOYMENT','SHIFT'],pRows,'No roster employees found.')+detailForm));

    var shiftRows=data.shifts.map(function(s){
      return cells([esc(s.shift_name),esc(String(s.start_time).slice(0,5)),esc(String(s.end_time).slice(0,5)),
        esc((s.work_days||[]).map(function(d){return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]||d;}).join(', ')),
        esc(s.grace_minutes),esc(s.active?'Active':'Disabled')]);
    });
    var shiftForm='<form class="hrc-form" data-form="shift"><div class="hrc-fields">'+
      input('Shift name *','shift_name','text','minlength="2" maxlength="100" required')+
      input('Start time (GST) *','start_time','time','required')+
      input('End time (GST) *','end_time','time','required')+
      input('Grace minutes *','grace_minutes','number','min="0" max="120" value="0" required')+
      '</div><div class="hrc-days" aria-label="Scheduled working weekdays">'+dayOptions+
      '</div><button class="btn btn-primary" type="submit">Create shift template</button></form>';
    var assignmentForm='<form class="hrc-form" data-form="assignment"><div class="hrc-fields">'+
      select('Employee *','employee_code',emp,'required')+
      select('Shift template *','shift_id',shifts,'required')+
      input('Effective from *','effective_from','date','value="'+esc(now)+'" required')+
      '</div><button class="btn btn-outline" type="submit">Assign shift from date</button></form>';
    out.push(section('2. Shift configuration','Settings do not generate automatic lateness, overtime or payroll without separately reviewed rules.',
      table(['SHIFT','START','END','WEEKDAYS','GRACE (MIN)','STATUS'],shiftRows,'No shift templates configured.')+
      '<div class="hrc-table-label">Create shift</div>'+shiftForm+
      '<div class="hrc-table-label">Assign employee shift (append-only history)</div>'+assignmentForm));

    var leaveRows=data.leave.map(function(l){
      return cells([esc(empName(l.employee_code)),esc(l.leave_year),
        esc(l.annual_days==null?'Not set':l.annual_days),esc(l.carry_forward_days==null?'Not set':l.carry_forward_days)]);
    });
    var leaveForm='<form class="hrc-form" data-form="leave"><div class="hrc-fields">'+
      select('Employee *','employee_code',emp,'required')+
      input('Leave year *','leave_year','number','min="2020" max="2100" value="'+esc(now.slice(0,4))+'" required')+
      input('Annual allocation (days)','annual_days','number','min="0" max="365" step="0.5" placeholder="Verify contract/policy"')+
      input('Carry-forward days','carry_forward_days','number','min="0" max="365" step="0.5" placeholder="HR approved"')+
      '</div><button class="btn btn-primary" type="submit">Save leave allocation</button></form>';
    out.push(section('3. Leave allocation setup','Configured entitlements only. These are NOT automatically deducted for requests; approved balances need policy integration.',
      table(['EMPLOYEE','YEAR','ALLOCATED DAYS','CARRY-FORWARD'],leaveRows,'No HR-verified leave allowances entered.')+
      '<div class="hrc-table-label">Configure an entitlement</div>'+leaveForm));

    var docRows=data.docs.slice().sort(function(a,b){return a.expires_on.localeCompare(b.expires_on);}).map(function(d){
      var days=dateDiff(d.expires_on,now),label=days<0?'EXPIRED':days<=30?'DUE ≤30 DAYS':days<=90?'DUE ≤90 DAYS':'Valid';
      var klass=days<0?'hrc-urgent':days<=90?'hrc-soon':'';
      return cells([esc(empName(d.employee_code)),esc(d.document_type.replace(/_/g,' ')),
        esc(d.expires_on),'<span class="'+klass+'">'+esc(label)+'</span>']);
    });
    var docForm='<form class="hrc-form" data-form="document"><div class="hrc-fields">'+
      select('Employee *','employee_code',emp,'required')+
      select('Document type *','document_type',documentTypes,'required')+
      input('Expiry date (verified) *','expires_on','date','required')+
      '</div><button class="btn btn-primary" type="submit">Save expiry date</button></form>';
    out.push(section('4. HR document expiry tracker','Dates only. No passport numbers, Emirates ID numbers, document images or files are uploaded.',
      table(['EMPLOYEE','DOCUMENT','EXPIRY DATE','STATUS'],docRows,'No verified document expiry dates have been entered.')+
      '<div class="hrc-table-label">Record or update an expiry date</div>'+docForm));
    out.push('<p class="hrc-note">Access: active HR Managers and Administrators only (Supabase RLS). '+
      'This module does not calculate UAE statutory leave, late penalties, salaries or WPS files.</p>');
    $('hrc-content').innerHTML=out.join('');
  }
  async function load(){
    if(!manager()||fetching)return;
    fetching=true;
    var area=$('hrc-content');
    if(area)area.innerHTML='<p class="section-helper">Loading HR data with Supabase access controls…</p>';
    var names=['roster','details','shifts','assignments','leave','docs'];
    var queries=[
      ctx.client.from('employee_bulk_roster').select('employee_code,full_name,department,job_title').order('employee_code'),
      ctx.client.from('hris_employee_details').select('employee_code,joining_date,employment_type,reporting_manager,work_location').order('employee_code'),
      ctx.client.from('hris_shift_templates').select('id,shift_name,start_time,end_time,work_days,grace_minutes,active').order('shift_name'),
      ctx.client.from('hris_employee_shift_assignments').select('employee_code,effective_from,shift_id').order('effective_from',{ascending:false}).limit(500),
      ctx.client.from('hris_leave_entitlements').select('employee_code,leave_year,annual_days,carry_forward_days').order('leave_year',{ascending:false}).limit(500),
      ctx.client.from('hris_document_expiry').select('employee_code,document_type,expires_on').order('expires_on',{ascending:true})
    ];
    var userId=ctx.user.id;
    try{
      var values=await Promise.all(queries);
      if(!manager()||ctx.user.id!==userId)return;
      var temp={};
      values.forEach(function(v,i){
        if(v.error)throw new Error('Unable to read '+names[i]+': '+v.error.message);
        temp[names[i]]=v.data||[];
      });
      data=temp;render();
    }catch(e){
      if(area)area.innerHTML='<p class="hrc-error">HR data unavailable: '+esc(e.message||'Check HR permissions')+'</p>';
    }finally{fetching=false;}
  }
  async function save(form){
    if(!manager()||saving)return;
    var fd=new FormData(form),kind=form.getAttribute('data-form');
    var code=String(fd.get('employee_code')||'').trim();
    if(kind!=='shift'&&!(data.roster||[]).some(function(r){return r.employee_code===code;})){
      alert('Please select a verified HR roster employee.');return;
    }
    var table,method='upsert',record={},options;
    if(kind==='details'){
      table='hris_employee_details';options={onConflict:'employee_code'};
      record={employee_code:code,joining_date:fd.get('joining_date')||null,
        employment_type:fd.get('employment_type')||null,reporting_manager:fd.get('reporting_manager')||null,
        work_location:fd.get('work_location')||null,updated_at:new Date().toISOString()};
    }else if(kind==='shift'){
      var days=fd.getAll('work_days').map(Number);
      if(!days.length){alert('Choose at least one working day.');return;}
      table='hris_shift_templates';method='insert';
      record={shift_name:String(fd.get('shift_name')||'').trim(),
        start_time:fd.get('start_time'),end_time:fd.get('end_time'),
        grace_minutes:Number(fd.get('grace_minutes')||0),work_days:days,active:true};
    }else if(kind==='assignment'){
      table='hris_employee_shift_assignments';method='insert';
      if(!(data.shifts||[]).some(function(s){return s.id===fd.get('shift_id')&&s.active;})){
        alert('Choose a configured, active shift.');return;
      }
      record={employee_code:code,shift_id:fd.get('shift_id'),effective_from:fd.get('effective_from')};
    }else if(kind==='leave'){
      table='hris_leave_entitlements';options={onConflict:'employee_code,leave_year'};
      record={employee_code:code,leave_year:Number(fd.get('leave_year')),
        annual_days:fd.get('annual_days')===''?null:Number(fd.get('annual_days')),
        carry_forward_days:fd.get('carry_forward_days')===''?null:Number(fd.get('carry_forward_days')),
        updated_at:new Date().toISOString()};
    }else if(kind==='document'){
      table='hris_document_expiry';options={onConflict:'employee_code,document_type'};
      record={employee_code:code,document_type:fd.get('document_type'),
        expires_on:fd.get('expires_on'),updated_at:new Date().toISOString()};
    }else return;
    if(!confirm('Save these HR-verified '+kind+' settings for '+(code||record.shift_name)+'?'))return;
    saving=true;
    try{
      var res=await ctx.client.from(table)[method](method==='upsert'?record:record,options);
      if(res.error)throw new Error(res.error.message);
      await load();
      alert('HR setup record saved. No attendance, leave approvals or payroll records were changed.');
    }catch(e){alert('Could not save HR setup: '+(e.message||'Unknown error'));}
    finally{saving=false;}
  }
  function onLogin(next){
    ctx=next;
    if(!manager()){
      $('hrc-nav')?.remove();
      $('page-hr-core')?.remove();
      built=false;data=null;
      return;
    }
    install();
    if(ctx&&document.querySelector('#page-hr-core:not(.hidden)'))void load();
  }
  function onPageChange(page){
    if(page==='hr-core'&&manager())void load();
  }
  function onLogout(){
    ctx=null;data=null;fetching=false;saving=false;
    var area=$('hrc-content');
    if(area)area.textContent='Sign in as HR or Administrator to access HR Operations Setup.';
  }
  window.HRIS_HR_CORE={onLogin:onLogin,onLogout:onLogout,onPageChange:onPageChange};
})();