// Boot: password gate -> load facilities + shared state -> map + UI wiring.
import * as api from './api.js';
import * as mapView from './map.js';
import * as ui from './ui.js';

const $ = (sel) => document.querySelector(sel);

let facilities = [];
let overrides = {}; // facilityId -> {s, n, t}
let booted = false;

const getOverride = (id) => overrides[id] || null;
const getOverrides = () => overrides;
const getStatus = (id) => overrides[id]?.s || 'none';

function showGate(withError = false) {
  $('#gate').classList.remove('hidden');
  $('#gate-error').classList.toggle('hidden', !withError);
  $('#gate-password').focus();
}

function applyOverrides(next) {
  overrides = next || {};
  ui.updateCounts(overrides, facilities.length);
  if (booted) {
    mapView.refreshAllMarkers();
    ui.refreshKanbanIfOpen();
  }
}

async function boot() {
  // One round trip both authenticates and loads shared state
  let state;
  try {
    state = await api.getState();
  } catch (err) {
    if (err.message !== 'unauthorized') {
      showGate();
      ui.toast('Kunde inte nå servern, försök igen');
    }
    return;
  }

  $('#gate').classList.add('hidden');
  $('#app').classList.remove('hidden');

  if (!facilities.length) {
    facilities = await (await fetch('/data/facilities.json')).json();
  }
  applyOverrides(state.overrides);

  if (!booted) {
    booted = true;
    mapView.initMap(facilities, getStatus, ui.openSheet, ui.closeSheet);
    ui.initUI(facilities, getOverride, handleSave, {
      onFilter: mapView.setFilter,
      onFocus: mapView.focusFacility,
      onSelect: mapView.ringFacility,
      getOverrides,
    });
    $('#locate').addEventListener('click', (e) => mapView.toggleLocate(e.currentTarget));
    $('#kanban-toggle').addEventListener('click', ui.toggleKanban);
    $('#tasks-toggle').addEventListener('click', openTasks);
    $('#wishes-toggle').addEventListener('click', openWishes);
    $('#kpis-toggle').addEventListener('click', openKpis);
    $('#permits-toggle').addEventListener('click', ui.showPermits);
    wireWishes();
    $('#refresh').addEventListener('click', refreshState);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        api.flushQueue(applyOverrides).then(refreshState);
      }
    });
    window.addEventListener('online', () => api.flushQueue(applyOverrides));
    mapView.refreshAllMarkers();
  }

  api.flushQueue(applyOverrides);
}

async function openTasks() {
  try {
    const { tasks } = await api.getTasks();
    ui.showTasks(tasks);
  } catch (err) {
    if (err.message === 'unauthorized') return;
    ui.toast('Kunde inte hämta uppgifter');
  }
}

async function openWishes() {
  try {
    const { wishes } = await api.getWishes();
    ui.showWishes(wishes);
  } catch (err) {
    if (err.message === 'unauthorized') return;
    ui.toast('Kunde inte hämta önskemål');
  }
}

async function openKpis() {
  try {
    const { week, steps } = await api.getKpis();
    ui.showKpis({ week, steps });
  } catch (err) {
    if (err.message === 'unauthorized') return;
    ui.toast('Kunde inte hämta veckomål');
  }
}

// Wire the wishlist add-form + delegated vote/edit/delete once at boot.
// Each mutation returns the full list, which we re-render in place.
function wireWishes() {
  const mutate = async (payload) => {
    try {
      const { wishes } = await api.saveWish(payload);
      ui.showWishes(wishes);
    } catch (err) {
      if (err.message === 'unauthorized') return;
      ui.toast('Kunde inte spara — försök igen');
    }
  };

  $('#wishes-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#wishes-text');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    mutate({ action: 'add', text });
  });

  $('#wishes-list').addEventListener('click', (e) => {
    const row = e.target.closest('.wish-row');
    if (!row) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    const id = row.dataset.id;
    if (act === 'vote') mutate({ action: 'vote', id, vote: 1 });
    else if (act === 'delete') mutate({ action: 'delete', id });
    else if (act === 'edit') {
      const current = row.querySelector('.wish-text')?.textContent || '';
      const text = prompt('Ändra önskemål:', current);
      if (text == null) return;
      const t = text.trim();
      if (t && t !== current) mutate({ action: 'edit', id, text: t });
    }
  });
}

async function refreshState() {
  const btn = $('#refresh');
  btn.classList.add('spinning');
  try {
    const state = await api.getState();
    applyOverrides(state.overrides);
  } catch {
    /* offline or auth-failed (handled via event) */
  } finally {
    btn.classList.remove('spinning');
  }
}

async function handleSave(payload) {
  const { id, s, n, v, c, tools, own } = payload;
  // Optimistic: recolor immediately, then persist
  if (s === 'none' && !n && !v && !c && !tools && !own) delete overrides[id];
  else overrides[id] = { s: s === 'none' ? undefined : s, n, v, c, tools, own, t: new Date().toISOString() };
  mapView.updateMarker(id);
  ui.updateCounts(overrides, facilities.length);
  ui.refreshKanbanIfOpen();
  ui.setSaveStatus('Sparar…');

  try {
    const data = await api.saveOverride(payload);
    applyOverrides(data.overrides);
    ui.setSaveStatus('Sparat ✓', 'ok');
    api.flushQueue(applyOverrides);
  } catch (err) {
    if (err.message === 'unauthorized') return;
    api.enqueueSave(payload);
    ui.setSaveStatus('Kunde inte spara — sparas när du är online igen', 'err');
    ui.toast(`${api.pendingCount()} ändring(ar) väntar på att skickas`);
  }
}

// Gate form
$('#gate-form').addEventListener('submit', (e) => {
  e.preventDefault();
  api.setPassword($('#gate-password').value);
  $('#gate-error').classList.add('hidden');
  boot();
});

window.addEventListener('auth-failed', () => {
  $('#app').classList.add('hidden');
  showGate(true);
});

// Start: try stored password, otherwise show gate
if (api.getPassword()) boot();
else showGate();
