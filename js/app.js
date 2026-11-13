/* Helen & Sons HRIS | Vanilla JavaScript frontend */
(() => {
  'use strict';
  const cfg = window.HRIS_CONFIG || {};
  const TZ = cfg.timezone || 'Asia/Dubai';
  const OLD_STORE = 'helensons-hris-html-demo-v1';
  const STORE = 'helensons-hris-html-demo-v2';
  const $ = (id) => document.getElementById(id);
  const state = {
    mode: 'none', client: null, session: null, user: null, profile: null,
    profiles: [], attendance: [], leaves: [], reviewedAlerts: [], selectedRejectId: null, activePage: 'overview', authView: 'signin',
    filterDate: businessDay(), attendanceView: 'all', alertView: 'all', query: '', demoUserId: 'demo-admin', busy: false,
    recoveryPending: false, shifts: [], corrections: [], editingEmployeeId: null, editingShiftId: null, selectedCorrectionRejectId: null, editingPhoto: null, photoRequestToken: 0, accountPhotoRequestToken: 0, assets: [], assetQuery: '', assetTypeFilter: 'all', assetStatusFilter: 'all', editingAssetId: null, returningAssetId: null
  };

  const configured = Boolean(
    typeof cfg.supabaseUrl === 'string' && /^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(cfg.supabaseUrl.trim()) &&
    typeof cfg.supabasePublishableKey === 'string' && cfg.supabasePublishableKey.trim()
  );
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function getParts(date = new Date(), opts = {}) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).formatToParts(date)
      .reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  }
  function businessDay(date = new Date()) {
    const p = getParts(date, {year:'numeric',month:'2-digit',day:'2-digit'});
    return `${p.year}-${p.month}-${p.day}`;
  }
  function shortTime(iso) { if (!iso) return '--:--'; return new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)); }
  function readableDay(day) { if (!day) return '—'; return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'}).format(new Date(`${day}T12:00:00Z`)); }
  function weekDay() { return new Intl.DateTimeFormat('en-GB',{timeZone:TZ,weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date()); }
  function hourDuration(record) {
    if (!record?.clock_in_at) return '—';
    const end = record.clock_out_at ? Date.parse(record.clock_out_at) : Date.now();
    const start = Date.parse(record.clock_in_at);
    if (!Number.isFinite(start) || end < start) return '—';
    return ((end - start) / 3600000).toFixed(1) + 'h';
  }
  function initials(name) { return String(name || 'HS').split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join('').toUpperCase(); }
  function roleLabel(role) { return ({admin:'Administrator',hr:'HR Manager',employee:'Employee'})[role] || 'Employee'; }
  // Photos are a DEMO feature. Canvas always produces a small JPEG data URL;
  // no full-size uploads, metadata or biometric information are stored.
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  const MAX_STORED_PHOTO_CHARS = 180000;
  function safePhotoUrl(value) {
    return typeof value === 'string' && value.length <= MAX_STORED_PHOTO_CHARS &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null;
  }
  function avatarMarkup(profile, cssClass = 'person-initials') {
    const name = profile?.full_name || 'Employee';
    const image = safePhotoUrl(profile?.photo_data_url);
    const contents = image ? `<img src="${image}" alt="" loading="lazy" decoding="async" />` : escapeHtml(initials(name));
    return `<span class="${cssClass} photo-avatar ${image ? 'has-photo' : ''}" aria-label="${escapeHtml(name)}'s profile photo">${contents}</span>`;
  }
  function renderAvatarElement(element, name, photo) {
    element.classList.add('photo-avatar');
    const image = safePhotoUrl(photo);
    element.replaceChildren();
    element.classList.toggle('has-photo', Boolean(image));
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', name + ' profile photo');
    if (image) {
      const img = document.createElement('img');
      img.src = image; img.alt = ''; img.decoding = 'async';
      element.appendChild(img);
    } else element.textContent = initials(name);
  }
  function resizeProfilePhoto(file) {
    return new Promise((resolve, reject) => {
      if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) {
        reject(Error('Choose a JPG, PNG or WebP image. SVG and other file types are not accepted.'));return;
      }
      if (file.size > MAX_PHOTO_BYTES) {reject(Error('This photo is too large. Select an image smaller than 5 MB.'));return;}
      const url = URL.createObjectURL(file);
      const img = new Image();
      let done = false;
      const finish = (error, result) => {
        if (done) return;
        done = true;
        URL.revokeObjectURL(url);
        if (error) reject(error); else resolve(result);
      };
      img.onload = () => {
        try {
          const width = img.naturalWidth, height = img.naturalHeight;
          if (!width || !height) throw Error('The selected image could not be read.');
          const canvas = document.createElement('canvas');
          const side = 240;
          canvas.width = side;canvas.height = side;
          const context = canvas.getContext('2d');
          if (!context) throw Error('Your browser cannot resize this image.');
          const crop = Math.min(width, height);
          context.drawImage(img, (width - crop) / 2, (height - crop) / 2, crop, crop, 0, 0, side, side);
          const encoded = canvas.toDataURL('image/jpeg', 0.78);
          if (!safePhotoUrl(encoded)) throw Error('This image cannot be stored. Try a smaller image.');
          finish(null, encoded);
        } catch (err) {finish(err);}
      };
      img.onerror = () => finish(Error('Unable to load this image. Please choose another photo.'));
      img.src = url;
    });
  }

  // Role checks are used in both the interface and every demo mutation handler.
  // They are NOT a substitute for server-side authorisation in a deployed HRIS.
  function canReadTeam() { return ['admin','hr'].includes(state.profile?.role); }
  function isHrManager() { return state.profile?.role === 'hr' && state.profile?.active !== false; }
  function canApproveLeave() { return isHrManager(); }
  function canApproveCorrections() { return isHrManager(); }
  function canInvite() { return state.profile?.role === 'admin' && state.profile?.active !== false; }
  function canManageAssets() { return canInvite() && !isLive(); }
  function canEditEmployee(profile) { return canInvite() && !!profile && !['demo-admin','demo-e3'].includes(profile.id) && profile.id !== state.profile?.id; }
  function pendingLeaveForManager() {
    return isHrManager() ? state.leaves.filter(l => l.status === 'pending' && l.employee_id !== state.profile?.id) : [];
  }
  function isLive() { return state.mode === 'live'; }
  function notify(text, type = 'success') {
    const el = $('toast'); el.textContent = text; el.className = `toast show ${type === 'error' ? 'error' : ''}`;
    clearTimeout(notify.timer); notify.timer = setTimeout(() => el.classList.remove('show'), 6000);
  }
  function showAuth(view = 'signin') {
    state.authView = view;
    $('app-screen').classList.add('hidden'); $('auth-screen').classList.remove('hidden');
    $('login-view').classList.toggle('hidden',view !== 'signin');
    $('forgot-view').classList.toggle('hidden',view !== 'forgot');
    $('password-view').classList.toggle('hidden',view !== 'password');
    $('setup-alert').classList.toggle('hidden', configured);
    $('demo-entry').classList.toggle('hidden', configured);
  }
  function showApp() {
    $('auth-screen').classList.add('hidden'); $('app-screen').classList.remove('hidden');
    $('mode-warning').classList.toggle('hidden', isLive());
    $('connection-indicator').innerHTML = `<span class="state-dot"></span> ${isLive() ? 'Connected · Supabase' : 'Demo preview'}`;
    $('connection-indicator').classList.toggle('live', isLive());
    $('demo-switch-wrap').classList.toggle('hidden', isLive());
    $('mobile-demo-switch-wrap').classList.toggle('hidden', isLive());
    switchPage(state.activePage);
  }
  function createDemoTime(hour, minute) { return new Date(`${businessDay()}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+04:00`).toISOString(); }
  function dateShift(days) { return new Date(Date.parse(businessDay() + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10); }
  function seedShifts() {
    return [
      {id:'shift-ops',name:'Operations morning',start:'09:00',end:'18:00',grace:10,days:[1,2,3,4,5,6]},
      {id:'shift-office',name:'Head office',start:'08:30',end:'17:30',grace:10,days:[1,2,3,4,5]},
      {id:'shift-night',name:'Evening / night',start:'22:00',end:'06:00',grace:15,days:[1,2,3,4,5,6]}
    ];
  }
  function normalizeDemo(data) {
    const defaults=seedShifts();
    data.shifts=Array.isArray(data.shifts)&&data.shifts.length ? data.shifts : defaults;
    data.corrections=Array.isArray(data.corrections) ? data.corrections : [];
    data.assets=Array.isArray(data.assets) ? data.assets : seedAssets();
    data.profiles=data.profiles.map((p,i)=>({
      ...p, role:p.id==='demo-admin'?'admin':p.id==='demo-e3'?'hr':(['admin','hr','employee'].includes(p.role)?p.role:'employee'), employee_code:p.employee_code||'HS-'+String(i+1).padStart(4,'0'),
      phone:p.phone||'', location:p.location||'Dubai, UAE', joined_on:p.joined_on||'2025-01-15',
      employment_type:p.employment_type||'Full-time', manager_id:p.manager_id ?? (p.id==='demo-admin'?'':'demo-admin'),
      shift_id:p.shift_id || (['demo-e2','demo-e4'].includes(p.id)?'shift-ops':'shift-office'),
      annual_allowance:Number.isFinite(Number(p.annual_allowance))?Number(p.annual_allowance):24,
      sick_allowance:Number.isFinite(Number(p.sick_allowance))?Number(p.sick_allowance):14
    }));
    return data;
  }
  function initialDemo() {
    return {
      shifts: seedShifts(),
      corrections: [],
      profiles: [
        {id:'demo-admin',full_name:'Helen & Sons Admin',email:'admin@helensons.example',department:'Human Resources',job_title:'System Administrator',role:'admin',active:true},
        {id:'demo-e1',full_name:'Ayesha Fernando',email:'ayesha@helensons.example',department:'Operations',job_title:'Operations Coordinator',role:'employee',active:true},
        {id:'demo-e2',full_name:'Mohammed Rizwan',email:'rizwan@helensons.example',department:'Facilities',job_title:'Site Supervisor',role:'employee',active:true},
        {id:'demo-e3',full_name:'Sarah Perera',email:'sarah@helensons.example',department:'Human Resources',job_title:'HR Manager',role:'hr',active:true},
        {id:'demo-e4',full_name:'Ahmed Khalid',email:'ahmed@helensons.example',department:'Operations',job_title:'Operations Assistant',role:'employee',active:true},
        {id:'demo-e5',full_name:'Nadia Iqbal',email:'nadia@helensons.example',department:'Administration',job_title:'Office Administrator',role:'employee',active:true}
      ],
      attendance: [
        {id:'demo-log-1',employee_id:'demo-e1',work_date:businessDay(),clock_in_at:createDemoTime(8,55),clock_out_at:null,source:'web'},
        {id:'demo-log-2',employee_id:'demo-e2',work_date:businessDay(),clock_in_at:createDemoTime(8,40),clock_out_at:null,source:'web'},
        {id:'demo-log-3',employee_id:'demo-e3',work_date:businessDay(),clock_in_at:createDemoTime(9,5),clock_out_at:createDemoTime(17,10),source:'web'},
        {id:'demo-log-4',employee_id:'demo-e4',work_date:businessDay(),clock_in_at:createDemoTime(9,24),clock_out_at:null,source:'web'}
      ],
      leaves: [
        {id:'leave-sample-1',employee_id:'demo-e1',type:'Annual leave',start_date:dateShift(5),end_date:dateShift(7),reason:'Family trip',status:'pending',submitted_at:new Date().toISOString(),review_note:'',reviewed_by:null},
        {id:'leave-sample-2',employee_id:'demo-e2',type:'Sick leave',start_date:dateShift(2),end_date:dateShift(3),reason:'Medical appointment and recovery',status:'pending',submitted_at:new Date().toISOString(),review_note:'',reviewed_by:null},
        {id:'leave-sample-3',employee_id:'demo-e4',type:'Annual leave',start_date:dateShift(12),end_date:dateShift(13),reason:'Planned personal leave',status:'approved',submitted_at:new Date().toISOString(),review_note:'Approved as requested',reviewed_by:'demo-e3',reviewed_at:new Date().toISOString()},
        {id:'leave-sample-4',employee_id:'demo-e5',type:'Unpaid leave',start_date:dateShift(8),end_date:dateShift(9),reason:'Personal matter',status:'rejected',submitted_at:new Date().toISOString(),review_note:'Please discuss alternative dates with your supervisor.',reviewed_by:'demo-e3',reviewed_at:new Date().toISOString()}
      ],
      reviewedAlerts: [],
      assets: seedAssets()
    };
  }
  function saveDemo() { try { localStorage.setItem(STORE, JSON.stringify({profiles:state.profiles,attendance:state.attendance,leaves:state.leaves,reviewedAlerts:state.reviewedAlerts,shifts:state.shifts,corrections:state.corrections,assets:state.assets})); return true; } catch (_) { notify('Browser storage is full or unavailable. Please remove some demo photos and try again.', 'error'); return false; } }
  function loadDemo() {
    let loaded;
    try { loaded = JSON.parse(localStorage.getItem(STORE) || localStorage.getItem(OLD_STORE) || 'null'); } catch (_) {}
    const fresh = initialDemo();
    if (!loaded || !Array.isArray(loaded.profiles) || !Array.isArray(loaded.attendance)) return normalizeDemo(fresh);
    return normalizeDemo({profiles:loaded.profiles, attendance:loaded.attendance, leaves:Array.isArray(loaded.leaves)?loaded.leaves:fresh.leaves, reviewedAlerts:Array.isArray(loaded.reviewedAlerts)?loaded.reviewedAlerts:[], shifts:loaded.shifts, corrections:loaded.corrections,assets:loaded.assets});
  }
  function enterDemo(userId) {
    state.accountPhotoRequestToken++;
    const data = loadDemo();
    state.mode = 'demo'; state.demoUserId = userId; state.user = {id:userId};
    state.profiles = data.profiles; state.attendance = data.attendance; state.leaves = data.leaves; state.reviewedAlerts = data.reviewedAlerts; state.shifts=data.shifts; state.corrections=data.corrections;state.assets=data.assets;
    const requested = data.profiles.find(p => p.id === userId && p.active !== false);
    if (!requested) {notify('This demo account is inactive or not available. Switch to an active employee.','error');return;}
    state.profile = requested;
    state.activePage = 'overview'; state.filterDate = businessDay(); state.assetQuery='';state.assetTypeFilter='all';state.assetStatusFilter='all';saveDemo(); showApp();
  }
  function getTodayRecords() { return state.attendance.filter(a => a.work_date === businessDay() && (canReadTeam() || a.employee_id === state.profile?.id)); }
  function myLastOpen() {
    return state.attendance.filter(a => a.employee_id === state.profile?.id && a.clock_in_at && !a.clock_out_at)
      .sort((a,b) => Date.parse(b.clock_in_at) - Date.parse(a.clock_in_at))[0] || null;
  }
  function myTodayRecord() {
    return getTodayRecords().find(a => a.employee_id === state.profile?.id) || null;
  }
  function findPerson(id) { return state.profiles.find(p => p.id === id) || {full_name:'Former employee',email:'—'}; }
  function statusFor(record) { return !record ? 'not-in' : record.clock_out_at ? 'out' : 'in'; }
  function statusMarkup(rec) {
    const status = statusFor(rec);
    return `<span class="data-pill ${status === 'in' ? 'active' : status === 'out' ? 'inactive' : ''}">${status === 'in' ? '● Clocked IN' : status === 'out' ? '✓ Clocked OUT' : 'Not checked in'}</span>`;
  }
  function personMarkup(profile) {
    return `<div class="person-cell">${avatarMarkup(profile)}<div><strong>${escapeHtml(profile.full_name)}</strong><small>${escapeHtml(profile.email || '')}</small></div></div>`;
  }
  function renderMetrics() {
    const people = state.profiles.filter(p => p.active !== false && (canReadTeam() || p.id === state.profile?.id));
    const today = getTodayRecords().filter(a => people.some(p => p.id === a.employee_id));
    const current = new Set(today.filter(a => !a.clock_out_at).map(a => a.employee_id));
    $('metric-total').textContent = String(people.length);
    $('metric-in').textContent = String(current.size);
    $('metric-late').textContent = String(getLateAlerts().filter(a => a.work_date === businessDay()).length);
    $('metric-pending').textContent = String(canApproveLeave() ? pendingLeaveForManager().length : state.leaves.filter(l => l.employee_id === state.profile?.id && l.status === 'pending').length);
    const pendingCard = $('metric-pending').closest('.metric-card');
    pendingCard.dataset.page = canApproveLeave() ? 'approvals' : 'leaves';
    pendingCard.setAttribute('aria-label',canApproveLeave() ? 'View HR Manager pending leave approvals' : 'View my pending leave requests');
    pendingCard.title = pendingCard.getAttribute('aria-label');
    $('metric-pending-caption').textContent = canApproveLeave() ? 'Awaiting your decision' : 'My requests awaiting review';
  }
  function renderMyAttendance() {
    const today = myTodayRecord(); const open = myLastOpen();
    const shown = open || today;
    const status = open ? 'in' : statusFor(today);
    const pill = $('my-status-pill');
    pill.className = `status-pill status-${status}`;
    pill.textContent = status === 'in' ? '● CLOCKED IN' : status === 'out' ? '✓ CLOCKED OUT' : 'NOT CLOCKED IN';
    $('my-in-time').textContent = shortTime(shown?.clock_in_at);
    $('my-out-time').textContent = shortTime(shown?.clock_out_at);
    $('my-hours').textContent = hourDuration(shown);
    $('clock-in-btn').disabled = Boolean(today || open) || state.busy;
    $('clock-out-btn').disabled = !open || state.busy;
    $('punch-help').textContent = status === 'in' ? 'You are currently clocked in. Clock out when you finish your shift.' :
      status === 'out' ? 'Your attendance has been completed for today.' : 'Your IN/OUT times are recorded automatically when you press a button.';
    $('attendance-status-heading').textContent = status === 'in' ? 'Currently clocked IN' : status === 'out' ? 'Shift completed' : 'Not checked in';
    $('attendance-status-desc').textContent = status === 'in' ? 'Your shift is active. Remember to clock out.' : status === 'out' ? 'Your shift was recorded successfully.' : 'Press Clock IN on the overview to begin your shift.';
    $('attendance-in').textContent = shortTime(shown?.clock_in_at);
    $('attendance-out').textContent = shortTime(shown?.clock_out_at);
  }
  function renderOverviewTable() {
    const records = getTodayRecords().sort((a,b) => Date.parse(b.clock_in_at) - Date.parse(a.clock_in_at));
    $('overview-attendance-body').innerHTML = records.length
      ? records.slice(0,7).map(r => `<tr><td>${personMarkup(findPerson(r.employee_id))}</td><td><strong>${shortTime(r.clock_in_at)}</strong></td><td><strong>${shortTime(r.clock_out_at)}</strong></td><td>${statusMarkup(r)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty-row">No attendance recorded today.</td></tr>';
  }
  function renderAttendanceTable() {
    const filtered = state.attendance.filter(a => a.work_date === state.filterDate && (canReadTeam() || a.employee_id === state.profile?.id) && (state.attendanceView === 'all' || (state.attendanceView === 'in' ? !a.clock_out_at : Boolean(a.clock_out_at))))
      .sort((a,b) => Date.parse(b.clock_in_at) - Date.parse(a.clock_in_at));
    $('attendance-date').value = state.filterDate;
    $('attendance-view-select').value = state.attendanceView;
    $('attendance-count-caption').textContent = `${filtered.length} ${state.attendanceView === 'in' ? 'currently IN' : state.attendanceView === 'out' ? 'clocked OUT' : 'attendance'} record${filtered.length === 1 ? '' : 's'} for ${readableDay(state.filterDate)}`;
    $('attendance-body').innerHTML = filtered.length ? filtered.map(r => `<tr><td>${personMarkup(findPerson(r.employee_id))}</td><td>${escapeHtml(readableDay(r.work_date))}</td><td><strong>${shortTime(r.clock_in_at)}</strong></td><td><strong>${shortTime(r.clock_out_at)}</strong></td><td>${hourDuration(r)}</td><td>${statusMarkup(r)}</td><td>${r.employee_id===state.profile?.id&&!isLive()?`<button type="button" class="table-action" data-correct-id="${escapeHtml(r.id)}">Request edit</button>`:r.corrected?'✓ Corrected':'—'}</td></tr>`).join('') : '<tr><td colspan="7" class="empty-row">No attendance entries for this date.</td></tr>';
  }
  function renderEmployees() {
    const q=state.query.trim().toLowerCase();
    const people=state.profiles.filter(p=>(canReadTeam()||p.id===state.profile?.id)&&[p.full_name,p.email,p.department,p.job_title,p.employee_code,roleLabel(p.role)].join(' ').toLowerCase().includes(q));
    $('employee-subcaption').textContent=`${people.length} employee profile${people.length===1?'':'s'} shown`;
    $('add-employee-btn').classList.toggle('hidden',!canInvite());
    $('employee-body').innerHTML=people.length?people.map(p=>`<tr><td>${personMarkup(p)}</td><td><span class="emp-code">${escapeHtml(p.employee_code||'—')}</span></td><td>${escapeHtml(p.department||'—')}</td><td>${escapeHtml(p.job_title||'—')}</td><td><span class="role-badge role-${escapeHtml(['employee','hr','admin'].includes(p.role)?p.role:'employee')}">${escapeHtml(roleLabel(p.role))}</span></td><td><span class="data-pill ${p.active===false?'inactive':'active'}">${p.active===false?'Inactive':'● Active'}</span></td><td><button type="button" class="table-action" data-edit-employee="${escapeHtml(p.id)}">${canEditEmployee(p)&&!isLive()?'Edit profile':'View'}</button></td></tr>`).join(''):'<tr><td colspan="7" class="empty-row">No employees found.</td></tr>';
  }
  function renderAccount() {
    const p = state.profile || {};
    $('account-name').textContent = p.full_name || 'Employee';
    $('account-email').textContent = p.email || '';
    renderAvatarElement($('account-big-avatar'), p.full_name || 'Employee', p.photo_data_url);
    $('account-photo-controls').classList.toggle('hidden', isLive());
    $('account-photo-live-note').classList.toggle('hidden', !isLive());
    $('account-photo-remove').disabled = !safePhotoUrl(p.photo_data_url);
    $('account-role').textContent = roleLabel(p.role);
    $('account-dept').textContent = p.department || '—';
    $('account-title').textContent = p.job_title || '—';
  }
  function updateClock() {
    const now = new Date();
    $('live-clock').textContent = new Intl.DateTimeFormat('en-GB', {timeZone:TZ,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now);
    $('clock-date').textContent = 'GST · UTC+4';
    $('today-subtitle').textContent = weekDay() + ' · Here is your HR overview.';
    const h = Number(getParts(now,{hour:'2-digit',hour12:false}).hour);
    $('greeting').textContent = `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${(state.profile?.full_name || 'there').split(' ')[0]}`;
    if (state.profile && !$('app-screen').classList.contains('hidden')) {
      const t = myTodayRecord();
      if (t && !t.clock_out_at) $('my-hours').textContent = hourDuration(t);
    }
  }
  function assignedShift(profile) { return state.shifts.find(s=>s.id===profile?.shift_id) || null; }
  function shiftForRecord(record) {return state.shifts.find(s=>s.id===(record.shift_id||findPerson(record.employee_id).shift_id)) || (isLive()?{id:'live-default',name:'Default shift (legacy)',start:'09:00',end:'18:00',grace:10,days:[1,2,3,4,5,6,7]}:null);}
  function shiftHours(shift) {return shift ? `${shift.start} – ${shift.end}${shift.end<shift.start?' (+1 day)':''}` : 'Unassigned';}
  function isoWeekDay(day) {const d=new Date(day+'T12:00:00Z').getUTCDay();return d===0?7:d;}
  function isWorkingDay(shift,day) {return Boolean(shift?.days?.includes(isoWeekDay(day)));}
  function lateForRecord(record) {
    const shift=shiftForRecord(record);
    if(!record.clock_in_at || !shift || !isWorkingDay(shift,record.work_date)) return null;
    const expected=Date.parse(`${record.work_date}T${shift.start}:00+04:00`);
    const actual=Date.parse(record.clock_in_at);
    if(!Number.isFinite(expected)||!Number.isFinite(actual))return null;
    const late=Math.max(0,Math.floor((actual-expected)/60000));
    return late>Number(shift.grace||0)?{...record,late_minutes:late,grace_minutes:Number(shift.grace||0),expected_by:minutesToTime(timeToMinutes(shift.start)+Number(shift.grace||0)),shift_name:shift.name}:null;
  }
  function getLateAlerts() {
    return state.attendance.filter(a => canReadTeam() || a.employee_id === state.profile?.id)
      .map(lateForRecord).filter(Boolean)
      .sort((a,b) => Date.parse(b.clock_in_at) - Date.parse(a.clock_in_at));
  }
  function timeToMinutes(t) {const [h,m]=String(t||'00:00').split(':').map(Number);return h*60+m;}
  function minutesToTime(n) {let val=((n%1440)+1440)%1440;return String(Math.floor(val/60)).padStart(2,'0')+':'+String(val%60).padStart(2,'0');}
  function datetimeLocal(iso) {if(!iso)return '';const p=getParts(new Date(iso),{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
  function gstDateFromLocal(value) {return value?new Date(value+':00+04:00').toISOString():null;}
  function visibleLeaves() { return state.leaves.filter(l => canReadTeam() || l.employee_id === state.profile?.id); }
  function leaveDays(start,end) {
    const a=Date.parse(start+'T12:00:00Z'); const b=Date.parse(end+'T12:00:00Z');
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return Math.round((b-a)/86400000)+1;
  }
  function leaveRange(leave) {return `${readableDay(leave.start_date)} – ${readableDay(leave.end_date)}`;}
  function statusTag(status) {
    const words={pending:'Pending',approved:'Approved',rejected:'Rejected',cancelled:'Cancelled'};
    return `<span class="leave-tag ${escapeHtml(status)}">${escapeHtml(words[status]||status)}</span>`;
  }
  function renderWorkflowCounts() {
    const leaves=canApproveLeave() ? visibleLeaves() : state.leaves.filter(l=>l.employee_id===state.profile?.id);
    for (const status of ['pending','approved','rejected']) {
      $('workflow-'+status).textContent=String(leaves.filter(l=>l.status===status).length);
    }
  }
  function renderLeaves() {
    $('leaves-demo-note').classList.toggle('hidden',!isLive());
    const my=state.leaves.filter(l=>l.employee_id===state.profile?.id).sort((a,b)=>Date.parse(b.submitted_at)-Date.parse(a.submitted_at));
    $('my-leave-total').textContent=String(my.length);
    $('my-leave-pending').textContent=String(my.filter(l=>l.status==='pending').length);
    $('my-leave-approved').textContent=String(my.filter(l=>l.status==='approved').length);
    $('my-leave-body').innerHTML=my.length?my.map(l=>`<tr><td><strong>${escapeHtml(l.type)}</strong><small class="td-note">${escapeHtml(l.reason)}</small></td><td>${escapeHtml(leaveRange(l))}</td><td>${leaveDays(l.start_date,l.end_date)}</td><td>${statusTag(l.status)}</td><td class="wrap-note">${escapeHtml(l.review_note||'—')}</td><td>${l.status==='pending'&&!isLive()?`<button class="table-action" type="button" data-cancel-leave="${escapeHtml(l.id)}">Cancel</button>`:'—'}</td></tr>`).join(''):'<tr><td class="empty-row" colspan="6">No leave requests yet. Use the form above to apply.</td></tr>';
    $('leave-form').querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=isLive());
  }
  function renderApprovals() {
    $('approvals-demo-note').classList.toggle('hidden',!isLive());
    const all=canApproveLeave()?visibleLeaves():[];
    const pending=all.filter(l=>l.status==='pending').sort((a,b)=>Date.parse(b.submitted_at)-Date.parse(a.submitted_at));
    $('approval-pending').textContent=String(pending.length);
    $('approval-approved').textContent=String(all.filter(l=>l.status==='approved').length);
    $('approval-rejected').textContent=String(all.filter(l=>l.status==='rejected').length);
    $('approval-count-header').textContent=`${pending.length} pending`;
    $('approval-queue').innerHTML=pending.length?pending.map(l=>{
      const employee=findPerson(l.employee_id);const self=l.employee_id===state.profile?.id;
      return `<div class="approval-item">${avatarMarkup(employee)}<div class="approval-copy"><strong>${escapeHtml(employee.full_name)}</strong><small>${escapeHtml(l.type)} · ${escapeHtml(leaveRange(l))} · ${leaveDays(l.start_date,l.end_date)} days</small><p>${escapeHtml(l.reason)}</p></div><div class="approval-actions">${self?'<span class="muted-tip">Cannot review your own request</span>':`<button type="button" class="btn btn-approve" data-review-id="${escapeHtml(l.id)}" data-decision="approved" ${isLive()?'disabled':''}>✓ Approve</button><button type="button" class="btn btn-danger-outline" data-review-id="${escapeHtml(l.id)}" data-decision="rejected" ${isLive()?'disabled':''}>Reject</button>`}</div></div>`;
    }).join(''):"<div class=\"empty-panel\">You are all caught up. No leave requests are waiting for review.</div>";
    const history=all.filter(l=>l.status==='approved'||l.status==='rejected').sort((a,b)=>Date.parse(b.reviewed_at||b.submitted_at)-Date.parse(a.reviewed_at||a.submitted_at));
    $('approval-history-body').innerHTML=history.length?history.map(l=>`<tr><td>${personMarkup(findPerson(l.employee_id))}</td><td>${escapeHtml(l.type)}</td><td>${escapeHtml(leaveRange(l))}</td><td>${statusTag(l.status)}</td><td>${escapeHtml(findPerson(l.reviewed_by).full_name)}</td></tr>`).join(''):'<tr><td colspan="5" class="empty-row">No decisions yet.</td></tr>';
  }
  function renderAlerts() {
    const allAlerts=getLateAlerts();
    const alerts=state.alertView === 'today' ? allAlerts.filter(a => a.work_date === businessDay()) : allAlerts;
    $('alert-view-select').value=state.alertView;
    const unread=alerts.filter(a=>!state.reviewedAlerts.includes(a.id));
    const today=allAlerts.filter(a=>a.work_date===businessDay());
    $('alert-today-count').textContent=String(today.length);
    $('alert-unread-count').textContent=String(unread.length);
    $('alert-all-count').textContent=String(allAlerts.length);
    $('late-alert-feed').innerHTML=alerts.length?alerts.map(a=>{
      const person=findPerson(a.employee_id),reviewed=state.reviewedAlerts.includes(a.id);
      return `<div class="alert-entry ${reviewed?'reviewed':''}"><span class="alert-round">!</span><div class="alert-copy"><strong>${escapeHtml(person.full_name)} <span class="late-chip">${a.late_minutes} min late</span></strong><p>Clocked IN at <b>${shortTime(a.clock_in_at)}</b> GST on ${readableDay(a.work_date)}. ${escapeHtml(a.shift_name)} · allowed until ${escapeHtml(a.expected_by)} (${a.grace_minutes}-min grace).</p></div><div class="alert-entry-actions">${reviewed?'<span class="reviewed-pill">✓ Reviewed</span>':`<button type="button" class="btn btn-outline" data-ack-alert="${escapeHtml(a.id)}" ${isLive()?'disabled title="Browser-only acknowledgement is unavailable in connected mode"':''}>Mark reviewed</button>`}</div></div>`;
    }).join(''):'<div class="empty-panel">No late check-ins recorded. All visible attendance is within the grace period.</div>';
    $('ack-all-alerts').disabled=isLive() || unread.length===0;
    $('alerts-glance-count').textContent=`${today.length} alerts`;
    $('alerts-glance-list').innerHTML=today.length?today.slice(0,3).map(a=>`<div class="glance-alert"><span class="glance-mark">!</span><span><strong>${escapeHtml(findPerson(a.employee_id).full_name)}</strong><small>${a.late_minutes} min late · IN ${shortTime(a.clock_in_at)}</small></span></div>`).join(''):'<div class="empty-panel">No late arrivals today.</div>';
    $('late-nav-count').textContent=String(allAlerts.filter(a=>!state.reviewedAlerts.includes(a.id)).length);
    $('late-nav-count').classList.toggle('hidden',!allAlerts.some(a=>!state.reviewedAlerts.includes(a.id)));
    $('top-alert-count').textContent=String(allAlerts.filter(a=>!state.reviewedAlerts.includes(a.id)).length);
    $('top-alert-count').classList.toggle('hidden',!allAlerts.some(a=>!state.reviewedAlerts.includes(a.id)));
    const p=pendingLeaveForManager().length;
    $('pending-nav-count').textContent=String(p);
    $('pending-nav-count').classList.toggle('hidden',!canApproveLeave()||p===0);
    // Leave notifications are routed ONLY to the HR Manager demo login.
    $('top-leave-btn').classList.toggle('hidden',!canApproveLeave());
    $('top-leave-count').textContent=String(p);
    $('top-leave-count').classList.toggle('hidden',p===0);
    $('hr-notification-note').classList.toggle('hidden',!canApproveLeave());
    $('hr-notification-count').textContent=String(p);
  }
  function renderNewFeatures() {
    document.querySelectorAll('.manager-only').forEach(el=>el.classList.toggle('hidden',!canApproveLeave()));
    if (!isLive()) $('demo-user-switch').value=state.profile?.id||'demo-admin';
    renderWorkflowCounts();renderLeaves();renderApprovals();renderAlerts();
  }
  function updateLeaveDays() {
    const a=$('leave-start').value,b=$('leave-end').value;
    const n=a&&b?leaveDays(a,b):0;
    $('leave-days-preview').textContent=n>0?`${n} calendar day${n!==1?'s':''} requested (including weekends).`:a&&b?'End date must be on or after the start date.':'Select dates to calculate the total days.';
  }
  function submitLeave(e) {
    e.preventDefault();
    if (isLive()) {notify('Live leave applications require the next database phase. Use demo preview to test this feature.','error');return;}
    const type=$('leave-type').value,start=$('leave-start').value,end=$('leave-end').value,reason=$('leave-reason').value.trim();
    const days=leaveDays(start,end);
    if (!['Annual leave','Sick leave','Emergency leave','Unpaid leave'].includes(type)||!reason||days<1||days>90) {notify('Enter valid dates, a reason and a duration between 1 and 90 days.','error');return;}
    const conflict=state.leaves.some(l=>l.employee_id===state.profile?.id && ['pending','approved'].includes(l.status)&&start<=l.end_date&&end>=l.start_date);
    if(conflict){notify('The selected dates overlap an existing pending or approved leave request.','error');return;}
    if(['Annual leave','Sick leave'].includes(type)&&days>leaveBalance(state.profile.id,type).available){notify('Not enough available '+type.toLowerCase()+' days after pending requests. Adjust your dates or contact HR.','error');return;}
    state.leaves.unshift({id:'leave-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),employee_id:state.profile.id,type,start_date:start,end_date:end,reason,status:'pending',submitted_at:new Date().toISOString(),review_note:'',reviewed_by:null});
    saveDemo();$('leave-form').reset();updateLeaveDays();renderAll();notify('Leave request submitted. It is now in the HR Manager approval inbox (demo only).');
  }
  function cancelLeave(id) {
    if(isLive())return;
    const leave=state.leaves.find(l=>l.id===id && l.employee_id===state.profile?.id && l.status==='pending');
    if(!leave)return notify('Only your own pending requests can be cancelled.','error');
    if(!confirm('Cancel this pending leave request?'))return;
    leave.status='cancelled';leave.review_note='Cancelled by employee';saveDemo();renderAll();notify('Leave application cancelled.');
  }
  function reviewLeave(id,decision,note='') {
    if(isLive() || !canApproveLeave())return notify('Only the HR Manager can approve or reject leave requests.','error');
    const leave=state.leaves.find(l=>l.id===id && l.status==='pending');
    if(!leave || leave.employee_id===state.profile?.id) return notify('This request is not eligible for your review.','error');
    if(!['approved','rejected'].includes(decision))return;
    if(decision==='rejected'&&note.trim().length<5) return notify('Please provide a rejection reason of at least 5 characters.','error');
    if(decision==='approved'&&['Annual leave','Sick leave'].includes(leave.type)&&leaveDays(leave.start_date,leave.end_date)>leaveBalance(leave.employee_id,leave.type).remaining){notify('Approval exceeds the remaining demo leave allowance.','error');return;}
    leave.status=decision;leave.review_note=decision==='approved'?'Approved by '+state.profile.full_name:note.trim();leave.reviewed_by=state.profile.id;leave.reviewed_at=new Date().toISOString();
    saveDemo();renderAll();notify('Leave request '+decision+' successfully.');
  }
  function closeDecisionModal() {$('decision-modal').classList.add('hidden');state.selectedRejectId=null;}
  function openDecisionModal(id) {state.selectedRejectId=id;$('decision-note').value='';$('decision-modal').classList.remove('hidden');$('decision-note').focus();}
  function acknowledgeAlert(id) {
    if(isLive())return;
    if(!canReadTeam() && !getLateAlerts().some(a=>a.id===id&&a.employee_id===state.profile?.id))return;
    if(!getLateAlerts().some(a=>a.id===id))return;
    if(!state.reviewedAlerts.includes(id))state.reviewedAlerts.push(id);
    saveDemo();renderAll();notify('Attendance alert marked as reviewed in this browser.');
  }
  // Demo modules: employee records and attendance correction workflow. Attendance rules remain internal.
  // All mutations below are local browser demo operations; they are NOT Supabase writes.
  function workDateForPunch() {
    const shift=assignedShift(state.profile);
    if(!shift || shift.end>=shift.start) return businessDay();
    const now=getParts(new Date(),{hour:'2-digit',minute:'2-digit',hour12:false});
    const mins=Number(now.hour)*60+Number(now.minute);
    return mins < timeToMinutes(shift.end) ? dateShift(-1) : businessDay();
  }
  function leaveBalance(employeeId,type) {
    const employee=findPerson(employeeId), annual=type==='Annual leave';
    const entitlement=Math.max(0,Number(annual?employee.annual_allowance:employee.sick_allowance)||0);
    const year=businessDay().slice(0,4);
    const relevant=state.leaves.filter(l=>l.employee_id===employeeId&&l.type===type&&l.start_date.slice(0,4)===year);
    const approved=relevant.filter(l=>l.status==='approved').reduce((a,l)=>a+leaveDays(l.start_date,l.end_date),0);
    const reserved=relevant.filter(l=>l.status==='pending').reduce((a,l)=>a+leaveDays(l.start_date,l.end_date),0);
    return {entitlement,approved,reserved,remaining:Math.max(0,entitlement-approved),available:Math.max(0,entitlement-approved-reserved)};
  }
  function renderLeaveBalances() {
    if(isLive()) {['annual','sick'].forEach(k=>{$('leave-'+k+'-balance').textContent='Demo only';$('leave-'+k+'-breakdown').textContent='Database setup pending';});return;}
    for(const [key,type] of [['annual','Annual leave'],['sick','Sick leave']]) {
      const b=leaveBalance(state.profile.id,type);
      $('leave-'+key+'-balance').textContent=b.remaining+' days';
      $('leave-'+key+'-breakdown').textContent=`${b.approved} used · ${b.reserved} pending · ${b.entitlement} allotted`;
    }
  }
  function renderDashboardExtras() {
    const corrections=state.corrections.filter(c=>canApproveCorrections()||c.employee_id===state.profile?.id);
    $('metric-corrections').textContent=String(corrections.filter(c=>c.status==='pending').length);
    const yearly=isLive()?null:leaveBalance(state.profile.id,'Annual leave');
    $('metric-leave-balance').textContent=yearly?`${yearly.remaining} days`:'Demo only';
  }
  function populateEmployeeSelectors(excludeId='') {
    $('emp-manager').innerHTML='<option value="">None assigned</option>'+state.profiles.filter(p=>p.active!==false&&p.id!==excludeId).map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.full_name)}</option>`).join('');
  }
  function updateRoleDescription() {
    const role=$('emp-role').value;
    const descriptions={
      employee:'Employee: own attendance, leave requests and assigned assets. No team management or approvals.',
      hr:'HR Manager: leave and attendance-correction approvals; receives approval alerts. Cannot edit employee accounts or assets.',
      admin:'Administrator: creates and manages employee accounts and company assets. Does not approve leave.'
    };
    $('emp-role-help').textContent=isLive()
      ? 'Connected mode: account invitations are currently Employee-only. Assigning HR Manager/Administrator securely needs the backend role-management service.'
      : !canInvite() ? 'Read-only profile.'
      : $('emp-role').disabled ? 'This is a protected account and its role cannot be changed here.'
      : (descriptions[role]||descriptions.employee)+' Demo roles only; they do not create passwords or real user access.';
  }
  function openProfile(id=null) {
    const p=id?state.profiles.find(x=>x.id===id):null;
    if(id&&!p)return;
    if(!p&&!canInvite())return notify('Only administrators can create employee accounts.','error');
    state.editingEmployeeId=p?.id||null;
    state.photoRequestToken++;
    state.editingPhoto = safePhotoUrl(p?.photo_data_url);
    const form=$('employee-form');form.reset();populateEmployeeSelectors(p?.id||'');
    renderAvatarElement($('emp-photo-preview'), p?.full_name || 'New employee', state.editingPhoto);
    $('emp-photo-remove').disabled = !state.editingPhoto;
    $('emp-photo-info').textContent = 'Photo changes are applied when you save the employee profile.';
    $('modal-title').textContent=p?'Employee profile · '+p.full_name:'Create employee account';
    const fields={
      'emp-name':p?.full_name||'','emp-email':p?.email||'','emp-code':p?.employee_code||`HS-${String(state.profiles.length+1).padStart(4,'0')}`,
      'emp-phone':p?.phone||'','emp-dept':p?.department||'','emp-title':p?.job_title||'',
      'emp-location':p?.location||'','emp-joined':p?.joined_on||businessDay(),
      'emp-type':p?.employment_type||'Full-time','emp-manager':p?.manager_id||'',
      'emp-status':p?.active===false?'inactive':'active',
      'emp-annual':p?.annual_allowance??24,'emp-sick':p?.sick_allowance??14,
      'emp-role':p?.role||'employee'
    };
    for(const [k,v] of Object.entries(fields))$(k).value=v;
    // View is always allowed for the profile itself, edits only for admin in demo.
    const writable=canInvite()&&!isLive()&&(!p||canEditEmployee(p));
    $('emp-photo-controls').classList.toggle('hidden', !writable);
    $('emp-photo-info').textContent = writable ? 'Photo changes are applied when you save the employee profile.' : 'This profile is read-only. Protected system accounts and your own account cannot be edited here.';
    form.querySelectorAll('input,select').forEach(el=>el.disabled=!writable);
    // In connected mode, continue allowing new employee invitations (basic fields only).
    if(!p && canInvite() && isLive()) form.querySelectorAll('input,select').forEach(el=>el.disabled=false);
    // Demo: role selection is available to Admin for eligible accounts.
    // Connected accounts must be promoted only by a trusted server-side service.
    $('emp-role').value=p?.role||'employee';
    $('emp-role').disabled=!writable || isLive();
    updateRoleDescription();
    $('save-employee-btn').classList.toggle('hidden', Boolean(p&&!writable));
    $('save-employee-btn').textContent=p?'Save employee changes →':isLive()?'Email employee invitation →':'Create demo account →';
    $('employee-modal').classList.remove('hidden');
    if(writable) $('emp-name').focus();
  }
  function recordLabel(record) {
    return `${readableDay(record.work_date)} · ${shortTime(record.clock_in_at)} → ${shortTime(record.clock_out_at)}`;
  }
  function renderCorrectionRecordOptions(selectedId='') {
    const myRecords=state.attendance.filter(a=>a.employee_id===state.profile?.id&&a.clock_in_at).sort((a,b)=>Date.parse(b.clock_in_at)-Date.parse(a.clock_in_at));
    $('correction-record').innerHTML='<option value="">Choose a date and record</option>'+myRecords.map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(recordLabel(a))}</option>`).join('');
    if(selectedId) $('correction-record').value=selectedId;
  }
  function fillCorrectionTimes() {
    const r=state.attendance.find(a=>a.id===$('correction-record').value&&a.employee_id===state.profile?.id);
    $('correction-in').value=datetimeLocal(r?.clock_in_at);
    $('correction-out').value=datetimeLocal(r?.clock_out_at);
  }
  function openCorrectionFor(id) {
    if(isLive())return notify('Attendance correction requests are available in demo mode only.','error');
    switchPage('corrections');renderCorrectionRecordOptions(id);fillCorrectionTimes();
    $('correction-reason').focus();
  }
  function submitCorrection(e) {
    e.preventDefault();
    if(isLive())return notify('Time corrections need the next secure database phase.','error');
    const record=state.attendance.find(a=>a.id===$('correction-record').value&&a.employee_id===state.profile?.id);
    const requestedIn=$('correction-in').value,requestedOut=$('correction-out').value,reason=$('correction-reason').value.trim();
    if(!record)return notify('Select one of your own attendance records.','error');
    if(reason.length<8||!requestedIn)return notify('Enter valid times and at least 8 characters explaining the request.','error');
    if(record.clock_out_at && !requestedOut)return notify('An existing OUT time cannot be removed. Please enter a corrected OUT time.','error');
    const start=Date.parse(requestedIn+':00+04:00'),end=requestedOut?Date.parse(requestedOut+':00+04:00'):null;
    const dayStart=Date.parse(record.work_date+'T00:00:00+04:00');
    if(!Number.isFinite(start)||(end!==null&&!Number.isFinite(end))||start<dayStart||start>dayStart+36*3600000||(end!==null&&(end<=start||end-start>24*3600000)))return notify('Corrected IN must be within 36h of the work date; OUT must be after IN and within 24h.','error');
    const originalIn=datetimeLocal(record.clock_in_at),originalOut=datetimeLocal(record.clock_out_at);
    if(requestedIn===originalIn&&requestedOut===originalOut)return notify('The requested times are identical to the current attendance record.','error');
    if(state.corrections.some(c=>c.record_id===record.id&&c.status==='pending'))return notify('An earlier correction is already awaiting review for this record.','error');
    state.corrections.unshift({id:'cor-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),record_id:record.id,employee_id:record.employee_id,work_date:record.work_date,
      original_in:record.clock_in_at,original_out:record.clock_out_at,requested_in:gstDateFromLocal(requestedIn),requested_out:gstDateFromLocal(requestedOut),
      reason,status:'pending',submitted_at:new Date().toISOString(),review_note:'',reviewed_by:null,reviewed_at:null});
    saveDemo();$('correction-form').reset();renderAll();notify('Attendance correction submitted for HR review. The original record remains unchanged.');
  }
  function cancelCorrection(id) {
    if(isLive())return;
    const c=state.corrections.find(x=>x.id===id&&x.employee_id===state.profile?.id&&x.status==='pending');
    if(!c)return notify('Only your own pending corrections can be withdrawn.','error');
    if(!confirm('Withdraw this attendance correction request?'))return;
    c.status='cancelled';c.review_note='Withdrawn by employee';c.reviewed_at=new Date().toISOString();
    saveDemo();renderAll();notify('Correction request withdrawn.');
  }
  function reviewCorrection(id,status,note='') {
    if(isLive()||!canApproveCorrections())return notify('Only the HR Manager can approve or reject time corrections.','error');
    const c=state.corrections.find(x=>x.id===id&&x.status==='pending');
    if(!c||c.employee_id===state.profile?.id||!['approved','rejected'].includes(status))return notify('This correction is not eligible for your review.','error');
    if(status==='rejected'&&note.trim().length<5)return notify('Enter a reason with at least 5 characters.','error');
    const record=state.attendance.find(a=>a.id===c.record_id&&a.employee_id===c.employee_id);
    if(!record)return notify('The original attendance record was not found.','error');
    if(status==='approved'){
      // Refuse a stale approval if another correction already changed the underlying record.
      if(record.clock_in_at!==c.original_in||record.clock_out_at!==c.original_out)return notify('Attendance has changed since this request. Reject it and ask for a new request.','error');
      record.clock_in_at=c.requested_in;record.clock_out_at=c.requested_out;record.corrected=true;
      state.reviewedAlerts=state.reviewedAlerts.filter(x=>x!==record.id);
    }
    c.status=status;c.reviewed_by=state.profile.id;c.reviewed_at=new Date().toISOString();
    c.review_note=status==='approved'?'Approved by '+state.profile.full_name:note.trim();
    saveDemo();renderAll();notify('Attendance correction '+status+'.'+(status==='approved'?' The punch times are updated.':''));
  }
  function renderCorrections() {
    const my=state.corrections.filter(x=>x.employee_id===state.profile?.id).sort((a,b)=>Date.parse(b.submitted_at)-Date.parse(a.submitted_at));
    const visible=state.corrections.filter(x=>canApproveCorrections()||x.employee_id===state.profile?.id);
    const pending=visible.filter(x=>x.status==='pending');
    $('correction-count-header').textContent=pending.length+' pending';
    $('corrections-nav-count').textContent=String(pending.length);
    $('corrections-nav-count').classList.toggle('hidden',!pending.length);
    $('corrections-my-pending').textContent=String(my.filter(x=>x.status==='pending').length);
    $('corrections-my-approved').textContent=String(my.filter(x=>x.status==='approved').length);
    $('corrections-my-rejected').textContent=String(my.filter(x=>x.status==='rejected').length);
    $('correction-live-note').classList.toggle('hidden',!isLive());
    $('correction-form').querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=isLive());
    const selected=$('correction-record').value;
    renderCorrectionRecordOptions(selected);
    $('correction-history-body').innerHTML=my.length?my.map(c=>`<tr><td>${readableDay(c.work_date)}</td><td><strong>${shortTime(c.requested_in)} → ${shortTime(c.requested_out)}</strong><small class="td-note">${escapeHtml(c.reason)}</small></td><td>${statusTag(c.status)}</td><td class="wrap-note">${escapeHtml(c.review_note||'—')}</td><td>${c.status==='pending'?`<button type="button" class="table-action" data-cancel-correction="${escapeHtml(c.id)}">Withdraw</button>`:'—'}</td></tr>`).join(''):'<tr><td colspan="5" class="empty-row">No correction requests yet. Select a recorded shift above.</td></tr>';
    $('correction-review-panel').classList.toggle('hidden',!canApproveCorrections());
    $('correction-review-count').textContent=pending.filter(c=>c.employee_id!==state.profile?.id).length+' awaiting review';
    const reviewable=pending.filter(c=>c.employee_id!==state.profile?.id);
    $('correction-approval-list').innerHTML=reviewable.length?reviewable.map(c=>`<div class="approval-item correction-approval">${avatarMarkup(findPerson(c.employee_id))}<div class="approval-copy"><strong>${escapeHtml(findPerson(c.employee_id).full_name)}</strong><small>${readableDay(c.work_date)} · ${escapeHtml(c.reason)}</small><p>Original: <b>${shortTime(c.original_in)} → ${shortTime(c.original_out)}</b> &nbsp; Requested: <b>${shortTime(c.requested_in)} → ${shortTime(c.requested_out)}</b></p></div><div class="approval-actions"><button type="button" class="btn btn-approve" data-correction-review="${escapeHtml(c.id)}" data-correction-action="approved">✓ Approve</button><button type="button" class="btn btn-danger-outline" data-correction-review="${escapeHtml(c.id)}" data-correction-action="rejected">Reject</button></div></div>`).join(''):'<div class="empty-panel">No correction requests need your review.</div>';
  }
  function csvEscape(value) {
    let text=String(value??'');
    // Neutralize spreadsheet formulas in employee-supplied values.
    if(/^[\s]*[=+\-@]/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  }
  function exportCsv(kind) {
    const team=state.profiles.filter(p=>canReadTeam()||p.id===state.profile?.id);
    const allowed=new Set(team.map(p=>p.id));
    let header=[],rows=[];
    if(kind==='attendance'){
      header=['Employee ID','Employee','Work date','IN (GST)','OUT (GST)','Hours','Late minutes','Corrected'];
      rows=state.attendance.filter(a=>allowed.has(a.employee_id)).map(a=>{
        const person=findPerson(a.employee_id);
        return [person.employee_code,person.full_name,a.work_date,datetimeLocal(a.clock_in_at),datetimeLocal(a.clock_out_at),hourDuration(a),lateForRecord(a)?.late_minutes||0,a.corrected?'Yes':'No'];
      });
    } else if(kind==='leaves'){
      header=['Employee ID','Employee','Leave type','From','To','Calendar days','Status','Reason','Reviewer','Review note'];
      rows=state.leaves.filter(l=>allowed.has(l.employee_id)).map(l=>[findPerson(l.employee_id).employee_code,findPerson(l.employee_id).full_name,l.type,l.start_date,l.end_date,leaveDays(l.start_date,l.end_date),l.status,l.reason,l.reviewed_by?findPerson(l.reviewed_by).full_name:'',l.review_note]);
    } else if(kind==='corrections'){
      header=['Employee ID','Employee','Work date','Original IN','Original OUT','Requested IN','Requested OUT','Status','Reason','Reviewer','Review note','Submitted at'];
      rows=state.corrections.filter(c=>allowed.has(c.employee_id)).map(c=>[findPerson(c.employee_id).employee_code,findPerson(c.employee_id).full_name,c.work_date,datetimeLocal(c.original_in),datetimeLocal(c.original_out),datetimeLocal(c.requested_in),datetimeLocal(c.requested_out),c.status,c.reason,c.reviewed_by?findPerson(c.reviewed_by).full_name:'',c.review_note,c.submitted_at]);
    } else if(kind==='employees'){
      header=['Employee ID','Name','Email','Phone','Department','Job title','Location','Employment type','Joining date','Manager','Role','Status','Annual allowance','Sick allowance'];
      rows=team.map(p=>[p.employee_code,p.full_name,p.email,p.phone,p.department,p.job_title,p.location,p.employment_type,p.joined_on,p.manager_id?findPerson(p.manager_id).full_name:'',p.role,p.active!==false?'Active':'Inactive',p.annual_allowance,p.sick_allowance]);
    } else return;
    const content='\uFEFF'+[header,...rows].map(row=>row.map(csvEscape).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8;'}));
    const a=document.createElement('a');a.href=url;a.download=`Helen_and_Sons_${kind}_${businessDay()}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    notify('CSV exported. Remember this is browser demo data.');
  }
  function renderReports() {
    const allow=new Set(state.profiles.filter(p=>canReadTeam()||p.id===state.profile?.id).map(p=>p.id));
    $('report-attendance-count').textContent=state.attendance.filter(x=>allow.has(x.employee_id)).length;
    $('report-leave-count').textContent=state.leaves.filter(x=>allow.has(x.employee_id)).length;
    $('report-correction-count').textContent=state.corrections.filter(x=>allow.has(x.employee_id)).length;
  }

  // Company assets are demo-only until a server-side asset API with role policies is connected.
  // Do NOT treat browser role switching or localStorage as genuine authorization.
  const ASSET_TYPES = {mobile:'Mobile phone', sim:'SIM card', laptop:'Laptop'};
  const ASSET_STATUSES = {assigned:'Assigned',available:'Available',maintenance:'Maintenance',retired:'Retired'};
  function seedAssets() {
    const at = new Date().toISOString();
    return [
      {id:'demo-asset-1',type:'mobile',asset_tag:'HNS-MOB-001',name:'Galaxy A55',brand:'Samsung',model:'Galaxy A55',identifier:'490154203237518',imei2:'',sim_number:'',sim_provider:'',assigned_to:'demo-e1',status:'assigned',condition:'Good',assigned_on:'2026-10-01',purchased_on:'2026-09-20',warranty_until:'2027-09-20',notes:'Handset and charger issued',history:[{at,action:'Assigned to employee',employee_id:'demo-e1',by:'demo-admin',note:'Demo allocation'}]},
      {id:'demo-asset-2',type:'sim',asset_tag:'HNS-SIM-001',name:'Business voice & data SIM',brand:'e&',model:'Business plan',identifier:'8997111234567890123',imei2:'',sim_number:'+971 50 000 0001',sim_provider:'e&',assigned_to:'demo-e1',status:'assigned',condition:'Good',assigned_on:'2026-10-01',purchased_on:'2026-09-20',warranty_until:'',notes:'Company business plan · sample number',history:[{at,action:'Assigned to employee',employee_id:'demo-e1',by:'demo-admin',note:'Demo allocation'}]},
      {id:'demo-asset-3',type:'laptop',asset_tag:'HNS-LAP-001',name:'ThinkPad T14',brand:'Lenovo',model:'T14 Gen 4',identifier:'HNS-LT-T14-DEMO1',imei2:'',sim_number:'',sim_provider:'',assigned_to:'demo-e2',status:'assigned',condition:'Good',assigned_on:'2026-10-05',purchased_on:'2026-09-28',warranty_until:'2028-09-28',notes:'Laptop, adapter and carry case',history:[{at,action:'Assigned to employee',employee_id:'demo-e2',by:'demo-admin',note:'Demo allocation'}]},
      {id:'demo-asset-4',type:'laptop',asset_tag:'HNS-LAP-002',name:'Latitude 5440',brand:'Dell',model:'Latitude 5440',identifier:'HNS-DL-5440-DEMO2',imei2:'',sim_number:'',sim_provider:'',assigned_to:'',status:'available',condition:'New',assigned_on:'',purchased_on:'2026-10-12',warranty_until:'2028-10-12',notes:'Available for allocation',history:[{at,action:'Registered',employee_id:'',by:'demo-admin',note:'New equipment'}]},
      {id:'demo-asset-5',type:'sim',asset_tag:'HNS-SIM-002',name:'Business data SIM',brand:'du',model:'Data plan',identifier:'8997141234567891234',imei2:'',sim_number:'+971 55 000 0002',sim_provider:'du',assigned_to:'',status:'available',condition:'New',assigned_on:'',purchased_on:'2026-10-20',warranty_until:'',notes:'Ready to issue',history:[{at,action:'Registered',employee_id:'',by:'demo-admin',note:'Demo asset'}]}
    ];
  }
  function assetTypeText(type) { return ASSET_TYPES[type] || 'Other asset'; }
  function assetStatusText(status) { return ASSET_STATUSES[status] || 'Unknown'; }
  function assetIdentifierText(type) { return type==='mobile' ? 'IMEI' : type==='sim' ? 'SIM ICCID / serial' : 'Laptop serial'; }
  function assetIcon(type) { return type==='mobile' ? '▯' : type==='sim' ? '▤' : '▣'; }
  function assetOwner(asset) { return asset.assigned_to ? state.profiles.find(p=>p.id===asset.assigned_to) : null; }
  function assetsVisibleToMe() {
    if(isLive()) return []; // Connected asset integration not implemented yet.
    if(canManageAssets()) return state.assets;
    return state.assets.filter(a=>a.assigned_to===state.profile?.id && a.status==='assigned');
  }
  function ownAssignedAssets() {
    if (isLive()) return [];
    return state.assets.filter(a=>a.status==='assigned' && a.assigned_to===state.profile?.id);
  }
  function assetStatusChip(status) {
    return `<span class="asset-status-pill asset-${escapeHtml(status)}">${escapeHtml(assetStatusText(status))}</span>`;
  }
  function assetTypeMarkup(asset) {
    return `<span class="asset-type-icon asset-type-${escapeHtml(asset.type)}" aria-hidden="true">${assetIcon(asset.type)}</span><span class="asset-name-stack"><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(assetTypeText(asset.type))}${asset.brand?' · '+escapeHtml(asset.brand):''}</small></span>`;
  }
  function renderAssets() {
    const admin=canManageAssets(),visible=assetsVisibleToMe();
    $('asset-search').value=state.assetQuery; $('asset-type-filter').value=state.assetTypeFilter; $('asset-status-filter').value=state.assetStatusFilter;
    $('asset-add-btn').classList.toggle('hidden',!admin);
    $('asset-export-btn').classList.toggle('hidden',!admin);
    $('asset-table-title').textContent=admin?'Company asset register':'My assigned equipment';
    $('asset-access-note-title').textContent=isLive()?'Backend configuration required':admin?'Administrator-only equipment management':'Read-only employee equipment view';
    $('asset-access-note').textContent=isLive()
      ? 'Your current connected account does not yet have an asset database service. This feature is available in demo preview only until a secure backend with administrator-only permissions is configured.'
      : admin?'Only your Administrator preview may enter or change IMEI, ICCID and serial numbers, allocate devices and register returns. Demo information is stored locally in this browser, not in a shared database.'
      : 'You can view equipment currently assigned to your account, but cannot register assets, change IMEI or serial numbers, edit allocations or return devices yourself. Contact the Administrator for changes.';
    const counts=admin
      ? [{n:'Total assets',v:visible.length,i:'▣'},{n:'Assigned',v:visible.filter(a=>a.status==='assigned').length,i:'✓'},{n:'Available',v:visible.filter(a=>a.status==='available').length,i:'▯'},{n:'Maintenance',v:visible.filter(a=>a.status==='maintenance').length,i:'⚒'}]
      : [{n:'My assets',v:visible.length,i:'▣'},{n:'Mobile phones',v:visible.filter(a=>a.type==='mobile').length,i:'▯'},{n:'SIM cards',v:visible.filter(a=>a.type==='sim').length,i:'▤'},{n:'Laptops',v:visible.filter(a=>a.type==='laptop').length,i:'▣'}];
    $('asset-stats').innerHTML=counts.map(item=>`<div class="asset-stat"><span>${escapeHtml(item.n)}</span><strong>${item.v}</strong><span class="asset-stat-icon" aria-hidden="true">${item.i}</span></div>`).join('');
    const q=state.assetQuery.trim().toLowerCase();
    const rows=visible.filter(a=>
      (state.assetTypeFilter==='all'||a.type===state.assetTypeFilter) &&
      (state.assetStatusFilter==='all'||a.status===state.assetStatusFilter) &&
      (!q||[a.asset_tag,a.name,a.brand,a.model,a.identifier,a.imei2,a.sim_number,a.sim_provider,admin?(assetOwner(a)?.full_name||''):''].join(' ').toLowerCase().includes(q))
    ).sort((a,b)=>a.asset_tag.localeCompare(b.asset_tag));
    $('asset-table-caption').textContent=`${rows.length} ${admin?'company asset':'assigned asset'}${rows.length===1?'':'s'} shown${admin?' · IMEI and serial edits restricted to Administrator':''}`;
    $('asset-table-body').innerHTML=rows.length?rows.map(a=>{
      const owner=assetOwner(a);
      const actions=admin
        ? `<div class="asset-actions"><button class="table-action" type="button" data-view-asset="${escapeHtml(a.id)}">View</button><button class="table-action" type="button" data-edit-asset="${escapeHtml(a.id)}">Edit</button>${a.status==='assigned'?`<button class="table-action asset-return-action" type="button" data-return-asset="${escapeHtml(a.id)}">Return</button>`:a.status==='available'?`<button class="table-action" type="button" data-assign-asset="${escapeHtml(a.id)}">Assign</button>`:''}</div>`
        : `<button class="table-action" type="button" data-view-asset="${escapeHtml(a.id)}">View details</button>`;
      return `<tr><td><span class="asset-main-cell">${assetTypeMarkup(a)}</span></td><td><span class="asset-tag">${escapeHtml(a.asset_tag)}</span></td><td>${owner?`<strong>${escapeHtml(owner.full_name)}</strong><small class="asset-table-small">${escapeHtml(owner.employee_code||'')}</small>`:'<span class="asset-muted">Not assigned</span>'}</td><td><span class="asset-identifier">${escapeHtml(a.identifier)}</span><small class="asset-table-small">${escapeHtml(assetIdentifierText(a.type))}</small></td><td>${assetStatusChip(a.status)}</td><td>${actions}</td></tr>`;
    }).join(''):'<tr><td colspan="6" class="empty-row">No matching company assets. Adjust the filters or ask the Administrator about your allocation.</td></tr>';
  }
  function renderAccountAssets() {
    const assets=ownAssignedAssets();
    $('account-assets-list').innerHTML=assets.length
      ? assets.map(a=>`<button class="account-asset-tile" type="button" data-view-asset="${escapeHtml(a.id)}"><span class="asset-type-icon asset-type-${escapeHtml(a.type)}" aria-hidden="true">${assetIcon(a.type)}</span><span><strong>${escapeHtml(a.name)}</strong><small>${escapeHtml(a.asset_tag)} · ${escapeHtml(assetTypeText(a.type))}</small></span><span aria-hidden="true" class="account-asset-arrow">↗</span></button>`).join('')
      : `<div class="asset-empty-note">${isLive()?'Assets are not connected to the live database yet.':'No company assets are currently assigned to this account in the demo.'}</div>`;
  }
  function closeAssetModal(id) {
    const dialog=$(id);
    if(dialog)dialog.classList.add('hidden');
    if(id==='asset-modal')state.editingAssetId=null;
    if(id==='asset-return-modal')state.returningAssetId=null;
  }
  function updateAssetTypeFields() {
    const type=$('asset-type').value;
    $('asset-second-imei-row').classList.toggle('hidden',type!=='mobile');
    $('asset-sim-fields').classList.toggle('hidden',type!=='sim');
    $('asset-identifier-label').textContent=(type==='mobile'?'IMEI number (15 digits)':type==='sim'?'SIM ICCID / serial number':'Laptop serial number')+' *';
    $('asset-identifier-hint').textContent=type==='mobile'?'Use the handset IMEI, usually 15 digits.':type==='sim'?'Use the ICCID printed on the SIM, typically 18–22 digits.':'Use the serial number printed on the laptop or in system information.';
    $('asset-identifier').placeholder=type==='mobile'?'15-digit phone IMEI':type==='sim'?'18–22-digit SIM ICCID':'Manufacturer serial number';
    $('asset-identifier').inputMode=type==='laptop'?'text':'numeric';
  }
  function updateAssetAssignmentFields() {
    const active=$('asset-status').value==='assigned';
    $('asset-assignee').disabled=!active;
    $('asset-assignee').required=active;
    $('asset-assigned-on').disabled=!active;
    $('asset-assigned-on').required=active;
    if(!active){$('asset-assignee').value='';$('asset-assigned-on').value='';}
    else if(!$('asset-assigned-on').value)$('asset-assigned-on').value=businessDay();
  }
  function openAssetEditor(id,focusAssignment=false) {
    if(!canManageAssets())return notify('Only the Administrator can register or modify company assets.','error');
    const a=id?state.assets.find(x=>x.id===id):null;
    if(id&&!a)return notify('The requested asset could not be found.','error');
    state.editingAssetId=a?.id||null;
    $('asset-form').reset();
    $('asset-modal-title').textContent=a?'Edit company asset':'Register new company asset';
    const values={type:a?.type||'mobile',tag:a?.asset_tag||'',name:a?.name||'',brand:a?.brand||'',model:a?.model||'',identifier:a?.identifier||'',imei2:a?.imei2||'',sim_number:a?.sim_number||'',sim_provider:a?.sim_provider||'',status:a?.status||(focusAssignment?'assigned':'available'),condition:a?.condition||'Good',assigned_on:a?.assigned_on||'',purchased_on:a?.purchased_on||'',warranty_until:a?.warranty_until||'',notes:a?.notes||''};
    Object.entries({type:'asset-type',tag:'asset-tag',name:'asset-name',brand:'asset-brand',model:'asset-model',identifier:'asset-identifier',imei2:'asset-imei2',sim_number:'asset-sim-number',sim_provider:'asset-sim-provider',status:'asset-status',condition:'asset-condition',assigned_on:'asset-assigned-on',purchased_on:'asset-purchased-on',warranty_until:'asset-warranty-until',notes:'asset-notes'}).forEach(([k,id])=>$(id).value=values[k]);
    const active=state.profiles.filter(p=>p.active!==false || p.id===a?.assigned_to);
    $('asset-assignee').innerHTML='<option value="">Select employee…</option>'+active.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.full_name)} · ${escapeHtml(p.employee_code||roleLabel(p.role))}</option>`).join('');
    $('asset-assignee').value=a?.assigned_to||'';
    if(focusAssignment){$('asset-status').value='assigned';}
    updateAssetTypeFields();updateAssetAssignmentFields();
    $('asset-modal').classList.remove('hidden');
    (focusAssignment?$('asset-assignee'):$('asset-tag')).focus();
  }
  function isValidImei(s) {
    if(!/^\d{15}$/.test(s))return false;
    // IMEI uses the Luhn check digit (the sample IMEIs in the demo also pass).
    let sum=0;
    for(let i=0;i<15;i++){
      let n=Number(s[i]);
      if(i%2===1){n*=2;if(n>9)n-=9;}
      sum+=n;
    }
    return sum%10===0;
  }
  function validateAssetInput(v,oldId) {
    if(!ASSET_TYPES[v.type])throw Error('Choose a valid asset category.');
    if(!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(v.asset_tag))throw Error('Asset tag must be 3–40 letters, digits, hyphens or underscores.');
    if(!v.name||v.name.length>100)throw Error('Enter an asset display name (up to 100 characters).');
    if(v.type==='mobile'){
      if(!isValidImei(v.identifier))throw Error('Mobile phone IMEI must be 15 digits with a valid check digit.');
      if(v.imei2 && !isValidImei(v.imei2))throw Error('Second IMEI must be 15 digits with a valid check digit.');
      if(v.imei2 && v.imei2===v.identifier)throw Error('The second IMEI must be different from the first.');
    } else if(v.type==='sim'){
      if(!/^\d{18,22}$/.test(v.identifier))throw Error('SIM ICCID must contain 18–22 digits.');
    } else if(!/^[A-Za-z0-9][A-Za-z0-9.\/_-]{3,63}$/.test(v.identifier)){
      throw Error('Enter a laptop serial number (4–64 letters, digits, dots, dashes or slashes).');
    }
    if(state.assets.some(a=>a.id!==oldId&&a.asset_tag.toUpperCase()===v.asset_tag))throw Error('That company asset tag already exists.');
    const allIdentifiers=[v.identifier,...(v.imei2?[v.imei2]:[])];
    if(state.assets.some(a=>a.id!==oldId&&(allIdentifiers.includes(a.identifier)||Boolean(a.imei2&&allIdentifiers.includes(a.imei2)))))throw Error('This IMEI, ICCID or serial number is already registered to another asset.');
    if(v.status==='assigned'){
      const person=state.profiles.find(p=>p.id===v.assigned_to&&p.active!==false);
      if(!person)throw Error('Choose an active employee for the assigned device.');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(v.assigned_on))throw Error('Choose the date the equipment was issued.');
    } else if(v.assigned_to)throw Error('An unassigned asset cannot have an assigned employee.');
    if(!ASSET_STATUSES[v.status])throw Error('Choose a valid asset status.');
    for(const date of [v.assigned_on,v.purchased_on,v.warranty_until])if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Check the asset dates.');
  }
  function saveAssetFromForm(e) {
    e.preventDefault();
    if(!canManageAssets())return notify('Only the Administrator may save or modify asset identifiers.','error');
    const get=id=>$(id).value.trim();
    const type=get('asset-type');
    const v={type,asset_tag:get('asset-tag').toUpperCase(),name:get('asset-name'),brand:get('asset-brand'),model:get('asset-model'),identifier:get('asset-identifier').toUpperCase(),imei2:type==='mobile'?get('asset-imei2'):'',sim_number:type==='sim'?get('asset-sim-number'):'',sim_provider:type==='sim'?get('asset-sim-provider'):'',status:get('asset-status'),assigned_to:get('asset-status')==='assigned'?get('asset-assignee'):'',condition:get('asset-condition'),assigned_on:get('asset-status')==='assigned'?get('asset-assigned-on'):'',purchased_on:get('asset-purchased-on'),warranty_until:get('asset-warranty-until'),notes:get('asset-notes')};
    const old=state.assets.find(a=>a.id===state.editingAssetId)||null;
    try {
      if(state.editingAssetId&&!old)throw Error('The asset no longer exists.');
      validateAssetInput(v,old?.id);
      const now=new Date().toISOString(),by=state.profile.id;
      const history=old?[...(old.history||[])]:[];
      if(!old)history.push({at:now,action:'Registered',employee_id:'',by,note:'Asset created'});
      if(old && old.assigned_to && old.assigned_to!==v.assigned_to)history.push({at:now,action:'Returned / unassigned',employee_id:old.assigned_to,by,note:'Allocation changed by Administrator'});
      if(v.assigned_to && v.assigned_to!==old?.assigned_to)history.push({at:now,action:'Assigned to employee',employee_id:v.assigned_to,by,note:'Issued '+v.assigned_on});
      if(old && old.status!==v.status && v.status!=='assigned')history.push({at:now,action:'Status: '+assetStatusText(v.status),employee_id:'',by,note:'Administrator status update'});
      if(old && (old.identifier!==v.identifier||old.imei2!==v.imei2||old.asset_tag!==v.asset_tag))history.push({at:now,action:'Identifiers updated',employee_id:'',by,note:'Asset identifiers modified by Administrator'});
      if(old){const tracked=['type','asset_tag','name','brand','model','identifier','imei2','sim_number','sim_provider','status','assigned_to','condition','assigned_on','purchased_on','warranty_until','notes']; const changed=tracked.filter(key=>(old[key]||'')!==(v[key]||'')); if(changed.length)history.push({at:now,action:'Record updated',employee_id:'',by,note:'Updated fields: '+changed.map(key=>({identifier:'primary identifier',imei2:'second IMEI',assigned_to:'allocation'}[key]||key.replace(/_/g,' '))).join(', ')});}
      const next={...old,...v,id:old?.id||'demo-asset-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),history,updated_at:now};
      if(old){const index=state.assets.findIndex(a=>a.id===old.id);state.assets[index]=next;if(!saveDemo()){state.assets[index]=old;return;}}
      else{state.assets.push(next);if(!saveDemo()){state.assets.pop();return;}}
      closeAssetModal('asset-modal');renderAll();notify(old?'Company asset updated. Changes saved to browser demo.':'Company asset registered in browser demo.');
    }catch(err){notify(err.message,'error');}
  }
  function showAssetDetail(id) {
    const a=assetsVisibleToMe().find(x=>x.id===id);
    if(!a)return notify('This asset is not assigned to your account or cannot be viewed.','error');
    $('asset-view-title').textContent=a.name;
    const owner=assetOwner(a);
    const details=[['Asset tag',a.asset_tag],['Type',assetTypeText(a.type)],['Brand',a.brand||'—'],['Model / plan',a.model||'—'],[assetIdentifierText(a.type),a.identifier],...(a.imei2?[['Second IMEI',a.imei2]]:[]),...(a.type==='sim'?[['SIM phone number',a.sim_number||'—'],['Network provider',a.sim_provider||'—']]:[]),['Status',assetStatusText(a.status)],['Assigned to',owner?.full_name||'Not assigned'],['Date issued',a.assigned_on||'—'],['Condition',a.condition||'—'],['Purchase date',a.purchased_on||'—'],['Warranty until',a.warranty_until||'—'],['Notes',a.notes||'—']];
    const history=canManageAssets()?(a.history||[]).slice().reverse():[];
    $('asset-view-content').innerHTML=`<div class="asset-detail-type">${assetTypeMarkup(a)} ${assetStatusChip(a.status)}</div><div class="asset-detail-grid">${details.map(([label,val])=>`<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(val)}</strong></div>`).join('')}</div>${canManageAssets()?`<h3 class="asset-history-title">Assignment &amp; update history</h3><div class="asset-history-list">${history.length?history.map(h=>`<div class="asset-history-item"><span class="asset-history-dot"></span><span><strong>${escapeHtml(h.action)}</strong><small>${escapeHtml(h.employee_id?(state.profiles.find(p=>p.id===h.employee_id)?.full_name||'Former employee'):'Administrator')} · ${escapeHtml(h.at?new Date(h.at).toLocaleString('en-GB',{timeZone:TZ}):'Date not recorded')}</small>${h.note?`<small>${escapeHtml(h.note)}</small>`:''}</span></div>`).join(''):'<p>No assignment events recorded.</p>'}</div>`:''}`;
    $('asset-view-modal').classList.remove('hidden');
    $('asset-view-done').focus();
  }
  function openAssetReturn(id) {
    if(!canManageAssets())return notify('Only the Administrator can record asset returns.','error');
    const a=state.assets.find(x=>x.id===id);
    if(!a||a.status!=='assigned'||!a.assigned_to)return notify('This asset is not currently assigned.','error');
    state.returningAssetId=id;
    $('asset-return-form').reset();
    $('asset-return-description').textContent=`Receive ${a.name} (${a.asset_tag}) back from ${assetOwner(a)?.full_name||'employee'}.`;
    $('asset-return-condition').value=a.condition==='Damaged'?'Damaged':'Good';
    $('asset-return-modal').classList.remove('hidden');$('asset-return-condition').focus();
  }
  function submitAssetReturn(e) {
    e.preventDefault();
    if(!canManageAssets())return notify('Only the Administrator may return an asset.','error');
    const index=state.assets.findIndex(a=>a.id===state.returningAssetId);
    if(index<0||state.assets[index].status!=='assigned')return notify('This asset cannot be returned.','error');
    const old=state.assets[index],status=$('asset-return-next-status').value;
    if(!['available','maintenance','retired'].includes(status))return notify('Choose a valid return status.','error');
    const next={...old,status,condition:$('asset-return-condition').value,assigned_to:'',assigned_on:'',updated_at:new Date().toISOString(),history:[...(old.history||[]),{at:new Date().toISOString(),action:'Returned / '+assetStatusText(status),employee_id:old.assigned_to,by:state.profile.id,note:$('asset-return-note').value.trim()||'Equipment returned'}]};
    state.assets[index]=next;
    if(!saveDemo()){state.assets[index]=old;return;}
    closeAssetModal('asset-return-modal');renderAll();notify('Asset return recorded and equipment unassigned in this browser demo.');
  }
  function exportAssetsCsv() {
    if(!canManageAssets())return notify('Only the Administrator can export full equipment details.','error');
    const header=['Asset tag','Type','Name','Brand','Model','IMEI / ICCID / serial','Second IMEI','SIM number','Provider','Status','Assigned employee','Employee ID','Issued on','Condition','Purchased on','Warranty until','Notes'];
    const lines=state.assets.map(a=>[a.asset_tag,assetTypeText(a.type),a.name,a.brand,a.model,a.identifier,a.imei2,a.sim_number,a.sim_provider,assetStatusText(a.status),assetOwner(a)?.full_name||'',assetOwner(a)?.employee_code||'',a.assigned_on,a.condition,a.purchased_on,a.warranty_until,a.notes]);
    const safeCell=value=>{
      let s=String(value??'');
      if(/^[\s]*[=+\-@]/.test(s))s="'"+s; // prevent spreadsheet formula execution when exported.
      return '"'+s.replace(/"/g,'""')+'"';
    };
    const csv='\ufeff'+[header,...lines].map(row=>row.map(safeCell).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`helen-and-sons-assets-${businessDay()}.csv`;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    notify('Asset register exported from demo browser data.');
  }

  function refreshPreviewUserSelector() {
    if(isLive())return;
    $('demo-user-switch').innerHTML=state.profiles.filter(p=>p.active!==false).map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.full_name)} · ${escapeHtml(roleLabel(p.role))}</option>`).join('');
    $('demo-user-switch').value=state.profile?.id||'demo-admin';
    $('mobile-demo-user-switch').innerHTML=$('demo-user-switch').innerHTML;
    $('mobile-demo-user-switch').value=$('demo-user-switch').value;
  }
  function renderAll() {
    refreshPreviewUserSelector();
    const p = state.profile || {}; const id = initials(p.full_name);
    renderAvatarElement($('user-avatar'), p.full_name || 'Employee', p.photo_data_url);
    $('top-user-name').textContent = p.full_name || 'Employee';
    $('top-user-role').textContent = roleLabel(p.role);
    renderMetrics();renderMyAttendance();renderOverviewTable();renderAttendanceTable();renderEmployees();renderAccount();renderNewFeatures();renderLeaveBalances();renderDashboardExtras();renderCorrections();renderReports();renderAssets();renderAccountAssets();updateClock();
  }
  function setMobileMenu(open) {
    const sidebar=$('main-sidebar'),backdrop=$('mobile-nav-backdrop'),toggle=$('mobile-menu-toggle');
    if(!sidebar || !backdrop || !toggle) return;
    sidebar.classList.toggle('mobile-open',Boolean(open));
    backdrop.classList.toggle('hidden',!open);
    toggle.setAttribute('aria-expanded',String(Boolean(open)));
    toggle.setAttribute('aria-label',open?'Close navigation menu':'Open navigation menu');
    document.body.classList.toggle('mobile-menu-active',Boolean(open));
    if(open) sidebar.querySelector('.nav-item.active')?.focus({preventScroll:true});
    else if(document.activeElement===sidebar || sidebar.contains(document.activeElement)) toggle.focus({preventScroll:true});
  }
  function openMetricCard(card) {
    const page=card.dataset.page;
    if(card.querySelector('#metric-in')) {
      state.filterDate=businessDay();
      state.attendanceView='in';
    } else if(card.querySelector('#metric-late')) {
      state.alertView='today';
    }
    switchPage(page);
  }
  function switchPage(page) {
    if (!['overview','attendance','employees','account','leaves','approvals','alerts','corrections','reports','assets'].includes(page)) page = 'overview';
    if (page==='approvals' && !canApproveLeave()) page='leaves';
    state.activePage = page;
    setMobileMenu(false);
    document.querySelectorAll('.page').forEach(el => el.classList.toggle('hidden',el.id !== 'page-'+page));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active',el.dataset.page === page));
    document.querySelectorAll('.studio-tab').forEach(el => el.classList.toggle('active',el.dataset.page === page));
    $('breadcrumb').innerHTML = `Workspace <span>/</span> ${escapeHtml(page.charAt(0).toUpperCase()+page.slice(1))}`;
    renderAll(); window.scrollTo({top:0,behavior:'instant'});
  }
  async function loadLive() {
    const client = state.client;
    if (!client) return;
    const {data:{user},error:authError} = await client.auth.getUser();
    if (authError || !user) { state.mode='none';showAuth();return; }
    const {data:profile,error:profileError} = await client.from('profiles').select('*').eq('id',user.id).single();
    if (profileError || !profile) throw Error(`Your profile could not be loaded. Check that supabase/schema.sql has been installed. ${profileError?.message || ''}`);
    if (!profile.active) { await client.auth.signOut();throw Error('This employee account is inactive. Please contact HR.'); }
    const {data:people,error:peopleError} = await client.from('profiles').select('*').order('full_name');
    if (peopleError) throw peopleError;
    const cutoff = new Date(Date.now()-120*86400000);
    const {data:logs,error:logsError} = await client.from('attendance').select('*').gte('work_date',businessDay(cutoff)).order('clock_in_at',{ascending:false}).limit(1500);
    if (logsError) throw logsError;
    state.mode='live'; state.user=user; state.profile=profile; state.profiles=people || [];state.attendance=logs || [];state.leaves=[];state.reviewedAlerts=[];state.shifts=[];state.corrections=[];state.assets=[];
    if (!state.profiles.find(p=>p.id===profile.id)) state.profiles.push(profile);
    if (state.authView === 'password') { showAuth('password'); return; }
    showApp();
  }
  async function initSupabase() {
    if (!configured) {showAuth();return;}
    if (!window.supabase?.createClient) {
      try {
        await new Promise((resolve,reject) => {
          const script=document.createElement('script');
          script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
          script.onload=resolve;script.onerror=()=>reject(Error('Cannot load the Supabase library. Check your internet connection.'));
          document.head.appendChild(script);
        });
      } catch(err) {showAuth();notify(err.message,'error');return;}
    }
    if (!window.supabase?.createClient) {showAuth();notify('Supabase browser library was unavailable.','error');return;}
    try {
      state.client = window.supabase.createClient(cfg.supabaseUrl.trim(),cfg.supabasePublishableKey.trim(),{
        auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}
      });
      const hasWelcome = new URLSearchParams(location.search).has('welcome');
      const hasRecovery = new URLSearchParams(location.search).has('recovery');
      if (hasWelcome || hasRecovery) state.authView = 'password';
      state.client.auth.onAuthStateChange((event,session) => {
        if (event === 'PASSWORD_RECOVERY') state.authView='password';
        if (event === 'SIGNED_OUT') { state.mode='none';state.profile=null;showAuth(); }
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'PASSWORD_RECOVERY') {
          setTimeout(async () => {
            try { await loadLive(); } catch (err) { notify(err.message,'error');showAuth(state.authView === 'password' ? 'password' : 'signin'); }
          },0);
        }
      });
      const {data:{session}} = await state.client.auth.getSession();
      if (session) { await loadLive(); }
      else if (state.authView === 'password') { showAuth('password'); }
      else showAuth();
    } catch(err) {console.error(err);showAuth();notify(err.message,'error');}
  }
  async function signIn(evt) {
    evt.preventDefault();
    if (!state.client) {notify('Connect Supabase in js/config.js first, or select a demo preview.','error');return;}
    const email=$('login-email').value.trim(); const password=$('login-password').value;
    try { const {error}=await state.client.auth.signInWithPassword({email,password});if(error)throw error; await loadLive();notify('Signed in successfully.'); }
    catch(err){notify(err.message,'error');}
  }
  async function forgotPassword(evt) {
    evt.preventDefault();
    if (!state.client) {notify('Connect Supabase to send a real password-reset email.','error');return;}
    const email=$('forgot-email').value.trim();
    const redirectTo = `${location.origin}${location.pathname}?recovery=1`;
    try { const {error}=await state.client.auth.resetPasswordForEmail(email,{redirectTo});if(error)throw error;notify('If this email is registered, a password-reset link has been requested. Check your inbox.');showAuth('signin'); }
    catch(err){notify(err.message,'error');}
  }
  async function updatePassword(evt, isAccount) {
    evt.preventDefault();
    const first=$(isAccount?'account-new-password':'new-password').value;
    const second=$(isAccount?'account-confirm-password':'confirm-password').value;
    if (first !== second) {notify('Passwords do not match.','error');return;}
    if (first.length < 10) {notify('Please use at least 10 characters.','error');return;}
    if (!isLive() && !state.client) {notify('Password changes are not available in demo mode. Connect Supabase for real accounts.','error');return;}
    if (!state.client) return;
    try {
      const {error}=await state.client.auth.updateUser({password:first});if(error)throw error;
      evt.target.reset();notify('Password updated successfully.');
      if (!isAccount) {state.authView='signin';history.replaceState(null,'',location.pathname);await loadLive();}
    }catch(err){notify(err.message,'error');}
  }
  async function punch(action) {
    if (state.busy) return;
    state.busy=true;renderMyAttendance();
    try {
      if (isLive()) {
        const {error}=await state.client.rpc('punch_attendance',{p_action:action});
        if(error)throw error;
        await loadLive();
      } else {
        const today = myTodayRecord(); const open=myLastOpen();
        if (action==='in') {
          if(today || open)throw Error('You already clocked in or have an open shift.');
          state.attendance.unshift({id:'demo-'+Date.now(),employee_id:state.profile.id,work_date:workDateForPunch(),clock_in_at:new Date().toISOString(),clock_out_at:null,source:'web',shift_id:state.profile.shift_id||null});
        } else {
          if(!open)throw Error('You have no open shift to clock out from.');
          open.clock_out_at = new Date().toISOString();
        }
        saveDemo();renderAll();
      }
      const justLate=action==='in' && Boolean(lateForRecord(state.attendance.find(a=>a.employee_id===state.profile?.id&&!a.clock_out_at))); 
      notify(justLate ? 'Clocked IN. A late-attendance notification was created for this shift.' : action === 'in' ? 'Clocked IN successfully. Attendance time saved.' : 'Clocked OUT successfully. Attendance time saved.');
    } catch(err) {notify(err.message,'error');}
    finally{state.busy=false;renderMyAttendance();}
  }
  async function refresh() {
    try {if (isLive()) await loadLive();else renderAll();notify('Attendance and employee information refreshed.');}
    catch(err){notify(err.message,'error');}
  }
  async function chooseEmployeePhoto(event) {
    if (!canInvite() || isLive() || (state.editingEmployeeId && !canEditEmployee(state.profiles.find(p=>p.id===state.editingEmployeeId)))) return;
    const file = event.target.files?.[0];
    if (!file) return;
    const token = ++state.photoRequestToken;
    $('emp-photo-info').textContent = 'Preparing your photo…';
    try {
      const photo = await resizeProfilePhoto(file);
      if (token !== state.photoRequestToken || $('employee-modal').classList.contains('hidden')) return;
      state.editingPhoto = photo;
      renderAvatarElement($('emp-photo-preview'), $('emp-name').value || 'Employee', photo);
      $('emp-photo-remove').disabled = false;
      $('emp-photo-info').textContent = 'Photo ready. Click Save profile to keep it.';
    } catch (err) {
      if (token === state.photoRequestToken) {notify(err.message, 'error');$('emp-photo-info').textContent = err.message;}
    } finally { event.target.value = ''; }
  }
  function removeEmployeePhoto() {
    if (!canInvite() || isLive() || (state.editingEmployeeId && !canEditEmployee(state.profiles.find(p=>p.id===state.editingEmployeeId)))) return;
    state.photoRequestToken++;
    state.editingPhoto = null;
    renderAvatarElement($('emp-photo-preview'), $('emp-name').value || 'Employee', null);
    $('emp-photo-remove').disabled = true;
    $('emp-photo-info').textContent = 'Photo will be removed when you save the employee profile.';
  }
  async function chooseOwnPhoto(event) {
    if (isLive() || state.mode !== 'demo') return;
    const file = event.target.files?.[0];
    if (!file) return;
    const token = ++state.accountPhotoRequestToken;
    const userId = state.profile?.id;
    try {
      const photo = await resizeProfilePhoto(file);
      if (token !== state.accountPhotoRequestToken || state.mode !== 'demo' || state.profile?.id !== userId) return;
      const profile = state.profiles.find(p=>p.id === userId);
      if (!profile) throw Error('Employee profile was not found.');
      const previous = profile.photo_data_url;
      profile.photo_data_url = photo;
      if (!saveDemo()) {profile.photo_data_url = previous;return;}
      renderAll();notify('Your profile photo was saved in this browser demo.');
    } catch (err) {if (token === state.accountPhotoRequestToken) notify(err.message, 'error');}
    finally {event.target.value='';}
  }
  function removeOwnPhoto() {
    if (isLive() || state.mode !== 'demo' || !state.profile) return;
    state.accountPhotoRequestToken++;
    const profile=state.profiles.find(p=>p.id===state.profile.id);
    if (!profile) return;
    const previous=profile.photo_data_url;
    profile.photo_data_url=null;
    if (!saveDemo()) {profile.photo_data_url=previous;return;}
    renderAll();notify('Your profile photo was removed from this browser demo.');
  }
  function openEmployeeModal() { openProfile(null); }
  function closeEmployeeModal() { state.photoRequestToken++;state.editingPhoto=null;$('emp-photo-input').value='';$('employee-modal').classList.add('hidden'); }
  async function addEmployee(evt) {
    evt.preventDefault();
    if(!canInvite())return notify('Only administrators can create or update employee accounts.','error');
    if(state.editingEmployeeId && !canEditEmployee(state.profiles.find(p=>p.id===state.editingEmployeeId)))
      return notify('The built-in accounts and your own account are protected from editing.','error');
    if(isLive() && state.editingEmployeeId)return notify('Connected employee editing needs a server-side profile update workflow.','error');
    const get=id=>$(id).value.trim();
    const full_name=get('emp-name'),email=get('emp-email').toLowerCase(),employee_code=get('emp-code').toUpperCase();
    const department=get('emp-dept'),job_title=get('emp-title');
    const requestedRole=get('emp-role');
    if(!['employee','hr','admin'].includes(requestedRole))return notify('Choose a valid access role.','error');
    const role=isLive()?'employee':requestedRole; // Live roles require trusted backend authority.
    if(!full_name||!email||!employee_code||!department||!job_title||!get('emp-joined')||!$('emp-email').checkValidity())
      return notify('Full name, employee ID, work email, department, job title, and joining date are required.','error');
    if(!/^[A-Z0-9][A-Z0-9-_]{1,31}$/.test(employee_code))return notify('Employee ID must use 2–32 letters, digits, hyphens, or underscores.','error');
    if(!isLive() && state.profiles.some(p=>p.id!==state.editingEmployeeId&&(p.email.toLowerCase()===email||p.employee_code===employee_code)))return notify('Employee email and employee ID must be unique.','error');
    const btn=$('save-employee-btn');btn.disabled=true;
    try {
      if(isLive()){
        const {data,error}=await state.client.functions.invoke('invite-employee',{body:{full_name,email,department,job_title,role}});
        if(error){let detail='';try{detail=(await error.context.json()).error||'';}catch(_){ }throw Error(detail||error.message||'Invitation failed.');}
        if(data?.error)throw Error(data.error);
        await loadLive();notify(`Invitation sent to ${email}. Additional HR fields need a database upgrade.`);
      } else {
        const extras={full_name,email,employee_code,phone:get('emp-phone'),department,job_title,role,location:get('emp-location'),joined_on:get('emp-joined'),employment_type:get('emp-type'),manager_id:get('emp-manager'),shift_id:state.editingEmployeeId?(state.profiles.find(p=>p.id===state.editingEmployeeId)?.shift_id||'shift-office'):'shift-office',active:get('emp-status')==='active',annual_allowance:Number(get('emp-annual')),sick_allowance:Number(get('emp-sick')),photo_data_url:state.editingPhoto};
        if(!Number.isInteger(extras.annual_allowance)||extras.annual_allowance<0||extras.annual_allowance>365||!Number.isInteger(extras.sick_allowance)||extras.sick_allowance<0||extras.sick_allowance>365)throw Error('Leave allowances must be from 0 to 365 days.');
        if(state.editingEmployeeId){const p=state.profiles.find(p=>p.id===state.editingEmployeeId);if(!p||!canEditEmployee(p))throw Error('You cannot edit this protected account.');Object.assign(p,extras);notify(`${full_name}'s profile and ${roleLabel(role)} access updated in the browser demo.`);}
        else{state.profiles.push({id:'demo-user-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),...extras});notify(`${full_name} created with ${roleLabel(role)} access in this browser demo. No login email was sent.`);}
        saveDemo();renderAll();
      }
      closeEmployeeModal();
    }catch(err){notify(err.message,'error');}
    finally{btn.disabled=false;btn.textContent='Save employee →';}
  }
  async function signOut() {
    if (isLive() && state.client) {try {const {error}=await state.client.auth.signOut(); if(error)throw error;}catch(err){notify(err.message,'error');return;}}
    state.mode='none';state.profile=null;state.profiles=[];state.attendance=[];state.leaves=[];state.reviewedAlerts=[];state.shifts=[];state.corrections=[];state.assets=[];state.authView='signin';showAuth();
  }
  const THEME_STORE = 'helen-sons-hris-studio-theme';
  function setTheme(value) {
    const theme = value === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      const selected = button.dataset.themeChoice === theme;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    });
    const colorMeta = document.querySelector('meta[name="theme-color"]');
    if (colorMeta) colorMeta.setAttribute('content', theme === 'light' ? '#FFFFFF' : '#000040');
    try { localStorage.setItem(THEME_STORE, theme); } catch (_) { /* Live Server still works without storage. */ }
  }
  function wireEvents() {
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.addEventListener('click', () => setTheme(button.dataset.themeChoice));
    });
    $('login-form').addEventListener('submit',signIn);
    $('forgot-form').addEventListener('submit',forgotPassword);
    $('password-form').addEventListener('submit',evt=>updatePassword(evt,false));
    $('account-password-form').addEventListener('submit',evt=>updatePassword(evt,true));
    $('forgot-link').addEventListener('click',()=>showAuth('forgot'));
    document.querySelectorAll('[data-back-login]').forEach(el=>el.addEventListener('click',()=>showAuth('signin')));
    document.querySelectorAll('[data-toggle]').forEach(btn=>btn.addEventListener('click',()=>{const input=$(btn.dataset.toggle);input.type=input.type==='password'?'text':'password';btn.textContent=input.type==='password'?'Show':'Hide';}));
    $('demo-admin').addEventListener('click',()=>enterDemo('demo-admin'));
    $('demo-employee').addEventListener('click',()=>enterDemo('demo-e1'));
    $('demo-hr').addEventListener('click',()=>enterDemo('demo-e3'));
    $('demo-user-switch').addEventListener('change',e=>{if(!isLive())enterDemo(e.target.value);});
    $('mobile-demo-user-switch').addEventListener('change',e=>{if(!isLive())enterDemo(e.target.value);});
    $('top-alert-btn').addEventListener('click',()=>switchPage('alerts'));
    $('top-leave-btn').addEventListener('click',()=>{if(canApproveLeave())switchPage('approvals');});
    $('correction-form').addEventListener('submit',submitCorrection);
    $('correction-record').addEventListener('change',fillCorrectionTimes);
    $('correction-decision-form').addEventListener('submit',e=>{e.preventDefault();if(!state.selectedCorrectionRejectId)return;reviewCorrection(state.selectedCorrectionRejectId,'rejected',$('correction-decision-reason').value);state.selectedCorrectionRejectId=null;$('correction-decision-modal').classList.add('hidden');});
    document.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>$(el.dataset.close).classList.add('hidden')));
    $('correction-decision-modal').addEventListener('click',e=>{if(e.target===$('correction-decision-modal'))$('correction-decision-modal').classList.add('hidden');});
    $('leave-form').addEventListener('submit',submitLeave);
    $('leave-start').addEventListener('change',updateLeaveDays);
    $('leave-end').addEventListener('change',updateLeaveDays);
    $('decision-form').addEventListener('submit',e=>{e.preventDefault();if(!state.selectedRejectId)return;reviewLeave(state.selectedRejectId,'rejected',$('decision-note').value);closeDecisionModal();});
    $('close-decision-modal').addEventListener('click',closeDecisionModal);
    $('cancel-decision').addEventListener('click',closeDecisionModal);
    $('decision-modal').addEventListener('click',e=>{if(e.target===$('decision-modal'))closeDecisionModal();});
    $('ack-all-alerts').addEventListener('click',()=>{if(isLive())return;state.reviewedAlerts=Array.from(new Set([...state.reviewedAlerts,...getLateAlerts().map(a=>a.id)]));saveDemo();renderAll();notify('All visible attendance alerts marked reviewed.');});
    document.addEventListener('click',e=>{
      const editAsset=e.target.closest('[data-edit-asset]');if(editAsset){openAssetEditor(editAsset.dataset.editAsset);return;}
      const assignAsset=e.target.closest('[data-assign-asset]');if(assignAsset){openAssetEditor(assignAsset.dataset.assignAsset,true);return;}
      const viewAsset=e.target.closest('[data-view-asset]');if(viewAsset){showAssetDetail(viewAsset.dataset.viewAsset);return;}
      const returnAsset=e.target.closest('[data-return-asset]');if(returnAsset){openAssetReturn(returnAsset.dataset.returnAsset);return;}
      const edit=e.target.closest('[data-edit-employee]');if(edit){openProfile(edit.dataset.editEmployee);return;}
      const correct=e.target.closest('[data-correct-id]');if(correct){openCorrectionFor(correct.dataset.correctId);return;}
      const cancelCorrectionBtn=e.target.closest('[data-cancel-correction]');if(cancelCorrectionBtn){cancelCorrection(cancelCorrectionBtn.dataset.cancelCorrection);return;}
      const correctionReview=e.target.closest('[data-correction-review]');if(correctionReview){
        if(correctionReview.dataset.correctionAction==='rejected'){state.selectedCorrectionRejectId=correctionReview.dataset.correctionReview;$('correction-decision-form').reset();$('correction-decision-modal').classList.remove('hidden');$('correction-decision-reason').focus();}
        else reviewCorrection(correctionReview.dataset.correctionReview,'approved');
        return;
      }
      const exportBtn=e.target.closest('[data-export]');if(exportBtn){exportCsv(exportBtn.dataset.export);return;}
      const link=e.target.closest('[data-page]');
      if(link && link.classList.contains('metric-link')){openMetricCard(link);return;}
      if(link && !link.classList.contains('nav-item')){switchPage(link.dataset.page);return;}
      const review=e.target.closest('[data-review-id]');
      if(review){if(review.dataset.decision==='rejected')openDecisionModal(review.dataset.reviewId);else reviewLeave(review.dataset.reviewId,'approved');return;}
      const cancel=e.target.closest('[data-cancel-leave]');if(cancel){cancelLeave(cancel.dataset.cancelLeave);return;}
      const ack=e.target.closest('[data-ack-alert]');if(ack){acknowledgeAlert(ack.dataset.ackAlert);}
    });
    document.querySelectorAll('.nav-item[data-page]').forEach(btn=>btn.addEventListener('click',()=>switchPage(btn.dataset.page)));
    $('mobile-menu-toggle').addEventListener('click',()=>setMobileMenu(!$('main-sidebar').classList.contains('mobile-open')));
    $('mobile-menu-close').addEventListener('click',()=>setMobileMenu(false));
    $('mobile-nav-backdrop').addEventListener('click',()=>setMobileMenu(false));
    window.addEventListener('resize',()=>{if(window.innerWidth>900)setMobileMenu(false);});
    $('attendance-view-select').addEventListener('change',e=>{state.attendanceView=e.target.value;renderAttendanceTable();});
    $('alert-view-select').addEventListener('change',e=>{state.alertView=e.target.value;renderAlerts();});
    document.querySelectorAll('[data-refresh]').forEach(btn=>btn.addEventListener('click',refresh));
    $('clock-in-btn').addEventListener('click',()=>punch('in'));
    $('clock-out-btn').addEventListener('click',()=>punch('out'));
    $('logout-btn').addEventListener('click',signOut);
    $('attendance-date').addEventListener('change',(e)=>{state.filterDate=e.target.value||businessDay();renderAttendanceTable();});
    $('employee-search').addEventListener('input',e=>{state.query=e.target.value;renderEmployees();});
    $('asset-add-btn').addEventListener('click',()=>openAssetEditor(null));
    $('asset-export-btn').addEventListener('click',exportAssetsCsv);
    $('asset-search').addEventListener('input',e=>{state.assetQuery=e.target.value;renderAssets();});
    $('asset-type-filter').addEventListener('change',e=>{state.assetTypeFilter=e.target.value;renderAssets();});
    $('asset-status-filter').addEventListener('change',e=>{state.assetStatusFilter=e.target.value;renderAssets();});
    $('asset-type').addEventListener('change',updateAssetTypeFields);
    $('asset-status').addEventListener('change',updateAssetAssignmentFields);
    $('asset-assignee').addEventListener('change',()=>{if($('asset-assignee').value){$('asset-status').value='assigned';if(!$('asset-assigned-on').value)$('asset-assigned-on').value=businessDay();}else if($('asset-status').value==='assigned')$('asset-status').value='available';updateAssetAssignmentFields();});
    $('asset-form').addEventListener('submit',saveAssetFromForm);
    $('asset-return-form').addEventListener('submit',submitAssetReturn);
    [['asset-modal','asset-close-modal','asset-cancel-modal'],['asset-view-modal','asset-view-close','asset-view-done'],['asset-return-modal','asset-return-close','asset-return-cancel']].forEach(([modal,...buttons])=>{
      buttons.forEach(id=>$(id).addEventListener('click',()=>closeAssetModal(modal)));
      $(modal).addEventListener('click',e=>{if(e.target===$(modal))closeAssetModal(modal);});
    });
    $('add-employee-btn').addEventListener('click',openEmployeeModal);
    $('close-modal').addEventListener('click',closeEmployeeModal);
    $('cancel-modal').addEventListener('click',closeEmployeeModal);
    $('employee-modal').addEventListener('click',e=>{if(e.target===$('employee-modal'))closeEmployeeModal();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){setMobileMenu(false);closeEmployeeModal();closeDecisionModal();$('correction-decision-modal').classList.add('hidden');['asset-modal','asset-view-modal','asset-return-modal'].forEach(closeAssetModal);}});
    $('employee-form').addEventListener('submit',addEmployee);
    $('emp-role').addEventListener('change',updateRoleDescription);
    $('emp-photo-input').addEventListener('change',chooseEmployeePhoto);
    $('emp-photo-remove').addEventListener('click',removeEmployeePhoto);
    $('account-photo-input').addEventListener('change',chooseOwnPhoto);
    $('account-photo-remove').addEventListener('click',removeOwnPhoto);
    document.querySelectorAll('label.photo-choose-btn').forEach(label=>{
      label.setAttribute('tabindex','0');label.setAttribute('role','button');
      label.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){
          event.preventDefault();const input=$(label.getAttribute('for'));if(input&&!input.disabled)input.click();
        }
      });
    });
    $('emp-name').addEventListener('input',()=>{if (!state.editingPhoto)renderAvatarElement($('emp-photo-preview'),$('emp-name').value||'New employee',null);});
    $('demo-reset-btn').addEventListener('click',()=>{
      if (!confirm('Reset all demo employees, leave applications and attendance records in this browser?')) return;
      localStorage.removeItem(STORE);localStorage.removeItem(OLD_STORE); enterDemo('demo-admin');notify('Demo data restored to defaults.');
    });
  }
  wireEvents();setTheme(document.documentElement.dataset.theme);showAuth();initSupabase();
  setInterval(()=>{if(!$('app-screen').classList.contains('hidden'))updateClock();},1000);
})();
