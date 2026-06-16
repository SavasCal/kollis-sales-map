// Admin task editor: add / toggle / delete tasks in the shared task bin.
// Password-gated with the same APP_PASSWORD as the map (shared localStorage key).
import * as api from '/js/api.js';
import { renderWishRows } from '/js/ui.js';

const $ = (sel) => document.querySelector(sel);
let tasks = [];
let wishes = [];
let kpiSteps = [];

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

function showGate(withError = false) {
  $('#gate').classList.remove('hidden');
  $('#admin').classList.add('hidden');
  $('#gate-error').classList.toggle('hidden', !withError);
  $('#gate-password').focus();
}

function render() {
  const list = $('#admin-list');
  if (!tasks.length) {
    list.innerHTML = '<p class="admin-empty">Inga uppgifter ännu</p>';
    return;
  }
  // Render in stored order — drag-to-reorder controls the ranking, top = highest.
  list.innerHTML = tasks
    .map(
      (t) => `<div class="admin-task${t.done ? ' done' : ''}" data-id="${escapeHtml(t.id)}" draggable="true">
        <span class="admin-drag" aria-hidden="true">&#9776;</span>
        <input type="checkbox" data-act="toggle" ${t.done ? 'checked' : ''} />
        <span class="admin-task-text">${escapeHtml(t.text)}</span>
        <button class="admin-del" data-act="delete" aria-label="Ta bort">&times;</button>
      </div>`
    )
    .join('');
}

// --- Drag to reorder (rank) ---
let dragId = null;

const listEl = $('#admin-list');

listEl.addEventListener('dragstart', (e) => {
  const row = e.target.closest('.admin-task');
  if (!row) return;
  dragId = row.dataset.id;
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});

listEl.addEventListener('dragend', (e) => {
  e.target.closest('.admin-task')?.classList.remove('dragging');
  dragId = null;
});

listEl.addEventListener('dragover', (e) => {
  e.preventDefault(); // allow drop
  const dragging = listEl.querySelector('.admin-task.dragging');
  if (!dragging) return;
  const after = rowAfter(e.clientY);
  if (after == null) listEl.appendChild(dragging);
  else listEl.insertBefore(dragging, after);
});

listEl.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!dragId) return;
  const order = [...listEl.querySelectorAll('.admin-task')].map((r) => r.dataset.id);
  // Skip the round-trip if nothing actually moved.
  if (order.join() !== tasks.map((t) => t.id).join()) mutate({ action: 'reorder', order });
});

// Find the row whose midpoint is just below the cursor (drop target).
function rowAfter(y) {
  const rows = [...listEl.querySelectorAll('.admin-task:not(.dragging)')];
  return rows.find((row) => {
    const box = row.getBoundingClientRect();
    return y < box.top + box.height / 2;
  }) || null;
}

async function load() {
  try {
    const data = await api.getTasks();
    tasks = data.tasks || [];
    $('#gate').classList.add('hidden');
    $('#admin').classList.remove('hidden');
    render();
    loadWishes();
    loadKpis();
  } catch (err) {
    if (err.message === 'unauthorized') return; // auth-failed event handles the gate
    showGate();
  }
}

// --- Wishlist (votes are the ranking — no drag-to-reorder) ---
function renderWishes() {
  $('#admin-wishes-list').innerHTML = renderWishRows(wishes);
}

async function loadWishes() {
  try {
    const data = await api.getWishes();
    wishes = data.wishes || [];
    renderWishes();
  } catch (err) {
    if (err.message === 'unauthorized') return;
    /* leave the section empty; tasks already unlocked the gate */
  }
}

async function mutateWish(payload) {
  try {
    const data = await api.saveWish(payload);
    wishes = data.wishes || [];
    renderWishes();
  } catch (err) {
    if (err.message === 'unauthorized') return;
    alert('Kunde inte spara — försök igen');
  }
}

$('#admin-wishes-add').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#admin-wishes-text');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  mutateWish({ action: 'add', text });
});

$('#admin-wishes-list').addEventListener('click', (e) => {
  const row = e.target.closest('.wish-row');
  if (!row) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  const id = row.dataset.id;
  if (act === 'vote') mutateWish({ action: 'vote', id, vote: 1 });
  else if (act === 'delete') mutateWish({ action: 'delete', id });
  else if (act === 'edit') {
    const current = row.querySelector('.wish-text')?.textContent || '';
    const text = prompt('Ändra önskemål:', current);
    if (text == null) return;
    const t = text.trim();
    if (t && t !== current) mutateWish({ action: 'edit', id, text: t });
  }
});

// --- KPI / weekly targets (single week, editable step list) ---
function renderKpis() {
  const list = $('#admin-kpi-list');
  if (!kpiSteps.length) {
    list.innerHTML = '<p class="admin-empty">Inga steg ännu</p>';
    return;
  }
  list.innerHTML = kpiSteps
    .map(
      (s) => `<div class="admin-kpi" data-id="${escapeHtml(s.id)}">
        <input class="admin-kpi-label" data-field="label" value="${escapeHtml(s.label)}" maxlength="40" />
        <input class="admin-kpi-num" data-field="current" type="number" min="0" inputmode="numeric" value="${Number(s.current) || 0}" />
        <span class="admin-kpi-sep">/</span>
        <input class="admin-kpi-num" data-field="target" type="number" min="0" inputmode="numeric" value="${Number(s.target) || 0}" />
        <button class="admin-del" data-act="delete" aria-label="Ta bort">&times;</button>
      </div>`
    )
    .join('');
}

async function loadKpis() {
  try {
    const data = await api.getKpis();
    kpiSteps = data.steps || [];
    $('#admin-kpi-week-input').value = data.week || '';
    renderKpis();
  } catch (err) {
    if (err.message === 'unauthorized') return;
    /* leave the section empty; tasks already unlocked the gate */
  }
}

async function mutateKpi(payload) {
  try {
    const data = await api.saveKpi(payload);
    kpiSteps = data.steps || [];
    $('#admin-kpi-week-input').value = data.week || '';
    renderKpis();
  } catch (err) {
    if (err.message === 'unauthorized') return;
    alert('Kunde inte spara — försök igen');
  }
}

$('#admin-kpi-week').addEventListener('submit', (e) => {
  e.preventDefault();
  mutateKpi({ action: 'set-week', week: $('#admin-kpi-week-input').value.trim() });
});

$('#admin-kpi-add').addEventListener('submit', (e) => {
  e.preventDefault();
  const label = $('#admin-kpi-label').value.trim();
  const target = $('#admin-kpi-target').value;
  if (!label || target === '') return;
  $('#admin-kpi-label').value = '';
  $('#admin-kpi-target').value = '';
  mutateKpi({ action: 'add-step', label, target: Number(target) });
});

// Save edited label/current/target on blur or change (event delegation)
$('#admin-kpi-list').addEventListener('change', (e) => {
  const input = e.target.closest('[data-field]');
  if (!input) return;
  const row = input.closest('.admin-kpi');
  const id = row?.dataset.id;
  if (!id) return;
  const field = input.dataset.field;
  const value = field === 'label' ? input.value.trim() : Number(input.value);
  if (field === 'label' && !value) { renderKpis(); return; } // reject empty label
  mutateKpi({ action: 'edit-step', id, [field]: value });
});

$('#admin-kpi-list').addEventListener('click', (e) => {
  if (e.target.dataset.act !== 'delete') return;
  const id = e.target.closest('.admin-kpi')?.dataset.id;
  if (id) mutateKpi({ action: 'delete-step', id });
});

async function mutate(payload) {
  try {
    const data = await api.saveTask(payload);
    tasks = data.tasks || [];
    render();
  } catch (err) {
    if (err.message === 'unauthorized') return;
    alert('Kunde inte spara — försök igen');
  }
}

// Add
$('#admin-add').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#admin-text');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  mutate({ action: 'add', text });
});

// Toggle / delete (event delegation)
$('#admin-list').addEventListener('click', (e) => {
  const row = e.target.closest('.admin-task');
  if (!row) return;
  const act = e.target.dataset.act;
  if (act === 'toggle') mutate({ action: 'toggle', id: row.dataset.id });
  else if (act === 'delete') mutate({ action: 'delete', id: row.dataset.id });
});

// Gate
$('#gate-form').addEventListener('submit', (e) => {
  e.preventDefault();
  api.setPassword($('#gate-password').value);
  $('#gate-error').classList.add('hidden');
  load();
});

window.addEventListener('auth-failed', () => showGate(true));

// Boot
if (api.getPassword()) load();
else showGate();
