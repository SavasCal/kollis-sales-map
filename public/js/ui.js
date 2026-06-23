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
  $('#leads-close').addEventListener('click', hideLeads);

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
const FLOATING_BTNS = ['#leads-toggle', '#permits-toggle', '#kpis-toggle', '#wishes-toggle', '#tasks-toggle', '#locate', '#kanban-toggle'];
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

// --- Read-only static list: restaurant-owner leads grouped by likely heritage ---

// [person, confidence, company, city, turnover (KSEK; '–' = unknown)]
const LEAD_GROUPS = [
  {
    title: '🟡🟢🔴 Turkish (55)',
    rows: [
      ['Okan Uludag', 0.93, 'HS Kök Stockholm AB', 'Farsta', '3 000–4 999'],
      ['Eray Tümtürk', 0.93, 'Brödernas cafe&bageri AB', 'Skarpnäck', '1 000–1 499'],
      ['Mehmet Gökcek', 0.93, 'Fika Time AB', 'Sundbyberg', '–'],
      ['Mehmet Ali Simsek', 0.93, 'Plexia Invest AB', 'Stockholm', '3 000–4 999'],
      ['Metin Kavakli', 0.92, 'Ankara Kebab AB', 'Stockholm', '5 000–9 999'],
      ['Yilmaz Kerpic', 0.92, 'Ask kebab AB', 'Årsta', '3 000–4 999'],
      ['Filiz Yazici', 0.92, 'Far East Food AB', 'Årsta', '50 000–99 999'],
      ['Özcan Sürer', 0.92, 'Rest. Axela AB', 'Stockholm', '20 000–49 999'],
      ['Nilgün Karayel', 0.92, 'Packgross i Stockholm AB', 'Stockholm', '5 000–9 999'],
      ['Eren Öztabak', 0.92, 'Dev-Ber Servicehandel AB', 'Stockholm', '10 000–19 999'],
      ['Fatih Demir', 0.92, 'Stora T HB', 'Stockholm', '10 000–19 999'],
      ['Yasin Yilmaz', 0.92, 'TLH Strand AB', 'Stockholm', '5 000–9 999'],
      ['Ertan Görgülü', 0.92, 'Serkans Gatukök AB', 'Stockholm', '1 500–2 999'],
      ['Volkan Kücük', 0.92, 'Åker Pizzeria AB', 'Hässelby', '10 000–19 999'],
      ['Imdat Ucak', 0.90, 'Suomen Tavaraclearing AB', 'Hägersten', '10 000–19 999'],
      ['Osman Cetin', 0.90, 'CK Ersta HB', 'Stockholm', '5 000–9 999'],
      ['Mustafa Erdinc Kalkan', 0.90, 'Efelund AB', 'Hägersten', '700–999'],
      ['Ergin Kaya', 0.90, 'Erees pizzeria AB', 'Farsta', '700–999'],
      ['Ebru Deniz Kuzey', 0.90, 'Fresta Sweets & Nuts AB', 'Sollentuna', '500–699'],
      ['Mevlüt Ekinci', 0.90, 'MA Hötorget AB', 'Vega', '500–699'],
      ['Erdal Eker', 0.90, 'Jacks Burger Södermalm AB', 'Stockholm', '1 500–2 999'],
      ['Osman Uyanik', 0.90, 'Rest. Pepe Nero i Årstadal AB', 'Stockholm', '5 000–9 999'],
      ['Ercan Coksürer', 0.90, 'CSR Pizzeria AB', 'Stockholm', '5 000–9 999'],
      ['Battal Gazi Ayhan', 0.90, 'Pizzeria NM HB', 'Stockholm', '3 000–4 999'],
      ['Hacer Sule Erzurum', 0.90, 'ICV Restaurang HB', 'Upplands Väsby', '5 000–9 999'],
      ['Can Karademir', 0.90, 'Esperia på Södermalm AB', 'Stockholm', '20 000–49 999'],
      ['Ramazan Topak', 0.90, 'Rest. Glada Hörnan HB', 'Hägersten', '3 000–4 999'],
      ['Suat Kaya', 0.90, 'HBR sjöbris AB', 'Stockholm', '–'],
      ['Ersin Akan', 0.90, 'Stuvsta Pizzeria … Smashburger AB', 'Huddinge', '10 000–19 999'],
      ['Sahin Akbuga', 0.90, 'H. M. Demirel & Co HB', 'Norsborg', '300–499'],
      ['Özay Güven', 0.90, 'Dolan Co AB', 'Stockholm', '1 500–2 999'],
      ['Nevzat Mermer', 0.90, '2 Killar AB', 'Stockholm', '10 000–19 999'],
      ['Ferit Varli', 0.88, 'Frescati Stories AB', 'Södertälje', '3 000–4 999'],
      ['Ismail Kececi', 0.88, 'Ragnar Kök & Bar AB', 'Stockholm', '1 500–2 999'],
      ['Bekir Kalkan', 0.88, 'Rest. Söder Gruvan HB', 'Stockholm', '1 500–2 999'],
      ['Osman Sari', 0.85, 'Yilmaz & Co KB', 'Skärholmen', '3 000–4 999'],
      ['Mahmut Suvakci', 0.85, 'Snurrar AB', 'Stockholm', '5 000–9 999'],
      ['Ahmed Serhat Günes', 0.85, 'Gunes Godishuset AB', 'Järfälla', '1 000–1 499'],
      ['Suleyman Aslan', 0.85, 'Grill 77', 'Stockholm', '1 000–1 499'],
      ['Fuat Üre', 0.85, 'Kebabhak STHLM AB', 'Stockholm', '–'],
      ['Mahmut Suvakci', 0.85, 'Frudam AB', 'Stockholm', '5 000–9 999'],
      ['Hasan Celep', 0.85, 'Recenita AB', 'Stockholm', '< 1'],
      ['Battal Tirpan', 0.85, 'Nya Piccola Rosa AB', 'Hässelby', '5 000–9 999'],
      ['Adnan Aydilek', 0.85, 'Folkunga Pizzeria HB', 'Stockholm', '5 000–9 999'],
      ['Meliha Kaya', 0.85, 'Samavati Förskolor AB', 'Kista', '–'],
      ['Sefer Erdal', 0.85, 'Elissa AB', 'Stockholm', '5 000–9 999'],
      ['Mehmet Salih Tekbas', 0.85, 'R.Tekbas AB', 'Vårby', '< 1'],
      ['Semire Deniz', 0.85, 'Bron Restaurang & Bar AB', 'Södertälje', '10 000–19 999'],
      ['Hasan Celep', 0.85, 'Devdel & Dema AB', 'Enskededalen', '5 000–9 999'],
      ['Ibrahim Ekici', 0.85, 'Ekici & partner AB', 'Johanneshov', '3 000–4 999'],
      ['Semire Deniz', 0.85, 'Thaipas Stockholm AB', 'Stockholm', '500–699'],
      ['Hakan Baran', 0.85, 'Elanur Grill', 'Johanneshov', '1 000–1 499'],
      ['Ebul Muhsin Andic', 0.80, 'Söder Haket AB', 'Enskededalen', '5 000–9 999'],
      ['Chico Halis Köprücü', 0.80, 'Älvsjö Bar & Kök AB', 'Älvsjö', '< 1'],
      ['Edison Altinisik', 0.75, 'Hanks Heaven AB', 'Södertälje', '5 000–9 999'],
    ],
  },
  {
    title: '🟡🟢🔴 Kurdish (11)',
    rows: [
      ['Ako Sardar Rahim', 0.85, 'ARtraining AB', 'Bromma', '1 000–1 499'],
      ['Karwan Mohammad Abubakir', 0.85, 'N FOOD AB', 'Skärholmen', '1–49'],
      ['Heza Zangana', 0.85, 'Spånga Direkt AB', 'Järfälla', '700–999'],
      ['Amanj Sardar Baban', 0.85, 'ABSB Solutions AB', 'Stockholm', '5 000–9 999'],
      ['Zana Shero Jamil', 0.80, 'Tropique AB', 'Bandhagen', '10 000–19 999'],
      ['Karezo Kamalla', 0.70, 'Apotek A AB', 'Kista', '5 000–9 999'],
      ['Ronak Khaledi', 0.70, 'D&D Services AB', 'Upplands Väsby', '1 500–2 999'],
      ['Fatah Toffik Arif', 0.70, 'Apopharmacy AB', 'Hässelby', '1–49'],
      ['Awesta Ali Karem', 0.70, 'Munching Baby AB', 'Hässelby', '–'],
      ['Fawzi Ramzi Bapir Bapir', 0.65, 'antwan HB', 'Vällingby', '3 000–4 999'],
      ['Nuha Qardagh Boya Askar', 0.65, 'RL Restaurang Salar AB', 'Vällingby', '< 1'],
    ],
  },
  {
    title: '⚪ Turkish-or-Kurdish — ambiguous (29)',
    rows: [
      ['Hampus Heval Sune Kjellgren Can', 0.70, 'Ranel Lionel Restaurang AB', 'Vällingby', '5 000–9 999'],
      ['Jan Can Erdogan Filruzi', 0.70, 'J A F Livs AB', 'Stockholm', '20 000–49 999'],
      ['Tekosin Akman', 0.70, 'Polena Rederi AB', 'Farsta', '10 000–19 999'],
      ['Sefkan Robin Aygün', 0.70, 'Björn Ståhlberg AB', 'Stockholm', '3 000–4 999'],
      ['Ihsan Arikan', 0.65, 'Ruccola Bromma AB', 'Bromma', '10 000–19 999'],
      ['Kadir Brazer Bozlak', 0.65, 'Spanjoren Slussen AB', 'Borlänge', '< 1'],
      ['Asir Cigel', 0.60, 'Allé grillen i Rinkeby HB', 'Spånga', '1 500–2 999'],
      ['Gabriel Daniel Johannes Aydin', 0.60, 'Babas burger and bites sweden 2 AB', 'Södertälje', '100 000–499 999'],
      ['Mustafa Sik', 0.60, 'DC Restaurang AB', 'Farsta', '5 000–9 999'],
      ['Samir Ökmen', 0.60, 'Bärasken AB', 'Solna', '5 000–9 999'],
      ['Helin Sofia M Celik Gunnarsson', 0.60, 'Lilla Smash AB', 'Stockholm', '1 500–2 999'],
      ['Isak Cansu', 0.60, 'Spisa Pizza Hammarby Sjöstad AB', 'Södertälje', '3 000–4 999'],
      ['Moses Musa Isik', 0.60, 'Scandinavia Hotell AB', 'Stockholm', '3 000–4 999'],
      ['Danijel Simon Güven', 0.55, 'Bibon AB', 'Stockholm', '–'],
      ['Aynur Halef', 0.55, 'Lussins Konditori & Bageri HB', 'Hägersten', '1 500–2 999'],
      ['Mickael Elia André Yilmaz', 0.55, 'Degkransen AB', 'Hägersten', '700–999'],
      ['Josua Güven', 0.55, 'Villa Romana Odenplan AB', 'Stockholm', '5 000–9 999'],
      ['Reza Albazi', 0.50, 'Albazi Quality AB', 'Kista', '–'],
      ['Antonio Aksu', 0.50, 'ICHIRO AB', 'Stockholm', '–'],
      ['Ismail Koje', 0.50, 'AL MAMA AB', 'Vällingby', '700–999'],
      ['Nadir Halef', 0.50, 'LB Gruppen AB', 'Stockholm', '10 000–19 999'],
      ['Özgur Josef Adayson', 0.50, 'SK Farsta 2 AB', 'Farsta', '< 1'],
      ['Sergon Kristian Can', 0.50, 'V Grillen AB', 'Järfälla', '3 000–4 999'],
      ['Marcel Gabriel Mirza', 0.45, 'Axmara AB', 'Stockholm', '–'],
      ['Sinan Jabar Tomma', 0.45, 'Beirut Lounge AB', 'Skärholmen', '–'],
      ['Allan Yari', 0.45, 'Paramount Property Management AB', 'Sollentuna', '–'],
      ['Janilgan Bayan', 0.45, 'TelTen AB', 'Stockholm', '3 000–4 999'],
      ['Rasmus … Ghambary Ek', 0.40, 'Baggio söder AB', 'Stockholm', '–'],
      ['Ninos Izgin', 0.40, 'Ninos fastfood AB', 'Södertälje', '–'],
    ],
  },
];

// Stable per-lead key for check-off state (person + company is unique enough here).
const leadKey = (person, company) => `${person}␟${company}`;

// `done` is the array of checked-off lead keys from /api/leads.
export function showLeads(done = []) {
  const doneSet = new Set(done);
  $('#leads-list').innerHTML = LEAD_GROUPS.flatMap((g) => g.rows)
    .map(([person, conf, company, city, turnover]) => {
      const meta = [city, turnover && turnover !== '–' ? `${turnover} KSEK` : null]
        .filter(Boolean).map(escapeHtml).join(' · ');
      const key = leadKey(person, company);
      const checked = doneSet.has(key);
      return `<div class="lead-row${checked ? ' done' : ''}" data-key="${escapeHtml(key)}">
        <span class="lead-check" aria-hidden="true">${checked ? '✓' : ''}</span>
        <div class="lead-body">
          <div class="lead-name">${escapeHtml(person)}</div>
          <div class="lead-company">${escapeHtml(company)}</div>
          ${meta ? `<div class="lead-meta">${meta}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  $('#leads-panel').classList.remove('hidden');
  setFloatingHidden(true);
}

function hideLeads() {
  $('#leads-panel').classList.add('hidden');
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
