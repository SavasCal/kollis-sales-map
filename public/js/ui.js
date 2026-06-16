// UI: bottom sheet, search, filter chips with counts, toasts.

const COLORS = { none: '#9ca3af', visited: '#3b82f6', avvakta: '#f59e0b', converted: '#22c55e' };
const $ = (sel) => document.querySelector(sel);

let currentFacility = null;
let selectedStatus = 'none';
let onSave = () => {};
let onSelect = () => {};
let getOverride = () => null;
let getOverrides = () => ({});
let allFacilities = [];
let facilityById = new Map();
let searchIndex = [];
let kanbanOpen = false;
let kanbanOwner = 'all';

const OWNER_LABELS = { savas: 'Savas', baran: 'Baran' };

export function initUI(facilities, overrideGetter, saveHandler, { onFilter, onFocus, onSelect: selectHandler, getOverrides: overridesGetter }) {
  allFacilities = facilities;
  facilityById = new Map(facilities.map((f) => [f.id, f]));
  getOverride = overrideGetter;
  getOverrides = overridesGetter;
  onSave = saveHandler;
  onSelect = selectHandler || onSelect;
  searchIndex = facilities.map((f) => ({ f, text: `${f.n} ${f.a}`.toLowerCase() }));

  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet-cancel').addEventListener('click', closeSheet);
  document.querySelectorAll('.status-btn').forEach((btn) =>
    btn.addEventListener('click', () => selectStatus(btn.dataset.status))
  );
  $('#sheet-save').addEventListener('click', () => {
    if (!currentFacility) return;
    onSave({
      id: currentFacility.id,
      s: selectedStatus,
      n: $('#sheet-notes').value.trim(),
      v: $('#sheet-visited').value,
      c: $('#sheet-comeback').value,
      tools: $('#sheet-tools').value.trim(),
      own: $('#sheet-owner').value,
      // facility info rides along so the Google Sheet rows are readable
      fn: currentFacility.n,
      fa: currentFacility.a,
      fb: currentFacility.b,
    });
  });

  // Search
  const searchInput = $('#search');
  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderSearch(searchInput.value), 150);
  });
  $('#search-results').addEventListener('click', (e) => {
    const btn = e.target.closest('.result');
    if (!btn) return;
    const facility = allFacilities.find((f) => f.id === btn.dataset.id);
    searchInput.value = '';
    hideSearch();
    searchInput.blur();
    onFocus(facility);
    openSheet(facility);
  });

  // Touching the map dismisses the search dropdown, the keyboard, and the task panel
  $('#map').addEventListener('pointerdown', () => {
    hideSearch();
    searchInput.blur();
    hideTasks();
  }, { passive: true });

  $('#tasks-close').addEventListener('click', hideTasks);
  $('#wishes-close').addEventListener('click', hideWishes);
  $('#kpis-close').addEventListener('click', hideKpis);
  $('#permits-close').addEventListener('click', hidePermits);

  // Filter chips
  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    onFilter(chip.dataset.filter);
  });

  // Kanban owner filter chips
  $('#kanban-owner-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    kanbanOwner = chip.dataset.owner;
    document.querySelectorAll('#kanban-owner-chips .chip').forEach((c) =>
      c.classList.toggle('active', c === chip)
    );
    renderKanban();
  });

  // Kanban card -> open the editor in place over the board
  $('#kanban').addEventListener('click', (e) => {
    const card = e.target.closest('.kanban-card');
    if (!card) return;
    const facility = facilityById.get(card.dataset.id);
    if (facility) openSheet(facility);
  });
}

const statusOf = (id) => getOverride(id)?.s || 'none';

function renderSearch(query) {
  const box = $('#search-results');
  const q = query.trim().toLowerCase();
  if (q.length < 2) return hideSearch();
  const hits = [];
  for (const { f, text } of searchIndex) {
    if (text.includes(q)) {
      hits.push(f);
      if (hits.length >= 20) break;
    }
  }
  if (!hits.length) return hideSearch();
  box.innerHTML = hits
    .map(
      (f) => `<button class="result" data-id="${f.id}">
        <span class="dot" style="background:${COLORS[statusOf(f.id)]}"></span>${escapeHtml(f.n)}
        <span class="addr">${escapeHtml(f.a)} · ${escapeHtml(f.b)}</span>
      </button>`
    )
    .join('');
  box.classList.remove('hidden');
}

const hideSearch = () => $('#search-results').classList.add('hidden');

export function openSheet(facility) {
  currentFacility = facility;
  const override = getOverride(facility.id);
  selectedStatus = override?.s || 'none';

  $('#sheet-name').textContent = facility.n;
  $('#sheet-address').textContent = `${facility.a} · ${facility.b}`;

  const warn = facility.r === 'Med avvikelser';
  $('#sheet-meta').innerHTML =
    `<span class="badge${warn ? ' warn' : ''}">${escapeHtml(facility.r || '')}</span>` +
    (facility.d ? ` <span>${escapeHtml(facility.d)}</span>` : '');
  $('#sheet-inspection').textContent = facility.t || '';

  const contact = [];
  if (facility.e) contact.push(`<a href="mailto:${escapeHtml(facility.e)}">${escapeHtml(facility.e)}</a>`);
  if (facility.w) contact.push(`<a href="${escapeHtml(facility.w)}" target="_blank" rel="noopener">${escapeHtml(facility.w.replace(/^https?:\/\//, ''))}</a>`);
  $('#sheet-contact').innerHTML = contact.join(' · ');

  $('#sheet-notes').value = override?.n || '';
  // "Besökt den" defaults to today so you don't have to set it on every visit
  $('#sheet-visited').value = override?.v || new Intl.DateTimeFormat('sv-SE').format(new Date());
  $('#sheet-comeback').value = override?.c || '';
  $('#sheet-tools').value = override?.tools || '';
  $('#sheet-owner').value = override?.own || '';
  setSaveStatus('');
  highlightStatusButtons();
  $('#sheet').classList.add('open');
  onSelect(facility);
}

export function closeSheet() {
  $('#sheet').classList.remove('open');
  currentFacility = null;
  onSelect(null);
}

export const getOpenFacilityId = () => currentFacility?.id || null;

// --- Kanban board: only touched places (those present in overrides) ---

const KANBAN_COLS = [
  { key: 'visited', label: 'Besökt' },
  { key: 'avvakta', label: 'Avvakta' },
  { key: 'converted', label: 'Kund' },
];

export function toggleKanban() {
  kanbanOpen = !kanbanOpen;
  $('#map').classList.toggle('hidden', kanbanOpen);
  $('#kanban').classList.toggle('hidden', !kanbanOpen);
  $('#kanban-owner-chips').classList.toggle('hidden', !kanbanOpen);
  const btn = $('#kanban-toggle');
  btn.classList.toggle('active', kanbanOpen);
  btn.title = kanbanOpen ? 'Visa karta' : 'Visa kanban';
  btn.setAttribute('aria-label', kanbanOpen ? 'Visa karta' : 'Visa kanban');
  if (kanbanOpen) renderKanban();
}

export function refreshKanbanIfOpen() {
  if (kanbanOpen) renderKanban();
}

function renderKanban() {
  // Bucket every touched place by status; unknown/missing status -> "övrigt".
  // Tally per-owner counts (over all touched places) for the filter chips.
  const buckets = { visited: [], avvakta: [], converted: [], övrigt: [] };
  const ownerCounts = { all: 0, savas: 0, baran: 0 };
  for (const [id, o] of Object.entries(getOverrides())) {
    const facility = facilityById.get(id);
    if (!facility) continue;
    ownerCounts.all++;
    if (ownerCounts[o?.own] !== undefined) ownerCounts[o.own]++;
    if (kanbanOwner !== 'all' && o?.own !== kanbanOwner) continue;
    const key = buckets[o?.s] ? o.s : 'övrigt';
    buckets[key].push({ facility, o });
  }
  document.querySelectorAll('#kanban-owner-chips .chip').forEach((chip) => {
    chip.querySelector('span').textContent = `(${ownerCounts[chip.dataset.owner] ?? 0})`;
  });
  for (const list of Object.values(buckets)) {
    list.sort((a, b) => (b.o?.t || '').localeCompare(a.o?.t || ''));
  }

  const cols = [...KANBAN_COLS];
  if (buckets.övrigt.length) cols.push({ key: 'övrigt', label: 'Övrigt' });

  $('#kanban').innerHTML = cols
    .map((col) => {
      const items = buckets[col.key];
      const cards = items.map(({ facility, o }) => renderCard(facility, o, col.key)).join('') ||
        '<p class="kanban-empty">Inga ännu</p>';
      return `<section class="kanban-col">
        <header class="kanban-col-header bg-${col.key}">${escapeHtml(col.label)} <span>(${items.length})</span></header>
        <div class="kanban-cards">${cards}</div>
      </section>`;
    })
    .join('');
}

function renderCard(facility, o, statusKey) {
  const note = o?.n ? `<p class="kanban-note">${escapeHtml(o.n)}</p>` : '';
  const dates = [];
  if (o?.v) dates.push(`Besökt ${escapeHtml(o.v)}`);
  if (o?.c) dates.push(`Återkom ${escapeHtml(o.c)}`);
  const dateRow = dates.length ? `<p class="kanban-dates">${dates.join(' · ')}</p>` : '';
  const owner = o?.own ? `<span class="kanban-owner">${escapeHtml(OWNER_LABELS[o.own] || o.own)}</span>` : '';
  return `<button class="kanban-card st-${statusKey}" data-id="${escapeHtml(facility.id)}">
    <span class="kanban-name">${escapeHtml(facility.n)}${owner}</span>
    <span class="kanban-addr">${escapeHtml(facility.a)} · ${escapeHtml(facility.b)}</span>
    ${note}${dateRow}
  </button>`;
}

function selectStatus(status) {
  selectedStatus = status;
  // First time a place is marked visited/converted, stamp today's date (local time).
  // Avvakta doesn't imply a visit, so it doesn't auto-stamp.
  const visitedInput = $('#sheet-visited');
  if ((status === 'visited' || status === 'converted') && !visitedInput.value) {
    visitedInput.value = new Intl.DateTimeFormat('sv-SE').format(new Date());
  }
  highlightStatusButtons();
}

function highlightStatusButtons() {
  document.querySelectorAll('.status-btn').forEach((btn) =>
    btn.classList.toggle('selected', btn.dataset.status === selectedStatus)
  );
  // Tint the whole sheet with a light shade of the chosen status
  const sheet = $('#sheet');
  sheet.classList.remove('bg-none', 'bg-visited', 'bg-avvakta', 'bg-converted');
  sheet.classList.add(`bg-${selectedStatus}`);
}

export function setSaveStatus(text, kind = '') {
  const el = $('#save-status');
  el.textContent = text;
  el.className = `save-status ${kind}`;
}

export function updateCounts(overrides, total) {
  let visited = 0;
  let avvakta = 0;
  let converted = 0;
  for (const o of Object.values(overrides)) {
    if (o.s === 'visited') visited++;
    else if (o.s === 'avvakta') avvakta++;
    else if (o.s === 'converted') converted++;
  }
  const counts = { all: total, none: total - visited - avvakta - converted, visited, avvakta, converted };
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.querySelector('span').textContent = `(${counts[chip.dataset.filter]})`;
  });
}

// --- Read-only open-task view: full-page immersive checklist (editing on /admin) ---

// The view covers the whole screen, so hide the floating map buttons while it's up.
const FLOATING_BTNS = ['#permits-toggle', '#kpis-toggle', '#wishes-toggle', '#tasks-toggle', '#locate', '#kanban-toggle'];
const setFloatingHidden = (hidden) =>
  FLOATING_BTNS.forEach((sel) => $(sel)?.classList.toggle('hidden', hidden));

function hideTasks() {
  $('#tasks-panel').classList.add('hidden');
  setFloatingHidden(false);
}

export function showTasks(tasks) {
  const open = (tasks || []).filter((t) => t && !t.done);
  $('#tasks-list').innerHTML = open.length
    ? open.map((t) => `<div class="task-row">${escapeHtml(t.text)}</div>`).join('')
    : '<p class="tasks-empty">Inga öppna uppgifter ✓</p>';
  $('#tasks-panel').classList.remove('hidden');
  setFloatingHidden(true);
}

// Sort by votes desc, tie-broken by creation time (oldest first), then render
// editable rows. Shared between the map wishlist panel and the /admin editor.
export function renderWishRows(wishes) {
  const sorted = (wishes || [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => (b.votes || 0) - (a.votes || 0) || String(a.t).localeCompare(String(b.t)));
  if (!sorted.length) return '<p class="wishes-empty">Inga önskemål ännu</p>';
  return sorted
    .map(
      (w) => `<div class="wish-row" data-id="${escapeHtml(w.id)}">
        <button class="wish-vote" data-act="vote" aria-label="Rösta upp">▲<span class="wish-count">${w.votes || 0}</span></button>
        <span class="wish-text">${escapeHtml(w.text)}</span>
        <button class="wish-edit" data-act="edit" aria-label="Ändra">✎</button>
        <button class="wish-del" data-act="delete" aria-label="Ta bort">&times;</button>
      </div>`
    )
    .join('');
}

export function showWishes(wishes) {
  $('#wishes-list').innerHTML = renderWishRows(wishes);
  $('#wishes-panel').classList.remove('hidden');
  setFloatingHidden(true);
}

function hideWishes() {
  $('#wishes-panel').classList.add('hidden');
  setFloatingHidden(false);
}

// --- Read-only weekly KPI view: one progress bar per step (editing on /admin) ---

export function showKpis({ week, steps }) {
  $('#kpis-week').textContent = (week || '').trim() || 'Veckomål';
  const list = (steps || []).filter(Boolean);
  $('#kpis-list').innerHTML = list.length
    ? list.map((s) => {
        const target = Number(s.target) || 0;
        const current = Number(s.current) || 0;
        const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
        return `<div class="kpi-row">
          <div class="kpi-row-head">
            <span class="kpi-label">${escapeHtml(s.label)}</span>
            <span class="kpi-nums">${current} / ${target}<span class="kpi-pct">${pct}%</span></span>
          </div>
          <div class="kpi-bar"><div class="kpi-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
      }).join('')
    : '<p class="kpis-empty">Inga veckomål satta</p>';
  $('#kpis-panel').classList.remove('hidden');
  setFloatingHidden(true);
}

function hideKpis() {
  $('#kpis-panel').classList.add('hidden');
  setFloatingHidden(false);
}

// --- Read-only static list: places that recently got permission to serve food ---

const PERMITS = [
  { date: '2026-06-12', name: 'Chiesi Pharma AB', cat: 'Kosttillskott', addr: 'Klara norra kyrkogata 34, Stockholm', op: 'Chiesi Pharma AB (556827-5746)' },
  { date: '2026-06-12', name: 'Halwa.', cat: 'Tillverkning', addr: 'Nybykroken 13, Spånga', op: 'Fagar AB (559103-3559)' },
  { date: '2026-06-10', name: 'BoCenter, Högbergsgatan', cat: 'Vård/omsorg', addr: 'Högbergsgatan 20, Nacka', op: 'Stockholm Stadsmission (802003-1954)' },
  { date: '2026-06-08', name: 'Dig in', cat: 'Restaurang' },
  { date: '2026-06-08', name: 'Hoi Polloi', cat: 'Restaurang' },
  { date: '2026-06-08', name: 'Lepicerie Fine', cat: 'Butik' },
  { date: '2026-06-08', name: 'Kruthuset', cat: 'Restaurang', addr: 'Hunduddsvägen 57, Stockholm', op: 'Gyllenstierna Mat & Media AB (556311-5442)' },
  { date: '2026-06-05', name: 'Swedish Temptations AB', cat: 'Matmäklare', addr: 'Torsgatan 57, Stockholm', op: 'Swedish Temptations AB (559008-4231)' },
  { date: '2026-06-05', name: 'TRAN Coffee Lab, mobil', cat: 'Café', addr: '(mobil), Stockholm', op: 'Systrarna TRAN AB (559587-6037)' },
  { date: '2026-06-04', name: 'Nova Classics', cat: 'Grossist', addr: 'Götgatan 35A, Stockholm', op: 'Nova Classics AB (559572-7198)' },
  { date: '2026-06-03', name: 'Kista Äng Gruppbostad', cat: 'Vård/omsorg', addr: 'Borgarfjordsgatan 2C, Spånga', op: 'Stadsdelsnämnd Järva (212000-0142)' },
  { date: '2026-06-03', name: 'Pressbyrån 4250180', cat: 'Kiosk', addr: 'Drottninggatan 65, Stockholm', op: 'Hura Servicehandel AB (559421-0709)' },
  { date: '2026-06-03', name: 'Skruf', cat: 'Huvudkontor', addr: 'Tulegatan 15, Stockholm', op: 'Skruf Snus AB (556626-9196)' },
  { date: '2026-06-02', name: 'Nutraframe.', cat: 'Kosttillskott', addr: 'Torsgatan 27, Stockholm', op: 'Nutraframe AB (559567-1503)' },
  { date: '2026-06-02', name: 'Pizza Jedi', cat: 'Snabbmatsrestaurang', addr: 'Enskede', op: 'Kakelfixarna Stockholm AB (559270-4430)' },
  { date: '2026-06-01', name: 'Kronopartner Stockholm HB', cat: 'Restaurang', addr: 'Tullinge', op: 'Kronopartner Stockholm HB (969762-7470)' },
  { date: '2026-06-01', name: 'Nordic Multserving', cat: 'Restaurang', addr: 'Karl XII:s torg 5, Tullinge', op: 'Nordic Multserving AB (559432-9814)' },
];

export function showPermits() {
  $('#permits-list').innerHTML = PERMITS.map((p) => {
    const meta = [p.addr, p.op].filter(Boolean).map(escapeHtml).join('<br>');
    return `<div class="permit-row">
      <div class="permit-row-head">
        <span class="permit-name">${escapeHtml(p.name)}</span>
        <span class="permit-cat">${escapeHtml(p.cat)}</span>
      </div>
      ${meta ? `<div class="permit-meta">${meta}</div>` : ''}
      <div class="permit-date">Tillstånd: ${escapeHtml(p.date)}</div>
    </div>`;
  }).join('');
  $('#permits-panel').classList.remove('hidden');
  setFloatingHidden(true);
}

function hidePermits() {
  $('#permits-panel').classList.add('hidden');
  setFloatingHidden(false);
}

let toastTimer;
export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
