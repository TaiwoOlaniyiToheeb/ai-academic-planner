/* ==========================================================================
   AI Academic Planner — planner engine (phases 1–7)
   ========================================================================== */

/* ==========================================================================
   PHASE 1 — DATA MODEL
   ========================================================================== */
const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const DAYNAME = {mon:'Monday',tue:'Tuesday',wed:'Wednesday',thu:'Thursday',fri:'Friday',sat:'Saturday',sun:'Sunday'};
const ALIAS = {monday:'mon',mon:'mon',tuesday:'tue',tue:'tue',tues:'tue',wednesday:'wed',wed:'wed',
  thursday:'thu',thu:'thu',thur:'thu',thurs:'thu',friday:'fri',fri:'fri',saturday:'sat',sat:'sat',sunday:'sun',sun:'sun'};
const PERIODS = {any:[0,1440], morning:[0,720], afternoon:[720,1020], evening:[1020,1440]};

const state = {
  topics: [],
  busy: {},
  prefs: {},
  pins: {},            // subject -> day  (from "move X to Y")
  plan: [],
  validation: null,
  accepted: false,
  seed: 12345,
  version: 0
};

const SEED_BUSY = {
  mon:[{start:'08:00',end:'16:00',label:'School'}],
  tue:[{start:'08:00',end:'16:00',label:'School'}],
  wed:[{start:'08:00',end:'16:00',label:'School'}],
  thu:[{start:'08:00',end:'16:00',label:'School'}],
  fri:[{start:'08:00',end:'16:00',label:'School'}],
  sat:[],
  sun:[{start:'09:00',end:'13:00',label:'Family'}]
};

const SEED_TOPICS = [
  {id:'t1', subject:'Mathematics', topic:'Quadratic Equations', mastery:42, difficulty:3, lastStudied:9,  examIn:5,  assignmentIn:2,  prereqMet:true,  boost:0},
  {id:'t2', subject:'Physics',     topic:'Forces & Motion',     mastery:55, difficulty:2, lastStudied:6,  examIn:4,  assignmentIn:null,prereqMet:true,  boost:0},
  {id:'t3', subject:'Biology',     topic:'Cell Division',       mastery:48, difficulty:2, lastStudied:11, examIn:9,  assignmentIn:5,  prereqMet:true,  boost:0},
  {id:'t4', subject:'Physics',     topic:'Electricity',         mastery:30, difficulty:3, lastStudied:14, examIn:12, assignmentIn:null,prereqMet:false, boost:0},
  {id:'t5', subject:'Mathematics', topic:'Trigonometry',        mastery:68, difficulty:3, lastStudied:4,  examIn:12, assignmentIn:null,prereqMet:true,  boost:0},
  {id:'t6', subject:'Chemistry',   topic:'Chemical Bonding',    mastery:74, difficulty:2, lastStudied:3,  examIn:18, assignmentIn:null,prereqMet:true,  boost:0},
  {id:'t7', subject:'Chemistry',   topic:'Organic Basics',      mastery:61, difficulty:3, lastStudied:10, examIn:25, assignmentIn:6,  prereqMet:true,  boost:0},
  {id:'t8', subject:'English',     topic:'Comprehension',       mastery:85, difficulty:1, lastStudied:2,  examIn:20, assignmentIn:null,prereqMet:true,  boost:0}
];

function seedState(){
  state.topics = SEED_TOPICS.map(t => ({...t}));
  state.busy = JSON.parse(JSON.stringify(SEED_BUSY));
  state.prefs = {
    sessionMinutes:60, breakMinutes:15, maxDailyMinutes:180, maxSessionsPerDay:3,
    preferredPeriod:'any', weekendsAvailable:true, dayStart:'06:00', dayEnd:'22:30'
  };
  state.pins = {};
  state.plan = [];
  state.validation = null;
  state.accepted = false;
}

/* ==========================================================================
   HELPERS
   ========================================================================== */
const toMin  = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
const toTime = m => String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
const fmt12  = t => { let [h,m] = t.split(':').map(Number); const ap = h>=12?'PM':'AM'; h = h%12||12;
                      return h + ':' + String(m).padStart(2,'0') + ' ' + ap; };
const clamp  = (v,a,b) => Math.max(a, Math.min(b, v));
const dur    = m => m >= 60 ? (m/60).toFixed(m%60?1:0).replace('.0','') + 'h' : m + 'm';

function makeRng(seed){ let s = seed>>>0 || 1; return () => (s = (s*1664525 + 1013904223)>>>0) / 4294967296; }

function subjHue(s){ let h = 0; for (const c of s) h = (h*31 + c.charCodeAt(0)) % 360; return h; }

function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('on');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2600);
}

/* ==========================================================================
   PHASE 3 — PRIORITY ENGINE
   ========================================================================== */
function scoreTopic(t){
  const gap     = (100 - t.mastery) / 100;
  let urgency   = clamp(1 - (t.examIn ?? 99) / 21, 0, 1);
  if (t.examIn <= 3) urgency = Math.min(1, urgency * 1.35);
  const forget  = clamp(t.lastStudied / 14, 0, 1);
  const diff    = (t.difficulty - 1) / 2;
  const assign  = t.assignmentIn == null ? 0 : clamp(1 - t.assignmentIn / 7, 0, 1);

  let raw = 0.30*gap + 0.28*urgency + 0.14*forget + 0.10*diff + 0.18*assign;
  if (!t.prereqMet) raw *= 0.55;                    // can't outrun missing foundations
  const score = clamp(Math.round(raw * 100) + (t.boost || 0), 0, 100);

  return { score, parts:{ gap, urgency, forget, diff, assign } };
}

function rankTopics(jitter = 0){
  const rng = makeRng(state.seed + state.version);
  return state.topics
    .map(t => ({ ...t, ...scoreTopic(t), jitter: jitter ? (rng()-0.5)*jitter : 0 }))
    .sort((a,b) => (b.score + b.jitter) - (a.score + a.jitter));
}

/* ==========================================================================
   PHASE 2 — AVAILABILITY ENGINE
   ========================================================================== */
function freeBlocks(day){
  const p = state.prefs;
  if (!p.weekendsAvailable && (day === 'sat' || day === 'sun')) return [];
  const [ps, pe] = PERIODS[p.preferredPeriod] || PERIODS.any;
  const lo = Math.max(toMin(p.dayStart), ps);
  const hi = Math.min(toMin(p.dayEnd), pe);
  let blocks = hi > lo ? [{start:lo, end:hi}] : [];

  for (const b of (state.busy[day] || [])){
    const bs = toMin(b.start), be = toMin(b.end);
    const next = [];
    for (const f of blocks){
      if (be <= f.start || bs >= f.end){ next.push(f); continue; }
      if (bs > f.start) next.push({start:f.start, end:bs});
      if (be < f.end)   next.push({start:be,   end:f.end});
    }
    blocks = next;
  }
  return blocks.filter(b => b.end - b.start >= p.sessionMinutes);
}

function dayFreeMinutes(day){
  const lo = toMin(state.prefs.dayStart), hi = toMin(state.prefs.dayEnd);
  let blocks = [{start:lo, end:hi}];
  for (const b of (state.busy[day] || [])){
    const bs = toMin(b.start), be = toMin(b.end);
    const next = [];
    for (const f of blocks){
      if (be <= f.start || bs >= f.end){ next.push(f); continue; }
      if (bs > f.start) next.push({start:f.start, end:bs});
      if (be < f.end)   next.push({start:be,   end:f.end});
    }
    blocks = next;
  }
  return blocks.reduce((s,b) => s + (b.end - b.start), 0);
}

/** Build the list of usable study slots, honouring every preference constraint. */
function buildSlots(){
  const p = state.prefs;
  const slots = [];
  for (const day of DAYS){
    let dayMin = 0, dayCount = 0;
    for (const b of freeBlocks(day)){
      let t = b.start;
      while (t + p.sessionMinutes <= b.end){
        if (dayCount >= p.maxSessionsPerDay) break;
        if (dayMin + p.sessionMinutes > p.maxDailyMinutes) break;
        slots.push({ day, start:t, end:t + p.sessionMinutes });
        dayMin += p.sessionMinutes; dayCount++;
        t += p.sessionMinutes + p.breakMinutes;
      }
      if (dayCount >= p.maxSessionsPerDay) break;
      if (dayMin + p.sessionMinutes > p.maxDailyMinutes) break;
    }
  }
  return slots;
}

/* ==========================================================================
   PHASE 4 — PLAN GENERATION
   ========================================================================== */
function sessionType(mastery, n){
  if (mastery < 50) return ['Learn','Practice','Practice','Revise'][Math.min(n-1,3)];
  if (mastery < 75) return ['Practice','Practice','Revise'][Math.min(n-1,2)];
  return ['Revise','Practice'][Math.min(n-1,1)];
}

function buildQueue(ranked){
  const items = ranked.map(r => ({
    ...r,
    demand: clamp(Math.round(r.score / 20), r.score < 12 ? 0 : 1, 4)
  })).filter(i => i.demand > 0);

  const queue = [];
  const maxD = Math.max(1, ...items.map(i => i.demand));
  for (let round = 0; round < maxD; round++)
    for (const it of items) if (round < it.demand) queue.push(it);
  return queue;
}

function generatePlan(){
  const ranked = rankTopics(4);            // small jitter → "Regenerate" gives a fresh layout
  const slots  = buildSlots();
  const queue  = buildQueue(ranked);
  const plan   = [];
  const perDayTopic = {}, perDaySubject = {}, countByTopic = {};

  const place = (slot, item, allowPinViolation) => {
    const pin = state.pins[item.subject];
    if (!allowPinViolation && pin && pin !== slot.day) return false;
    (perDayTopic[slot.day]   ||= new Set());
    (perDaySubject[slot.day] ||= new Set());
    if (perDayTopic[slot.day].has(item.id)) return false;
    if (!allowPinViolation && perDaySubject[slot.day].size >= 2 &&
        perDaySubject[slot.day].has(item.subject)) return false;

    const n = (countByTopic[item.id] = (countByTopic[item.id] || 0) + 1);
    plan.push({
      id: `${slot.day}-${slot.start}-${item.id}`,
      day: slot.day, start: slot.start, end: slot.end,
      topicId: item.id, subject: item.subject, topic: item.topic,
      type: sessionType(item.mastery, n), priority: item.score
    });
    perDayTopic[slot.day].add(item.id);
    perDaySubject[slot.day].add(item.subject);
    return true;
  };

  // Pass 1 — strict: respect pins + subject variety
  for (const slot of slots){
    if (!queue.length) break;
    let idx = queue.findIndex(q => {
      const pin = state.pins[q.subject];
      if (pin && pin !== slot.day) return false;
      if (perDayTopic[slot.day]?.has(q.id)) return false;
      if (perDaySubject[slot.day]?.has(q.subject)) return false;
      return true;
    });
    if (idx === -1) continue;
    place(slot, queue.splice(idx,1)[0], false);
  }
  // Pass 2 — relaxed: fill leftover slots with anything that still fits
  for (const slot of slots){
    if (!queue.length) break;
    if (plan.some(s => s.day === slot.day && s.start === slot.start)) continue;
    const idx = queue.findIndex(q => !(perDayTopic[slot.day]?.has(q.id)));
    if (idx === -1) continue;
    place(slot, queue.splice(idx,1)[0], true);
  }
  // Pass 3 — leftover pinned topics get squeezed in anywhere
  for (const slot of slots){
    if (!queue.length) break;
    if (plan.some(s => s.day === slot.day && s.start === slot.start)) continue;
    place(slot, queue.shift(), true);
  }

  plan.sort((a,b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start - b.start);
  return { plan, unscheduled: queue, ranked };
}

/* ==========================================================================
   PHASE 5 — INDEPENDENT VALIDATION
   ========================================================================== */
function isFree(day, start, end){
  const p = state.prefs;
  if (start < toMin(p.dayStart) || end > toMin(p.dayEnd)) return false;
  if (!p.weekendsAvailable && (day === 'sat' || day === 'sun')) return false;
  const [ps, pe] = PERIODS[p.preferredPeriod] || PERIODS.any;
  if (start < ps || end > pe) return false;
  for (const b of (state.busy[day] || [])){
    const bs = toMin(b.start), be = toMin(b.end);
    if (start < be && end > bs) return false;   // direct clash with a busy block
  }
  return true;
}

function validatePlan(plan, ranked, unscheduled){
  const p = state.prefs;
  const byDay = {};
  for (const s of plan) (byDay[s.day] ||= []).push(s);
  for (const d of Object.keys(byDay)) byDay[d].sort((a,b) => a.start - b.start);

  const checks = [];

  // 1 — double booking
  let overlaps = 0;
  for (const list of Object.values(byDay))
    for (let i = 1; i < list.length; i++)
      if (list[i].start < list[i-1].end) overlaps++;
  checks.push({ ok: overlaps === 0, name:'No double-booked sessions',
    detail: overlaps ? overlaps + ' overlapping pair(s) found' : 'Every session occupies its own slot' });

  // 2 — inside genuine free time
  const outside = plan.filter(s => !isFree(s.day, s.start, s.end));
  checks.push({ ok: outside.length === 0, name:'Every session fits inside real free time',
    detail: outside.length ? outside.length + ' session(s) clash with school/busy blocks'
                           : 'No clashes with school, commitments or your day window' });

  // 3 — daily cap
  const overDaily = Object.entries(byDay).filter(([,l]) =>
    l.reduce((s,x) => s + (x.end - x.start), 0) > p.maxDailyMinutes);
  checks.push({ ok: overDaily.length === 0, name:`Daily limit ≤ ${dur(p.maxDailyMinutes)}`,
    detail: overDaily.length ? 'Exceeded on: ' + overDaily.map(([d]) => DAYNAME[d]).join(', ')
                             : 'No day exceeds your maximum study time' });

  // 4 — breaks
  let noBreak = 0;
  for (const list of Object.values(byDay))
    for (let i = 1; i < list.length; i++)
      if (list[i].start - list[i-1].end < p.breakMinutes) noBreak++;
  checks.push({ ok: noBreak === 0, name:`Breaks ≥ ${p.breakMinutes} min between sessions`,
    detail: noBreak ? noBreak + ' back-to-back session(s)' : 'Every session is separated by a break' });

  // 5 — sessions per day
  const tooMany = Object.entries(byDay).filter(([,l]) => l.length > p.maxSessionsPerDay);
  checks.push({ ok: tooMany.length === 0, name:`Max ${p.maxSessionsPerDay} sessions per day`,
    detail: tooMany.length ? 'Exceeded on: ' + tooMany.map(([d]) => DAYNAME[d]).join(', ')
                           : 'Session count per day is within your limit' });

  // 6 — exam coverage
  const uncovered = state.topics.filter(t => {
    if (t.examIn == null || t.examIn > 6) return false;
    const deadline = Math.max(1, t.examIn);
    return !plan.some(s => s.topicId === t.id && DAYS.indexOf(s.day) < deadline);
  });
  checks.push({ ok: uncovered.length === 0, name:'Imminent exams covered before the date',
    detail: uncovered.length ? 'Not scheduled in time: ' + uncovered.map(t => t.topic).join(', ')
                             : 'Every topic with an exam within 6 days is scheduled before it' });

  // 7 — workload balance
  const days = Object.keys(byDay).length;
  const spread = days <= 1 && plan.length > 2;
  checks.push({ ok: !spread, severity: spread ? 'warn' : 'pass', name:'Workload is spread across the week',
    detail: spread ? 'Almost everything landed on one day — try widening your availability'
                   : `Sessions distributed over ${days} day${days === 1 ? '' : 's'}` });

  // 8 — everything placed
  const dropped = unscheduled ? unscheduled.length : 0;
  checks.push({ ok: dropped === 0, severity: dropped ? 'warn' : 'pass',
    name:'All prioritised topics were scheduled',
    detail: dropped ? `${dropped} session(s) couldn't fit — add more free time or lower the session length`
                    : 'Every topic that needed time got it' });

  const errors = checks.filter(c => !c.ok && c.severity !== 'warn');
  return { checks, errors, warnings: checks.filter(c => !c.ok && c.severity === 'warn') };
}

/** Generate → validate → repair → re-validate. */
function buildValidatedPlan(){
  let { plan, unscheduled, ranked } = generatePlan();
  let validation = validatePlan(plan, ranked, unscheduled);
  let repairs = 0, guard = 0;

  while (validation.errors.length && guard++ < 5){
    const badIds = new Set();
    // Drop only the offending sessions, then re-place from the remaining queue
    for (const chk of validation.errors){
      if (chk.name.startsWith('No double')){
        const byDay = {};
        for (const s of plan) (byDay[s.day] ||= []).push(s);
        for (const list of Object.values(byDay)){
          list.sort((a,b) => a.start - b.start);
          for (let i = 1; i < list.length; i++)
            if (list[i].start < list[i-1].end) badIds.add(list[i].id);
        }
      }
      if (chk.name.startsWith('Every session fits'))
        plan.filter(s => !isFree(s.day, s.start, s.end)).forEach(s => badIds.add(s.id));
      if (chk.name.startsWith('Daily limit')){
        const byDay = {};
        for (const s of plan) (byDay[s.day] ||= []).push(s);
        for (const list of Object.values(byDay)){
          list.sort((a,b) => a.start - b.start);
          let acc = 0;
          for (const s of list){
            acc += s.end - s.start;
            if (acc > state.prefs.maxDailyMinutes) badIds.add(s.id);
          }
        }
      }
      if (chk.name.startsWith('Breaks') || chk.name.startsWith('Max ') && chk.name.includes('sessions')){
        const byDay = {};
        for (const s of plan) (byDay[s.day] ||= []).push(s);
        for (const list of Object.values(byDay)){
          list.sort((a,b) => a.start - b.start);
          for (let i = 1; i < list.length; i++)
            if (list[i].start - list[i-1].end < state.prefs.breakMinutes) badIds.add(list[i].id);
        }
      }
    }
    if (!badIds.size) break;
    repairs += badIds.size;
    plan = plan.filter(s => !badIds.has(s.id));
    validation = validatePlan(plan, ranked, unscheduled);
  }

  return { plan, validation, repairs, ranked, unscheduled };
}

/* ==========================================================================
   RENDER — STEP 1 : ACADEMICS
   ========================================================================== */
const acadBody = document.getElementById('acadBody');

function priColor(v){
  if (v >= 60) return 'linear-gradient(90deg,#f85149,#ff8a5c)';
  if (v >= 35) return 'linear-gradient(90deg,#d29922,#e3b341)';
  return 'linear-gradient(90deg,#2ea043,#3fb950)';
}

function renderAcademics(){
  acadBody.innerHTML = state.topics.map(t => `
    <tr data-id="${t.id}">
      <td><input value="${t.subject}" data-f="subject" style="width:118px"></td>
      <td><input value="${t.topic}"   data-f="topic"   style="width:170px"></td>
      <td><input type="number" min="0" max="100" value="${t.mastery}" data-f="mastery"></td>
      <td>
        <select data-f="difficulty">
          <option value="1"${t.difficulty==1?' selected':''}>Easy</option>
          <option value="2"${t.difficulty==2?' selected':''}>Medium</option>
          <option value="3"${t.difficulty==3?' selected':''}>Hard</option>
        </select>
      </td>
      <td><input type="number" min="0" max="90" value="${t.lastStudied}" data-f="lastStudied" title="days ago"></td>
      <td><input type="number" min="0" max="90" value="${t.examIn}" data-f="examIn" title="days from now"></td>
      <td><input type="number" min="0" max="90" value="${t.assignmentIn ?? ''}" data-f="assignmentIn" placeholder="—" title="days from now"></td>
      <td>
        <select data-f="prereqMet">
          <option value="true"${t.prereqMet?' selected':''}>Met</option>
          <option value="false"${!t.prereqMet?' selected':''}>Missing</option>
        </select>
      </td>
      <td><div class="pri" data-pri="${t.id}">
        <div class="bar"><i style="width:0%;background:${priColor(0)}"></i></div><b>0</b>
      </div></td>
    </tr>`).join('');
  updatePriorities();
}

acadBody.addEventListener('input', e => {
  const input = e.target.closest('[data-f]'); if (!input) return;
  const id = e.target.closest('tr').dataset.id;
  const t  = state.topics.find(x => x.id === id); if (!t) return;
  const f  = input.dataset.f;
  if (f === 'subject' || f === 'topic') t[f] = input.value;
  else if (f === 'prereqMet') t[f] = input.value === 'true';
  else if (f === 'assignmentIn') t[f] = input.value === '' ? null : clamp(Number(input.value), 0, 90);
  else t[f] = clamp(Number(input.value) || 0, 0, 100);
  updatePriorities();
});

document.getElementById('addTopic').addEventListener('click', () => {
  state.topics.push({
    id:'t' + Date.now(), subject:'New Subject', topic:'New Topic', mastery:50, difficulty:2,
    lastStudied:7, examIn:14, assignmentIn:null, prereqMet:true, boost:0
  });
  renderAcademics();
});

function updatePriorities(){
  const ranked = rankTopics();
  const map = Object.fromEntries(ranked.map(r => [r.id, r.score]));
  for (const t of state.topics){
    const cell = acadBody.querySelector(`[data-pri="${t.id}"]`);
    if (!cell) continue;
    const v = map[t.id] || 0;
    cell.querySelector('i').style.width = v + '%';
    cell.querySelector('i').style.background = priColor(v);
    cell.querySelector('b').textContent = v;
  }
  document.getElementById('topicCount').textContent = state.topics.length;
  const weekly = DAYS.reduce((s,d) => s + dayFreeMinutes(d), 0);
  document.getElementById('freeTotal').textContent = dur(weekly);
}

/* ==========================================================================
   RENDER — STEP 2 : AVAILABILITY
   ========================================================================== */
const availBody = document.getElementById('availBody');

function renderAvailability(){
  availBody.innerHTML = DAYS.map(day => `
    <div class="dayrow" data-day="${day}">
      <div class="dayname">${DAYNAME[day]}<small>${dur(dayFreeMinutes(day))} free</small></div>
      <div>
        <div class="blocks">
          ${(state.busy[day] || []).map((b,i) => `
            <div class="block" data-i="${i}">
              <input type="time" value="${b.start}" data-f="start">
              <span style="color:var(--muted)">–</span>
              <input type="time" value="${b.end}" data-f="end">
              <input value="${b.label}" data-f="label" placeholder="label" style="width:130px">
              <button class="x" data-rm="${i}">×</button>
            </div>`).join('')}
        </div>
        <button class="addblock" data-add="${day}">+ Add busy block</button>
      </div>
    </div>`).join('');
}

availBody.addEventListener('click', e => {
  const rm = e.target.closest('[data-rm]');
  const add = e.target.closest('[data-add]');
  if (rm){
    const day = e.target.closest('.dayrow').dataset.day;
    state.busy[day].splice(Number(rm.dataset.rm), 1);
    renderAvailability(); updatePriorities(); return;
  }
  if (add){
    const day = add.dataset.add;
    (state.busy[day] ||= []).push({start:'17:00', end:'18:00', label:'Busy'});
    renderAvailability(); updatePriorities();
  }
});

availBody.addEventListener('input', e => {
  const f = e.target.dataset.f; if (!f) return;
  const row = e.target.closest('.block');
  const day = e.target.closest('.dayrow').dataset.day;
  const b = state.busy[day][Number(row.dataset.i)];
  if (!b) return;
  b[f] = e.target.value;
  if (f === 'start' || f === 'end'){
    const small = e.target.closest('.dayrow').querySelector('small');
    small.textContent = dur(dayFreeMinutes(day)) + ' free';
  }
  updatePriorities();
});

/* ==========================================================================
   RENDER — STEP 3 : PREFERENCES
   ========================================================================== */
const P = {
  session:  document.getElementById('pSession'),
  brk:      document.getElementById('pBreak'),
  maxDaily: document.getElementById('pMaxDaily'),
  maxSess:  document.getElementById('pMaxSessions'),
  period:   document.getElementById('pPeriod'),
  weekend:  document.getElementById('pWeekend'),
  start:    document.getElementById('pStart'),
  end:      document.getElementById('pEnd')
};

function prefsFromUI(){
  state.prefs.sessionMinutes   = Number(P.session.value);
  state.prefs.breakMinutes     = Number(P.brk.value);
  state.prefs.maxDailyMinutes  = clamp(Number(P.maxDaily.value) || 180, 30, 600);
  state.prefs.maxSessionsPerDay= clamp(Number(P.maxSess.value) || 3, 1, 8);
  state.prefs.preferredPeriod  = P.period.value;
  state.prefs.weekendsAvailable= P.weekend.value === 'yes';
  state.prefs.dayStart         = P.start.value;
  state.prefs.dayEnd           = P.end.value;
}
function prefsToUI(){
  P.session.value   = state.prefs.sessionMinutes;
  P.brk.value       = state.prefs.breakMinutes;
  P.maxDaily.value  = state.prefs.maxDailyMinutes;
  P.maxSess.value   = state.prefs.maxSessionsPerDay;
  P.period.value    = state.prefs.preferredPeriod;
  P.weekend.value   = state.prefs.weekendsAvailable ? 'yes' : 'no';
  P.start.value     = state.prefs.dayStart;
  P.end.value       = state.prefs.dayEnd;
}
Object.values(P).forEach(el => el.addEventListener('change', () => { prefsFromUI(); renderAvailability(); updatePriorities(); }));

/* ==========================================================================
   RENDER — STEP 4 : PLAN
   ========================================================================== */
function renderPlan(){
  const plan = state.plan;
  const grid = document.getElementById('weekGrid');

  if (!plan.length){
    grid.innerHTML = '<p class="empty">No sessions could be scheduled. Add more free time in step 2, or lower your session length in step 3.</p>';
  } else {
    grid.innerHTML = DAYS.filter(d => plan.some(s => s.day === d)).map(day => `
      <div class="daycard">
        <h4>${DAYNAME[day]}</h4>
        ${plan.filter(s => s.day === day).map(s => `
          <div class="session" style="border-left-color:hsl(${subjHue(s.subject)} 70% 62%)"
               data-open="${s.topicId}" title="Open learning material">
            <div class="tm">${fmt12(toTime(s.start))} – ${fmt12(toTime(s.end))}</div>
            <div class="tt">${s.subject} · ${s.topic}</div>
            <div class="mt">
              <span class="chip" style="background:hsl(${subjHue(s.subject)} 45% 20%);color:hsl(${subjHue(s.subject)} 70% 72%)">${s.subject}</span>
              <span class="pill ${s.type.toLowerCase()}">${s.type}</span>
            </div>
          </div>`).join('')}
      </div>`).join('');
  }

  const total = plan.reduce((s,x) => s + (x.end - x.start), 0);
  document.getElementById('statSessions').textContent = plan.length;
  document.getElementById('statMinutes').textContent  = dur(total);
  document.getElementById('statTopics').textContent   = new Set(plan.map(s => s.topicId)).size;

  // validation report
  const v = state.validation;
  document.getElementById('checks').innerHTML = v.checks.map(c => {
    const cls = c.ok ? 'p' : (c.severity === 'warn' ? 'w' : 'f');
    const ico = c.ok ? '✓' : (c.severity === 'warn' ? '!' : '×');
    return `<div class="check">
      <div class="ic ${cls}">${ico}</div>
      <div><div>${c.name}</div><small>${c.detail}</small></div>
    </div>`;
  }).join('') + (state.repairs
    ? `<div class="check"><div class="ic w">↻</div><div><div>Auto-repaired</div>
       <small>${state.repairs} invalid session(s) were removed and re-placed before display</small></div></div>`
    : '');

  // ranking
  const ranked = rankTopics();
  document.getElementById('ranking').innerHTML = `
    <table><thead><tr><th>#</th><th>Topic</th><th>Priority</th><th>Why</th></tr></thead><tbody>
    ${ranked.map((r,i) => {
      const p = r.parts;
      const why = [];
      if (p.gap > .45) why.push('low mastery');
      if (p.urgency > .5) why.push(`exam in ${r.examIn}d`);
      if (p.assign > 0) why.push(`assignment in ${r.assignmentIn}d`);
      if (p.forget > .6) why.push(`${r.lastStudied}d since last study`);
      if (p.diff > .6) why.push('high difficulty');
      if (!r.prereqMet) why.push('⚠ prerequisites missing (deprioritised)');
      return `<tr>
        <td style="color:var(--muted)">${i+1}</td>
        <td><b>${r.subject}</b> · ${r.topic}</td>
        <td><div class="pri"><div class="bar"><i style="width:${r.score}%;background:${priColor(r.score)}"></i></div><b>${r.score}</b></div></td>
        <td style="color:var(--muted);font-size:12.5px">${why.join(' · ') || 'maintenance'}</td>
      </tr>`;
    }).join('')}
    </tbody></table>`;
}

document.getElementById('weekGrid').addEventListener('click', e => {
  const el = e.target.closest('[data-open]'); if (!el) return;
  const t = state.topics.find(x => x.id === el.dataset.open);
  if (t) toast(`→ Opens learning content: ${t.subject} · ${t.topic}`);
});

/* ==========================================================================
   ORCHESTRATION
   ========================================================================== */
function goStep(n){
  document.querySelectorAll('nav.steps button').forEach(b => {
    b.classList.toggle('on', Number(b.dataset.step) === n);
    b.classList.toggle('done', Number(b.dataset.step) < n);
  });
  document.querySelectorAll('[data-panel]').forEach(p =>
    p.classList.toggle('hide', Number(p.dataset.panel) !== n));
  window.scrollTo({ top:0, behavior:'smooth' });
}
document.getElementById('steps').addEventListener('click', e => {
  const b = e.target.closest('button'); if (b) goStep(Number(b.dataset.step));
});

function runPlanner(){
  prefsFromUI();
  state.version++;
  const { plan, validation, repairs } = buildValidatedPlan();
  state.plan = plan;
  state.validation = validation;
  state.repairs = repairs;
  state.accepted = false;
  renderPlan();
  document.getElementById('planSub').textContent =
    `${plan.length} sessions across ${new Set(plan.map(s => s.day)).size} days · generated from your priorities and free time.`;
  goStep(3);
  if (repairs) toast(`Plan repaired automatically (${repairs} fix${repairs>1?'es':''})`);
}

document.getElementById('genBtn1').addEventListener('click', runPlanner);
document.getElementById('regenBtn').addEventListener('click', () => { runPlanner(); toast('New plan generated'); });
document.getElementById('backBtn').addEventListener('click', () => goStep(1));
document.getElementById('acceptBtn').addEventListener('click', () => {
  state.accepted = true;
  toast('✓ Plan accepted — next: connect sessions to lessons & track results');
});

/* ==========================================================================
   PHASE 7 — NATURAL-LANGUAGE MODIFICATION
   ========================================================================== */
const DAY_RE = Object.keys(ALIAS).join('|');

function interpretCommand(text){
  const raw = text.trim();
  const t = raw.toLowerCase();
  if (!t) return null;

  const dayMatch = t.match(new RegExp(`\\b(${DAY_RE})\\b`));
  const day = dayMatch ? ALIAS[dayMatch[1]] : null;

  const subjects = [...new Set(state.topics.map(x => x.subject))];
  const topics   = state.topics.map(x => x.topic.toLowerCase());
  const findSubject = txt => subjects.find(s => txt.includes(s.toLowerCase()));
  const findTopic   = txt => state.topics.find(x => txt.includes(x.topic.toLowerCase()));

  // --- regenerate
  if (/^(regenerate|redo|new plan|try again|reshuffle)/.test(t))
    return { type:'regenerate', msg:'Regenerating plan…' };

  // --- more / less of a subject
  let m = t.match(/\b(more|less|prioritise|prioritize|deprioritise|deprioritize|increase|reduce|drop)\b\s*(?:of|for|on)?\s*(.+)/);
  if (m){
    const subj = findSubject(m[2]) || findSubject(t);
    const topic = findTopic(t);
    if (subj || topic){
      const up = /more|prioriti[sz]e|increase/.test(m[1]);
      const targets = topic ? [topic] : state.topics.filter(x => x.subject === subj);
      targets.forEach(x => x.boost = clamp((x.boost || 0) + (up ? 25 : -25), -50, 50));
      return { type:'boost', msg:`${up ? 'Prioritising' : 'Deprioritising'} ${topic ? topic.topic : subj}` };
    }
  }

  // --- move X to <day>
  m = t.match(/\bmove\s+(.+?)\s+to\s+(?:the\s+)?(\w+)/);
  if (m){
    const target = m[2].length >= 3 ? ALIAS[m[2].slice(0,3)] || ALIAS[m[2]] : null;
    const subj = findSubject(m[1]);
    const topic = findTopic(m[1]);
    if (target){
      if (topic) state.pins[topic.subject] = target;
      else if (subj) state.pins[subj] = target;
      else return { type:'unknown', msg:`I don't recognise "${m[1].trim()}"` };
      return { type:'move', msg:`Moving ${topic ? topic.topic : subj} to ${DAYNAME[target]}` };
    }
  }

  // --- don't study on <day>
  if (day && /\b(don'?t|do not|no|can'?t|cannot|won'?t|skip|off|free)\b/.test(t) &&
      /\b(study|studying|work|anything|session|sessions|plan)\b/.test(t)){
    state.busy[day] = [{ start: state.prefs.dayStart, end: state.prefs.dayEnd, label:'Unavailable' }];
    return { type:'block-day', msg:`Marked ${DAYNAME[day]} as unavailable` };
  }
  // --- "no Wednesday" (short form)
  if (day && /^(no|not|skip)\s+\w+$/.test(t)){
    state.busy[day] = [{ start: state.prefs.dayStart, end: state.prefs.dayEnd, label:'Unavailable' }];
    return { type:'block-day', msg:`Marked ${DAYNAME[day]} as unavailable` };
  }

  // --- only / not before <time>
  m = t.match(/\b(?:only|not before|can'?t before|start(?:ing)? (?:at|after)|after)\b.*?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (m){
    let h = Number(m[1]); const min = Number(m[2] || 0); const ap = m[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (!ap && h <= 7) h += 12;                   // "after 7" → 7 PM
    if (h >= 0 && h < 24){
      state.prefs.dayStart = toTime(h*60 + min);
      prefsToUI();
      return { type:'time-start', msg:`Earliest study time set to ${fmt12(state.prefs.dayStart)}` };
    }
  }

  // --- not after / before <time>
  m = t.match(/\b(?:not after|finish by|before|until|no later than|by)\b.*?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (m){
    let h = Number(m[1]); const min = Number(m[2] || 0); const ap = m[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (!ap && h <= 7) h += 12;
    if (h >= 0 && h < 24){
      state.prefs.dayEnd = toTime(h*60 + min);
      prefsToUI();
      return { type:'time-end', msg:`Latest study time set to ${fmt12(state.prefs.dayEnd)}` };
    }
  }

  // --- max N hours/minutes a day
  m = t.match(/\bmax(?:imum)?\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(hour|hours|hr|hrs|h|minute|minutes|min|mins|m)\b/);
  if (m && /\b(day|daily|per day|a day)\b/.test(t)){
    const n = Number(m[1]);
    const mins = /^h/.test(m[2]) ? n*60 : n;
    state.prefs.maxDailyMinutes = clamp(Math.round(mins), 30, 600);
    prefsToUI();
    return { type:'daily-max', msg:`Daily study limit set to ${dur(state.prefs.maxDailyMinutes)}` };
  }

  // --- session duration
  m = t.match(/\b(\d+)\s*(?:min|minute|minutes)\b/);
  if (m){
    const n = Number(m[1]);
    if (n >= 15 && n <= 180 && /\b(session|sessions|block|blocks|each|per)\b/.test(t)){
      state.prefs.sessionMinutes = n;
      prefsToUI();
      return { type:'session-len', msg:`Session length set to ${n} minutes` };
    }
  }

  // --- weekends
  if (/\bweekend/.test(t)){
    const off = /\b(no|not|off|unavailable|don'?t|without|free of)\b/.test(t);
    state.prefs.weekendsAvailable = !off;
    prefsToUI();
    return { type:'weekend', msg:`Weekends are now ${off ? 'unavailable' : 'available'}` };
  }

  // --- preferred period
  if (/\b(morning|mornings)\b/.test(t))  { state.prefs.preferredPeriod = 'morning';   prefsToUI(); return {type:'period', msg:'Preferring mornings'}; }
  if (/\bafternoon/.test(t))             { state.prefs.preferredPeriod = 'afternoon'; prefsToUI(); return {type:'period', msg:'Preferring afternoons'}; }
  if (/\b(evening|evenings|night)\b/.test(t)){ state.prefs.preferredPeriod = 'evening'; prefsToUI(); return {type:'period', msg:'Preferring evenings'}; }

  return { type:'unknown', msg:`I didn't understand "${raw}". Try: "move Maths to Saturday", "no Wednesday", "45 minute sessions".` };
}

document.getElementById('cmdBtn').addEventListener('click', applyCommand);
document.getElementById('cmdInput').addEventListener('keydown', e => { if (e.key === 'Enter') applyCommand(); });

function applyCommand(){
  const input = document.getElementById('cmdInput');
  const text = input.value;
  if (!text.trim()) return;

  const result = interpretCommand(text);
  if (!result) return;

  toast(result.msg);
  if (result.type === 'unknown') return;

  input.value = '';
  if (result.type === 'regenerate'){ runPlanner(); return; }
  runPlanner();   // every other change re-plans + re-validates
}

/* ==========================================================================
   OPTIONAL LLM HOOK
   ------------------------------------------------------------------
   window.AIPlanner.parseCommand = async (text, ctx) => ({type, msg})
   window.AIPlanner.generatePlan = async (ctx) => planArray
   Return null to fall back to the built-in engines.
   ========================================================================== */
window.AIPlanner = window.AIPlanner || {};

/* ==========================================================================
   INIT
   ========================================================================== */
seedState();
renderAcademics();
renderAvailability();
prefsToUI();
goStep(0);