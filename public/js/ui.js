// UI: bottom sheet, search, filter chips with counts, toasts.

const COLORS = { none: '#9ca3af', visited: '#3b82f6', avvakta: '#f59e0b', converted: '#22c55e' };
const $ = (sel) => document.querySelector(sel);

let currentFacility = null;
let selectedStatus = 'none';
let onSave = () => {};
let getOverride = () => null;
let getOverrides = () => ({});
let allFacilities = [];
let facilityById = new Map();
let searchIndex = [];
let kanbanOpen = false;

export function initUI(facilities, overrideGetter, saveHandler, { onFilter, onFocus, getOverrides: overridesGetter }) {
  allFacilities = facilities;
  facilityById = new Map(facilities.map((f) => [f.id, f]));
  getOverride = overrideGetter;
  getOverrides = overridesGetter;
  onSave = saveHandler;
  searchIndex = facilities.map((f) => ({ f, text: `${f.n} ${f.a}`.toLowerCase() }));

  $('#sheet-close').addEventListener('click', closeSheet);
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

  // Touching the map dismisses the search dropdown and the keyboard
  $('#map').addEventListener('pointerdown', () => {
    hideSearch();
    searchInput.blur();
  }, { passive: true });

  // Filter chips
  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    onFilter(chip.dataset.filter);
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
  $('#sheet-visited').value = override?.v || '';
  $('#sheet-comeback').value = override?.c || '';
  $('#sheet-tools').value = override?.tools || '';
  setSaveStatus('');
  highlightStatusButtons();
  $('#sheet').classList.add('open');
}

export function closeSheet() {
  $('#sheet').classList.remove('open');
  currentFacility = null;
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
  const buckets = { visited: [], avvakta: [], converted: [], övrigt: [] };
  for (const [id, o] of Object.entries(getOverrides())) {
    const facility = facilityById.get(id);
    if (!facility) continue;
    const key = buckets[o?.s] ? o.s : 'övrigt';
    buckets[key].push({ facility, o });
  }
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
  return `<button class="kanban-card st-${statusKey}" data-id="${escapeHtml(facility.id)}">
    <span class="kanban-name">${escapeHtml(facility.n)}</span>
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
