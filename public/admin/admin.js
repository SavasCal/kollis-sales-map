// Admin task editor: add / toggle / delete tasks in the shared task bin.
// Password-gated with the same APP_PASSWORD as the map (shared localStorage key).
import * as api from '/js/api.js';

const $ = (sel) => document.querySelector(sel);
let tasks = [];

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
  } catch (err) {
    if (err.message === 'unauthorized') return; // auth-failed event handles the gate
    showGate();
  }
}

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
