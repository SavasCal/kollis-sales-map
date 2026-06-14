// Leaflet map: canvas dot per facility, status colors, filtering, locate-me.

const COLORS = { none: '#9ca3af', visited: '#3b82f6', avvakta: '#f59e0b', converted: '#22c55e' };
const WARN_OUTLINE = '#dc2626'; // "Med avvikelser" — inspection issues, a sales opening

let map;
const markersById = new Map();
let activeFilter = 'all';
let getStatus = () => 'none';
let userMarker = null;
let accuracyCircle = null;
let watching = false;
let watchId = null;
let hereRing = null;       // red 2x ring drawn around the open/selected facility
let hereFacilityId = null; // which facility the ring is currently on

// Bigger dots the closer you zoom — easier to hit with a thumb
function radiusForZoom(z) {
  if (z >= 17) return 13;
  if (z >= 16) return 11;
  if (z >= 15) return 9;
  if (z >= 14) return 8;
  return 7;
}
let currentRadius = 7;

function dotStyle(facility, status) {
  const warn = facility.r === 'Med avvikelser';
  return {
    radius: currentRadius,
    fillColor: COLORS[status] || COLORS.none,
    fillOpacity: 0.92,
    color: warn ? WARN_OUTLINE : '#ffffff',
    weight: warn ? 2.5 : 1.5,
  };
}

const VIEW_KEY = 'salesmap_view';
let suppressMapTapUntil = 0;

export function initMap(facilities, statusGetter, onTap, onMapTap) {
  getStatus = statusGetter;
  map = L.map('map', {
    preferCanvas: true,
    renderer: L.canvas({ tolerance: 12 }),
    zoomControl: false,
  });

  // Start where you left off; otherwise zoomed in on the city, then snap to GPS
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(VIEW_KEY)); } catch { /* ignore */ }
  if (saved?.c && saved?.z) {
    map.setView(saved.c, saved.z);
  } else {
    map.setView([59.331, 18.062], 15);
    navigator.geolocation?.getCurrentPosition(
      (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 16),
      () => {},
      { timeout: 5000, maximumAge: 60000 }
    );
  }
  map.on('moveend', () => {
    const c = map.getCenter();
    localStorage.setItem(VIEW_KEY, JSON.stringify({ c: [c.lat, c.lng], z: map.getZoom() }));
  });

  // Tapping empty map closes the sheet — but not right after a marker tap
  map.on('click', () => {
    if (Date.now() > suppressMapTapUntil) onMapTap?.();
  });

  currentRadius = radiusForZoom(map.getZoom());
  map.on('zoomend', () => {
    const r = radiusForZoom(map.getZoom());
    if (r === currentRadius) return;
    currentRadius = r;
    for (const marker of markersById.values()) marker.setRadius(r);
    hereRing?.setRadius(r * 2);
  });

  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  for (const f of facilities) {
    const marker = L.circleMarker([f.la, f.lo], dotStyle(f, getStatus(f.id)));
    marker.on('click', () => {
      suppressMapTapUntil = Date.now() + 150;
      onTap(f);
    });
    marker._facility = f;
    marker.addTo(map);
    markersById.set(f.id, marker);
  }
  return map;
}

export function updateMarker(id) {
  const marker = markersById.get(id);
  if (!marker) return;
  marker.setStyle(dotStyle(marker._facility, getStatus(id)));
  applyFilterToMarker(marker);
}

export function refreshAllMarkers() {
  for (const marker of markersById.values()) {
    marker.setStyle(dotStyle(marker._facility, getStatus(marker._facility.id)));
    applyFilterToMarker(marker);
  }
}

function applyFilterToMarker(marker) {
  const visible = activeFilter === 'all' || getStatus(marker._facility.id) === activeFilter;
  if (visible && !map.hasLayer(marker)) marker.addTo(map);
  if (!visible && map.hasLayer(marker)) marker.remove();
}

export function setFilter(filter) {
  activeFilter = filter;
  for (const marker of markersById.values()) applyFilterToMarker(marker);
}

export function focusFacility(facility) {
  map.setView([facility.la, facility.lo], Math.max(map.getZoom(), 17));
}

// Draw/move/clear the red 2x ring on a given marker (null clears it).
function setRingOnMarker(marker) {
  if (!marker) {
    hereRing?.remove();
    hereRing = null;
    hereFacilityId = null;
    return;
  }
  if (hereFacilityId === marker._facility.id) {
    hereRing.setLatLng(marker.getLatLng());
    return;
  }
  hereRing?.remove();
  hereFacilityId = marker._facility.id;
  hereRing = L.circleMarker(marker.getLatLng(), {
    radius: currentRadius * 2,
    fill: false,
    color: WARN_OUTLINE,
    weight: 3,
  }).addTo(map);
  hereRing.bringToFront();
}

// Ring the facility whose sheet is open. Accepts a facility object, an id, or
// null/unknown id to clear the ring.
export function ringFacility(arg) {
  if (!arg) return setRingOnMarker(null);
  const id = typeof arg === 'object' ? arg.id : arg;
  setRingOnMarker(markersById.get(id) || null);
}

export function toggleLocate(button) {
  if (watching) {
    navigator.geolocation.clearWatch(watchId);
    watching = false;
    button.classList.remove('active');
    userMarker?.remove();
    accuracyCircle?.remove();
    userMarker = accuracyCircle = null;
    return;
  }
  if (!navigator.geolocation) return;
  watching = true;
  button.classList.add('active');
  let firstFix = true;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (!userMarker) {
        userMarker = L.circleMarker(ll, {
          radius: 8, fillColor: '#2563eb', fillOpacity: 1, color: '#fff', weight: 3,
        }).addTo(map);
        accuracyCircle = L.circle(ll, {
          radius: pos.coords.accuracy, color: '#2563eb', weight: 1, fillOpacity: 0.08,
        }).addTo(map);
      } else {
        userMarker.setLatLng(ll);
        accuracyCircle.setLatLng(ll).setRadius(pos.coords.accuracy);
      }
      if (firstFix) {
        map.setView(ll, Math.max(map.getZoom(), 15));
        firstFix = false;
      }
    },
    () => {
      watching = false;
      button.classList.remove('active');
    },
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}
