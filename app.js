/* Inglés Práctico — app de estudio (sin servidor). Todo se guarda en este dispositivo. */
'use strict';
const VERSION = '1.0.0';
const APP = document.getElementById('app');
const NAV = document.getElementById('nav');

/* ================= utilidades ================= */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a, n) => shuffle(a).slice(0, n);
const today = () => dstr(new Date());
function dstr(d) { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
function parseD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function weekStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); return x; }
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fmtDate = s => { const d = parseD(s); return `${d.getDate()} de ${MONTHS[d.getMonth()]}`; };
const fmtDur = sec => { sec = Math.round(sec || 0); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600); }
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20"/></svg>',
  cards: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="14" height="14" rx="3"/><path d="M7 3h11a3 3 0 0 1 3 3v11"/></svg>',
  target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/></svg>',
  person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  exam: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 5l7 7-7 7"/></svg>',
};
const LOGO = `<img class="logo" src="icons/logo.png" alt="EP">`;

/* ================= estado ================= */
const KEY = 'ipd_state_v1';
const DEFAULT = () => ({
  v: 1, profile: { setupDone: false }, settings: { rate: 1, voice: '', freeMode: false },
  modules: {}, exams: {}, srs: {}, mastered: {}, log: [], recs: [], created: today(),
});
let S;
try { S = Object.assign(DEFAULT(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { S = DEFAULT(); }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('No se pudo guardar el progreso'); } }
const MS = n => (S.modules[n] = S.modules[n] || { lesson: false, blocks: 0, practice: 0, pres: false, exam: [], cando: {} });
function logAct(t, m, ok, tot, sec) { S.log.push({ d: today(), t, m, ok: ok || 0, tot: tot || 0, s: Math.round(sec || 0) }); save(); }

/* ================= audio guardado (IndexedDB) ================= */
const IDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('ipd_audio', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('a');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('a', mode); const st = t.objectStore('a'); const r = fn(st); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); },
  put(id, blob) { return this.tx('readwrite', s => s.put(blob, id)); },
  get(id) { return this.tx('readonly', s => s.get(id)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
};

/* ================= voz en inglés (gratis, del dispositivo) ================= */
const TTS = {
  ok: 'speechSynthesis' in window, voices: [],
  load() {
    if (!this.ok) return;
    const all = speechSynthesis.getVoices();
    this.voices = all.filter(v => /^en[-_]US/i.test(v.lang));
    if (!this.voices.length) this.voices = all.filter(v => /^en/i.test(v.lang));
  },
  voice() {
    if (!this.voices.length) this.load();
    const want = S.settings.voice;
    let v = this.voices.find(x => x.voiceURI === want);
    if (!v) {
      const pref = [/aria.*natural/i, /jenny.*natural/i, /guy.*natural/i, /natural/i, /samantha/i, /ava/i, /google us english/i, /zira/i, /alex/i];
      for (const p of pref) { v = this.voices.find(x => p.test(x.name)); if (v) break; }
    }
    return v || this.voices[0] || null;
  },
  say(text, slow) {
    if (!this.ok) { toast('Este navegador no tiene voz en inglés'); return; }
    const t = String(text).replace(/\*\*/g, '').replace(/\[\d+\]/g, ' blank ').replace(/_{2,}/g, ' blank ');
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    const v = this.voice(); if (v) u.voice = v;
    u.lang = 'en-US';
    u.rate = (slow ? 0.7 : 0.95) * (S.settings.rate || 1);
    speechSynthesis.speak(u);
  },
  sayList(list) { if (!this.ok) return; speechSynthesis.cancel(); const v = this.voice(); list.forEach(t => { const u = new SpeechSynthesisUtterance(String(t).replace(/\*\*/g, '')); if (v) u.voice = v; u.lang = 'en-US'; u.rate = 0.95 * (S.settings.rate || 1); speechSynthesis.speak(u); }); },
};
if (TTS.ok) { TTS.load(); speechSynthesis.onvoiceschanged = () => TTS.load(); }

/* ================= reconocimiento de voz + grabadora ================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function listenOnce(onText, onDone) {
  if (!SR) { onDone(null); return null; }
  const r = new SR(); r.lang = 'en-US'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  let final = '', got = false;
  r.onresult = e => { let t = ''; for (const res of e.results) t += res[0].transcript; final = t; got = true; onText(t); };
  r.onerror = () => { };
  r.onend = () => onDone(got ? final : '');
  try { r.start(); } catch (e) { onDone(null); return null; }
  return r;
}
async function startRecorder(onText) {
  if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('norec');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  const mimeType = types.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = []; rec.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
  rec.start(1000);
  const t0 = Date.now();
  let active = true, finals = '', interim = '', recog = null;
  const startRecog = () => {
    if (!SR || !active) return;
    try {
      recog = new SR(); recog.lang = 'en-US'; recog.continuous = true; recog.interimResults = true;
      recog.onresult = e => { interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const tr = e.results[i][0].transcript; if (e.results[i].isFinal) finals += ' ' + tr; else interim += ' ' + tr; } onText((finals + ' ' + interim).trim()); };
      recog.onerror = () => { };
      recog.onend = () => { if (active) setTimeout(startRecog, 250); };
      recog.start();
    } catch (e) { recog = null; }
  };
  startRecog();
  return {
    stop() {
      active = false;
      try { recog && recog.stop(); } catch (e) { }
      return new Promise(res => {
        rec.onstop = () => {
          stream.getTracks().forEach(t => t.stop());
          const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
          setTimeout(() => res({ blob, dur: (Date.now() - t0) / 1000, transcript: (finals + ' ' + interim).trim() }), 400);
        };
        try { rec.stop(); } catch (e) { res({ blob: new Blob(chunks), dur: (Date.now() - t0) / 1000, transcript: finals.trim() }); }
      });
    },
  };
}

/* ================= comparar respuestas ================= */
function norm(s) {
  s = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`´]/g, "'");
  s = s.replace(/\bwon't\b/g, 'will not').replace(/\bcan't\b/g, 'can not').replace(/\bcannot\b/g, 'can not').replace(/\bshan't\b/g, 'shall not')
    .replace(/\b(\w+)n't\b/g, '$1 not').replace(/\bi'm\b/g, 'i am').replace(/\b(you|we|they|who|what)'re\b/g, '$1 are')
    .replace(/\b(he|she|it|that|there|here|what|where|who|how|when|why|everything|nothing|this)'s\b/g, '$1 is')
    .replace(/\b(\w+)'ve\b/g, '$1 have').replace(/\b(\w+)'ll\b/g, '$1 will').replace(/\b(i|you|he|she|it|we|they|that|there)'d\b/g, '$1 would')
    .replace(/\bgonna\b/g, 'going to').replace(/\bwanna\b/g, 'want to');
  return s.replace(/[^a-z0-9ñ]+/g, ' ').trim();
}
function variants(ans) {
  const out = new Set();
  for (const a of ans) {
    out.add(a);
    if (/\(.*?\)/.test(a)) { out.add(a.replace(/\s*\(.*?\)\s*/g, ' ')); out.add(a.replace(/[()]/g, '')); }
    a.split(/\s+\/\s+/).forEach(x => x.trim() && out.add(x));
  }
  return [...out];
}
function lev(a, b) {
  if (a === b) return 0; const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
function grade(user, answers) {
  const u = norm(user); if (!u) return 'no';
  const vs = variants(answers).map(norm);
  if (vs.includes(u)) return 'ok';
  for (const v of vs) { const tol = Math.max(1, Math.floor(v.length * 0.05)); if (lev(u, v) <= tol) return 'close'; }
  return 'no';
}
function wordCoverage(target, spoken) {
  const t = norm(target).split(' ').filter(Boolean), s = norm(spoken).split(' ').filter(Boolean);
  if (!t.length) return 0;
  const bag = {}; s.forEach(w => bag[w] = (bag[w] || 0) + 1);
  let hit = 0; t.forEach(w => { if (bag[w]) { hit++; bag[w]--; } });
  return hit / t.length;
}

/* ================= datos ================= */
const DATA = { catalog: null, mods: {}, pres: {}, exams: {} };
async function getJSON(p) { const r = await fetch(p, { cache: 'no-cache' }); if (!r.ok) throw new Error(p); return r.json(); }
async function mod(n) { if (!DATA.mods[n]) DATA.mods[n] = await getJSON(`data/modules/m${String(n).padStart(2, '0')}.json`); return DATA.mods[n]; }
async function pres(n) { if (!DATA.pres[n]) DATA.pres[n] = await getJSON(`data/pres/p${String(n).padStart(2, '0')}.json`); return DATA.pres[n]; }
async function bigExam(id) { if (!DATA.exams[id]) DATA.exams[id] = await getJSON(`data/exams/exam_${id}.json`); return DATA.exams[id]; }
const levelOf = n => n <= 12 ? 'A' : n <= 26 ? 'B' : 'C';
const EXAM_AFTER = { A: 12, B: 26, C: 36 };
const LEVEL_NAME = { A: 'Nivel A1–A2', B: 'Nivel B1–B2', C: 'Nivel C1' };

/* ================= reglas de avance ================= */
const examBest = n => Math.max(0, ...(MS(n).exam || []).map(e => e.score));
const passed = n => examBest(n) >= 32;
const bigBest = id => Math.max(0, ...((S.exams[id] || {}).hist || []).map(e => e.score));
const bigPassed = id => bigBest(id) >= 80;
function unlocked(n) {
  if (S.settings.freeMode || n === 1) return true;
  if (n === 13) return bigPassed('A');
  if (n === 27) return bigPassed('B');
  return passed(n - 1);
}
const bigUnlocked = id => S.settings.freeMode || passed(EXAM_AFTER[id]);
function currentModule() { for (let n = 1; n <= 36; n++) { if (!passed(n)) return unlocked(n) ? n : n - 1 || 1; if (EXAM_AFTER[levelOf(n)] === n && !bigPassed(levelOf(n))) return n; } return 36; }

/* ================= perfil y plantillas ================= */
const GOALS = {
  abroad: ['to work abroad', 'working abroad', 'Trabajar en el extranjero'],
  better: ['to get a better job', 'getting a better job', 'Conseguir un mejor trabajo'],
  clients: ['to talk with international clients', 'talking with international clients', 'Hablar con clientes internacionales'],
  travel: ['to travel', 'traveling', 'Viajar'],
  study: ['to study abroad', 'studying abroad', 'Estudiar en el extranjero'],
};
const EDWIN = { name: 'Edwin', city: 'Talara', region: 'Piura', country: 'Peru', profession: 'industrial engineer', profession_es: 'ingeniero industrial', jobTitle: 'mechanical and piping design engineer', jobTitle_es: 'ingeniero de diseño mecánico y piping', company: 'QSL', companyPlace: 'Freeport, The Bahamas', work: 'tanks, pipes, structures and supports', work_es: 'tanques, tuberías, estructuras y soportes', project: 'the T8076 tank repair', project_es: 'la reparación del tanque T8076', tool: 'Excel', startDate: 'September 2025', prevJob: 'MSH Chile', prevPlace: 'Antofagasta, Chile', school: 'UPAO', gradYear: '2026', dreamCountry: 'Australia', goal: 'abroad' };
const art = s => (/^[aeiou]/i.test(s || '') ? 'an ' : 'a ') + (s || '');
function fields() {
  const p = S.profile, g = GOALS[p.goal] || GOALS.abroad;
  const f = Object.assign({}, p, { a_profession: art(p.profession), a_jobTitle: art(p.jobTitle), goal_to: g[0], goal_ing: g[1], coworker: 'Sarah' });
  ['profession', 'jobTitle', 'work', 'project'].forEach(k => { if (!f[k + '_es']) f[k + '_es'] = f[k] || ''; });
  return f;
}
function fill(t) { const f = fields(); return String(t || '').replace(/\{(\w+)\}/g, (m, k) => f[k] != null && f[k] !== '' ? f[k] : '____'); }
const fillHTML = t => esc(fill(t)).replace(/\*\*(.+?)\*\*/g, '<mark>$1</mark>');

/* ================= SRS (repaso espaciado) ================= */
const BOX_DAYS = [0, 0, 1, 3, 7, 16];
function srsMark(id, ok) {
  const it = S.srs[id] || { b: 1, due: today() };
  it.b = ok ? Math.min(5, it.b + 1) : 1;
  const d = new Date(); d.setDate(d.getDate() + BOX_DAYS[it.b]); it.due = dstr(d);
  S.srs[id] = it;
  if (ok && it.b >= 3 && id.startsWith('b:') && !S.mastered[id]) S.mastered[id] = today();
}
const dueIds = () => Object.entries(S.srs).filter(([, v]) => v.due <= today()).map(([k]) => k);

/* ================= router ================= */
let CLEANUP = null;
function route() {
  if (CLEANUP) { try { CLEANUP(); } catch (e) { } CLEANUP = null; }
  if (TTS.ok) speechSynthesis.cancel();
  const h = location.hash.replace(/^#\/?/, '') || 'home';
  const [a, b, c] = h.split('/');
  if (!S.profile.setupDone && a !== 'setup') { location.hash = '#/setup'; return; }
  const tab = { home: 'home', practice: 'practice', voice: 'voice', progress: 'progress' }[a] || (a === 'm' || a === 'x' ? 'home' : '');
  NAV.classList.toggle('hidden', a === 'setup' || a === 'run');
  NAV.querySelectorAll('a').forEach(el => el.classList.toggle('on', el.dataset.tab === tab));
  window.scrollTo(0, 0);
  const R = { setup: viewSetup, home: viewHome, practice: viewPractice, voice: viewVoice, progress: viewProgress, m: () => viewModule(+b, c), x: () => viewBigExam(b), profile: viewProfileEdit };
  (R[a] || viewHome)().catch(err => { console.error(err); APP.innerHTML = `<div class="card"><h2>No se pudo cargar</h2><p class="muted">${esc(err.message)}</p><a class="btn" href="#/home">Volver al inicio</a></div>`; });
}
window.addEventListener('hashchange', route);
const backBtn = (href, label = 'Volver') => `<a class="back" href="${href}">${ICON.back}${label}</a>`;

/* ================= SETUP / PERFIL ================= */
const PFORM = [
  { step: 1, title: 'Empecemos por ti', sub: 'Con tus respuestas armamos tus presentaciones en inglés. Escribe en inglés cuando se pide.', fields: [
    ['name', 'Tu nombre', 'Edwin'], ['city', 'Tu ciudad', 'Talara'], ['region', 'Tu región o provincia', 'Piura'], ['country', 'Tu país (en inglés)', 'Peru']] },
  { step: 2, title: 'Tu trabajo', sub: 'Escribe en inglés. Si no sabes cómo, escríbelo lo mejor que puedas y luego lo cambias.', fields: [
    ['profession', 'Tu profesión (en inglés)', 'industrial engineer'], ['profession_es', 'Tu profesión en español', 'ingeniero industrial'],
    ['jobTitle', 'Tu puesto actual (en inglés)', 'mechanical design engineer'], ['jobTitle_es', 'Tu puesto en español', 'ingeniero de diseño mecánico'],
    ['company', 'Nombre de tu empresa', 'QSL'], ['companyPlace', 'Dónde está tu empresa', 'Freeport, The Bahamas'],
    ['work', '¿Con qué trabajas? (en inglés, sin verbos)', 'tanks, pipes and supports'], ['work_es', 'Lo mismo en español', 'tanques, tuberías y soportes'],
    ['tool', 'El programa de computadora que más usas', 'Excel, AutoCAD, SAP…']] },
  { step: 3, title: 'Tu historia y tus metas', sub: 'Casi listo. Esto hace que tus frases suenen a ti.', fields: [
    ['project', 'Tu proyecto actual (en inglés, empieza con "the")', 'the T8076 tank repair'], ['project_es', 'Tu proyecto en español', 'la reparación del tanque T8076'],
    ['startDate', '¿Desde cuándo trabajas ahí? (mes y año en inglés)', 'September 2025'],
    ['prevJob', 'Tu trabajo o empresa anterior', 'MSH Chile'], ['prevPlace', 'Dónde era', 'Antofagasta, Chile'],
    ['school', 'Dónde estudiaste', 'UPAO'], ['gradYear', 'Año en que te graduaste', '2026'],
    ['dreamCountry', 'Un país donde te gustaría trabajar (en inglés)', 'Australia'], ['goal', '¿Para qué quieres el inglés?', '', 'goal']] },
];
const REQUIRED = ['name', 'city', 'country', 'profession', 'jobTitle', 'company', 'work', 'project', 'startDate', 'dreamCountry'];
function profileForm(step, data) {
  const st = PFORM[step - 1];
  return `<div class="form">${st.fields.map(([k, label, ph, type]) => type === 'goal'
    ? `<label>${label}</label><select class="field" data-k="${k}">${Object.entries(GOALS).map(([gk, g]) => `<option value="${gk}" ${data[k] === gk ? 'selected' : ''}>${g[2]}</option>`).join('')}</select>`
    : `<label>${label}${REQUIRED.includes(k) ? '' : ' <span class="help">(opcional)</span>'}</label><input class="field" data-k="${k}" value="${esc(data[k] || '')}" placeholder="Ej.: ${esc(ph)}" autocomplete="off" autocapitalize="${/^(name|city|region|country|company|school|prevJob|prevPlace|companyPlace|dreamCountry|startDate)$/.test(k) ? 'words' : 'off'}">`).join('')}</div>`;
}
function readForm(data) { APP.querySelectorAll('[data-k]').forEach(el => data[el.dataset.k] = el.value.trim()); }
async function viewSetup() {
  const params = new URLSearchParams(location.search);
  let data = Object.assign({}, S.profile);
  if (params.get('perfil') === 'edwin' && !data.name) data = Object.assign({}, EDWIN);
  if (!data.goal) data.goal = 'abroad';
  let step = 0;
  const draw = () => {
    if (step === 0) {
      APP.innerHTML = `<div class="top"><div><h1>Inglés Práctico</h1><div class="sub">Habla inglés de verdad, 10 minutos al día</div></div>${LOGO}</div>
      <div class="card"><h2>Bienvenido</h2><p class="muted">36 módulos del nivel A1 al C1, práctica diaria con audio, exámenes y tu propia voz grabada para ver cómo mejoras semana a semana.</p>
      <p class="muted small">Todo se guarda en este dispositivo. Sin cuentas y sin costo.</p>
      <div class="btns"><button class="btn" id="go">Crear mi perfil</button></div></div>`;
      APP.querySelector('#go').onclick = () => { step = 1; draw(); };
      return;
    }
    const st = PFORM[step - 1];
    APP.innerHTML = `<div class="top"><div><div class="sub">Paso ${step} de 3</div><h1>${st.title}</h1></div>${LOGO}</div>
      <div class="pbar" style="margin-bottom:14px"><i style="width:${step * 33.3}%"></i></div>
      <div class="card"><p class="muted small" style="margin-top:0">${st.sub}</p>${profileForm(step, data)}</div>
      <div class="btns two"><button class="btn sec" id="prev">Atrás</button><button class="btn" id="next">${step === 3 ? 'Terminar' : 'Siguiente'}</button></div>`;
    APP.querySelector('#prev').onclick = () => { readForm(data); step--; draw(); };
    APP.querySelector('#next').onclick = () => {
      readForm(data);
      const miss = st.fields.map(f => f[0]).filter(k => REQUIRED.includes(k) && !data[k]);
      if (miss.length) { toast('Completa los campos que no dicen "opcional"'); return; }
      if (step < 3) { step++; draw(); window.scrollTo(0, 0); return; }
      if (data.project && !/^(the|my|a|an|our)\s/i.test(data.project)) data.project = 'the ' + data.project;
      S.profile = Object.assign({}, data, { setupDone: true }); save();
      toast(`Listo, ${data.name}. ¡A empezar!`); location.hash = '#/home';
    };
  };
  draw();
}
async function viewProfileEdit() {
  const data = Object.assign({}, S.profile);
  APP.innerHTML = `${backBtn('#/progress')}<div class="top"><div><h1>Mi perfil</h1><div class="sub">Tus presentaciones se arman con estos datos</div></div></div>
    ${[1, 2, 3].map(s => `<div class="card"><h3>${PFORM[s - 1].title}</h3>${profileForm(s, data)}</div>`).join('')}
    <div class="btns"><button class="btn" id="sv">Guardar</button></div>`;
  APP.querySelector('#sv').onclick = () => { readForm(data); S.profile = Object.assign(S.profile, data); save(); toast('Perfil guardado'); location.hash = '#/progress'; };
}

/* ================= INICIO ================= */
function streak() {
  const days = new Set(S.log.map(l => l.d)); let n = 0; const d = new Date();
  if (!days.has(dstr(d))) d.setDate(d.getDate() - 1);
  while (days.has(dstr(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function weekStats(offset = 0) {
  const ws = weekStart(new Date()); ws.setDate(ws.getDate() - 7 * offset); const we = new Date(ws); we.setDate(we.getDate() + 7);
  const inW = l => { const d = parseD(l.d); return d >= ws && d < we; };
  const L = S.log.filter(inW);
  const ok = L.reduce((a, l) => a + l.ok, 0), tot = L.reduce((a, l) => a + l.tot, 0);
  return {
    min: Math.round(L.reduce((a, l) => a + l.s, 0) / 60), days: new Set(L.map(l => l.d)).size,
    acc: tot ? Math.round(100 * ok / tot) : null, words: Object.values(S.mastered).filter(d => inW({ d })).length,
    recs: S.recs.filter(r => inW({ d: r.d })).length, passedEx: L.filter(l => l.t === 'exam' && l.ok >= 32).length,
  };
}
async function viewHome() {
  const cat = DATA.catalog, cur = currentModule(), w = weekStats();
  const p = S.profile;
  const hr = new Date().getHours(), hi = hr < 12 ? 'Buenos días' : hr < 19 ? 'Buenas tardes' : 'Buenas noches';
  const curT = cat.modules[cur - 1];
  const ms = MS(cur);
  const next = !ms.lesson ? ['Aprende', 'lesson'] : !ms.pres ? ['Tu presentación', 'pres'] : !passed(cur) ? ['Examen del módulo', 'exam'] : ['Práctica', 'practice'];
  let path = '';
  for (const L of ['A', 'B', 'C']) {
    path += `<div class="level lv-${L}"><span class="pill">${L === 'A' ? 'A1–A2' : L === 'B' ? 'B1–B2' : 'C1'}</span>${LEVEL_NAME[L].replace('Nivel ', '') === '' ? '' : ''}</div>`;
    cat.modules.filter(m => levelOf(m.id) === L).forEach(m => {
      const u = unlocked(m.id), done = passed(m.id), now = m.id === cur && !done;
      path += `<div class="mod ${done ? 'done' : now ? 'now' : u ? '' : 'lock'}" ${u ? `data-go="#/m/${m.id}"` : ''}><span class="dot">${m.id}</span><span class="t">${esc(m.title)}</span><span class="meta">${done ? examBest(m.id) + '/40' : now ? 'en curso' : u ? '' : 'bloqueado'}</span></div>`;
    });
    const ex = cat.exams.find(e => e.id === L); const eu = bigUnlocked(L), ed = bigPassed(L);
    path += `<div class="mod exam ${ed ? 'done' : eu ? '' : 'lock'}" ${eu ? `data-go="#/x/${L}"` : ''}><span class="dot">${ICON.exam.replace('<svg', '<svg width="18" height="18" fill="none" stroke="#fff" stroke-width="2"')}</span><span class="t">${esc(ex.title)}</span><span class="meta">${ed ? bigBest(L) + '/100' : eu ? 'disponible' : 'bloqueado'}</span></div>`;
  }
  APP.innerHTML = `<div class="top"><div><h1>${hi}, ${esc(p.name)}</h1><div class="sub">${LEVEL_NAME[levelOf(cur)]} · Módulo ${cur}</div></div>${LOGO}</div>
    <div class="stats"><div class="stat s-orange"><b>${streak()}</b><span>${streak() === 1 ? 'día seguido' : 'días seguidos'}</span></div><div class="stat s-teal"><b>${Object.keys(S.mastered).length}</b><span>frases dominadas</span></div><div class="stat s-purple"><b>${w.min}</b><span>min esta semana</span></div></div>
    <div class="card accent"><h2>Sesión de hoy · 10 min</h2><p class="muted small" style="margin:0 0 12px">Escuchar, armar frases, corregir errores y hablar. Incluye repaso de lo que fallaste.</p>
      <a class="btn" href="#/practice?go=1">Empezar sesión</a>
      <a class="btn sec" style="margin-top:10px" href="#/m/${cur}/${next[1]}">Módulo ${cur}: ${esc(next[0])}</a></div>
    ${path}`;
  APP.querySelectorAll('[data-go]').forEach(el => el.onclick = () => location.hash = el.dataset.go);
}

/* ================= MÓDULO ================= */
async function viewModule(n, sub) {
  if (!unlocked(n)) { toast('Aprueba el examen anterior para desbloquearlo'); location.hash = '#/home'; return; }
  const m = await mod(n);
  if (sub === 'lesson') return runLesson(n, m);
  if (sub === 'blocks') return runBlocks(n, m);
  if (sub === 'practice') return runQueue(moduleQueue(n, m, 12), { title: `Práctica · Módulo ${n}`, back: `#/m/${n}`, kind: 'practice', m: n });
  if (sub === 'pres') return runPres(n, m);
  if (sub === 'exam') return runModExam(n, m);
  if (sub === 'cando') return runCando(n, m);
  const ms = MS(n), best = examBest(n);
  const steps = [
    ['lesson', ICON.book, 'Aprende', `${m.lesson.length} tarjetas + errores típicos`, ms.lesson],
    ['blocks', ICON.cards, 'Frases clave', `${m.blocks.length} frases con audio`, ms.blocks >= 15],
    ['practice', ICON.target, 'Práctica', 'Escuchar, armar, corregir y hablar', ms.practice > 0],
    ['pres', ICON.person, 'Mi presentación', 'Habla de ti con este tema y grábate', ms.pres],
    ['exam', ICON.exam, 'Examen', best ? `Mejor nota: ${best}/40 · apruebas con 32` : '40 puntos · apruebas con 32', passed(n)],
    ['cando', ICON.list, 'Ya puedo…', `${Object.values(ms.cando).filter(Boolean).length} de ${m.cando.length} logrados`, Object.values(ms.cando).filter(Boolean).length === m.cando.length],
  ];
  APP.innerHTML = `${backBtn('#/home', 'Inicio')}<div class="top"><div><div class="sub">${m.level} · Módulo ${n}</div><h1>${esc(m.title)}</h1></div></div>
    <p class="muted" style="margin-top:-6px">${esc(m.goal)}</p>
    <div class="steps">${steps.map(([k, ic, t, d, ok]) => `<a class="step ${ok ? 'ok' : ''}" href="#/m/${n}/${k}"><span class="n">${ok ? ICON.check : ic}</span><div><b>${t}</b><span>${d}</span></div><span class="go">${ICON.chev}</span></a>`).join('')}</div>`;
}

/* ---------- Aprende ---------- */
async function runLesson(n, m) {
  const cards = m.lesson.map(c => ({ title: c.title, html: c.html + (c.svg ? `<div class="fig">${c.svg}${c.caption ? `<div class="cap">${esc(c.caption)}</div>` : ''}</div>` : '') }));
  cards.push({ title: 'Errores típicos de hispanohablantes', html: `<table><thead><tr><th>Error</th><th>Correcto</th></tr></thead><tbody>${m.errors.map(e => `<tr><td><span class="wrong">${esc(e.wrong)}</span></td><td><span class="ok">${esc(e.right)}</span><br><span class="muted" style="font-size:13px">${esc(e.why)}</span></td></tr>`).join('')}</tbody></table>` });
  if (m.falseFriends && m.falseFriends.length) cards.push({ title: 'Falsos amigos y trampas', html: `<table><thead><tr><th>En inglés</th><th>Parece…</th><th>Significa</th></tr></thead><tbody>${m.falseFriends.map(f => `<tr><td class="en">${esc(f.en)}</td><td>${esc(f.looks)}</td><td>${esc(f.means)}${f.fix ? `<br><span class="muted" style="font-size:13px">Lo correcto: ${esc(f.fix)}</span>` : ''}</td></tr>`).join('')}</tbody></table>` });
  if (m.dialog && m.dialog.length) cards.push({ title: 'Diálogo modelo', html: `<p class="muted">Toca una línea para escucharla.</p>${m.dialog.map((l, i) => `<p data-say="${i}" style="cursor:pointer"><b style="color:var(--purple)">${esc(l.who)}:</b> ${esc(l.text)}</p>`).join('')}<button class="audio" id="alld">${ICON.play} Escuchar todo</button>` });
  let i = 0; const t0 = Date.now();
  const draw = () => {
    const c = cards[i];
    APP.innerHTML = `${backBtn(`#/m/${n}`, `Módulo ${n}`)}<div class="dots">${cards.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="lesson"><div class="kind">Tarjeta ${i + 1} de ${cards.length}</div><h2>${esc(c.title)}</h2>${c.html}</div>
      <div class="btns two"><button class="btn sec" id="p" ${i === 0 ? 'disabled' : ''}>Anterior</button><button class="btn" id="nx">${i === cards.length - 1 ? 'Terminar' : 'Siguiente'}</button></div>`;
    APP.querySelector('#p').onclick = () => { i--; draw(); window.scrollTo(0, 0); };
    APP.querySelector('#nx').onclick = () => {
      if (i < cards.length - 1) { i++; draw(); window.scrollTo(0, 0); return; }
      MS(n).lesson = true; logAct('lesson', n, 0, 0, (Date.now() - t0) / 1000); toast('Lección completada'); location.hash = `#/m/${n}`;
    };
    APP.querySelectorAll('[data-say]').forEach(el => el.onclick = () => TTS.say(m.dialog[+el.dataset.say].text));
    const ad = APP.querySelector('#alld'); if (ad) ad.onclick = () => TTS.sayList(m.dialog.map(l => l.text));
    APP.querySelectorAll('.lesson .en, .lesson td.en').forEach(el => { el.style.cursor = 'pointer'; el.onclick = () => TTS.say(el.textContent); });
  };
  draw();
}

/* ---------- Frases clave (flashcards) ---------- */
async function runBlocks(n, m) {
  const ids = m.blocks.map((b, i) => ({ b, id: `b:${n}:${i}` }));
  const order = shuffle(ids).sort((x, y) => ((S.srs[x.id] || {}).b || 0) - ((S.srs[y.id] || {}).b || 0)).slice(0, 15);
  let i = 0, shown = false, ok = 0; const t0 = Date.now();
  const draw = () => {
    if (i >= order.length) {
      MS(n).blocks = (MS(n).blocks || 0) + order.length; logAct('blocks', n, ok, order.length, (Date.now() - t0) / 1000);
      APP.innerHTML = `${backBtn(`#/m/${n}`, `Módulo ${n}`)}<div class="celebrate"><div class="score">${ok}<small>/${order.length}</small></div><p class="muted">frases que ya sabías</p></div>
        <div class="btns"><button class="btn" id="more">Otras 15 frases</button><a class="btn sec" href="#/m/${n}">Volver al módulo</a></div>`;
      APP.querySelector('#more').onclick = () => runBlocks(n, m); return;
    }
    const { b } = order[i];
    APP.innerHTML = `<div class="ex-top"><button class="close" id="x">✕</button><div class="pbar"><i style="width:${100 * i / order.length}%"></i></div></div>
      <div class="flash" id="card"><div class="group">${esc(b.group || 'Frase clave')}</div><div class="big">${esc(b.en)}</div>
      ${shown ? `<div class="reveal"><div class="es">${esc(b.es)}</div>${b.pron ? `<div style="margin-top:8px"><span class="pron">${esc(b.pron)}</span></div>` : ''}</div>` : '<div class="hint">Toca la tarjeta para ver el significado</div>'}</div>
      <div class="row" style="justify-content:center;gap:10px"><button class="audio" id="a">${ICON.play} Escuchar</button><button class="audio slow" id="s">Lento</button></div>
      ${shown ? `<div class="btns two"><button class="btn sec" id="no">Repasar</button><button class="btn teal" id="yes">Lo sé</button></div>` : `<div class="btns"><button class="btn sec" id="show">Ver significado</button></div>`}`;
    APP.querySelector('#x').onclick = () => location.hash = `#/m/${n}`;
    APP.querySelector('#a').onclick = e => { e.stopPropagation(); TTS.say(b.en); };
    APP.querySelector('#s').onclick = e => { e.stopPropagation(); TTS.say(b.en, true); };
    const reveal = () => { if (!shown) { shown = true; draw(); TTS.say(b.en); } };
    APP.querySelector('#card').onclick = reveal;
    const sh = APP.querySelector('#show'); if (sh) sh.onclick = reveal;
    const y = APP.querySelector('#yes'), no = APP.querySelector('#no');
    if (y) y.onclick = () => { srsMark(order[i].id, true); ok++; i++; shown = false; save(); draw(); };
    if (no) no.onclick = () => { srsMark(order[i].id, false); i++; shown = false; save(); draw(); };
  };
  draw();
}

/* ---------- generador de ejercicios ---------- */
const wc = s => String(s).trim().split(/\s+/).length;
function moduleQueue(n, m, size = 12) {
  const blocks = m.blocks.map((b, i) => ({ ...b, id: `b:${n}:${i}` })).filter(b => b.en && b.es);
  const ex = m.examples.map((e, i) => ({ ...e, id: `e:${n}:${i}` }));
  const errs = m.errors.map((e, i) => ({ ...e, id: `r:${n}:${i}` }));
  const buildable = [...ex, ...blocks].filter(x => wc(x.en) >= 3 && wc(x.en) <= 11 && !/[\/…]|\.\.\./.test(x.en));
  const sayable = [...ex, ...blocks].filter(x => wc(x.en) >= 3 && wc(x.en) <= 12 && !/[\/…(]/.test(x.en));
  const typeable = blocks.filter(x => wc(x.en) >= 2 && wc(x.en) <= 6 && !/[\/…(]/.test(x.en));
  const q = [];
  pick(blocks, 2).forEach(b => q.push({ t: 'meaning', item: b, pool: blocks }));
  pick(blocks, 2).forEach(b => q.push({ t: 'listen', item: b, pool: blocks }));
  pick(buildable, 2).forEach(b => q.push({ t: 'build', item: b }));
  pick(errs, 2).forEach(e => q.push({ t: 'fix', item: e }));
  pick(typeable, 1).forEach(b => q.push({ t: 'type', item: b }));
  pick(sayable, 2).forEach(b => q.push({ t: 'speak', item: b }));
  const out = shuffle(q).slice(0, size - 1);
  if (m.speak && m.speak.length) out.push({ t: 'answer', item: { en: pick(m.speak, 1)[0], id: `q:${n}` } });
  return out;
}
async function reviewItems(max) {
  const ids = shuffle(dueIds()).slice(0, max * 2), out = [];
  for (const id of ids) {
    const [k, ns, is] = id.split(':'); const n = +ns, i = +is; if (!n || !unlocked(n)) continue;
    let m; try { m = await mod(n); } catch (e) { continue; }
    if (k === 'b' && m.blocks[i]) { const pool = m.blocks.map((b, j) => ({ ...b, id: `b:${n}:${j}` })); out.push({ t: Math.random() < .5 ? 'meaning' : 'listen', item: pool[i], pool, review: true }); }
    else if (k === 'e' && m.examples[i] && wc(m.examples[i].en) <= 11) out.push({ t: 'build', item: { ...m.examples[i], id }, review: true });
    else if (k === 'r' && m.errors[i]) out.push({ t: 'fix', item: { ...m.errors[i], id }, review: true });
    if (out.length >= max) break;
  }
  return out;
}

/* ---------- motor de ejercicios ---------- */
function runQueue(queue, opt) {
  let i = 0, ok = 0, tot = 0; const t0 = Date.now(); let stopRec = null;
  CLEANUP = () => { if (stopRec) try { stopRec.abort(); } catch (e) { } };
  const finish = () => {
    const sec = (Date.now() - t0) / 1000;
    if (opt.kind === 'practice' && opt.m) MS(opt.m).practice = (MS(opt.m).practice || 0) + 1;
    logAct(opt.kind || 'practice', opt.m || 0, ok, tot, sec);
    const pct = tot ? Math.round(100 * ok / tot) : 0;
    APP.innerHTML = `<div class="celebrate"><div class="score">${pct}<small>%</small></div><p class="muted">de aciertos · ${fmtDur(sec)} min</p>
      <span class="${pct >= 80 ? 'badge-ok' : 'badge-no'}">${pct >= 80 ? '¡Muy bien!' : 'Lo que fallaste volverá en tu repaso'}</span></div>
      <div class="card"><div class="kv"><span>Racha</span><b>${streak()} ${streak() === 1 ? 'día' : 'días'}</b></div><div class="kv"><span>Frases dominadas</span><b>${Object.keys(S.mastered).length}</b></div><div class="kv"><span>Minutos esta semana</span><b>${weekStats().min}</b></div></div>
      <div class="btns"><a class="btn" href="${opt.back}">Continuar</a></div>`;
  };
  const next = good => {
    const it = queue[i];
    if (it.t !== 'answer') { tot++; if (good) ok++; }
    if (it.item.id && it.t !== 'answer') srsMark(it.item.id, good);
    save(); i++;
    i >= queue.length ? finish() : draw();
  };
  const head = () => `<div class="ex-top"><button class="close" id="x">✕</button><div class="pbar"><i style="width:${100 * i / queue.length}%"></i></div></div>`;
  const bindClose = () => APP.querySelector('#x').onclick = () => { if (confirmLeave()) location.hash = opt.back; };
  const fbHTML = (good, title, body) => `<div class="fb ${good ? 'good' : 'bad'}"><b class="t">${title}</b>${body || ''}</div>`;
  const continueBtn = good => { const f = APP.querySelector('#foot'); f.innerHTML = `<button class="btn" id="cont">Continuar</button>`; f.querySelector('#cont').onclick = () => next(good); };

  function draw() {
    const it = queue[i], x = it.item;
    const R = it.review ? '<span class="chip" style="font-size:12px;padding:3px 9px;margin-left:6px">Repaso</span>' : '';
    if (it.t === 'meaning' || it.t === 'listen') {
      const others = pick(it.pool.filter(b => b.es !== x.es && b.en !== x.en), 3);
      const opts = shuffle([x, ...others]);
      const isL = it.t === 'listen';
      APP.innerHTML = `${head()}<div class="kind">${isL ? 'Escucha y elige lo que oíste' : '¿Qué significa?'}${R}</div>
        ${isL ? `<div class="row" style="gap:10px;margin:14px 0"><button class="audio" id="a" style="padding:14px 22px;font-size:16px">${ICON.play} Escuchar</button><button class="audio slow" id="s">Lento</button></div>`
          : `<div class="prompt">${esc(x.en)}</div><div class="row" style="gap:10px"><button class="audio" id="a">${ICON.play} Escuchar</button></div>`}
        <div class="opts">${opts.map((o, k) => `<button class="opt" data-k="${k}">${esc(isL ? o.en : o.es)}</button>`).join('')}</div><div id="fb"></div><div id="foot" class="sticky-foot"></div>`;
      bindClose();
      APP.querySelector('#a').onclick = () => TTS.say(x.en);
      const s = APP.querySelector('#s'); if (s) s.onclick = () => TTS.say(x.en, true);
      if (isL) setTimeout(() => TTS.say(x.en), 250);
      APP.querySelectorAll('.opt').forEach(b => b.onclick = () => {
        const o = opts[+b.dataset.k], good = o === x;
        APP.querySelectorAll('.opt').forEach(z => { z.disabled = true; if (opts[+z.dataset.k] === x) z.classList.add('good'); });
        if (!good) b.classList.add('bad');
        APP.querySelector('#fb').innerHTML = fbHTML(good, good ? '¡Correcto!' : 'No exactamente', `<span class="ans">${esc(x.en)}</span>${esc(x.es)}${x.pron ? ` · <span class="pron">${esc(x.pron)}</span>` : ''}`);
        if (!isL) TTS.say(x.en);
        continueBtn(good);
      });
    } else if (it.t === 'build') {
      const words = x.en.trim().split(/\s+/);
      const tiles = shuffle(words.map((w, k) => ({ w, k })));
      let chosen = [];
      APP.innerHTML = `${head()}<div class="kind">Arma la frase en inglés${R}</div><div class="prompt es">${esc(x.es)}</div>
        <div class="answer-area" id="ans"></div><div class="tiles" id="pool">${tiles.map((t, k) => `<button class="tile" data-k="${k}">${esc(t.w)}</button>`).join('')}</div>
        <div id="fb"></div><div id="foot" class="sticky-foot"><button class="btn" id="chk" disabled>Comprobar</button></div>`;
      bindClose();
      const redraw = () => {
        APP.querySelector('#ans').innerHTML = chosen.map((k, j) => `<button class="tile" data-j="${j}">${esc(tiles[k].w)}</button>`).join('');
        APP.querySelectorAll('#pool .tile').forEach(b => b.classList.toggle('used', chosen.includes(+b.dataset.k)));
        APP.querySelector('#chk').disabled = chosen.length !== tiles.length;
        APP.querySelectorAll('#ans .tile').forEach(b => b.onclick = () => { chosen.splice(+b.dataset.j, 1); redraw(); });
      };
      APP.querySelectorAll('#pool .tile').forEach(b => b.onclick = () => { const k = +b.dataset.k; if (!chosen.includes(k)) { chosen.push(k); redraw(); } });
      APP.querySelector('#chk').onclick = () => {
        const said = chosen.map(k => tiles[k].w).join(' ');
        const good = norm(said) === norm(x.en);
        APP.querySelectorAll('.tile').forEach(b => b.disabled = true);
        APP.querySelector('#fb').innerHTML = fbHTML(good, good ? '¡Perfecto!' : 'El orden correcto es:', `<span class="ans">${esc(x.en)}</span>`);
        TTS.say(x.en); continueBtn(good);
      };
    } else if (it.t === 'fix') {
      const opts = shuffle([{ s: x.right, good: true }, { s: x.wrong, good: false }]);
      APP.innerHTML = `${head()}<div class="kind">¿Cuál está bien dicha?${R}</div>
        <div class="opts">${opts.map((o, k) => `<button class="opt" data-k="${k}">${esc(o.s)}</button>`).join('')}</div><div id="fb"></div><div id="foot" class="sticky-foot"></div>`;
      bindClose();
      APP.querySelectorAll('.opt').forEach(b => b.onclick = () => {
        const good = opts[+b.dataset.k].good;
        APP.querySelectorAll('.opt').forEach(z => { z.disabled = true; z.classList.add(opts[+z.dataset.k].good ? 'good' : 'bad'); });
        APP.querySelector('#fb').innerHTML = fbHTML(good, good ? '¡Correcto!' : 'Ojo con esta trampa', `<p>${esc(x.why)}</p>`);
        TTS.say(x.right); continueBtn(good);
      });
    } else if (it.t === 'type') {
      APP.innerHTML = `${head()}<div class="kind">Escríbelo en inglés${R}</div><div class="prompt es">${esc(x.es)}</div>
        <input class="field" id="in" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Escribe aquí…"><div id="fb"></div>
        <div id="foot" class="sticky-foot"><button class="btn" id="chk">Comprobar</button></div>`;
      bindClose();
      const inp = APP.querySelector('#in'); inp.focus();
      const check = () => {
        const g = grade(inp.value, [x.en]); inp.disabled = true;
        const good = g !== 'no';
        APP.querySelector('#fb').innerHTML = fbHTML(good, g === 'ok' ? '¡Correcto!' : g === 'close' ? 'Casi perfecto (revisa la ortografía)' : 'La respuesta es:', `<span class="ans">${esc(x.en)}</span>${x.pron ? `<span class="pron">${esc(x.pron)}</span>` : ''}`);
        TTS.say(x.en); continueBtn(good);
      };
      APP.querySelector('#chk').onclick = check; inp.onkeydown = e => { if (e.key === 'Enter' && !inp.disabled) check(); };
    } else if (it.t === 'speak' || it.t === 'answer') {
      const isA = it.t === 'answer';
      APP.innerHTML = `${head()}<div class="kind">${isA ? 'Responde en voz alta (habla libre)' : 'Escucha y repite en voz alta'}${R}</div>
        <div class="prompt">${esc(x.en)}</div>${!isA && x.es ? `<p class="es" style="margin-top:-6px">${esc(x.es)}</p>` : ''}
        <div class="row" style="gap:10px"><button class="audio" id="a">${ICON.play} Escuchar</button>${isA ? '' : '<button class="audio slow" id="s">Lento</button>'}</div>
        <div class="rec"><button class="recbtn" id="mic">${ICON.mic}</button><div class="live" id="live">${SR ? 'Toca el micrófono y habla' : 'Tu navegador no transcribe la voz: escucha, repite en voz alta y evalúate.'}</div></div>
        <div id="fb"></div><div id="foot" class="sticky-foot">${SR ? '<button class="btn ghost" id="skip">No puedo hablar ahora</button>' : '<div class="btns two"><button class="btn sec" id="sno">Repasar luego</button><button class="btn teal" id="syes">Me salió bien</button></div>'}</div>`;
      bindClose();
      APP.querySelector('#a').onclick = () => TTS.say(x.en);
      const s = APP.querySelector('#s'); if (s) s.onclick = () => TTS.say(x.en, true);
      const live = APP.querySelector('#live'), mic = APP.querySelector('#mic');
      if (!SR) {
        mic.style.opacity = .4;
        APP.querySelector('#syes').onclick = () => next(true); APP.querySelector('#sno').onclick = () => next(false);
        return;
      }
      APP.querySelector('#skip').onclick = () => { if (isA) next(true); else { i++; i >= queue.length ? finish() : draw(); } };
      let listening = false;
      mic.onclick = () => {
        if (listening) { stopRec && stopRec.stop(); return; }
        if (TTS.ok) speechSynthesis.cancel();
        listening = true; mic.classList.add('on'); live.textContent = 'Escuchando…';
        stopRec = listenOnce(t => live.textContent = t, said => {
          listening = false; mic.classList.remove('on'); stopRec = null;
          if (said === null) { live.textContent = 'No se pudo usar el micrófono. Revisa el permiso del navegador.'; return; }
          if (!said) { live.textContent = 'No te escuché. Toca el micrófono e inténtalo de nuevo.'; return; }
          live.innerHTML = `Dijiste: <b>${esc(said)}</b>`;
          if (isA) {
            const n = wc(said);
            APP.querySelector('#fb').innerHTML = fbHTML(n >= 4, n >= 4 ? `¡Bien! Dijiste ${n} palabras.` : 'Intenta decir una frase más larga', '<p class="small">En la sección Mi voz puedes grabar respuestas largas y ver tu progreso.</p>');
            logAct('speak', opt.m || 0, 0, 0, 20);
            continueBtn(true);
          } else {
            const cov = wordCoverage(x.en, said), good = cov >= 0.7;
            APP.querySelector('#fb').innerHTML = fbHTML(good, good ? `¡Muy bien! ${Math.round(cov * 100)}% de la frase` : `${Math.round(cov * 100)}% de la frase. Escucha otra vez y repite.`, `<span class="ans">${esc(x.en)}</span>${x.pron ? `<span class="pron">${esc(x.pron)}</span>` : ''}`);
            const f = APP.querySelector('#foot');
            f.innerHTML = good ? `<button class="btn" id="cont">Continuar</button>` : `<div class="btns two"><button class="btn sec" id="again">Intentar otra vez</button><button class="btn" id="cont">Continuar</button></div>`;
            f.querySelector('#cont').onclick = () => next(good);
            const ag = f.querySelector('#again'); if (ag) ag.onclick = () => draw();
          }
        });
      };
    }
  }
  draw();
}
function confirmLeave() { return window.confirm('¿Salir? Perderás el avance de esta sesión.'); }

/* ---------- Práctica diaria ---------- */
async function viewPractice() {
  const cur = currentModule(), go = /go=1/.test(location.hash);
  const due = dueIds().length;
  if (!go) {
    const w = weekStats();
    APP.innerHTML = `<div class="top"><div><h1>Práctica</h1><div class="sub">10 minutos al día hacen la diferencia</div></div>${LOGO}</div>
      <div class="card accent"><h2>Sesión de hoy</h2><p class="muted small">12 retos del Módulo ${cur}${due ? ` + repaso de ${Math.min(due, 4)} cosas que fallaste antes` : ''}. Incluye hablar en voz alta.</p><a class="btn" href="#/practice?go=1">Empezar</a></div>
      <div class="card"><h3>Practicar un módulo</h3><p class="muted small">Elige cualquier módulo ya desbloqueado.</p>
      <select class="field" id="msel">${DATA.catalog.modules.filter(m => unlocked(m.id)).map(m => `<option value="${m.id}" ${m.id === cur ? 'selected' : ''}>Módulo ${m.id} · ${esc(m.title)}</option>`).join('')}</select>
      <div class="btns two"><button class="btn sec" id="pm">Práctica</button><button class="btn sec" id="pb">Frases clave</button></div></div>
      <div class="card"><h3>Esta semana</h3><div class="kv"><span>Días practicados</span><b>${w.days} de 7</b></div><div class="kv"><span>Minutos</span><b>${w.min}</b></div><div class="kv"><span>Aciertos</span><b>${w.acc == null ? '—' : w.acc + '%'}</b></div><div class="kv"><span>Pendientes de repaso</span><b>${due}</b></div></div>`;
    APP.querySelector('#pm').onclick = () => location.hash = `#/m/${APP.querySelector('#msel').value}/practice`;
    APP.querySelector('#pb').onclick = () => location.hash = `#/m/${APP.querySelector('#msel').value}/blocks`;
    return;
  }
  const m = await mod(cur);
  const rev = await reviewItems(4);
  const base = moduleQueue(cur, m, 12);
  const last = base.pop();
  const q = shuffle([...base.slice(0, 11 - rev.length), ...rev]);
  q.push(last);
  NAV.classList.add('hidden');
  runQueue(q, { title: 'Sesión de hoy', back: '#/home', kind: 'practice', m: cur });
}

/* ---------- Mi presentación ---------- */
async function runPres(n, m) {
  let P; try { P = await pres(n); } catch (e) { APP.innerHTML = `${backBtn(`#/m/${n}`)}<div class="card">Presentación no disponible.</div>`; return; }
  const rows = P.rows.map(r => ({ en: fill(r.en), es: fill(r.es), enH: fillHTML(r.en), esH: fillHTML(r.es) }));
  const plain = rows.map(r => r.en.replace(/\*\*/g, ''));
  let mode = '';
  const draw = () => {
    const prev = S.recs.filter(r => r.kind === 'pres' && r.m === n);
    APP.innerHTML = `${backBtn(`#/m/${n}`, `Módulo ${n}`)}<div class="top"><div><div class="sub">Mi presentación · ${esc(P.topic)}</div><h1>${esc(fill(P.title))}</h1></div></div>
      <p class="muted small" style="margin-top:-6px">${esc(P.practice)}</p>
      <div class="row wrap" style="gap:8px;margin-bottom:12px"><button class="chip ${mode === '' ? 'on' : ''}" data-m="">Ver todo</button><button class="chip ${mode === 'hide-es' ? 'on' : ''}" data-m="hide-es">Solo inglés</button><button class="chip ${mode === 'hide-en' ? 'on' : ''}" data-m="hide-en">Modo memoria</button><button class="audio" id="all">${ICON.play} Escuchar todo</button></div>
      <div class="card ${mode}">${rows.map((r, k) => `<div class="prow"><button class="iconbtn" data-say="${k}">${ICON.play}</button><div class="txt"><span class="en">${r.enH}</span><span class="es">${r.esH}</span></div></div>`).join('')}</div>
      <div class="card"><h3>${esc(P.dialogTitle)}</h3>${P.dialog.map((l, k) => `<p style="margin:0 0 8px;cursor:pointer" data-dl="${k}"><b style="color:var(--purple)">${esc(fill(l.who))}:</b> ${esc(fill(l.text))}</p>`).join('')}<button class="audio" id="dall">${ICON.play} Escuchar diálogo</button></div>
      <div class="card"><h3>Pronuncia bien estas frases</h3>${P.pron.map((p, k) => `<div class="prow"><button class="iconbtn" data-pr="${k}">${ICON.play}</button><div class="txt"><span class="en">${esc(fill(p.en))}</span>${p.pron ? `<span class="pron">${esc(p.pron)}</span>` : ''}</div></div>`).join('')}</div>
      <div class="card accent"><h3>Grábate</h3><p class="muted small">${esc(P.check)}</p>${prev.length ? `<p class="small">Ya te grabaste ${prev.length} ${prev.length === 1 ? 'vez' : 'veces'}. Última: ${fmtDate(prev[prev.length - 1].d)}.</p>` : ''}
      <button class="btn purple" id="rec">${ICON.mic} Grabar mi presentación</button></div>`;
    APP.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { mode = b.dataset.m; draw(); });
    APP.querySelectorAll('[data-say]').forEach(b => b.onclick = () => TTS.say(plain[+b.dataset.say]));
    APP.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => TTS.say(fill(P.dialog[+b.dataset.dl].text)));
    APP.querySelectorAll('[data-pr]').forEach(b => b.onclick = () => TTS.say(fill(P.pron[+b.dataset.pr].en)));
    APP.querySelector('#all').onclick = () => TTS.sayList(plain);
    APP.querySelector('#dall').onclick = () => TTS.sayList(P.dialog.map(l => fill(l.text)));
    APP.querySelector('#rec').onclick = () => recordScreen({
      kind: 'pres', m: n, title: `Presentación · Módulo ${n}`, target: plain.join(' '), back: `#/m/${n}/pres`,
      hint: 'Dila sin leer. Si te trabas, sigue adelante.',
      onSaved: () => { MS(n).pres = true; save(); },
    });
  };
  draw();
}

/* ---------- pantalla de grabación (presentación, reto semanal, examen oral) ---------- */
function recordScreen(o) {
  NAV.classList.add('hidden');
  let r = null, timer = null, t0 = 0, liveText = '';
  APP.innerHTML = `<div class="ex-top"><button class="close" id="x">✕</button><div class="grow"><b>${esc(o.title)}</b></div></div>
    ${o.prompt ? `<div class="card"><div class="kind">Tema</div><div class="prompt" style="font-size:19px;margin:0">${esc(o.prompt)}</div>${o.promptEs ? `<p class="es small" style="margin:6px 0 0">${esc(o.promptEs)}</p>` : ''}</div>` : ''}
    <div class="card"><div class="rec"><button class="recbtn" id="mic">${ICON.mic}</button><div class="timer" id="tm">0:00</div><div class="live" id="live">${esc(o.hint || 'Toca para empezar a grabar')}</div></div></div>
    <div id="res"></div>`;
  const mic = APP.querySelector('#mic'), live = APP.querySelector('#live'), tm = APP.querySelector('#tm');
  CLEANUP = () => { clearInterval(timer); if (r) r.stop(); };
  APP.querySelector('#x').onclick = () => { CLEANUP(); CLEANUP = null; if (o.onDone) return o.onCancel ? o.onCancel() : o.onDone(); goBack(o.back); };
  mic.onclick = async () => {
    if (!r) {
      try {
        if (TTS.ok) speechSynthesis.cancel();
        r = await startRecorder(t => { liveText = t; live.textContent = t.slice(-220); });
      } catch (e) {
        live.innerHTML = 'No se pudo usar el micrófono. Permite el micrófono para esta página en la configuración del navegador.' + (location.protocol === 'file:' ? '<br><b>Abre la app desde su link (https), no desde el archivo.</b>' : '');
        return;
      }
      t0 = Date.now(); mic.classList.add('on'); live.textContent = SR ? 'Te escucho… habla en inglés' : 'Grabando… (este navegador no transcribe, pero tu audio se guarda)';
      timer = setInterval(() => tm.textContent = fmtDur((Date.now() - t0) / 1000), 500);
      return;
    }
    clearInterval(timer); mic.classList.remove('on'); mic.disabled = true; live.textContent = 'Guardando…';
    const res = await r.stop(); r = null;
    const transcript = res.transcript || liveText;
    const words = transcript ? wc(transcript) : 0;
    const rec = {
      id: 'r' + Date.now(), d: today(), kind: o.kind, m: o.m || 0, prompt: o.prompt || '', dur: Math.round(res.dur), transcript,
      words, wpm: res.dur > 5 && words ? Math.round(words / (res.dur / 60)) : 0,
      uniq: new Set(norm(transcript).split(' ').filter(Boolean)).size,
      match: o.target && transcript ? Math.round(100 * wordCoverage(o.target, transcript)) : null,
    };
    try { await IDB.put(rec.id, res.blob); } catch (e) { toast('No se pudo guardar el audio'); }
    S.recs.push(rec); logAct('voice', o.m || 0, 0, 0, res.dur); save();
    o.onSaved && o.onSaved(rec);
    CLEANUP = null;
    showRecResult(rec, o);
  };
}
function sameKind(rec) { return S.recs.filter(x => x.kind === rec.kind && (rec.kind !== 'pres' || x.m === rec.m) && x.id !== rec.id); }
function metricsHTML(r) {
  return `<div class="big">${r.wpm ? r.wpm + ' <span class="small muted">pal/min</span>' : fmtDur(r.dur)}</div>
    <div class="small muted">${r.wpm ? fmtDur(r.dur) + ' min · ' : ''}${r.words || '—'} palabras${r.uniq ? ` · ${r.uniq} distintas` : ''}${r.match != null ? ` · ${r.match}% del texto` : ''}</div>`;
}
function diffLine(label, a, b, unit, higherBetter = true) {
  if (a == null || b == null || (!a && !b)) return '';
  const d = b - a; if (!d) return `<div class="kv"><span>${label}</span><b>igual</b></div>`;
  const good = higherBetter ? d > 0 : d < 0;
  return `<div class="kv"><span>${label}</span><b class="${good ? 'gain' : 'loss'}">${d > 0 ? '+' : ''}${d}${unit}</b></div>`;
}
async function playRec(id, btn) {
  try {
    const blob = await IDB.get(id); if (!blob) { toast('Audio no encontrado en este dispositivo'); return; }
    if (playRec.a) { playRec.a.pause(); URL.revokeObjectURL(playRec.a.src); }
    const a = new Audio(URL.createObjectURL(blob)); playRec.a = a; a.play();
    if (btn) { btn.classList.add('on'); a.onended = () => btn.classList.remove('on'); }
  } catch (e) { toast('No se pudo reproducir'); }
}
function showRecResult(rec, o) {
  const prev = sameKind(rec), first = prev[0], last = prev[prev.length - 1];
  const cmp = first ? `<div class="card"><h3>Antes y ahora</h3><p class="muted small">Tu primera grabación de este tipo (${fmtDate(first.d)}) frente a la de hoy.</p>
    <div class="compare"><div class="cmp"><div class="lbl">Primera</div>${metricsHTML(first)}<button class="audio" data-play="${first.id}" style="margin-top:8px">${ICON.play} Escuchar</button></div>
    <div class="cmp new"><div class="lbl">Hoy</div>${metricsHTML(rec)}<button class="audio" data-play="${rec.id}" style="margin-top:8px">${ICON.play} Escuchar</button></div></div>
    <div style="margin-top:10px">${diffLine('Palabras por minuto', first.wpm, rec.wpm, '')}${diffLine('Palabras dichas', first.words, rec.words, '')}${diffLine('Palabras distintas', first.uniq, rec.uniq, '')}${rec.match != null && first.match != null ? diffLine('Parte del texto que dijiste', first.match, rec.match, '%') : ''}</div>
    ${last && last !== first ? `<p class="small muted">Grabación anterior (${fmtDate(last.d)}): ${last.wpm || '—'} pal/min.</p>` : ''}</div>` : `<div class="fb info">Esta es tu primera grabación de este tipo. La próxima vez verás aquí cuánto mejoraste.</div>`;
  document.getElementById('res').innerHTML = `<div class="card"><h3>Tu grabación</h3>${metricsHTML(rec)}
    ${rec.transcript ? `<p class="small" style="margin:10px 0 0"><b>Lo que entendió el teléfono:</b> ${esc(rec.transcript)}</p><p class="tiny muted">Si una palabra salió distinta, puede ser pronunciación… o el micrófono. Escúchate para comparar.</p>` : `<p class="small muted">No hubo transcripción en este navegador; tu audio sí quedó guardado.</p>`}
    <button class="audio" data-play="${rec.id}" style="margin-top:8px">${ICON.play} Escucharme</button></div>${cmp}
    <div class="btns two"><button class="btn sec" id="again">Grabar otra vez</button><button class="btn" id="done">Listo</button></div>`;
  APP.querySelectorAll('[data-play]').forEach(b => b.onclick = () => playRec(b.dataset.play, b));
  APP.querySelector('#again').onclick = () => recordScreen(o);
  APP.querySelector('#done').onclick = () => { if (playRec.a) playRec.a.pause(); if (o.onDone) return o.onDone(); goBack(o.back); };
}
function goBack(h) { NAV.classList.remove('hidden'); if (location.hash === h) route(); else location.hash = h; }

/* ---------- Examen del módulo (40 pts) ---------- */
async function runModExam(n, m) {
  const X = m.exam; const t0 = Date.now();
  const items = [
    ...X.A1.map((q, k) => ({ part: 'A1', label: 'Parte A · Traduce al inglés', q, num: k + 1 })),
    ...X.A2.map((q, k) => ({ part: 'A2', label: 'Parte A · Traduce al español', q, num: k + 11 })),
    ...X.B.map((q, k) => ({ part: 'B', label: 'Parte B · Corrige el error (hay uno solo)', q, num: k + 1 })),
  ];
  let i = -1, pts = 0; const wrong = [];
  const intro = () => {
    const best = examBest(n);
    APP.innerHTML = `${backBtn(`#/m/${n}`, `Módulo ${n}`)}<div class="top"><div><div class="sub">Módulo ${n}</div><h1>Examen</h1></div></div>
      <div class="card"><div class="kv"><span>Parte A · Traducción</span><b>15 pts</b></div><div class="kv"><span>Parte B · Corrige el error</span><b>10 pts</b></div><div class="kv"><span>Parte C1 · Completa el diálogo</span><b>8 pts</b></div><div class="kv"><span>Parte C2 · Escribe un mensaje</span><b>7 pts</b></div>
      <p class="small muted" style="margin:10px 0 0">Apruebas con <b>32 de 40</b> y se desbloquea el siguiente módulo. Hazlo sin mirar el libro.</p>${best ? `<p class="small">Tu mejor nota: <b>${best}/40</b></p>` : ''}</div>
      <div class="btns"><button class="btn" id="go">Empezar examen</button></div>`;
    APP.querySelector('#go').onclick = () => { NAV.classList.add('hidden'); i = 0; drawItem(); };
  };
  const head = (label) => `<div class="ex-top"><button class="close" id="x">✕</button><div class="pbar"><i style="width:${100 * Math.max(0, i) / (items.length + 2)}%"></i></div><span class="small muted">${pts} pts</span></div><div class="kind">${label}</div>`;
  const bindX = () => APP.querySelector('#x').onclick = () => { if (confirmLeave()) { NAV.classList.remove('hidden'); location.hash = `#/m/${n}`; } };
  function drawItem() {
    if (i >= items.length) return drawC1();
    const it = items[i], q = it.q;
    APP.innerHTML = `${head(it.label)}<div class="prompt ${it.part === 'A1' ? 'es' : ''}">${it.num}. ${esc(q.prompt)}</div>
      <textarea class="field" id="in" style="min-height:90px" autocomplete="off" autocapitalize="sentences" spellcheck="false" placeholder="Tu respuesta…"></textarea>
      <div id="fb"></div><div id="foot" class="sticky-foot"><button class="btn" id="chk">Comprobar</button></div>`;
    bindX();
    const inp = APP.querySelector('#in'); inp.focus();
    APP.querySelector('#chk').onclick = () => {
      const g = grade(inp.value, q.answers); inp.disabled = true;
      const good = g !== 'no'; if (good) pts++; else wrong.push({ num: `${it.part === 'B' ? 'B' : 'A'}${it.num}`, q, user: inp.value });
      APP.querySelector('#fb').innerHTML = `<div class="fb ${good ? 'good' : 'bad'}"><b class="t">${g === 'ok' ? 'Correcto · +1' : g === 'close' ? 'Correcto, con un detalle de ortografía · +1' : 'Respuesta esperada:'}</b><span class="ans">${esc(q.answers[0])}</span>${q.answers.length > 1 ? `<span class="small muted">También vale: ${esc(q.answers.slice(1, 4).join(' · '))}</span>` : ''}<p class="small">${esc(q.explain)}</p></div>`;
      const f = APP.querySelector('#foot');
      f.innerHTML = good ? `<button class="btn" id="cont">Siguiente</button>` : `<div class="btns two"><button class="btn sec" id="mine">Mi respuesta también vale</button><button class="btn" id="cont">Siguiente</button></div>`;
      f.querySelector('#cont').onclick = () => { i++; drawItem(); };
      const mine = f.querySelector('#mine'); if (mine) mine.onclick = () => { pts++; wrong.pop(); i++; drawItem(); };
      if (it.part !== 'A2') TTS.say(q.answers[0]);
    };
  }
  function drawC1() {
    const C = X.C1;
    const lineHTML = l => esc(l.text).replace(/\[(\d+)\]/g, (_, k) => `<input class="blank-in" data-n="${k}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="(${k})">`);
    APP.innerHTML = `${head('Parte C1 · Completa el diálogo (8 pts)')}<p class="muted small">${esc(C.instructions || '')}</p>
      <div class="dlg">${C.lines.map(l => `<p><span class="who">${esc(l.who)}:</span>${lineHTML(l)}</p>`).join('')}</div><div id="fb"></div>
      <div id="foot" class="sticky-foot"><button class="btn" id="chk">Comprobar</button></div>`;
    bindX();
    APP.querySelector('#chk').onclick = () => {
      let got = 0; const notes = [];
      C.blanks.forEach(b => {
        const el = APP.querySelector(`.blank-in[data-n="${b.n}"]`); const g = grade(el.value, b.answers); el.disabled = true;
        if (g !== 'no') { got++; el.classList.add('good'); } else { el.classList.add('bad'); notes.push(`<p class="small"><b>(${b.n}) ${esc(b.answers.join(' / '))}</b> — ${esc(b.explain)}</p>`); wrong.push({ num: `C1-${b.n}`, q: { prompt: `Espacio (${b.n})`, answers: b.answers, explain: b.explain }, user: el.value }); }
      });
      pts += got;
      APP.querySelector('#fb').innerHTML = `<div class="fb ${got >= 6 ? 'good' : 'bad'}"><b class="t">${got} de 8 correctas</b>${notes.join('')}</div>`;
      APP.querySelector('#foot').innerHTML = `<button class="btn" id="cont">Siguiente</button>`;
      APP.querySelector('#cont').onclick = drawC2;
    };
  }
  function drawC2() {
    const C = X.C2; i = items.length + 1;
    APP.innerHTML = `${head('Parte C2 · Escribe (7 pts)')}<div class="card"><p style="margin:0">${esc(C.prompt)}</p></div>
      <textarea class="field" id="in" spellcheck="false" placeholder="Escribe tu mensaje en inglés…"></textarea>
      <div id="fb"></div><div id="foot" class="sticky-foot"><button class="btn" id="chk">Ver modelo y calificarme</button></div>`;
    bindX();
    APP.querySelector('#chk').onclick = () => {
      const txt = APP.querySelector('#in').value.trim(); if (wc(txt) < 10) { toast('Escribe al menos unas frases'); return; }
      APP.querySelector('#in').disabled = true;
      APP.querySelector('#fb').innerHTML = `<div class="card"><h3>Modelo</h3><p style="white-space:pre-wrap;margin:0">${esc(C.model)}</p></div>
        <div class="card"><h3>Califícate con honestidad</h3><p class="muted small">Marca solo lo que tu mensaje cumple.</p>${C.rubric.map((r, k) => `<div class="check" data-k="${k}"><span class="box"></span><div><b>${esc(r)}</b></div></div>`).join('')}</div>`;
      APP.querySelectorAll('.check').forEach(c => c.onclick = () => c.classList.toggle('on'));
      APP.querySelector('#foot').innerHTML = `<button class="btn" id="fin">Terminar examen</button>`;
      APP.querySelector('#fin').onclick = () => { pts += APP.querySelectorAll('.check.on').length; results(); };
    };
  }
  function results() {
    const ms = MS(n); const was = passed(n);
    ms.exam.push({ d: today(), score: pts }); logAct('exam', n, pts, 40, (Date.now() - t0) / 1000);
    const ok = pts >= 32; NAV.classList.remove('hidden');
    APP.innerHTML = `<div class="celebrate"><div class="score">${pts}<small>/40</small></div>
      <span class="${ok ? 'badge-ok' : 'badge-no'}">${ok ? (was ? 'Aprobado otra vez' : `¡Aprobado! Se desbloqueó el ${n === 12 || n === 26 ? 'examen integrador' : n === 36 ? 'examen final' : 'Módulo ' + (n + 1)}`) : 'Aún no: necesitas 32. Repasa y vuelve a intentarlo.'}</span></div>
      ${wrong.length ? `<div class="card"><h3>Para repasar</h3>${wrong.map(w => `<div class="kv" style="display:block"><b>${esc(w.num)}.</b> ${esc(w.q.prompt)}<br><span class="small">Tú: <span class="wrong">${esc(w.user || '(vacío)')}</span> · Correcto: <span class="ok">${esc(w.q.answers[0])}</span></span></div>`).join('')}</div>` : ''}
      <div class="btns">${ok ? `<a class="btn" href="#/home">Ir al inicio</a>` : `<a class="btn" href="#/m/${n}/lesson">Repasar la lección</a>`}<a class="btn sec" href="#/m/${n}">Volver al módulo</a></div>`;
  }
  intro();
}

/* ---------- Ya puedo ---------- */
async function runCando(n, m) {
  const ms = MS(n);
  const draw = () => {
    APP.innerHTML = `${backBtn(`#/m/${n}`, `Módulo ${n}`)}<div class="top"><div><div class="sub">Módulo ${n}</div><h1>Ya puedo…</h1></div></div>
      <p class="muted small" style="margin-top:-6px">Marca cada habilidad solo cuando pases su prueba.</p>
      <div class="card">${m.cando.map((c, k) => `<div class="check ${ms.cando[k] ? 'on' : ''}" data-k="${k}"><span class="box"></span><div><b>${esc(c.skill)}</b><span>${esc(c.test)}</span></div></div>`).join('')}</div>`;
    APP.querySelectorAll('.check').forEach(c => c.onclick = () => { const k = c.dataset.k; ms.cando[k] = !ms.cando[k]; save(); draw(); });
  };
  draw();
}

/* ================= EXÁMENES INTEGRADORES ================= */
async function viewBigExam(id) {
  if (!bigUnlocked(id)) { toast('Aprueba el último módulo del nivel primero'); location.hash = '#/home'; return; }
  const E = await bigExam(id);
  const t0 = Date.now();
  const best = bigBest(id);
  APP.innerHTML = `${backBtn('#/home', 'Inicio')}<div class="top"><div><div class="sub">${LEVEL_NAME[id]}</div><h1>${esc(E.title)}</h1></div></div>
    <p class="muted" style="margin-top:-6px">${esc(E.goal || '')}</p>
    <div class="card">${E.parts.map(p => `<div class="kv"><span>${esc(p.title)}</span><b>${p.points} pts</b></div>`).join('')}
    <p class="small muted" style="margin:10px 0 0">Apruebas con <b>${E.pass}/100</b>. Toma unas 2 horas; puedes hacerlo de una vez.</p>${best ? `<p class="small">Tu mejor nota: <b>${best}/100</b></p>` : ''}</div>
    <div class="btns"><button class="btn" id="go">Empezar</button></div>`;
  let pi = 0, ii = 0; const score = {}; const wrong = [];
  APP.querySelector('#go').onclick = () => { NAV.classList.add('hidden'); drawPart(); };
  const head = p => `<div class="ex-top"><button class="close" id="x">✕</button><div class="pbar"><i style="width:${100 * pi / E.parts.length}%"></i></div></div><div class="kind">${esc(p.title)}</div>`;
  const bindX = () => APP.querySelector('#x').onclick = () => { if (confirmLeave()) { NAV.classList.remove('hidden'); location.hash = '#/home'; } };
  function drawPart() {
    if (pi >= E.parts.length) return finish();
    const p = E.parts[pi]; score[pi] = score[pi] || 0;
    if (p.selfGraded) return p.oral ? drawOral(p) : drawWrite(p);
    if (ii >= p.items.length) { pi++; ii = 0; return drawPart(); }
    const it = p.items[ii];
    APP.innerHTML = `${head(p)}${p.text ? `<details ${ii === 0 ? 'open' : ''} style="margin-bottom:10px"><summary class="small" style="cursor:pointer;font-weight:700">Texto de lectura</summary><div class="reading">${esc(p.text)}</div></details>` : ''}
      ${ii === 0 && p.instructions ? `<p class="muted small">${esc(p.instructions)}</p>` : ''}
      <div class="prompt" style="font-size:19px">${it.n}. ${esc(it.prompt)}</div>
      ${it.type === 'choice' ? `<div class="opts">${it.options.map((o, k) => `<button class="opt" data-k="${k}">${esc(o)}</button>`).join('')}</div>` : `<textarea class="field" id="in" style="min-height:80px" spellcheck="false" placeholder="Tu respuesta…"></textarea>`}
      <div id="fb"></div><div id="foot" class="sticky-foot">${it.type === 'write' ? '<button class="btn" id="chk">Comprobar</button>' : ''}</div>`;
    bindX();
    const after = (good, ansText) => {
      if (good) score[pi] += it.points; else wrong.push({ n: it.n, prompt: it.prompt, ans: ansText, module: it.module });
      APP.querySelector('#fb').innerHTML = `<div class="fb ${good ? 'good' : 'bad'}"><b class="t">${good ? `Correcto · +${it.points}` : 'Respuesta correcta:'}</b>${good ? '' : `<span class="ans">${esc(ansText)}</span>`}<p class="small">${esc(it.explain)}${it.module ? ` <span class="muted">(Módulo ${esc(it.module)})</span>` : ''}</p></div>`;
      const f = APP.querySelector('#foot');
      f.innerHTML = good || it.type === 'choice' ? `<button class="btn" id="cont">Siguiente</button>` : `<div class="btns two"><button class="btn sec" id="mine">Mi respuesta también vale</button><button class="btn" id="cont">Siguiente</button></div>`;
      f.querySelector('#cont').onclick = () => { ii++; drawPart(); };
      const mine = f.querySelector('#mine'); if (mine) mine.onclick = () => { score[pi] += it.points; wrong.pop(); ii++; drawPart(); };
    };
    if (it.type === 'choice') {
      APP.querySelectorAll('.opt').forEach(b => b.onclick = () => {
        const k = +b.dataset.k, good = k === it.answer;
        APP.querySelectorAll('.opt').forEach(z => { z.disabled = true; if (+z.dataset.k === it.answer) z.classList.add('good'); });
        if (!good) b.classList.add('bad');
        after(good, it.options[it.answer]);
      });
    } else if (it.points > 1 || p.text) {
      // respuestas abiertas (lectura, traducciones de 2 pts): ver modelo y calificarse
      APP.querySelector('#chk').onclick = () => {
        const inp = APP.querySelector('#in'); inp.disabled = true;
        const auto = grade(inp.value, it.answers) !== 'no';
        APP.querySelector('#fb').innerHTML = `<div class="fb info"><b class="t">Respuesta modelo</b><span class="ans">${esc(it.answers[0])}</span><p class="small">${esc(it.explain)}</p>
          <p class="small" style="margin-top:10px"><b>¿Cuántos puntos merece tu respuesta?</b></p><div class="row wrap" style="gap:8px">${Array.from({ length: it.points + 1 }, (_, v) => `<button class="chip ${auto && v === it.points ? 'on' : ''}" data-pts="${v}">${v} de ${it.points}</button>`).join('')}</div></div>`;
        let chosen = auto ? it.points : null;
        APP.querySelectorAll('[data-pts]').forEach(b => b.onclick = () => { chosen = +b.dataset.pts; APP.querySelectorAll('[data-pts]').forEach(z => z.classList.toggle('on', z === b)); f.querySelector('#cont').disabled = false; });
        const f = APP.querySelector('#foot'); f.innerHTML = `<button class="btn" id="cont" ${chosen == null ? 'disabled' : ''}>Siguiente</button>`;
        f.querySelector('#cont').onclick = () => { score[pi] += chosen || 0; if ((chosen || 0) < it.points) wrong.push({ n: it.n, prompt: it.prompt, ans: it.answers[0], module: it.module }); ii++; drawPart(); };
      };
    } else {
      APP.querySelector('#chk').onclick = () => { const inp = APP.querySelector('#in'); inp.disabled = true; after(grade(inp.value, it.answers) !== 'no', it.answers[0]); };
    }
  }
  function rubricHTML(p) {
    return `<div class="card"><h3>Califícate</h3>${p.rubric.map((r, k) => `<div class="kv" style="align-items:center"><span><b>${esc(r.criterion)}</b>${r.levels ? `<br><span class="tiny muted">${esc(r.levels)}</span>` : ''}</span>
      <select class="field" data-r="${k}" style="width:92px;padding:9px 10px">${Array.from({ length: r.points + 1 }, (_, v) => `<option value="${v}">${v} / ${r.points}</option>`).join('')}</select></div>`).join('')}</div>`;
  }
  const readRubric = () => [...APP.querySelectorAll('[data-r]')].reduce((a, s) => a + (+s.value), 0);
  function drawWrite(p) {
    APP.innerHTML = `${head(p)}<div class="card"><p style="margin:0;white-space:pre-wrap">${esc(p.prompt)}</p></div>
      <textarea class="field" id="in" style="min-height:220px" spellcheck="false" placeholder="Escribe en inglés…"></textarea><div id="fb"></div>
      <div id="foot" class="sticky-foot"><button class="btn" id="chk">Ver modelo y calificarme</button></div>`;
    bindX();
    APP.querySelector('#chk').onclick = () => {
      APP.querySelector('#in').disabled = true;
      APP.querySelector('#fb').innerHTML = `${p.model ? `<div class="card"><h3>Modelo</h3><p style="white-space:pre-wrap;margin:0">${esc(p.model)}</p></div>` : ''}${rubricHTML(p)}`;
      APP.querySelector('#foot').innerHTML = `<button class="btn" id="cont">Siguiente parte</button>`;
      APP.querySelector('#cont').onclick = () => { score[pi] = readRubric(); pi++; ii = 0; drawPart(); };
    };
  }
  function drawOral(p) {
    APP.innerHTML = `${head(p)}<div class="card"><p class="muted small" style="margin-top:0">${esc(p.instructions || 'Responde en voz alta cada pregunta, sin leer. Graba todo de corrido.')}</p><ol style="padding-left:20px;margin:0">${p.questions.map(q => `<li style="margin-bottom:6px">${esc(q)}</li>`).join('')}</ol></div>
      <div class="btns"><button class="btn purple" id="rec">${ICON.mic} Grabar mis respuestas</button><button class="btn sec" id="skip">Ya me grabé · calificarme</button></div>`;
    bindX();
    const goRubric = () => {
      APP.innerHTML = `${head(p)}${p.model ? `<div class="card"><h3>Respuestas modelo</h3><p style="white-space:pre-wrap;margin:0" class="small">${esc(p.model)}</p></div>` : ''}${rubricHTML(p)}<div class="btns"><button class="btn" id="cont">Siguiente</button></div>`;
      APP.querySelector('#cont').onclick = () => { score[pi] = readRubric(); pi++; ii = 0; drawPart(); };
    };
    APP.querySelector('#skip').onclick = goRubric;
    APP.querySelector('#rec').onclick = () => {
      recordScreen({ kind: 'exam', title: p.title, prompt: 'Responde las preguntas en orden, sin leer.', back: location.hash, hint: 'Toca para grabar. Al terminar, toca otra vez.', onDone: goRubric, onCancel: () => drawOral(p) });
    };
  }
  function finish() {
    const total = Object.values(score).reduce((a, b) => a + b, 0);
    const ex = S.exams[id] = S.exams[id] || { hist: [] }; ex.hist.push({ d: today(), score: total });
    logAct('bigexam', 0, total, 100, (Date.now() - t0) / 1000);
    NAV.classList.remove('hidden');
    const ok = total >= E.pass;
    const mods = {}; wrong.forEach(w => { if (w.module) String(w.module).split(/[,\s]+/).filter(Boolean).forEach(mm => mods[mm] = (mods[mm] || 0) + 1); });
    APP.innerHTML = `<div class="celebrate"><div class="score">${total}<small>/100</small></div><span class="${ok ? 'badge-ok' : 'badge-no'}">${ok ? (id === 'C' ? '¡Nivel C1 completado!' : '¡Nivel aprobado! Se desbloqueó el siguiente nivel') : `Necesitas ${E.pass}. Repasa los módulos indicados.`}</span></div>
      <div class="card"><h3>Puntaje por parte</h3>${E.parts.map((p, k) => `<div class="kv"><span>${esc(p.title)}</span><b>${score[k] || 0} / ${p.points}</b></div>`).join('')}</div>
      ${Object.keys(mods).length ? `<div class="card"><h3>Módulos para repasar</h3>${Object.entries(mods).sort((a, b) => b[1] - a[1]).map(([mm, c]) => `<div class="kv"><span>Módulo ${esc(mm)}</span><b>${c} ${c === 1 ? 'fallo' : 'fallos'}</b></div>`).join('')}</div>` : ''}
      <div class="btns"><a class="btn" href="#/home">Ir al inicio</a></div>`;
  }
}

/* ================= MI VOZ ================= */
const WEEKLY = {
  A: [['Tell me about yourself: your name, your city and your job.', 'Preséntate: nombre, ciudad y trabajo.'], ['Describe a normal day at work.', 'Describe un día normal de trabajo.'], ['What did you do last weekend?', '¿Qué hiciste el fin de semana pasado?'], ['What are your plans for next month?', '¿Qué planes tienes para el próximo mes?'], ['Describe your workplace.', 'Describe tu lugar de trabajo.'], ['What can you do well? What can\'t you do yet?', '¿Qué sabes hacer bien y qué todavía no?']],
  B: [['Tell me about a problem at work and how you solved it.', 'Un problema en el trabajo y cómo lo resolviste.'], ['What have you been working on lately?', '¿En qué has estado trabajando últimamente?'], ['If you could work in another country, where would you go and why?', 'Si pudieras trabajar en otro país, ¿dónde y por qué?'], ['Explain a process you know well, step by step.', 'Explica paso a paso un proceso que conoces bien.'], ['What advice would you give a new coworker?', '¿Qué consejo le darías a un compañero nuevo?'], ['Tell me about your last meeting: what did people say?', 'Tu última reunión: ¿qué dijeron?']],
  C: [['Present a project you are proud of in one minute.', 'Presenta en un minuto un proyecto del que estés orgulloso.'], ['Answer an interviewer: "Tell me about yourself."', 'Responde en una entrevista: "Háblame de ti".'], ['Explain something technical from your work to a non-expert.', 'Explica algo técnico de tu trabajo a alguien que no es experto.'], ['Politely disagree with a decision at work.', 'Discrepa con educación de una decisión en el trabajo.'], ['Describe your career plans for the next five years.', 'Tus planes profesionales para los próximos cinco años.'], ['Tell a short story about a mistake you learned from.', 'Cuenta un error del que aprendiste.']],
};
function weeklyPrompt() {
  const L = levelOf(currentModule()); const w = Math.floor((weekStart(new Date()) - weekStart(parseD(S.created))) / (7 * 864e5));
  const list = WEEKLY[L]; return list[((w % list.length) + list.length) % list.length];
}
async function viewVoice() {
  const recs = S.recs.slice().reverse();
  const wk = S.recs.filter(r => r.kind === 'weekly');
  const ws = weekStart(new Date());
  const doneThisWeek = wk.some(r => parseD(r.d) >= ws);
  const [pEn, pEs] = weeklyPrompt();
  const base = wk.length ? wk : S.recs.filter(r => r.kind === 'pres');
  const first = base[0], last = base[base.length - 1];
  const byMonth = {};
  recs.forEach(r => { const d = parseD(r.d); const k = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; (byMonth[k] = byMonth[k] || []).push(r); });
  const label = r => r.kind === 'weekly' ? 'Reto semanal' : r.kind === 'pres' ? `Presentación · Módulo ${r.m}` : 'Examen oral';
  APP.innerHTML = `<div class="top"><div><h1>Mi voz</h1><div class="sub">Tu progreso real: escúchate antes y ahora</div></div>${LOGO}</div>
    <div class="card ${doneThisWeek ? '' : 'accent'}"><div class="kind">Reto de esta semana · 1 minuto</div><h3 style="font-size:18px">${esc(pEn)}</h3><p class="es small" style="margin:0 0 12px">${esc(pEs)}</p>
      ${doneThisWeek ? '<p class="small ok" style="margin:0 0 10px">Ya grabaste tu reto de esta semana. Puedes grabarlo otra vez.</p>' : ''}
      <button class="btn purple" id="wk">${ICON.mic} Grabar mi reto</button></div>
    ${first && last && first !== last ? `<div class="card"><h3>Antes y ahora</h3><p class="muted small">${wk.length ? 'Tu primer reto semanal' : 'Tu primera presentación'} (${fmtDate(first.d)}) frente al más reciente (${fmtDate(last.d)}).</p>
      <div class="compare"><div class="cmp"><div class="lbl">Al inicio</div>${metricsHTML(first)}<button class="audio" data-play="${first.id}" style="margin-top:8px">${ICON.play} Escuchar</button>${first.transcript ? `<div class="tr">${esc(first.transcript)}</div>` : ''}</div>
      <div class="cmp new"><div class="lbl">Ahora</div>${metricsHTML(last)}<button class="audio" data-play="${last.id}" style="margin-top:8px">${ICON.play} Escuchar</button>${last.transcript ? `<div class="tr">${esc(last.transcript)}</div>` : ''}</div></div>
      <div style="margin-top:10px">${diffLine('Palabras por minuto', first.wpm, last.wpm, '')}${diffLine('Palabras dichas', first.words, last.words, '')}${diffLine('Palabras distintas', first.uniq, last.uniq, '')}${diffLine('Tiempo hablando (seg)', first.dur, last.dur, '')}</div></div>`
      : `<div class="fb info">Graba tu reto cada semana. Desde la segunda grabación verás aquí tu voz de antes junto a la de ahora.</div>`}
    <h3 style="margin:18px 0 4px">Todas mis grabaciones</h3>
    ${recs.length ? Object.entries(byMonth).map(([k, list]) => `<div class="month">${k}</div><div class="card" style="padding:4px 16px">${list.map(r => `<div class="vitem"><button class="iconbtn" data-play="${r.id}">${ICON.play}</button><div class="grow"><b>${esc(label(r))}</b><div class="when">${fmtDate(r.d)} · ${fmtDur(r.dur)} min${r.wpm ? ` · ${r.wpm} pal/min` : ''}${r.match != null ? ` · ${r.match}% del texto` : ''}</div></div><button class="btn ghost" style="width:auto;padding:0 6px" data-del="${r.id}">Borrar</button></div>`).join('')}</div>`).join('') : '<p class="muted small">Aún no tienes grabaciones.</p>'}`;
  APP.querySelector('#wk').onclick = () => recordScreen({ kind: 'weekly', title: 'Reto semanal', prompt: pEn, promptEs: pEs, back: '#/voice', hint: 'Habla 1 minuto. No importa si te equivocas: lo importante es hablar.' });
  APP.querySelectorAll('[data-play]').forEach(b => b.onclick = () => playRec(b.dataset.play, b));
  APP.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Borrar esta grabación? No se puede deshacer.')) return;
    const id = b.dataset.del; S.recs = S.recs.filter(r => r.id !== id); save(); try { await IDB.del(id); } catch (e) { } viewVoice();
  });
}

/* ================= PROGRESO ================= */
function cmpLine(label, now, before, unit = '') {
  const d = (now ?? 0) - (before ?? 0);
  const arrow = before == null ? '' : d > 0 ? `<span class="gain">+${d}${unit}</span>` : d < 0 ? `<span class="loss">${d}${unit}</span>` : '<span class="muted">igual</span>';
  return `<div class="kv"><span>${label}</span><b>${now ?? '—'}${now != null ? unit : ''} ${before != null ? `<span class="small muted" style="font-weight:500">(antes ${before}${unit})</span> ${arrow}` : ''}</b></div>`;
}
function monthSummaries() {
  const out = {};
  S.log.forEach(l => { const d = parseD(l.d), k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; const o = out[k] = out[k] || { min: 0, days: new Set(), passed: [], recs: [], ok: 0, tot: 0 }; o.min += l.s / 60; o.days.add(l.d); if ((l.t === 'practice') && l.tot) { o.ok += l.ok; o.tot += l.tot; } });
  Object.entries(S.modules).forEach(([n, ms]) => { const p = (ms.exam || []).find(e => e.score >= 32); if (p) { const d = parseD(p.d), k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; (out[k] = out[k] || { min: 0, days: new Set(), passed: [], recs: [], ok: 0, tot: 0 }).passed.push(+n); } });
  S.recs.forEach(r => { const d = parseD(r.d), k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; (out[k] = out[k] || { min: 0, days: new Set(), passed: [], recs: [], ok: 0, tot: 0 }).recs.push(r); });
  return Object.entries(out).sort((a, b) => b[0].localeCompare(a[0]));
}
async function viewProgress() {
  const w = weekStats(0), pw = weekStats(1);
  const passedMods = DATA.catalog.modules.filter(m => passed(m.id));
  const exams = [];
  Object.entries(S.modules).forEach(([n, ms]) => (ms.exam || []).forEach(e => exams.push({ n: +n, ...e })));
  Object.entries(S.exams).forEach(([id, e]) => (e.hist || []).forEach(h => exams.push({ big: id, ...h })));
  exams.sort((a, b) => b.d.localeCompare(a.d));
  const voicesOpt = TTS.voices.map(v => `<option value="${esc(v.voiceURI)}" ${S.settings.voice === v.voiceURI ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
  const months = monthSummaries();
  APP.innerHTML = `<div class="top"><div><h1>Mi progreso</h1><div class="sub">${esc(S.profile.name)} · empezaste el ${fmtDate(S.created)}</div></div>${LOGO}</div>
    <div class="card"><h3>Esta semana frente a la anterior</h3>
      ${cmpLine('Días practicados', w.days, pw.days)}${cmpLine('Minutos de práctica', w.min, pw.min)}${cmpLine('Aciertos', w.acc, pw.acc, '%')}${cmpLine('Frases nuevas dominadas', w.words, pw.words)}${cmpLine('Grabaciones de voz', w.recs, pw.recs)}</div>
    <div class="card"><h3>Mes a mes</h3>${months.length ? months.map(([k, o]) => { const [y, mo] = k.split('-'); const wp = o.recs.filter(r => r.wpm); const avg = wp.length ? Math.round(wp.reduce((a, r) => a + r.wpm, 0) / wp.length) : null; return `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b style="text-transform:capitalize">${MONTHS[+mo - 1]} ${y}</b><div class="small muted">${Math.round(o.min)} min · ${o.days.size} ${o.days.size === 1 ? 'día' : 'días'} · ${o.passed.length ? `aprobaste ${o.passed.length === 1 ? 'el Módulo ' + o.passed[0] : 'los módulos ' + o.passed.join(', ')}` : 'sin módulos aprobados'}${o.tot ? ` · ${Math.round(100 * o.ok / o.tot)}% aciertos` : ''}${avg ? ` · hablaste a ${avg} pal/min` : ''}</div></div>`; }).join('') : '<p class="muted small">Aquí verás un resumen por mes.</p>'}</div>
    <div class="card"><h3>Mi camino</h3><div class="kv"><span>Módulos aprobados</span><b>${passedMods.length} de 36</b></div><div class="kv"><span>Exámenes integradores</span><b>${['A', 'B', 'C'].filter(bigPassed).length} de 3</b></div><div class="kv"><span>Frases dominadas</span><b>${Object.keys(S.mastered).length}</b></div><div class="kv"><span>Habilidades "Ya puedo…"</span><b>${Object.values(S.modules).reduce((a, ms) => a + Object.values(ms.cando || {}).filter(Boolean).length, 0)}</b></div><div class="kv"><span>Racha actual</span><b>${streak()} ${streak() === 1 ? 'día' : 'días'}</b></div></div>
    <div class="card"><h3>Mis exámenes</h3>${exams.length ? exams.slice(0, 30).map(e => `<div class="kv"><span>${e.big ? DATA.catalog.exams.find(x => x.id === e.big).title : 'Módulo ' + e.n} · <span class="muted small">${fmtDate(e.d)}</span></span><b class="${(e.big ? e.score >= 80 : e.score >= 32) ? 'gain' : 'loss'}">${e.score}/${e.big ? 100 : 40}</b></div>`).join('') : '<p class="muted small">Aún no diste exámenes.</p>'}</div>
    <div class="card"><h3>Ajustes</h3>
      <div class="form"><label>Voz en inglés</label><select class="field" id="voice"><option value="">Automática (la mejor disponible)</option>${voicesOpt}</select>
      <label>Velocidad de la voz</label><select class="field" id="rate">${[[0.85, 'Más lenta'], [1, 'Normal'], [1.1, 'Más rápida']].map(([v, t]) => `<option value="${v}" ${+S.settings.rate === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="check ${S.settings.freeMode ? 'on' : ''}" id="free" style="margin-top:8px"><span class="box"></span><div><b>Modo libre</b><span>Desbloquea todos los módulos sin aprobar exámenes.</span></div></div>
      <div class="btns"><button class="audio" id="tv" style="justify-content:center">${ICON.play} Probar la voz</button><a class="btn sec" href="#/profile">Editar mi perfil</a></div></div>
    <div class="card"><h3>Respaldo</h3><p class="muted small">Tu progreso vive en este dispositivo. Guarda un respaldo de vez en cuando, o úsalo para pasar tu progreso a otro equipo.</p>
      <div class="check" id="inca"><span class="box"></span><div><b>Incluir mis grabaciones</b><span>El archivo pesará más.</span></div></div>
      <div class="btns two"><button class="btn sec" id="exp">Guardar respaldo</button><button class="btn sec" id="imp">Cargar respaldo</button></div><input type="file" id="file" accept=".json,application/json" class="hidden">
      <button class="btn ghost" id="reset" style="margin-top:6px;color:var(--red)">Borrar todo y empezar de cero</button></div>
    <p class="tiny muted center" style="text-align:center">Inglés Práctico · versión ${VERSION}</p>`;
  APP.querySelector('#voice').onchange = e => { S.settings.voice = e.target.value; save(); TTS.say('Hello! This is my English voice.'); };
  APP.querySelector('#rate').onchange = e => { S.settings.rate = +e.target.value; save(); TTS.say('This is the speed of my voice.'); };
  APP.querySelector('#tv').onclick = () => TTS.say(`Hi, I'm ${S.profile.name}. I'm learning English every day.`);
  APP.querySelector('#free').onclick = () => { S.settings.freeMode = !S.settings.freeMode; save(); viewProgress(); };
  APP.querySelector('#inca').onclick = e => e.currentTarget.classList.toggle('on');
  APP.querySelector('#exp').onclick = () => exportBackup(APP.querySelector('#inca').classList.contains('on'));
  APP.querySelector('#imp').onclick = () => APP.querySelector('#file').click();
  APP.querySelector('#file').onchange = e => e.target.files[0] && importBackup(e.target.files[0]);
  APP.querySelector('#reset').onclick = async () => {
    if (!confirm('Se borrará todo tu progreso y tus grabaciones de este dispositivo. ¿Seguro?')) return;
    if (!confirm('Última confirmación: ¿borrar todo?')) return;
    for (const r of S.recs) { try { await IDB.del(r.id); } catch (e) { } }
    localStorage.removeItem(KEY); S = DEFAULT(); location.hash = '#/setup'; location.reload();
  };
}
const b64 = blob => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
async function exportBackup(withAudio) {
  const out = { app: 'ingles-practico', version: VERSION, date: today(), state: S, audio: {} };
  if (withAudio) for (const r of S.recs) { try { const b = await IDB.get(r.id); if (b) out.audio[r.id] = await b64(b); } catch (e) { } }
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const name = `respaldo-ingles-${(S.profile.name || 'yo').toLowerCase().replace(/\W+/g, '')}-${today()}.json`;
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) { await navigator.share({ files: [file], title: 'Respaldo Inglés Práctico' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  toast('Respaldo guardado');
}
async function importBackup(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'ingles-practico' || !d.state) throw new Error('formato');
    if (!confirm(`Cargar el respaldo del ${d.date}? Reemplaza el progreso de este dispositivo.`)) return;
    for (const [id, url] of Object.entries(d.audio || {})) { const blob = await (await fetch(url)).blob(); await IDB.put(id, blob); }
    S = Object.assign(DEFAULT(), d.state); save(); toast('Respaldo cargado'); location.hash = '#/home'; route();
  } catch (e) { toast('Ese archivo no es un respaldo válido'); }
}

/* ================= arranque ================= */
async function boot() {
  try { DATA.catalog = await getJSON('data/catalog.json'); }
  catch (e) {
    APP.innerHTML = `<div class="card"><h2>No se pudieron cargar los datos</h2><p class="muted">${location.protocol === 'file:' ? 'Estás abriendo el archivo directamente. Ábrela desde su link de GitHub Pages (https) o con un servidor local.' : 'Revisa tu conexión e inténtalo de nuevo.'}</p></div>`;
    return;
  }
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
}
boot();
