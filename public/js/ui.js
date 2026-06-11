// UI: bottom sheet, search, filter chips with counts, toasts.

const COLORS = { none: '#9ca3af', visited: '#f59e0b', converted: '#22c55e' };
const $ = (sel) => document.querySelector(sel);

let currentFacility = null;
let selectedStatus = 'none';
let onSave = () => {};
let getOverride = () => null;
let allFacilities = [];
let searchIndex = [];

export function initUI(facilities, overrideGetter, saveHandler, { onFilter, onFocus }) {
  allFacilities = facilities;
  getOverride = overrideGetter;
  onSave = saveHandler;
  searchIndex = facilities.map((f) => ({ f, text: `${f.n} ${f.a}`.toLowerCase() }));

  $('#sheet-close').addEventListener('click', closeSheet);
  document.querySelectorAll('.status-btn').forEach((btn) =>
    btn.addEventListener('click', () => selectStatus(btn.dataset.status))
  );
  $('#sheet-save').addEventListener('click', () => {
    if (!currentFacility) return;
    onSave({ id: currentFacility.id, s: selectedStatus, n: $('#sheet-notes').value.trim() });
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

  // Filter chips
  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    onFilter(chip.dataset.filter);
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
  setSaveStatus('');
  highlightStatusButtons();
  $('#sheet').classList.add('open');
}

export function closeSheet() {
  $('#sheet').classList.remove('open');
  currentFacility = null;
}

export const getOpenFacilityId = () => currentFacility?.id || null;

function selectStatus(status) {
  selectedStatus = status;
  highlightStatusButtons();
}

function highlightStatusButtons() {
  document.querySelectorAll('.status-btn').forEach((btn) =>
    btn.classList.toggle('selected', btn.dataset.status === selectedStatus)
  );
}

export function setSaveStatus(text, kind = '') {
  const el = $('#save-status');
  el.textContent = text;
  el.className = `save-status ${kind}`;
}

export function updateCounts(overrides, total) {
  let visited = 0;
  let converted = 0;
  for (const o of Object.values(overrides)) {
    if (o.s === 'visited') visited++;
    else if (o.s === 'converted') converted++;
  }
  const counts = { all: total, none: total - visited - converted, visited, converted };
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
