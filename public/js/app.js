// Boot: password gate -> load facilities + shared state -> map + UI wiring.
import * as api from './api.js';
import * as mapView from './map.js';
import * as ui from './ui.js';

const $ = (sel) => document.querySelector(sel);

let facilities = [];
let overrides = {}; // facilityId -> {s, n, t}
let booted = false;

const getOverride = (id) => overrides[id] || null;
const getStatus = (id) => overrides[id]?.s || 'none';

function showGate(withError = false) {
  $('#gate').classList.remove('hidden');
  $('#gate-error').classList.toggle('hidden', !withError);
  $('#gate-password').focus();
}

function applyOverrides(next) {
  overrides = next || {};
  ui.updateCounts(overrides, facilities.length);
  if (booted) mapView.refreshAllMarkers();
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
    });
    $('#locate').addEventListener('click', (e) => mapView.toggleLocate(e.currentTarget));
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
  const { id, s, n, v, c, tools } = payload;
  // Optimistic: recolor immediately, then persist
  if (s === 'none' && !n && !v && !c && !tools) delete overrides[id];
  else overrides[id] = { s: s === 'none' ? undefined : s, n, v, c, tools, t: new Date().toISOString() };
  mapView.updateMarker(id);
  ui.updateCounts(overrides, facilities.length);
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
