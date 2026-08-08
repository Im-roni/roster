// ---------- helpers ----------
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const MONTH_ORDER = (a, b) => (a.year - b.year) || (a.month - b.month);

function classify(raw) {
  if (raw === null || raw === undefined) return { cls: 'dash', label: '–' };
  const s = String(raw).trim();
  if (s === '' || s === '-' || s === 'XXX' || s === 'XX') return { cls: 'dash', label: '–' };

  const timeMatch = s.match(/^(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/);
  if (timeMatch) {
    const startHour = parseInt(timeMatch[1].split(':')[0], 10);
    return { cls: 'time', label: `${timeMatch[1]}–${timeMatch[2]}`, bucket: timeBucket(startHour) };
  }

  const upper = s.toUpperCase();
  if (upper === 'P' || upper === 'PRESENT') return { cls: 'present', label: 'Present' };
  if (upper.startsWith('P - WFH') || upper.startsWith('P-WFH') || upper === 'WFH') return { cls: 'wfh', label: 'WFH' };
  if (upper === 'OFF' || upper === 'WEEK OFF') return { cls: 'off', label: 'Off' };
  if (upper === 'HOLIDAY') return { cls: 'holiday', label: 'Holiday' };
  if (upper.includes('COMP') && upper.includes('OFF')) return { cls: 'compoff', label: 'Comp Off' };
  if (upper === 'HALF DAY' || upper === 'HD' || upper.includes('HALF DAY')) return { cls: 'halfday', label: 'Half Day' };
  if (['LEAVE', 'CL', 'SL', 'AL', 'PL', 'LWP'].includes(upper) || upper.includes('LEAVE')) return { cls: 'leave', label: s };
  if (upper === 'A' || upper === 'ABSENT') return { cls: 'absent', label: 'Absent' };
  if (upper === 'OFFICE') return { cls: 'office', label: 'Office' };
  return { cls: 'other', label: s };
}

function timeBucket(hour) {
  if (hour >= 5 && hour < 11) return { color: 'var(--amber)', name: 'Morning' };
  if (hour >= 11 && hour < 17) return { color: 'var(--teal)', name: 'Day' };
  if (hour >= 17 && hour < 21) return { color: 'var(--violet)', name: 'Evening' };
  return { color: 'var(--indigo)', name: 'Night' };
}

function dowShort(name) {
  return (name || '').slice(0, 3).toUpperCase();
}

function hexAlpha(cssVar) {
  return `color-mix(in srgb, ${cssVar} 16%, transparent)`;
}

// ---------- state ----------
const manifest = [...MONTH_MANIFEST].sort(MONTH_ORDER);
const monthCache = new Map(); // sheetName -> parsed month record

let state = {
  team: 'IB',
  manifestEntry: null,
  search: ''
};

function availableMonths(team) {
  return manifest.filter(m => m.team === team).sort(MONTH_ORDER).reverse();
}

// ---------- live status ----------
// (No persistent "live/cached" indicator by design — refresh silently keeps
// the roster on screen fresh; the refresh button itself shows a brief
// "Syncing…" state while a fetch is in flight.)

// ---------- data loading ----------
async function loadMonth(entry, forceFresh = false) {
  const cacheKey = entry.sheet;
  if (!forceFresh && monthCache.has(cacheKey)) return monthCache.get(cacheKey);

  try {
    const table = await fetchSheetTable(entry.sheet);
    const parsed = parseMonthTable(table, entry.team);
    parsed.source = 'live';
    monthCache.set(cacheKey, parsed);
    return parsed;
  } catch (err) {
    console.warn(`Live fetch failed for "${entry.sheet}":`, err.message);
    const fallback = FALLBACK_DATA.find(m => m.sheet === entry.sheet);
    if (fallback) {
      const copy = { ...fallback, source: 'fallback', error: err.message };
      monthCache.set(cacheKey, copy);
      return copy;
    }
    throw err;
  }
}

// ---------- rendering ----------
function populateMonthSelect() {
  const sel = $('#monthSelect');
  sel.innerHTML = '';
  const opts = availableMonths(state.team);
  opts.forEach(m => {
    const o = document.createElement('option');
    o.value = m.sheet;
    o.textContent = m.monthLabel;
    sel.appendChild(o);
  });
  state.manifestEntry = opts[0] || null;
  if (state.manifestEntry) sel.value = state.manifestEntry.sheet;
}

async function renderTable(forceFresh = false) {
  const thead = $('#rosterTable thead');
  const tbody = $('#rosterTable tbody');
  $('#emptyNote').hidden = true;

  if (!state.manifestEntry) {
    thead.innerHTML = ''; tbody.innerHTML = '';
    return;
  }

  thead.innerHTML = '';
  tbody.innerHTML = `<tr><td class="loading-row">Loading roster…</td></tr>`;

  let data;
  try {
    data = await loadMonth(state.manifestEntry, forceFresh);
  } catch (err) {
    tbody.innerHTML = `<tr><td class="loading-row">Couldn't load this month. ${err.message}</td></tr>`;
    return;
  }

  thead.innerHTML = '';
  tbody.innerHTML = '';

  const trh = document.createElement('tr');
  const thName = document.createElement('th');
  thName.className = 'name-col';
  thName.textContent = 'Name';
  trh.appendChild(thName);
  data.dates.forEach((dateStr, i) => {
    const th = document.createElement('th');
    const dayNum = dateStr.slice(8, 10).replace(/^0/, '');
    th.innerHTML = `${dayNum}<span class="dow">${dowShort(data.dayNames[i])}</span>`;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  const q = state.search.trim().toLowerCase();
  let shown = 0;
  data.employees.forEach(emp => {
    if (!emp.name) return;
    if (q && !emp.name.toLowerCase().includes(q)) return;
    shown++;
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.className = 'name-col';
    tdName.textContent = emp.name;
    tr.appendChild(tdName);

    emp.days.forEach((val) => {
      const td = document.createElement('td');
      const info = classify(val);
      const span = document.createElement('span');
      if (info.cls === 'time') {
        span.className = 'cell time';
        span.style.background = hexAlpha(info.bucket.color);
        span.style.color = info.bucket.color;
        span.innerHTML = info.label.replace('–', '–<br>');
        span.title = `${info.bucket.name} shift`;
      } else if (info.cls === 'dash') {
        span.className = 'cell dash';
        span.textContent = info.label;
      } else {
        span.className = `cell c-${info.cls}`;
        span.textContent = info.label;
      }
      td.appendChild(span);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  $('#emptyNote').hidden = shown !== 0;
  renderStats(data, shown);
}

function renderStats(data, shownCount) {
  const wrap = $('#statGroup');
  wrap.innerHTML = '';
  const total = data.employees.filter(e => e.name).length;
  const pills = [
    [`${total}`, 'on roster'],
    [`${data.dates.length}`, 'days'],
    [`${shownCount}`, 'shown']
  ];
  pills.forEach(([val, label]) => {
    const p = document.createElement('div');
    p.className = 'stat-pill';
    p.innerHTML = `<b>${val}</b> ${label}`;
    wrap.appendChild(p);
  });
}

function renderLegend() {
  const legend = $('#legend');
  const items = [
    ['c-present', 'Present'], ['c-wfh', 'WFH'], ['c-off', 'Off'],
    ['c-holiday', 'Holiday'], ['c-leave', 'Leave (CL/SL/PL…)'],
    ['c-halfday', 'Half day'], ['c-compoff', 'Comp off'],
    ['c-absent', 'Absent'], ['c-office', 'Office'],
  ];
  legend.innerHTML = items.map(([cls, label]) => `
    <div class="legend-item">
      <span class="legend-swatch ${cls}" style="background:var(--${cls.replace('c-', '')})"></span>
      ${label}
    </div>`).join('') + `
    <div class="legend-item"><span class="legend-swatch" style="background:linear-gradient(90deg,var(--amber),var(--teal),var(--violet),var(--indigo))"></span>Shift time (color = time of day)</div>`;
}

function renderRangeLabel() {
  const first = manifest[0], last = manifest[manifest.length - 1];
  if (first && last) $('#rangeLabel').textContent = `${first.monthLabel} – ${last.monthLabel}`;
}

// ---------- clock + dial ----------
function tickClock() {
  const now = new Date();
  $('#liveClock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const pct = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;
  $('#dialMarker').style.left = `${pct}%`;
}

// ---------- theme ----------
function initTheme() {
  const saved = localStorageSafeGet('shiftlog-theme');
  const theme = saved || 'dark';
  applyTheme(theme);
  $('#themeToggle').addEventListener('click', () => {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    applyTheme(next);
    localStorageSafeSet('shiftlog-theme', next);
  });
}
function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
}
// Artifacts environments can block localStorage; degrade quietly if so.
function localStorageSafeGet(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function localStorageSafeSet(key, val) {
  try { window.localStorage.setItem(key, val); } catch (e) { /* ignore */ }
}

// ---------- events ----------
function bindEvents() {
  $$('.seg').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.seg').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.team = btn.dataset.team;
      populateMonthSelect();
      renderTable();
    });
  });

  $('#monthSelect').addEventListener('change', e => {
    state.manifestEntry = manifest.find(m => m.sheet === e.target.value) || null;
    renderTable();
  });

  $('#searchInput').addEventListener('input', e => {
    state.search = e.target.value;
    renderTable();
  });

  $('#refreshBtn').addEventListener('click', async () => {
    const btn = $('#refreshBtn');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '⟳ Syncing…';
    if (state.manifestEntry) monthCache.delete(state.manifestEntry.sheet);
    await renderTable(true);
    btn.textContent = original;
    btn.disabled = false;
  });
}

// ---------- init ----------
function init() {
  initTheme();
  populateMonthSelect();
  renderLegend();
  renderTable();
  renderRangeLabel();
  bindEvents();
  tickClock();
  setInterval(tickClock, 1000);
}

init();
