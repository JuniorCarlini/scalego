// ScaleGo — local-first rotation scheduler. No backend: everything lives in
// localStorage on this device. Visuals and logic ported 1:1 from the
// approved design (ScaleGo Passo a Passo v2). Code/logic in English,
// on-screen text in Portuguese (pt-BR), per project convention.

const STORAGE_KEY = 'scalego:schedule';

const MONTH_LABELS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEKDAY_FULL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const WEEKDAY_FULL_HEADER = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const STEP_LABELS = ['Pessoas', 'Período', 'Dias', 'Ajustar', 'Exportar'];

const PALETTE = [
  ['#EEEAFE', '#4B32C3'], ['#E6F6EC', '#17803D'], ['#FDEFE3', '#B5561A'], ['#E5F1FC', '#1F64B0'],
  ['#FCE8EF', '#B42A5C'], ['#E4F5F4', '#157A73'], ['#F3F0E3', '#7A6A1C'], ['#F0F0F3', '#44444E'],
];

const THEME_UNIFORM = {
  colorful: null,
  neutral: ['#F1F1F4', '#111114'],
  bw: ['#111114', '#FFFFFF'],
  purple: ['#F0EDFF', '#4B32C3'],
};

const THEME_DEFS = [
  { id: 'colorful', label: 'Colorido', swatches: ['#EEEAFE', '#E6F6EC', '#FDEFE3'] },
  { id: 'neutral', label: 'Neutro', swatches: ['#FFFFFF', '#F1F1F4', '#111114'] },
  { id: 'bw', label: 'Preto e branco', swatches: ['#FFFFFF', '#111114'] },
  { id: 'purple', label: 'Roxo', swatches: ['#FFFFFF', '#F0EDFF', '#5B3FE0'] },
];

const MODE_DEFS = [
  { id: 'all', label: 'Todos os dias', hint: 'Domingo a sábado' },
  { id: 'weekend', label: 'Fins de semana', hint: 'Sábado e domingo' },
  { id: 'weekday', label: 'Dias úteis', hint: 'Segunda a sexta' },
  { id: 'custom', label: 'Escolher dias', hint: 'Você marca os dias' },
];

// ---------- persistence ----------

function generateId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptySchedule() {
  const now = new Date();
  return {
    id: generateId(),
    step: 0,
    people: [],
    draft: '',
    year: now.getFullYear(),
    months: [`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`],
    daysMode: 'weekend',
    customWeekdays: [0, 6],
    peoplePerDay: 2,
    rotationMode: 'day',
    availability: {},
    dateBlocks: {},
    overrides: {},
    seed: Math.floor(Math.random() * 1e9),
    scaleName: '',
    logo: null,
    theme: 'colorful',
    view: 'calendar',
    calendarScope: 'selected',
    printDensity: 'comfortable',
    note: '',
    showAvailability: false,
  };
}

function loadSchedule() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return { ...createEmptySchedule(), ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

function saveSchedule() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.schedule));
}

const state = {
  schedule: loadSchedule() || createEmptySchedule(),
  editing: null, // { dateKey, slot, weekday, day, month, year }
  copied: false,
  route: 'app', // 'app' | 'invite' | 'import' — set once from the URL hash at startup
  invitePayload: null,
  inviteSelectedPerson: null,
  inviteBlocked: [],
  inviteResponseLink: null,
  importPayload: null,
};

function persistAndRender() {
  saveSchedule();
  render();
}

// ---------- date helpers ----------

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function activeWeekdaysFor(daysMode, customWeekdays) {
  if (daysMode === 'all') return [0, 1, 2, 3, 4, 5, 6];
  if (daysMode === 'weekday') return [1, 2, 3, 4, 5];
  if (daysMode === 'weekend') return [0, 6];
  return customWeekdays;
}

function activeWeekdays(schedule) {
  return activeWeekdaysFor(schedule.daysMode, schedule.customWeekdays);
}

// ---------- share links (invite + response, no backend) ----------

function encodeHashPayload(obj) {
  const json = encodeURIComponent(JSON.stringify(obj));
  return btoa(unescape(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeHashPayload(str) {
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(decodeURIComponent(escape(atob(padded))));
  } catch {
    return null;
  }
}

function buildInvitePayload(schedule) {
  return {
    id: schedule.id,
    name: schedule.scaleName,
    people: schedule.people,
    months: schedule.months,
    daysMode: schedule.daysMode,
    customWeekdays: schedule.customWeekdays,
  };
}

// Candidate ISO dates for an invite payload — same rule as getScheduleDates
// but working off the small payload shape, not a full schedule object.
function candidateDatesFor(payload) {
  const active = activeWeekdaysFor(payload.daysMode, payload.customWeekdays);
  const dates = [];
  [...payload.months].sort().forEach((key) => {
    const [year, month] = key.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      if (active.includes(date.getDay())) dates.push({ iso: toISODate(date), day, month: month - 1, year, weekday: date.getDay() });
    }
  });
  return dates;
}

function buildInviteLink(schedule) {
  return `${location.origin}${location.pathname}#invite=${encodeHashPayload(buildInvitePayload(schedule))}`;
}

function parseRoute() {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const params = new URLSearchParams(hash);
  const invite = params.get('invite');
  const response = params.get('response');
  if (invite) {
    const payload = decodeHashPayload(invite);
    if (payload) return { route: 'invite', payload };
  }
  if (response) {
    const payload = decodeHashPayload(response);
    if (payload) return { route: 'import', payload };
  }
  return { route: 'app', payload: null };
}

function canWork(schedule, name, weekday) {
  return !(schedule.availability[name] || []).includes(weekday);
}

// Specific one-off dates a person can't attend (e.g. "não posso dia 12"),
// separate from the recurring weekday rule above — used by the invite/response
// link flow, where a participant marks exact dates on the real calendar.
function isBlockedOnDate(schedule, name, dateISO) {
  return (schedule.dateBlocks[name] || []).includes(dateISO);
}

function canWorkOn(schedule, name, weekday, dateISO) {
  return canWork(schedule, name, weekday) && !isBlockedOnDate(schedule, name, dateISO);
}

function sortedMonths(schedule) {
  return [...schedule.months].sort().map((key) => {
    const [year, month] = key.split('-').map(Number);
    return { key, year, month: month - 1 };
  });
}

// ---------- rotation engine (ported from the approved design) ----------

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededOrder(people, seed) {
  const arr = [...people];
  const rand = mulberry32(seed || 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateSchedule(schedule) {
  const order = seededOrder(schedule.people, schedule.seed);
  const rank = {};
  order.forEach((name, i) => (rank[name] = i));
  const counts = {}, last = {}, weekCounts = {};
  schedule.people.forEach((name) => { counts[name] = 0; last[name] = -1; weekCounts[name] = 0; });
  const sortByLoad = (list, load) =>
    list.slice().sort((a, b) => load[a] - load[b] || last[a] - last[b] || rank[a] - rank[b]);

  const active = activeWeekdays(schedule);
  const perDay = Math.max(1, Math.min(schedule.peoplePerDay, Math.max(1, schedule.people.length)));
  const assignments = {};
  let dayIndex = 0, weekKey = null, weekTeam = [];

  sortedMonths(schedule).forEach(({ year, month }) => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const weekday = date.getDay();
      if (!active.includes(weekday)) continue;
      const key = toISODate(date);
      let picked;

      if (schedule.overrides[key]) {
        picked = schedule.overrides[key].filter((name) => schedule.people.includes(name));
      } else {
        const candidates = schedule.people.filter((name) => canWorkOn(schedule, name, weekday, key));
        if (schedule.rotationMode === 'week') {
          const weekStart = new Date(year, month, day - weekday).toDateString();
          if (weekStart !== weekKey) {
            weekKey = weekStart;
            weekTeam = sortByLoad(schedule.people, weekCounts).slice(0, perDay);
            weekTeam.forEach((name) => weekCounts[name]++);
          }
          picked = weekTeam.filter((name) => canWorkOn(schedule, name, weekday, key));
          if (picked.length < perDay) {
            const backfill = sortByLoad(candidates.filter((n) => !picked.includes(n)), counts);
            picked = [...picked, ...backfill.slice(0, perDay - picked.length)];
          }
        } else {
          picked = sortByLoad(candidates, counts).slice(0, perDay);
        }
      }

      picked.forEach((name) => { counts[name]++; last[name] = dayIndex; });
      dayIndex++;
      assignments[key] = picked;
    }
  });

  return { assignments, counts, perDay };
}

function personColors(schedule) {
  const uniform = THEME_UNIFORM[schedule.theme];
  const colors = {};
  schedule.people.forEach((name, i) => {
    const [bg, fg] = PALETTE[i % PALETTE.length];
    colors[name] = uniform ? { bg: uniform[0], fg: uniform[1] } : { bg, fg };
  });
  return colors;
}

// ---------- toast (copy feedback lives inline on the button itself) ----------

function scheduleCopiedReset() {
  clearTimeout(state._copiedTimer);
  state._copiedTimer = setTimeout(() => { state.copied = false; render(); }, 1600);
}

// ---------- small style helpers (exact values from the approved design) ----------

const BTN_SECONDARY =
  'h-10 px-[14px] rounded-[12px] border border-[#E6E6EC] bg-white font-semibold text-[13px] text-[#44444E] hover:bg-[#F4F4F7] cursor-pointer';
const BTN_PRIMARY_FOOTER =
  'h-12 px-6 rounded-[14px] border-none bg-[#111114] text-white font-semibold text-[14px] hover:bg-[#2A2A30] cursor-pointer';
const BTN_SECONDARY_FOOTER =
  'h-12 px-5 rounded-[14px] border border-[#E6E6EC] bg-white font-semibold text-[14px] text-[#111114] hover:bg-[#F4F4F7] cursor-pointer';

function segmented(options, activeId, action) {
  return `
    <div class="grid grid-cols-${options.length} gap-1 p-1 bg-[#F4F4F7] rounded-[12px]">
      ${options.map((opt) => {
        const on = opt.id === activeId;
        return `<button data-action="${action}" data-value="${opt.id}"
          class="tuc-btn h-[34px] px-[14px] rounded-[9px] border-none font-medium text-[13px] cursor-pointer ${on ? 'bg-[#5B3FE0] shadow-[0_1px_2px_rgba(17,17,20,0.08)] font-semibold text-white' : 'bg-transparent text-[#6B6B76]'}">${opt.label}</button>`;
      }).join('')}
    </div>
  `;
}

// ---------- shell ----------

function renderHeader() {
  return `
    <header class="flex items-center justify-between gap-4 px-7 py-[18px] bg-white border-b border-[#EEEEF2]">
      ${renderLogoMark()}
      <button data-action="restart" class="tuc-btn ${BTN_SECONDARY}">Nova escala</button>
    </header>
  `;
}

function renderLogoMark() {
  return `
    <a href="index.html" class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-[10px] bg-[#111114] text-white flex items-center justify-center font-extrabold text-[17px]">S</div>
      <div class="font-extrabold text-[20px] tracking-[-0.02em] text-[#111114]">ScaleGo</div>
    </a>
  `;
}

function shellPage(bodyHtml, { maxW = '480px' } = {}) {
  return `
    <div style="min-height:100vh;display:flex;flex-direction:column">
      <header class="flex items-center gap-4 px-7 py-[18px] bg-white border-b border-[#EEEEF2]">${renderLogoMark()}</header>
      <main class="flex-1 flex flex-col items-center px-3 sm:px-5 pt-9 pb-12 gap-7">
        <section class="w-full max-w-[${maxW}] bg-white border border-[#EEEEF2] rounded-[22px] p-4 sm:p-8 flex flex-col gap-6">
          ${bodyHtml}
        </section>
      </main>
    </div>
  `;
}

// ---------- invite / import routes (URL-based sharing, no backend) ----------

function groupDatesByMonth(dates) {
  const map = new Map();
  dates.forEach((d) => {
    const key = `${d.year}-${d.month}`;
    if (!map.has(key)) map.set(key, { year: d.year, month: d.month, dates: [] });
    map.get(key).dates.push(d);
  });
  return [...map.values()];
}

function renderInviteCalendar(payload) {
  // Same reasoning as the organizer's Ajustar grid: only render the weekday
  // columns that are actually candidate days, so a weekend-only (or similar)
  // schedule gets much wider, easier-to-tap columns on a phone instead of
  // 5 permanently-empty ones.
  const activeCols = activeWeekdaysFor(payload.daysMode, payload.customWeekdays).slice().sort((a, b) => a - b);
  const months = groupDatesByMonth(candidateDatesFor(payload));
  return months.map(({ year, month, dates }) => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const byDay = {};
    dates.forEach((d) => { byDay[d.day] = d; });

    const buildCell = (day) => {
      if (day === null) return '<div></div>';
      const d = byDay[day];
      if (!d) return `<div class="min-h-[76px] p-2 text-[13px] text-[#B8B8C0]">${day}</div>`;
      const blocked = state.inviteBlocked.includes(d.iso);
      return `
        <button data-action="invite-toggle-date" data-date="${d.iso}"
          class="tuc-btn flex flex-col items-start justify-between gap-2 min-h-[76px] p-2 rounded-[12px] text-left cursor-pointer ${blocked
            ? 'border border-dashed border-[#E3A0A0] bg-[#FDF1F1]'
            : 'border border-[#EEEEF2] bg-white hover:bg-[#FAFAFB]'}">
          <span class="text-[13px] font-bold" style="color:${blocked ? '#B42A2A' : '#111114'}">${day}</span>
          ${blocked ? '<span class="text-[11px] font-semibold text-[#B42A2A]">Não posso</span>' : ''}
        </button>
      `;
    };

    const weeks = [];
    let week = new Array(7).fill(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const wd = new Date(year, month, day).getDay();
      week[wd] = day;
      if (wd === 6) { weeks.push(week); week = new Array(7).fill(null); }
    }
    if (week.some((v) => v !== null)) weeks.push(week);

    return `
      <div class="flex flex-col gap-3">
        <div class="font-bold text-[17px]">${MONTH_LABELS[month]} ${year}</div>
        <div class="grid gap-1 sm:gap-[6px]" style="grid-template-columns:repeat(${activeCols.length},minmax(0,1fr))">
          ${activeCols.map((wd) => `<div class="text-[11px] font-bold text-[#8A8A94] uppercase tracking-[0.06em] px-[6px]">${WEEKDAY_SHORT[wd]}</div>`).join('')}
          ${weeks.map((w) => activeCols.map((wd) => buildCell(w[wd])).join('')).join('')}
        </div>
      </div>
    `;
  }).join('');
}

let inviteNameModal = null;

function openInviteNameModal(payload) {
  const wrapper = document.createElement('div');
  wrapper.className = 'flex flex-wrap gap-2';
  wrapper.innerHTML = payload.people.map((name) => `
    <button data-action="invite-pick-person" data-name="${escapeHtml(name)}"
      class="tuc-btn h-10 px-4 rounded-[12px] text-[14px] font-semibold cursor-pointer border border-[#EEEEF2] bg-white text-[#111114] hover:bg-[#FAFAFB]">${escapeHtml(name)}</button>
  `).join('');
  inviteNameModal = new Tucano.Modal({
    title: 'Quem é você?',
    text: 'Escolha seu nome pra ver e marcar seus dias.',
    size: 'sm',
    closable: false,
    closeOnBackdrop: false,
  });
  inviteNameModal.content(wrapper);
  inviteNameModal.open();
}

function renderInviteRoute() {
  const payload = state.invitePayload;
  const person = state.inviteSelectedPerson;
  const link = state.inviteResponseLink;

  if (!person && !link && !state._inviteNameModalShown) {
    state._inviteNameModalShown = true;
    openInviteNameModal(payload);
  }

  const header = `
    <div class="flex flex-col gap-[6px]">
      <div class="text-[13px] font-semibold text-[#5B3FE0]">Convite</div>
      <h1 class="m-0 text-[28px] font-extrabold tracking-[-0.02em]">${escapeHtml(payload.name) || 'Escala'}</h1>
      <p class="m-0 text-[15px] text-[#6B6B76]">${person ? `Toque nos dias que ${escapeHtml(person)} NÃO pode.` : 'Escolha quem você é pra começar.'}</p>
    </div>
  `;

  if (link) {
    return document.getElementById('app').innerHTML = shellPage(`
      ${header}
      <div class="flex flex-col gap-3">
        <p class="text-[14px] text-[#6B6B76]">Prontinho, ${escapeHtml(person)}! Manda esse link de volta pra quem te chamou — é ele que leva sua resposta.</p>
        <div class="p-3 rounded-[12px] border border-[#E6E6EC] bg-[#FBFBFC] text-[13px] break-all">${escapeHtml(link)}</div>
        <div class="grid grid-cols-2 gap-2">
          <button data-action="invite-copy-response" class="tuc-btn h-10 rounded-[12px] border border-[#E6E6EC] bg-white font-semibold text-[13px] hover:bg-[#F4F4F7] cursor-pointer">${state.copied ? 'Copiado' : 'Copiar'}</button>
          <button data-action="invite-whatsapp-response" class="tuc-btn h-10 rounded-[12px] border-none bg-[#111114] text-white font-semibold text-[13px] hover:bg-[#2A2A30] cursor-pointer">WhatsApp</button>
        </div>
      </div>
    `, { maxW: '480px' });
  }

  return document.getElementById('app').innerHTML = shellPage(`
    ${header}
    <div class="flex flex-col gap-2">
      <p class="text-[13px] text-[#8A8A94] m-0">É a data certinha, não o dia da semana — se você pode em todos, não marque nenhum.</p>
      ${renderInviteCalendar(payload)}
    </div>
    ${person ? `<button data-action="invite-generate" class="tuc-btn h-12 rounded-[14px] border-none bg-[#111114] text-white font-semibold text-[14px] hover:bg-[#2A2A30] cursor-pointer">Gerar link de resposta</button>` : ''}
  `, { maxW: '1040px' });
}

function renderImportRoute() {
  const payload = state.importPayload;
  const hasSchedule = state.schedule.people.length > 0;
  const blockedLabel = payload.blockedDates.length
    ? `Não pode nos dias: ${payload.blockedDates.map((iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; }).join(', ')}.`
    : 'Pode participar em todos os dias perguntados.';

  return document.getElementById('app').innerHTML = shellPage(`
    <div class="flex flex-col gap-[6px]">
      <div class="text-[13px] font-semibold text-[#5B3FE0]">Resposta recebida</div>
      <h1 class="m-0 text-[26px] font-extrabold tracking-[-0.02em]">Importar resposta de ${escapeHtml(payload.person)}?</h1>
      <p class="m-0 text-[15px] text-[#6B6B76]">${blockedLabel}</p>
    </div>
    ${!hasSchedule ? `<p class="text-[14px] text-[#B42A2A]">Você não tem nenhuma escala criada neste navegador ainda, então não dá pra importar essa resposta aqui.</p>` : ''}
    <div class="flex gap-3">
      <button data-action="import-cancel" class="tuc-btn h-12 px-5 rounded-[14px] border border-[#E6E6EC] bg-white font-semibold text-[14px] hover:bg-[#F4F4F7] cursor-pointer">Fechar</button>
      ${hasSchedule ? `<button data-action="import-confirm" class="tuc-btn h-12 px-6 rounded-[14px] border-none bg-[#111114] text-white font-semibold text-[14px] hover:bg-[#2A2A30] cursor-pointer">Importar</button>` : ''}
    </div>
  `, { maxW: '480px' });
}

function ok(schedule) {
  return [
    schedule.people.length > 0,
    schedule.months.length > 0,
    activeWeekdays(schedule).length > 0,
    true,
    true,
  ];
}

function maxOk(schedule, index) {
  return ok(schedule).slice(0, index).every(Boolean);
}

function renderStepsNav(schedule, maxW) {
  const step = schedule.step;
  return `
    <nav class="w-full max-w-[${maxW}] grid grid-cols-3 sm:grid-cols-5 gap-x-2 gap-y-4">
      ${STEP_LABELS.map((label, i) => {
        const bar = i <= step ? '#5B3FE0' : '#E6E6EC';
        const ink = i === step ? '#111114' : i < step ? '#5B3FE0' : '#9A9AA4';
        const reachable = maxOk(schedule, i);
        return `<button data-action="go-to-step" data-step="${i}" ${reachable ? '' : 'disabled'}
          class="tuc-btn flex flex-col items-start gap-2 border-none bg-transparent p-0 text-left min-w-0" style="cursor:${reachable ? 'pointer' : 'default'}">
          <div class="h-1 rounded-full w-full" style="background:${bar}"></div>
          <div class="text-[12px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis" style="color:${ink}">${i + 1}. ${label}</div>
        </button>`;
      }).join('')}
    </nav>
  `;
}

function render() {
  if (state.route === 'invite') return renderInviteRoute();
  if (state.route === 'import') return renderImportRoute();

  const schedule = state.schedule;
  const step = schedule.step;
  const maxW = '1040px';
  const copy = [
    ['Quem vai participar?', 'Adicione os nomes das pessoas da escala.'],
    ['Quais meses?', 'Escolha um ou mais meses. A escala continua de um mês para o outro.'],
    ['Em quais dias?', 'Escolha os dias da semana em que alguém precisa estar escalado.'],
    ['Ajuste a escala', 'A escala já foi gerada. Troque nomes, marque quem não pode em algum dia ou mude o revezamento.'],
    ['Estilo e exportação', 'Escolha como a escala vai aparecer e envie para quem precisa.'],
  ][step];

  const stepBody =
    step === 0 ? renderStepPeople(schedule) :
    step === 1 ? renderStepPeriod(schedule) :
    step === 2 ? renderStepDays(schedule) :
    step === 3 ? renderStepAdjust(schedule) :
    renderStepExport(schedule);

  document.getElementById('app').innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column">
      ${renderHeader()}
      <main class="flex-1 flex flex-col items-center px-3 sm:px-5 pt-9 pb-12 gap-7">
        ${renderStepsNav(schedule, maxW)}
        <section class="w-full max-w-[${maxW}] bg-white border border-[#EEEEF2] rounded-[22px] p-4 sm:p-8 flex flex-col gap-6">
          <div class="flex flex-col gap-[6px]">
            <div class="text-[13px] font-semibold text-[#5B3FE0]">Passo ${step + 1} de 5</div>
            <h1 class="m-0 text-[28px] font-extrabold tracking-[-0.02em]">${copy[0]}</h1>
            <p class="m-0 text-[15px] text-[#6B6B76]">${copy[1]}</p>
          </div>
          ${stepBody}
          ${renderFooterNav(schedule)}
        </section>
      </main>
    </div>
  `;

  const personInput = document.getElementById('personInput');
  if (personInput && document.activeElement !== personInput && state._focusPersonInput) {
    personInput.focus();
  }

  if (step === 4) initExportStepExtras();
}

// A fresh <textarea id="noteEditor"> is created by every render() (innerHTML
// wipe), so it needs a fresh rich-text editor instance each time too — the
// declarative data-tuc-editor auto-init doesn't let us trim the toolbar, so
// this is wired up by hand instead.
function initExportStepExtras() {
  const field = document.getElementById('noteEditor');
  if (field && window.Tucano?.Editor) {
    const editor = new Tucano.Editor(field, {
      toolbar: ['bold', 'italic', 'list', 'left', 'center', 'right', 'justify', 'link'],
      minHeight: '70px',
      placeholder: 'Um aviso pra quem for ver a escala...',
    });
    // The editor's own toolbar buttons already carry data-tuc-tip — Tucano
    // just doesn't auto-scan for it here since these buttons didn't exist at
    // page load, so its native tooltips need to be switched on by hand too.
    window.Tucano?.autoInitTooltips?.(editor.root);
    field.addEventListener('input', () => {
      state.schedule.note = field.value;
      saveSchedule();
      const previewNote = document.getElementById('previewNote');
      if (previewNote) previewNote.innerHTML = field.value;
    });
  }
  renderPageBreakMarkers();
}

// Rough visual guide only — the real page size depends on the printer/paper
// the person picks, so this estimates a common A4-ish printable height and
// draws a dashed line where a page would likely break.
const PRINT_PAGE_HEIGHT_PX = 970;

function renderPageBreakMarkers() {
  const container = document.getElementById('previewPaper');
  if (!container) return;
  container.querySelectorAll('.scalego-page-break').forEach((el) => el.remove());
  const blocks = Array.from(container.querySelectorAll('.scalego-print-month'));
  let cumulative = 0;
  blocks.forEach((block) => {
    const h = block.offsetHeight + 10;
    if (cumulative > 0 && cumulative + h > PRINT_PAGE_HEIGHT_PX) {
      const marker = document.createElement('div');
      marker.className = 'scalego-page-break';
      marker.style.cssText = 'position:relative;margin:8px 0;border-top:1px dashed #C9C9D2';
      marker.innerHTML = '<span style="position:absolute;top:-8px;right:0;background:#fff;padding:0 6px;font-size:10px;color:#8A8A94">quebra de página (estimativa)</span>';
      container.insertBefore(marker, block);
      cumulative = 0;
    }
    cumulative += h;
  });
}

function renderFooterNav(schedule) {
  const step = schedule.step;
  const last = step === 4;
  const okArr = ok(schedule);
  const hints = [
    `${schedule.people.length} ${schedule.people.length === 1 ? 'pessoa' : 'pessoas'}`,
    `${schedule.months.length} ${schedule.months.length === 1 ? 'mês' : 'meses'}`,
    '', '', '',
  ];
  if (step === 2 || step === 3) {
    const { assignments } = generateSchedule(schedule);
    const total = Object.keys(assignments).length;
    hints[2] = `${total} dias na escala`;
    hints[3] = `${total} dias na escala`;
  }
  const nextLabel = step === 2 ? 'Gerar escala' : 'Continuar';
  const nextOk = !last && okArr[step];
  const nextBlocked = !last && !okArr[step];

  return `
    <div class="flex justify-between items-center gap-3 pt-5 border-t border-[#F1F1F4]">
      ${step > 0 ? `<button data-action="back" class="tuc-btn ${BTN_SECONDARY_FOOTER}">Voltar</button>` : '<div></div>'}
      <div class="text-[13px] text-[#6B6B76] text-center">${hints[step]}</div>
      ${nextOk ? `<button data-action="next" class="tuc-btn ${BTN_PRIMARY_FOOTER}">${nextLabel}</button>` : ''}
      ${nextBlocked ? `<button disabled class="tuc-btn h-12 px-6 rounded-[14px] border-none bg-[#E6E6EC] text-[#9A9AA4] font-semibold text-[14px] cursor-not-allowed">${nextLabel}</button>` : ''}
      ${last ? '<div></div>' : ''}
    </div>
  `;
}

// ---------- step 1: pessoas ----------

function renderStepPeople(schedule) {
  const colors = personColors(schedule);
  return `
    <div class="flex flex-col gap-4">
      <div class="flex gap-2">
        <input id="personInput" type="text" value="${escapeHtml(schedule.draft)}" placeholder="Digite um nome e aperte Enter"
          class="flex-1 min-w-0 h-[50px] rounded-[14px] border border-[#E6E6EC] px-4 text-[15px] outline-none bg-[#FBFBFC] text-[#111114] focus:border-[#5B3FE0] focus:bg-white">
        <button data-action="add-person" class="tuc-btn h-[50px] px-[18px] rounded-[14px] border-none bg-[#F0EDFF] text-[#5B3FE0] text-[14px] font-bold hover:bg-[#E4DEFF] cursor-pointer">Adicionar</button>
      </div>
      <div class="flex flex-wrap gap-2 min-h-[36px]">
        ${schedule.people.map((name) => {
          const c = colors[name];
          return `<div class="flex items-center gap-1.5 h-10 pl-[14px] pr-2 rounded-[10px] text-[14px] font-semibold" style="background:${c.bg};color:${c.fg}">
            ${escapeHtml(name)}
            <button data-action="remove-person" data-name="${escapeHtml(name)}" aria-label="Remover ${escapeHtml(name)}"
              class="flex items-center justify-center flex-shrink-0 w-5 h-5 rounded-full border-none bg-black/10 hover:bg-black/25 active:bg-black/35 cursor-pointer transition-colors" style="color:inherit">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="M5 5L19 19M19 5L5 19"/></svg>
            </button>
          </div>`;
        }).join('')}
      </div>
      <div class="text-[13px] text-[#8A8A94]">Pode colar vários nomes separados por vírgula.</div>
    </div>
  `;
}

function addPeopleFromDraft() {
  const names = state.schedule.draft.split(/[,;\n]/).map((n) => n.trim()).filter(Boolean);
  if (!names.length) return;
  names.forEach((name) => {
    if (!state.schedule.people.includes(name)) state.schedule.people.push(name);
  });
  state.schedule.draft = '';
}

// ---------- step 2: período ----------

function renderStepPeriod(schedule) {
  return `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <button data-action="prev-year" class="tuc-btn p-0 w-9 h-9 min-w-0 rounded-[10px] border border-[#EEEEF2] bg-white cursor-pointer text-[#44444E] text-[16px]">‹</button>
        <div class="font-bold text-[16px]">${schedule.year}</div>
        <button data-action="next-year" class="tuc-btn p-0 w-9 h-9 min-w-0 rounded-[10px] border border-[#EEEEF2] bg-white cursor-pointer text-[#44444E] text-[16px]">›</button>
      </div>
      <div class="grid gap-2" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr))">
        ${MONTH_LABELS.map((label, i) => {
          const key = `${schedule.year}-${String(i + 1).padStart(2, '0')}`;
          const on = schedule.months.includes(key);
          return `<button data-action="toggle-month" data-month="${key}"
            class="tuc-btn h-12 rounded-[12px] text-[14px] cursor-pointer ${on
              ? 'border border-[#5B3FE0] bg-[#5B3FE0] text-white font-semibold'
              : 'border border-[#EEEEF2] bg-white text-[#44444E] font-medium hover:bg-[#F6F6F9]'}">${label}</button>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ---------- step 3: dias ----------

function renderStepDays(schedule) {
  const active = activeWeekdays(schedule);
  return `
    <div class="flex flex-col gap-[22px]">
      <div class="grid grid-cols-2 gap-2">
        ${MODE_DEFS.map((mode) => {
          const on = schedule.daysMode === mode.id;
          return `<button data-action="set-days-mode" data-mode="${mode.id}"
            class="tuc-btn flex flex-col items-start justify-center gap-1 h-[72px] px-3 rounded-[12px] text-left cursor-pointer" style="border:1.5px solid ${on ? '#5B3FE0' : '#EEEEF2'};background:${on ? '#F0EDFF' : '#fff'}">
            <span class="font-semibold text-[14px]" style="color:${on ? '#3F27B8' : '#111114'}">${mode.label}</span>
            <span class="text-[12px]" style="color:${on ? '#5B3FE0' : '#8A8A94'}">${mode.hint}</span>
          </button>`;
        }).join('')}
      </div>
      ${schedule.daysMode === 'custom' ? `
        <div class="grid grid-cols-7 gap-[6px]">
          ${WEEKDAY_SHORT.map((label, i) => {
            const on = active.includes(i);
            return `<button data-action="toggle-custom-weekday" data-weekday="${i}"
              class="tuc-btn h-11 rounded-[12px] text-[13px] cursor-pointer ${on
                ? 'border border-[#5B3FE0] bg-[#5B3FE0] text-white font-bold'
                : 'border border-[#EEEEF2] bg-white text-[#6B6B76] font-medium hover:bg-[#F6F6F9]'}">${label}</button>`;
          }).join('')}
        </div>
      ` : ''}
      <div class="flex justify-between items-center gap-3 p-4 rounded-[14px] bg-[#FAFAFB] flex-wrap">
        <div class="flex flex-col gap-[2px]">
          <div class="text-[15px] font-bold">Pessoas por dia</div>
          <div class="text-[13px] text-[#6B6B76]">Quantas pessoas trabalham em cada dia</div>
        </div>
        <div class="flex items-center gap-[10px]">
          <button data-action="dec-people-per-day" class="tuc-btn p-0 w-10 h-10 min-w-0 rounded-[12px] border border-[#E6E6EC] bg-white cursor-pointer text-[18px] text-[#44444E]">−</button>
          <div class="font-extrabold text-[18px] min-w-[20px] text-center">${schedule.peoplePerDay}</div>
          <button data-action="inc-people-per-day" class="tuc-btn p-0 w-10 h-10 min-w-0 rounded-[12px] border border-[#E6E6EC] bg-white cursor-pointer text-[18px] text-[#44444E]">+</button>
        </div>
      </div>
    </div>
  `;
}

// ---------- step 4: ajustar ----------

function renderGapAlert(gaps) {
  const label = gaps === 1 ? '1 dia precisa de alguém' : `${gaps} dias precisam de alguém`;
  return `
    <div class="tuc-alert is-warning" role="alert">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>
      </svg>
      <div class="tuc-alert__body">
        <p class="tuc-alert__title">${label}</p>
        <p>Clique em "+ Adicionar" nos dias em laranja no calendário abaixo pra completar a escala.</p>
      </div>
    </div>
  `;
}

function renderStepAdjust(schedule) {
  const colors = personColors(schedule);
  const { assignments, counts, perDay } = generateSchedule(schedule);
  const hasOverrides = Object.keys(schedule.overrides).length > 0;
  const blockedCount = Object.values(schedule.availability).reduce((a, b) => a + b.length, 0)
    + Object.values(schedule.dateBlocks).reduce((a, b) => a + b.length, 0);
  let gaps = 0;

  // Only the weekday columns actually used by the schedule are rendered —
  // showing all 7 when, say, only weekends are scheduled would waste 5/7 of
  // the grid on columns that can never hold an assignment, which is
  // especially costly on narrow (mobile) screens.
  const activeCols = activeWeekdays(schedule).slice().sort((a, b) => a - b);

  const monthsHtml = sortedMonths(schedule).map(({ year, month }) => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let scheduledDays = 0;

    const buildCell = (day) => {
      if (day === null) return '<div></div>';
      const date = new Date(year, month, day);
      const weekday = date.getDay();
      const key = toISODate(date);
      const names = assignments[key];
      if (names === undefined) {
        return `<div class="min-h-[76px] sm:min-h-[96px] rounded-[12px] bg-[#FAFAFB] p-1.5 sm:p-2 min-w-0"><div class="text-[13px] font-medium text-[#B8B8C0]">${day}</div></div>`;
      }
      scheduledDays++;
      const missing = Math.max(0, perDay - names.length);
      if (missing) gaps++;
      const border = missing ? '#F0D9B0' : '#EEEEF2';
      const edited = !!schedule.overrides[key];
      const peopleHtml = names.map((name, slot) => {
        const c = colors[name];
        return `<button data-action="open-editor" data-date="${key}" data-slot="${slot}" data-weekday="${weekday}" data-day="${day}" data-month="${month}" data-year="${year}"
          class="tuc-btn justify-start text-[11px] sm:text-[12px] font-semibold px-1 sm:px-[7px] py-[3px] rounded-[7px] border-none text-left cursor-pointer w-full whitespace-nowrap overflow-hidden text-ellipsis hover:brightness-[0.96]" style="background:${c.bg};color:${c.fg}">${escapeHtml(name)}</button>`;
      }).join('');
      const gapHtml = Array.from({ length: missing }, () =>
        `<button data-action="open-editor" data-date="${key}" data-slot="${names.length}" data-weekday="${weekday}" data-day="${day}" data-month="${month}" data-year="${year}"
          class="tuc-btn justify-start text-[11px] sm:text-[12px] font-semibold px-1 sm:px-[7px] py-[3px] rounded-[7px] border border-dashed border-[#E0C08A] bg-[#FFF9EF] text-[#9A5B00] text-left cursor-pointer w-full">+ Adicionar</button>`
      ).join('');
      return `
        <div class="min-h-[76px] sm:min-h-[96px] rounded-[12px] bg-white p-1.5 sm:p-2 flex flex-col gap-[5px] min-w-0" style="border:1px solid ${border}">
          <div class="flex justify-between items-center">
            <span class="text-[13px] font-bold">${day}</span>
            ${edited ? '<span class="w-[6px] h-[6px] rounded-full" style="background:#5B3FE0"></span>' : ''}
          </div>
          ${peopleHtml}${gapHtml}
        </div>
      `;
    };

    const weeks = [];
    let week = new Array(7).fill(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const wd = new Date(year, month, day).getDay();
      week[wd] = day;
      if (wd === 6) { weeks.push(week); week = new Array(7).fill(null); }
    }
    if (week.some((v) => v !== null)) weeks.push(week);
    // Built into a variable (not inline in the template below) because
    // buildCell has the scheduledDays/gaps side effects — the template's
    // "${scheduledDays} dias" badge sits textually before this grid, and
    // template substitutions evaluate left to right, so inlining it here
    // would read scheduledDays before any cell incremented it.
    const gridHtml = weeks.map((w) => activeCols.map((wd) => buildCell(w[wd])).join('')).join('');

    return `
      <div class="flex flex-col gap-3">
        <div class="flex justify-between items-center">
          <div class="font-bold text-[17px]">${MONTH_LABELS[month]} ${year}</div>
          <div class="h-7 px-3 rounded-[8px] bg-[#E8F7EE] text-[#1FA34A] font-semibold text-[13px] flex items-center">${scheduledDays} dias</div>
        </div>
        <div class="grid gap-1 sm:gap-[6px]" style="grid-template-columns:repeat(${activeCols.length},minmax(0,1fr))">
          ${activeCols.map((wd) => `<div class="text-[11px] font-bold text-[#8A8A94] uppercase tracking-[0.06em] px-[6px]">${WEEKDAY_SHORT[wd]}</div>`).join('')}
          ${gridHtml}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="flex flex-col gap-5">
      <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div class="flex items-center gap-[10px] flex-wrap">
          <span class="text-[13px] font-semibold text-[#6B6B76]">Revezar</span>
          ${segmented([{ id: 'day', label: 'Por dia' }, { id: 'week', label: 'Por semana' }], schedule.rotationMode, 'set-rotation-mode')}
        </div>
        <div class="grid grid-cols-2 sm:flex gap-2 sm:flex-wrap">
          ${hasOverrides ? `<button data-action="undo-overrides" class="tuc-btn ${BTN_SECONDARY}">Desfazer trocas</button>` : ''}
          <button data-action="toggle-availability" class="tuc-btn h-10 px-[14px] rounded-[12px] font-semibold text-[13px] cursor-pointer"
            style="border:1px solid ${schedule.showAvailability ? '#5B3FE0' : '#E6E6EC'};background:${schedule.showAvailability ? '#F0EDFF' : '#fff'};color:${schedule.showAvailability ? '#5B3FE0' : '#111114'}">Disponibilidade${blockedCount ? ` · ${blockedCount}` : ''}</button>
          <button data-action="open-invite-modal" class="tuc-btn ${BTN_SECONDARY}">Convidar por link</button>
          <button data-action="shuffle" class="tuc-btn ${BTN_SECONDARY.replace('text-[#44444E]', 'text-[#111114]')}">Embaralhar</button>
        </div>
      </div>

      ${schedule.showAvailability ? `
        <div class="flex flex-col gap-3 p-[18px] rounded-[14px] bg-[#FAFAFB] border border-[#EEEEF2]">
          <div class="flex flex-col gap-[2px]">
            <div class="text-[15px] font-bold">Quem não pode em algum dia?</div>
            <div class="text-[13px] text-[#6B6B76]">Toque no dia para marcar que a pessoa não pode. A escala se reorganiza sozinha.</div>
          </div>
          ${schedule.people.map((name) => {
            const c = colors[name];
            const days = activeWeekdays(schedule);
            return `<div class="flex items-center gap-3">
              <div class="flex-none min-w-[110px] h-8 px-3 rounded-[10px] text-[13px] font-semibold flex items-center whitespace-nowrap" style="background:${c.bg};color:${c.fg}">${escapeHtml(name)}</div>
              <div class="flex-1 grid gap-[6px]" style="grid-template-columns:repeat(${days.length},minmax(0,1fr))">
                ${days.map((wd) => {
                  const can = canWork(schedule, name, wd);
                  return `<button data-action="toggle-availability-day" data-name="${escapeHtml(name)}" data-weekday="${wd}"
                    class="tuc-btn h-8 px-[10px] rounded-[10px] text-[12px] font-semibold cursor-pointer ${can
                      ? 'border border-[#E6E6EC] bg-white text-[#111114] hover:border-[#C9C9D2]'
                      : 'border border-dashed border-[#E3A0A0] bg-[#FDF1F1] text-[#B42A2A] line-through'}">${WEEKDAY_SHORT[wd]}</button>`;
                }).join('')}
              </div>
            </div>`;
          }).join('')}
        </div>
      ` : ''}

      <div class="flex flex-wrap gap-2 items-center">
        ${schedule.people.map((name) => {
          const c = colors[name];
          return `<div class="flex items-center gap-2 h-8 px-3 rounded-[10px] text-[13px] font-semibold" style="background:${c.bg};color:${c.fg}">${escapeHtml(name)} <span class="font-extrabold">${counts[name] || 0}</span></div>`;
        }).join('')}
      </div>
      ${gaps ? renderGapAlert(gaps) : ''}
      <div class="text-[13px] text-[#8A8A94]">Clique em um nome no calendário para trocar ou remover.</div>

      ${monthsHtml}
    </div>
  `;
}

// ---------- editing modal (real Tucano.Modal instance) ----------

let currentEditModal = null;

function buildEditorOptionsNode(schedule) {
  const { assignments, counts } = generateSchedule(schedule);
  const colors = personColors(schedule);
  const E = state.editing;
  const names = assignments[E.dateKey] || [];
  const currentName = names[E.slot];

  const optionsHtml = schedule.people.map((name) => {
    const isCurrent = name === currentName;
    const isOther = !isCurrent && names.includes(name);
    const canDay = canWork(schedule, name, E.weekday);
    const note = isCurrent ? 'Atual' : isOther ? 'Já está no dia' : !canDay ? `Não pode ${WEEKDAY_FULL[E.weekday]}` : `${counts[name] || 0} dias`;
    const noteColor = isCurrent ? '#5B3FE0' : !canDay ? '#B42A2A' : '#8A8A94';
    const border = isCurrent ? '#5B3FE0' : '#EEEEF2';
    const opacity = isOther ? 0.45 : 1;
    const c = colors[name];
    return `<button data-action="pick-replacement" data-name="${escapeHtml(name)}" ${isCurrent || isOther ? 'disabled' : ''}
      class="tuc-btn flex items-center justify-between gap-[10px] h-[46px] px-3 rounded-[12px] bg-white cursor-pointer hover:bg-[#FAFAFB]" style="border:1px solid ${border};opacity:${opacity}">
      <span class="h-[30px] px-3 rounded-[9px] text-[13px] font-semibold flex items-center" style="background:${c.bg};color:${c.fg}">${escapeHtml(name)}</span>
      <span class="text-[12px] font-semibold" style="color:${noteColor}">${note}</span>
    </button>`;
  }).join('');

  const wrapper = document.createElement('div');
  wrapper.className = 'flex flex-col gap-[6px]';
  wrapper.innerHTML = optionsHtml;
  return wrapper;
}

function openEditor(payload) {
  state.editing = payload;
  const schedule = state.schedule;
  const { assignments } = generateSchedule(schedule);
  const names = assignments[payload.dateKey] || [];
  const currentName = names[payload.slot];
  const editDate = `${WEEKDAY_FULL[payload.weekday][0].toUpperCase() + WEEKDAY_FULL[payload.weekday].slice(1)}, ${payload.day} de ${MONTH_LABELS[payload.month].toLowerCase()}`;

  currentEditModal = new Tucano.Modal({
    title: currentName ? `Trocar ${currentName}` : 'Adicionar pessoa',
    text: editDate,
    size: 'md',
    closable: true,
    closeOnBackdrop: true,
    actions: currentName ? [{ text: 'Remover deste dia', variant: 'danger', onClick: removeFromDay }] : null,
    onClose: () => { state.editing = null; currentEditModal = null; },
  });
  currentEditModal.content(buildEditorOptionsNode(schedule));
  currentEditModal.open();
}

function pickReplacement(name) {
  const schedule = state.schedule;
  const { assignments } = generateSchedule(schedule);
  const E = state.editing;
  const names = (assignments[E.dateKey] || []).slice();
  names[E.slot] = name;
  schedule.overrides[E.dateKey] = names;
  currentEditModal?.close('action');
  persistAndRender();
}

function removeFromDay() {
  const schedule = state.schedule;
  const { assignments } = generateSchedule(schedule);
  const E = state.editing;
  schedule.overrides[E.dateKey] = (assignments[E.dateKey] || []).filter((_, i) => i !== E.slot);
  persistAndRender();
}

// ---------- invite modal (organizer side, real Tucano.Modal instance) ----------

function openInviteModal() {
  const link = buildInviteLink(state.schedule);
  const wrapper = document.createElement('div');
  wrapper.className = 'flex flex-col gap-3';
  wrapper.innerHTML = `
    <p class="text-[13px] text-[#6B6B76]">Manda esse link pra cada pessoa marcar sozinha os dias que ela não pode. Quando ela te mandar o link de resposta de volta, abra ele neste mesmo navegador pra importar.</p>
    <div class="p-3 rounded-[12px] border border-[#E6E6EC] bg-[#FBFBFC] text-[13px] break-all">${escapeHtml(link)}</div>
    <div class="grid grid-cols-2 gap-2">
      <button data-action="invite-copy" data-link="${escapeHtml(link)}" class="tuc-btn h-10 rounded-[12px] border border-[#E6E6EC] bg-white font-semibold text-[13px] hover:bg-[#F4F4F7] cursor-pointer">Copiar link</button>
      <button data-action="invite-whatsapp" data-link="${escapeHtml(link)}" class="tuc-btn h-10 rounded-[12px] border-none bg-[#111114] text-white font-semibold text-[13px] hover:bg-[#2A2A30] cursor-pointer">WhatsApp</button>
    </div>
  `;
  const modal = new Tucano.Modal({
    title: 'Convidar por link',
    text: 'Sem conta, sem servidor — a resposta volta como um link.',
    size: 'md',
    closable: true,
    closeOnBackdrop: true,
  });
  modal.content(wrapper);
  modal.open();
}

// ---------- step 5: estilo e exportar ----------

function renderStepExport(schedule) {
  const colors = personColors(schedule);
  const { assignments } = generateSchedule(schedule);
  const months = sortedMonths(schedule);

  const previewHtml = renderPreviewPaper(schedule, colors, assignments, months);

  return `
    <div class="flex flex-wrap gap-6 items-start">
      <div class="w-full sm:w-auto sm:flex-[0_1_300px] min-w-[260px] flex flex-col gap-[22px]">
        <div class="flex flex-col gap-2">
          <div class="text-[14px] font-bold">Nome da escala</div>
          <input id="scaleNameInput" type="text" value="${escapeHtml(schedule.scaleName)}" placeholder="Escala de setembro"
            class="h-[46px] rounded-[12px] border border-[#E6E6EC] px-[14px] text-[14px] outline-none bg-[#FBFBFC] text-[#111114] focus:border-[#5B3FE0] focus:bg-white">
        </div>
        <div class="flex flex-col gap-2">
          <div class="text-[14px] font-bold">Logo</div>
          ${schedule.logo ? `
            <div class="flex items-center gap-3 p-[10px] rounded-[12px] border border-[#EEEEF2]">
              <img src="${schedule.logo}" alt="Logo" class="w-11 h-11 rounded-[10px] object-contain bg-[#FAFAFB]">
              <div class="flex-1 grid grid-cols-2 gap-[6px]">
                <label class="tuc-btn h-9 rounded-[10px] border border-[#E6E6EC] bg-white font-semibold text-[13px] hover:bg-[#F4F4F7] cursor-pointer flex items-center justify-center">
                  Trocar<input id="logoInput" type="file" accept="image/*" class="hidden">
                </label>
                <button data-action="remove-logo" class="tuc-btn h-9 rounded-[10px] border border-[#F3D0D0] bg-[#FDF5F5] font-semibold text-[13px] text-[#B42A2A] cursor-pointer">Remover</button>
              </div>
            </div>
          ` : `
            <label class="tuc-btn h-[72px] rounded-[12px] border-[1.5px] border-dashed border-[#D9D9E0] bg-[#FBFBFC] flex flex-col items-center justify-center gap-[2px] cursor-pointer hover:border-[#5B3FE0] hover:bg-[#F7F5FF]">
              <span class="font-semibold text-[14px]">Enviar logo</span>
              <span class="text-[12px] text-[#8A8A94]">PNG, JPG ou SVG</span>
              <input id="logoInput" type="file" accept="image/*" class="hidden">
            </label>
          `}
        </div>
        <div class="flex flex-col gap-2">
          <div class="text-[14px] font-bold">Visual</div>
          <div class="grid grid-cols-2 gap-2">
            ${THEME_DEFS.map((theme) => {
              const on = schedule.theme === theme.id;
              return `<button data-action="set-theme" data-theme="${theme.id}"
                class="tuc-btn flex flex-col items-start justify-center gap-2 h-[72px] px-3 rounded-[12px] cursor-pointer" style="border:1.5px solid ${on ? '#5B3FE0' : '#EEEEF2'};background:${on ? '#F7F5FF' : '#fff'}">
                <span class="font-semibold text-[14px]">${theme.label}</span>
                <span class="flex gap-1">
                  ${theme.swatches.map((sw) => `<span class="w-[18px] h-[18px] rounded-[5px] border border-[#E6E6EC]" style="background:${sw}"></span>`).join('')}
                </span>
              </button>`;
            }).join('')}
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <div class="text-[14px] font-bold">Formato</div>
          ${segmented([{ id: 'calendar', label: 'Calendário' }, { id: 'list', label: 'Lista' }], schedule.view, 'set-view')}
        </div>
        ${schedule.view === 'calendar' && activeWeekdays(schedule).length < 7 ? `
          <div class="flex flex-col gap-2">
            <div class="text-[14px] font-bold">Colunas do calendário</div>
            ${segmented([{ id: 'full', label: 'Completo' }, { id: 'selected', label: 'Só dias usados' }], schedule.calendarScope, 'set-calendar-scope')}
            <div class="text-[12px] text-[#8A8A94]">"Só dias usados" tira as colunas dos dias da semana que não entram na escala.</div>
          </div>
        ` : ''}
        <div class="flex flex-col gap-2">
          <div class="text-[14px] font-bold">Espaçamento</div>
          ${segmented([{ id: 'comfortable', label: 'Confortável' }, { id: 'compact', label: 'Compacto' }], schedule.printDensity, 'set-print-density')}
          <div class="text-[12px] text-[#8A8A94]">"Compacto" deixa as células menores pra caber mais meses por página no PDF.</div>
        </div>
        <div class="flex flex-col gap-2 pt-[18px] border-t border-[#F1F1F4]">
          <div class="text-[14px] font-bold">Comunicado</div>
          <textarea id="noteEditor" placeholder="Um aviso pra quem for ver a escala...">${escapeHtml(schedule.note)}</textarea>
        </div>
        <div class="flex flex-col gap-2 pt-[18px] border-t border-[#F1F1F4]">
          <div class="text-[14px] font-bold">Exportar</div>
          <div class="grid grid-cols-2 gap-2">
            <button data-action="export-whatsapp" class="tuc-btn h-[42px] rounded-[12px] border-none bg-[#111114] text-white font-semibold text-[13px] hover:bg-[#2A2A30] cursor-pointer">WhatsApp</button>
            <button data-action="export-copy" class="tuc-btn h-[42px] rounded-[12px] border border-[#E6E6EC] bg-white font-semibold text-[13px] hover:bg-[#F4F4F7] cursor-pointer">${state.copied ? 'Copiado' : 'Copiar'}</button>
            <button data-action="export-pdf" class="tuc-btn h-[42px] rounded-[12px] border border-[#E6E6EC] bg-white font-semibold text-[13px] hover:bg-[#F4F4F7] cursor-pointer">PDF</button>
            <button data-action="export-csv" class="tuc-btn h-[42px] rounded-[12px] border border-[#E6E6EC] bg-white font-semibold text-[13px] hover:bg-[#F4F4F7] cursor-pointer">Planilha</button>
          </div>
        </div>
      </div>

      <div id="previewPaper" class="flex-[1_1_420px] min-w-0 rounded-[18px] border border-[#EEEEF2] bg-white p-6 flex flex-col gap-5">
        ${previewHtml}
      </div>
    </div>
  `;
}

const PRINT_DENSITY = {
  comfortable: { cellMin: 64, cellPad: 6, gridGap: 4, monthGap: 10, dayFont: 11, nameFont: 10, headerFont: 10 },
  compact: { cellMin: 40, cellPad: 3, gridGap: 2, monthGap: 5, dayFont: 10, nameFont: 9, headerFont: 9 },
};

function renderPreviewPaper(schedule, colors, assignments, months) {
  const cellBorder = schedule.theme === 'bw' ? '#D6D6DC' : '#EEEEF2';
  const d = PRINT_DENSITY[schedule.printDensity] || PRINT_DENSITY.comfortable;
  const header = `
    <div class="flex items-center gap-[14px]">
      ${schedule.logo ? `<img src="${schedule.logo}" alt="Logo" style="height:44px;max-width:120px;object-fit:contain">` : ''}
      <div class="text-[22px] font-extrabold tracking-[-0.02em]">${escapeHtml(schedule.scaleName) || 'Escala sem nome'}</div>
    </div>
  `;
  const monthsHtml = months.map(({ year, month }) => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = new Date(year, month, 1).getDay();
    if (schedule.view === 'list') {
      const rows = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const key = toISODate(date);
        const names = assignments[key];
        if (names === undefined) continue;
        rows.push(`
          <div class="flex items-center gap-[14px] flex-wrap" style="padding:${d.cellPad + 4}px 0;border-top:1px solid ${cellBorder}">
            <div class="flex items-baseline gap-2 min-w-[80px]">
              <span class="font-extrabold text-[15px]">${String(day).padStart(2, '0')}</span>
              <span class="text-[12px] text-[#8A8A94] font-semibold">${WEEKDAY_SHORT[date.getDay()]}</span>
            </div>
            <div class="flex flex-wrap gap-[6px]">
              ${names.map((n) => `<div class="text-[12px] font-semibold px-[9px] py-1 rounded-[7px]" style="background:${colors[n].bg};color:${colors[n].fg}">${escapeHtml(n)}</div>`).join('')}
            </div>
          </div>
        `);
      }
      return `<div class="scalego-print-month flex flex-col gap-[10px]"><div class="font-bold text-[15px]">${MONTH_LABELS[month]} ${year}</div><div class="flex flex-col">${rows.join('')}</div></div>`;
    }
    const renderCell = (day) => {
      if (day === null) return '<div></div>';
      const date = new Date(year, month, day);
      const key = toISODate(date);
      const names = assignments[key];
      if (names === undefined) {
        return `<div style="min-height:${d.cellMin}px;border-radius:9px;border:1px solid #F1F1F4;background:#FAFAFB;padding:${d.cellPad}px;font-size:${d.dayFont}px;color:#C4C4CC">${day}</div>`;
      }
      return `
        <div style="min-height:${d.cellMin}px;border-radius:9px;border:1px solid ${cellBorder};padding:${d.cellPad}px;display:flex;flex-direction:column;gap:2px;min-width:0">
          <div style="font-size:${d.dayFont}px;font-weight:700">${day}</div>
          ${names.map((n) => `<div style="font-size:${d.nameFont}px;font-weight:600;padding:1px 4px;border-radius:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:${colors[n].bg};color:${colors[n].fg}">${escapeHtml(n)}</div>`).join('')}
        </div>
      `;
    };
    // Day from the previous/next month, shown muted so the grid at a month
    // turn doesn't read as broken empty cells — same idea as a normal
    // calendar app, but never carries assignments (those belong to that
    // day's own month block).
    const renderOverflowCell = (day) => `<div style="min-height:${d.cellMin}px;border-radius:9px;padding:${d.cellPad}px;font-size:${d.dayFont}px;color:#D6D6DC">${day}</div>`;
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    if (schedule.calendarScope === 'selected' && activeWeekdays(schedule).length < 7) {
      const activeCols = activeWeekdays(schedule).slice().sort((a, b) => a - b);
      const weeks = [];
      let week = new Array(7).fill(null);
      for (let day = 1; day <= daysInMonth; day++) {
        const wd = new Date(year, month, day).getDay();
        week[wd] = day;
        if (wd === 6) { weeks.push(week); week = new Array(7).fill(null); }
      }
      if (week.some((v) => v !== null)) weeks.push(week);
      // Leading/trailing nulls in the first and last row are days outside
      // this month — fill them with the neighboring month's dates (muted)
      // instead of leaving blank grid cells.
      const lastWeekday = new Date(year, month, daysInMonth).getDay();
      weeks[0] = weeks[0].map((v, wd) => v !== null ? v : { overflow: true, day: daysInPrevMonth - firstWeekday + 1 + wd });
      const lastIdx = weeks.length - 1;
      weeks[lastIdx] = weeks[lastIdx].map((v, wd) => v !== null ? v : { overflow: true, day: wd - lastWeekday });
      const renderSlot = (cell) => (cell && typeof cell === 'object' ? renderOverflowCell(cell.day) : renderCell(cell));
      return `
        <div class="scalego-print-month flex flex-col" style="gap:${d.monthGap}px">
          <div class="font-bold text-[15px]">${MONTH_LABELS[month]} ${year}</div>
          <div class="grid" style="gap:${d.gridGap}px;grid-template-columns:repeat(${activeCols.length},minmax(0,1fr))">
            ${activeCols.map((wd) => `<div class="font-bold text-[#8A8A94]" style="font-size:${d.headerFont}px;padding:0 4px">${WEEKDAY_FULL_HEADER[wd]}</div>`).join('')}
            ${weeks.map((w) => activeCols.map((wd) => renderSlot(w[wd])).join('')).join('')}
          </div>
        </div>
      `;
    }

    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(renderOverflowCell(daysInPrevMonth - firstWeekday + 1 + i));
    for (let day = 1; day <= daysInMonth; day++) cells.push(renderCell(day));
    const trailing = (7 - (cells.length % 7)) % 7;
    for (let day = 1; day <= trailing; day++) cells.push(renderOverflowCell(day));
    return `
      <div class="scalego-print-month flex flex-col" style="gap:${d.monthGap}px">
        <div class="font-bold text-[15px]">${MONTH_LABELS[month]} ${year}</div>
        <div class="grid grid-cols-7" style="gap:${d.gridGap}px">
          ${WEEKDAY_SHORT.map((h) => `<div class="font-bold text-[#8A8A94] uppercase tracking-[0.06em]" style="font-size:${Math.max(9, d.headerFont - 1)}px;padding:0 4px">${h}</div>`).join('')}
          ${cells.join('')}
        </div>
      </div>
    `;
  }).join('');
  const noteHtml = `<div id="previewNote" class="text-[12px] leading-relaxed text-[#44444E]" style="${schedule.note ? `margin-top:8px;padding-top:12px;border-top:1px solid ${cellBorder}` : ''}">${schedule.note || ''}</div>`;
  return header + monthsHtml + noteHtml;
}

// ---------- exporting ----------

function buildExportText(schedule, assignments) {
  const lines = [];
  sortedMonths(schedule).forEach(({ year, month }) => {
    lines.push(`\n*${MONTH_LABELS[month]} ${year}*`);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const key = toISODate(date);
      const names = assignments[key];
      if (names === undefined) continue;
      const ds = `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}`;
      lines.push(`${ds} (${WEEKDAY_SHORT[date.getDay()].toLowerCase()}) — ${names.join(', ') || '—'}`);
    }
  });
  const noteText = stripHtml(schedule.note).trim();
  return `*${schedule.scaleName || 'Escala'}*` + lines.join('\n') + (noteText ? `\n\n${noteText}` : '');
}

function buildExportCSV(schedule, assignments) {
  const rows = ['Data;Dia;Pessoas'];
  sortedMonths(schedule).forEach(({ year, month }) => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const key = toISODate(date);
      const names = assignments[key];
      if (names === undefined) continue;
      const ds = `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
      rows.push(`${ds};${WEEKDAY_FULL[date.getDay()]};${names.join(', ')}`);
    }
  });
  return rows.join('\n');
}

function exportWhatsApp() {
  const { assignments } = generateSchedule(state.schedule);
  const text = buildExportText(state.schedule, assignments);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

function exportCopy() {
  const { assignments } = generateSchedule(state.schedule);
  const text = buildExportText(state.schedule, assignments);
  navigator.clipboard?.writeText(text).catch(() => {});
  state.copied = true;
  render();
  scheduleCopiedReset();
}

function exportPDF() {
  const schedule = state.schedule;
  const colors = personColors(schedule);
  const { assignments } = generateSchedule(schedule);
  const months = sortedMonths(schedule);
  document.getElementById('print-area').innerHTML = `<div style="padding:32px;font-family:'Plus Jakarta Sans',system-ui,sans-serif">${renderPreviewPaper(schedule, colors, assignments, months)}</div>`;
  window.print();
}

function exportCSVFile() {
  const schedule = state.schedule;
  const { assignments } = generateSchedule(schedule);
  const csv = buildExportCSV(schedule, assignments);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${schedule.scaleName || 'escala'}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------- utils ----------

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Rich-text note → plain text for WhatsApp/Copiar, which don't render HTML.
function stripHtml(html) {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent || '';
}

// ---------- event handling ----------

function handleClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const schedule = state.schedule;

  switch (action) {
    case 'add-person': {
      const input = document.getElementById('personInput');
      schedule.draft = input ? input.value : schedule.draft;
      addPeopleFromDraft();
      state._focusPersonInput = true;
      persistAndRender();
      break;
    }
    case 'remove-person':
      schedule.people = schedule.people.filter((n) => n !== target.dataset.name);
      delete schedule.availability[target.dataset.name];
      persistAndRender();
      break;
    case 'prev-year':
      schedule.year--;
      render();
      break;
    case 'next-year':
      schedule.year++;
      render();
      break;
    case 'toggle-month': {
      const key = target.dataset.month;
      schedule.months = schedule.months.includes(key)
        ? schedule.months.filter((m) => m !== key)
        : [...schedule.months, key];
      persistAndRender();
      break;
    }
    case 'set-days-mode': {
      const mode = target.dataset.mode;
      if (mode === 'custom') schedule.customWeekdays = activeWeekdays(schedule);
      schedule.daysMode = mode;
      schedule.overrides = {};
      persistAndRender();
      break;
    }
    case 'toggle-custom-weekday': {
      const day = Number(target.dataset.weekday);
      schedule.customWeekdays = schedule.customWeekdays.includes(day)
        ? schedule.customWeekdays.filter((d) => d !== day)
        : [...schedule.customWeekdays, day];
      schedule.overrides = {};
      persistAndRender();
      break;
    }
    case 'dec-people-per-day':
      schedule.peoplePerDay = Math.max(1, schedule.peoplePerDay - 1);
      schedule.overrides = {};
      persistAndRender();
      break;
    case 'inc-people-per-day':
      schedule.peoplePerDay = Math.min(Math.max(1, schedule.people.length), schedule.peoplePerDay + 1);
      schedule.overrides = {};
      persistAndRender();
      break;
    case 'go-to-step': {
      const step = Number(target.dataset.step);
      if (maxOk(schedule, step)) { schedule.step = step; persistAndRender(); }
      break;
    }
    case 'back':
      schedule.step = Math.max(0, schedule.step - 1);
      persistAndRender();
      break;
    case 'next':
      schedule.step = Math.min(4, schedule.step + 1);
      persistAndRender();
      break;
    case 'restart':
      currentEditModal?.close('api');
      state.schedule = createEmptySchedule();
      state.editing = null;
      persistAndRender();
      break;
    case 'set-rotation-mode':
      schedule.rotationMode = target.dataset.value;
      schedule.overrides = {};
      persistAndRender();
      break;
    case 'toggle-availability':
      schedule.showAvailability = !schedule.showAvailability;
      render();
      break;
    case 'toggle-availability-day': {
      const name = target.dataset.name;
      const day = Number(target.dataset.weekday);
      const current = schedule.availability[name] || [];
      schedule.availability[name] = current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day];
      schedule.overrides = {};
      persistAndRender();
      break;
    }
    case 'shuffle':
      schedule.seed += 1;
      schedule.overrides = {};
      persistAndRender();
      break;
    case 'undo-overrides':
      schedule.overrides = {};
      persistAndRender();
      break;
    case 'open-editor':
      openEditor({
        dateKey: target.dataset.date,
        slot: Number(target.dataset.slot),
        weekday: Number(target.dataset.weekday),
        day: Number(target.dataset.day),
        month: Number(target.dataset.month),
        year: Number(target.dataset.year),
      });
      break;
    case 'pick-replacement':
      pickReplacement(target.dataset.name);
      break;
    case 'set-theme':
      schedule.theme = target.dataset.theme;
      persistAndRender();
      break;
    case 'set-view':
      schedule.view = target.dataset.value;
      persistAndRender();
      break;
    case 'set-calendar-scope':
      schedule.calendarScope = target.dataset.value;
      persistAndRender();
      break;
    case 'set-print-density':
      schedule.printDensity = target.dataset.value;
      persistAndRender();
      break;
    case 'remove-logo':
      schedule.logo = null;
      persistAndRender();
      break;
    case 'export-whatsapp':
      exportWhatsApp();
      break;
    case 'export-copy':
      exportCopy();
      break;
    case 'export-pdf':
      exportPDF();
      break;
    case 'export-csv':
      exportCSVFile();
      break;
    case 'open-invite-modal':
      openInviteModal();
      break;
    case 'invite-copy': {
      navigator.clipboard?.writeText(target.dataset.link).catch(() => {});
      const original = target.textContent;
      target.textContent = 'Copiado';
      setTimeout(() => { target.textContent = original; }, 1600);
      break;
    }
    case 'invite-whatsapp':
      window.open(`https://wa.me/?text=${encodeURIComponent(target.dataset.link)}`, '_blank');
      break;
    case 'invite-pick-person':
      state.inviteSelectedPerson = target.dataset.name;
      state.inviteBlocked = [];
      inviteNameModal?.close('action');
      render();
      break;
    case 'invite-toggle-date': {
      const iso = target.dataset.date;
      state.inviteBlocked = state.inviteBlocked.includes(iso)
        ? state.inviteBlocked.filter((d) => d !== iso)
        : [...state.inviteBlocked, iso];
      render();
      break;
    }
    case 'invite-generate': {
      const payload = {
        id: state.invitePayload.id,
        person: state.inviteSelectedPerson,
        blockedDates: state.inviteBlocked.slice().sort(),
      };
      state.inviteResponseLink = `${location.origin}${location.pathname}#response=${encodeHashPayload(payload)}`;
      render();
      break;
    }
    case 'invite-copy-response':
      navigator.clipboard?.writeText(state.inviteResponseLink).catch(() => {});
      state.copied = true;
      render();
      scheduleCopiedReset();
      break;
    case 'invite-whatsapp-response':
      window.open(`https://wa.me/?text=${encodeURIComponent(state.inviteResponseLink)}`, '_blank');
      break;
    case 'import-cancel':
      history.replaceState(null, '', location.pathname);
      state.route = 'app';
      render();
      break;
    case 'import-confirm': {
      const payload = state.importPayload;
      state.schedule.dateBlocks[payload.person] = payload.blockedDates;
      state.schedule.overrides = {};
      state.schedule.step = 3;
      history.replaceState(null, '', location.pathname);
      state.route = 'app';
      persistAndRender();
      break;
    }
  }
}

function handleInput(event) {
  if (event.target.id === 'personInput') {
    const v = event.target.value;
    if (/[,;]/.test(v)) {
      state.schedule.draft = v;
      addPeopleFromDraft();
      state._focusPersonInput = true;
      persistAndRender();
    } else {
      state.schedule.draft = v;
      saveSchedule();
    }
  }
  if (event.target.id === 'scaleNameInput') {
    state.schedule.scaleName = event.target.value;
    saveSchedule();
    const cursor = event.target.selectionStart;
    render();
    const input = document.getElementById('scaleNameInput');
    if (input) { input.focus(); input.setSelectionRange(cursor, cursor); }
  }
}

function handleKeydown(event) {
  if (event.target.id === 'personInput' && event.key === 'Enter') {
    event.preventDefault();
    state.schedule.draft = event.target.value;
    addPeopleFromDraft();
    state._focusPersonInput = true;
    persistAndRender();
  }
}

function handleChange(event) {
  if (event.target.id === 'logoInput') {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.schedule.logo = reader.result;
      persistAndRender();
    };
    reader.readAsDataURL(file);
  }
}

function applyRouteFromHash() {
  const { route, payload } = parseRoute();
  state.route = route;
  if (route === 'invite') {
    state.invitePayload = payload;
    state.inviteSelectedPerson = null;
    state.inviteBlocked = [];
    state.inviteResponseLink = null;
    state._inviteNameModalShown = false;
  }
  if (route === 'import') state.importPayload = payload;
}

function init() {
  applyRouteFromHash();

  // Delegated on document (not #app) so clicks inside a Tucano.Modal — which
  // gets appended to document.body, outside #app — are still handled.
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('change', handleChange);
  // Covers pasting/opening a different invite or response link in a tab that
  // already has the app loaded (hash-only URL changes don't reload the page).
  window.addEventListener('hashchange', () => { applyRouteFromHash(); render(); });
  render();
}

init();
