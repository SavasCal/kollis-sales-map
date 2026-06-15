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
  // Open tasks first, then done; preserve insertion order within each group.
  const ordered = [...tasks].sort((a, b) => Number(a.done) - Number(b.done));
  list.innerHTML = ordered
    .map(
      (t) => `<div class="admin-task${t.done ? ' done' : ''}" data-id="${escapeHtml(t.id)}">
        <input type="checkbox" data-act="toggle" ${t.done ? 'checked' : ''} />
        <span class="admin-task-text">${escapeHtml(t.text)}</span>
        <button class="admin-del" data-act="delete" aria-label="Ta bort">&times;</button>
      </div>`
    )
    .join('');
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
