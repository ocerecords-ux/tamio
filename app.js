/* Tamio – prototyp navigace
 * Mapa: OpenStreetMap (vektorové dlaždice OpenFreeMap, 3D budovy)
 * Hledání adres: Nominatim (OSM)
 * Trasy: OSRM (veřejný demo server)
 * Hlášení a uložená místa: zatím jen v tomto prohlížeči (localStorage)
 */
'use strict';

/* ---------- Nastavení ---------- */
const CFG = {
  start: [16.6068, 49.1951],         // výchozí střed mapy, než je známa poloha
  nominatim: 'https://nominatim.openstreetmap.org',
  osrm: 'https://router.project-osrm.org',
  offRouteMeters: 60,                 // vzdálenost od trasy, kdy přepočítat
  rerouteEveryMs: 10000,
  reportTtlMs: 3 * 60 * 60 * 1000,    // hlášení zmizí po 3 hodinách
  simFactor: 3,                       // jízda nanečisto běží 3× rychleji než ve skutečnosti
  simTickMs: 250,
};

const REPORT_TYPES = {
  kolona:   { label: 'Kolona',   color: '#A78BFA', icon: '<rect x="3" y="10" width="7" height="6" rx="1"/><rect x="14" y="10" width="7" height="6" rx="1"/><path d="M3 19h18"/>' },
  nehoda:   { label: 'Nehoda',   color: '#FF6B57', icon: '<path d="M12 3l9 16H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>' },
  policie:  { label: 'Policie',  color: '#60A5FA', icon: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>' },
  uzavirka: { label: 'Uzavírka', color: '#FBBF24', icon: '<path d="M4 12h16"/><path d="M6 8v8M18 8v8"/>' },
  prekazka: { label: 'Překážka', color: '#F472B6', icon: '<circle cx="12" cy="12" r="3"/><path d="M5 19l3-4M19 19l-3-4M12 4v5"/>' },
  pocasi:   { label: 'Počasí',   color: '#4ADE80', icon: '<path d="M7 16a4 4 0 1 1 1-7.9A5 5 0 0 1 18 9a3.5 3.5 0 0 1 0 7z"/><path d="M9 19l-1 2M13 19l-1 2M17 19l-1 2"/>' },
};

const store = {
  get(k, d) { try { const v = localStorage.getItem('tamio.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tamio.' + k, JSON.stringify(v)); } catch (e) { /* bez úložiště */ } },
};

/* ---------- Stav ---------- */
const S = {
  pos: null,          // {lng, lat, heading, speed}
  hasFix: false,
  dest: null,         // {name, addr, lng, lat}
  routes: [],
  sel: 0,
  nav: null,          // aktivní navigace
  sim: null,          // časovač jízdy nanečisto
  follow: true,
  muted: false,
  view3d: store.get('view3d', true),
  reports: [],
  saved: { home: null, work: null },
  quickTimes: {},
};

/* ---------- Pomocné funkce ---------- */
const $ = (id) => document.getElementById(id);
const R = 6371000;
const rad = (d) => d * Math.PI / 180;
function dist(a, b) {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function fmtDist(m) {
  if (m >= 10000) return Math.round(m / 1000) + ' km';
  if (m >= 1000) return (m / 1000).toFixed(1).replace('.', ',') + ' km';
  if (m >= 300) return Math.round(m / 50) * 50 + ' m';
  return Math.max(10, Math.round(m / 10) * 10) + ' m';
}
function fmtDur(s) {
  const min = Math.round(s / 60);
  if (min < 60) return min + ' min';
  return Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
}
function fmtClock(date) {
  return date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
function here() {
  if (S.pos) return [S.pos.lng, S.pos.lat];
  const c = map.getCenter();
  return [c.lng, c.lat];
}

/* ---------- Mapa ---------- */
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/dark',
  customAttribution: 'trasy <a href="https://project-osrm.org" target="_blank">OSRM</a>',
  center: CFG.start,
  zoom: 12,
  attributionControl: { compact: true },
  pitchWithRotate: true,
});


/* Podkladová mapa v barvách Tamia */
function tintBaseMap() {
  const set = (id, prop, val) => { if (map.getLayer(id)) { try { map.setPaintProperty(id, prop, val); } catch (e) { /* vrstva bez vlastnosti */ } } };
  set('background', 'background-color', '#191330');
  set('water', 'fill-color', '#1C2B4A');
  set('waterway', 'line-color', '#1C2B4A');
  set('landuse_park', 'fill-color', '#17301F');
  set('landcover_wood', 'fill-color', '#17301F');
  set('landuse_residential', 'fill-color', '#1C1535');
  set('building', 'fill-color', '#2B2244');
  ['highway_minor', 'highway_path'].forEach((id) => set(id, 'line-color', '#3A2F58'));
  ['highway_major_inner', 'highway_major_subtle'].forEach((id) => set(id, 'line-color', '#514477'));
  ['highway_motorway_inner', 'highway_motorway_subtle'].forEach((id) => set(id, 'line-color', '#6B5E8C'));
  ['highway_major_casing', 'highway_motorway_casing'].forEach((id) => set(id, 'line-color', '#140F22'));
  map.getStyle().layers.forEach((l) => {
    if (l.type === 'symbol') { set(l.id, 'text-color', '#B5ABCF'); set(l.id, 'text-halo-color', '#140F22'); }
  });
}

map.on('load', () => {
  tintBaseMap();
  map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'routes-alt', type: 'line', source: 'routes', filter: ['==', ['get', 'sel'], false],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#5B4F78', 'line-width': 7 },
  });
  map.addLayer({
    id: 'routes-casing', type: 'line', source: 'routes', filter: ['==', ['get', 'sel'], true],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#140F22', 'line-width': 13 },
  });
  map.addLayer({
    id: 'routes-sel', type: 'line', source: 'routes', filter: ['==', ['get', 'sel'], true],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#A78BFA', 'line-width': 8 },
  });
  map.on('click', 'routes-alt', (e) => {
    const i = e.features[0] && e.features[0].properties.i;
    if (typeof i === 'number' && !S.nav) selectRoute(i);
  });
  renderReports();
  add3D();
});

// Dlouhé podržení / pravé tlačítko = vybrat cíl na mapě
map.on('contextmenu', (e) => { if (!S.nav) pickPoint(e.lngLat); });
let pressTimer = null;
map.on('touchstart', (e) => {
  if (S.nav || e.originalEvent.touches.length > 1) return;
  const ll = e.lngLat;
  pressTimer = setTimeout(() => pickPoint(ll), 600);
});
['touchend', 'touchmove', 'dragstart', 'zoomstart'].forEach((ev) => map.on(ev, () => clearTimeout(pressTimer)));
map.on('dragstart', () => {
  if (S.nav && S.follow) { S.follow = false; $('btn-recenter').hidden = false; }
});

/* ---------- Poloha ---------- */
const meEl = document.createElement('div');
meEl.className = 'me';
const meMarker = new maplibregl.Marker({ element: meEl, rotationAlignment: 'map' });

function setPos(p) {
  S.pos = p;
  updateSpeed(p);
  meMarker.setLngLat([p.lng, p.lat]);
  if (!meMarker._map) meMarker.addTo(map);
  if (S.nav) {
    meMarker.setRotation(p.heading || 0);
    navUpdate();
  }
}

if ('geolocation' in navigator) {
  navigator.geolocation.watchPosition((g) => {
    if (S.sim) return;
    const first = !S.hasFix;
    S.hasFix = true;
    let heading = g.coords.heading;
    if ((heading == null || isNaN(heading)) && S.pos) heading = bearing([S.pos.lng, S.pos.lat], [g.coords.longitude, g.coords.latitude]);
    setPos({ lng: g.coords.longitude, lat: g.coords.latitude, heading: heading || 0, speed: g.coords.speed });
    if (first) { map.jumpTo({ center: [S.pos.lng, S.pos.lat], zoom: 14 }); refreshQuick(); }
  }, (err) => {
    if (err.code === 1) toast('Bez přístupu k poloze. Trasy počítám ze středu mapy.');
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
}

$('btn-locate').addEventListener('click', () => {
  if (S.pos) map.flyTo({ center: [S.pos.lng, S.pos.lat], zoom: 15 });
  else toast('Poloha zatím není k dispozici.');
});

/* ---------- Panely ---------- */
const VIEWS = ['idle', 'place', 'routes', 'nav', 'report', 'arrived', 'car'];
let prevView = 'idle';
function show(v) {
  VIEWS.forEach((n) => { $('v-' + n).hidden = n !== v; });
  if (v !== 'report') prevView = v;
  const navOn = v === 'nav' || (v === 'report' && S.nav);
  $('top').hidden = navOn;
  $('banner').hidden = !navOn;
  $('fabs').hidden = !navOn;
  $('gauge').hidden = !navOn;
  $('drawer-tab').hidden = navOn;
  if (navOn) closeDrawer();
  if (!navOn) $('alert-chip').hidden = true;
}

/* ---------- Hledání ---------- */
const q = $('q');
let searchTimer = null, searchCtl = null;
q.addEventListener('input', () => {
  $('q-clear').hidden = !q.value;
  clearTimeout(searchTimer);
  if (q.value.trim().length < 3) { $('results').hidden = true; return; }
  searchTimer = setTimeout(() => search(q.value.trim()), 450);
});
q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { clearTimeout(searchTimer); if (q.value.trim()) search(q.value.trim()); }
  if (e.key === 'Escape') { $('results').hidden = true; }
});
$('q-clear').addEventListener('click', () => { q.value = ''; $('q-clear').hidden = true; $('results').hidden = true; q.focus(); });

async function search(text, bounded) {
  if (searchCtl) searchCtl.abort();
  searchCtl = new AbortController();
  const [lng, lat] = here();
  const d = bounded ? 0.05 : 1.5;
  const params = new URLSearchParams({
    format: 'jsonv2', q: text, limit: bounded ? '10' : '7', 'accept-language': 'cs', addressdetails: '0',
    viewbox: [lng - d, lat + d, lng + d, lat - d].join(','),
  });
  if (bounded) params.set('bounded', '1');
  const ul = $('results');
  try {
    const res = await fetch(CFG.nominatim + '/search?' + params, { signal: searchCtl.signal });
    if (!res.ok) throw new Error(res.status);
    const items = await res.json();
    ul.innerHTML = '';
    if (!items.length) {
      ul.innerHTML = '<li class="r-empty">Nic jsem nenašel. Zkus jiný název nebo přidej město.</li>';
    }
    items.forEach((it) => {
      const parts = it.display_name.split(', ');
      const name = it.name || parts[0];
      const sub = parts.filter((p) => p !== name).slice(0, 4).join(', ');
      const km = dist([lng, lat], [+it.lon, +it.lat]) / 1000;
      const li = document.createElement('li');
      li.innerHTML = '<button><span class="r-name">' + esc(name) + '</span><span class="r-sub">' +
        (S.pos ? esc(km.toFixed(km < 10 ? 1 : 0).replace('.', ',')) + ' km · ' : '') + esc(sub) + '</span></button>';
      li.firstChild.addEventListener('click', () => {
        ul.hidden = true; q.blur();
        setDest({ name, addr: sub, lng: +it.lon, lat: +it.lat });
      });
      ul.appendChild(li);
    });
    ul.hidden = false;
  } catch (e) {
    if (e.name === 'AbortError') return;
    ul.innerHTML = '<li class="r-empty">Hledání teď nefunguje. Zkontroluj připojení a zkus to znovu.</li>';
    ul.hidden = false;
  }
}

document.querySelectorAll('[data-poi]').forEach((b) => {
  b.addEventListener('click', () => {
    q.value = b.dataset.poi; $('q-clear').hidden = false;
    search(b.dataset.poi, true);
  });
});

async function pickPoint(ll) {
  setDest({ name: 'Vybrané místo', addr: ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5), lng: ll.lng, lat: ll.lat });
  try {
    const p = new URLSearchParams({ format: 'jsonv2', lat: ll.lat, lon: ll.lng, 'accept-language': 'cs', zoom: '18' });
    const res = await fetch(CFG.nominatim + '/reverse?' + p);
    const it = await res.json();
    if (it && it.display_name && S.dest && S.dest.lng === ll.lng) {
      const parts = it.display_name.split(', ');
      S.dest.name = it.name || parts.slice(0, 2).join(' ');
      S.dest.addr = parts.slice(2, 5).join(', ');
      $('place-name').textContent = S.dest.name;
      $('place-addr').textContent = S.dest.addr;
    }
  } catch (e) { /* zůstane souřadnice */ }
}

/* ---------- Cíl ---------- */
const destEl = document.createElement('div');
destEl.className = 'dest-pin';
const destMarker = new maplibregl.Marker({ element: destEl });

function setDest(d) {
  S.dest = d;
  destMarker.setLngLat([d.lng, d.lat]).addTo(map);
  $('place-name').textContent = d.name;
  $('place-addr').textContent = d.addr || '';
  updatePlaceFavBtn();
  clearRoutes();
  show('place');
  map.flyTo({ center: [d.lng, d.lat], zoom: Math.max(map.getZoom(), 14) });
}
$('place-close').addEventListener('click', resetAll);
$('btn-routes').addEventListener('click', () => loadRoutes());
$('save-home').addEventListener('click', () => savePlace('home'));
$('save-work').addEventListener('click', () => savePlace('work'));

function savePlace(key) {
  if (!S.dest) return;
  S.saved[key] = { ...S.dest };
  store.set('saved', S.saved);
  toast((key === 'home' ? 'Domov' : 'Práce') + ' uloženo.');
  refreshQuick();
}

function resetAll() {
  S.dest = null; destMarker.remove();
  clearRoutes();
  q.value = ''; $('q-clear').hidden = true; $('results').hidden = true;
  show('idle');
}

/* ---------- Trasy ---------- */
async function fetchRoutes(from, to, alternatives) {
  const url = CFG.osrm + '/route/v1/driving/' + from.join(',') + ';' + to.join(',') +
    '?overview=full&geometries=geojson&steps=true&alternatives=' + (alternatives ? 'true' : 'false');
  const res = await fetch(url);
  if (!res.ok) throw new Error('osrm ' + res.status);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes.length) throw new Error(data.code);
  return data.routes;
}

async function loadRoutes(prefer) {
  if (!S.dest) return;
  const btn = $('btn-routes');
  btn.disabled = true; btn.textContent = 'Počítám trasy…';
  try {
    const routes = await fetchRoutes(here(), [S.dest.lng, S.dest.lat], true);
    S.routes = routes.map((r, i) => ({ ...r, i, turns: r.legs[0].steps.filter((s) => /turn|end of road|fork|roundabout|rotary/.test(s.maneuver.type)).length }));
    tagRoutes();
    S.sel = 0;
    if (prefer) {
      const m = (prefer.tag && S.routes.find((r) => r.tags.some((t) => t[0] === prefer.tag))) ||
        (prefer.via && S.routes.find((r) => (r.legs[0].summary || '').includes(prefer.via)));
      if (m) S.sel = m.i;
    }
    $('routes-note').hidden = !!S.pos;
    $('routes-note').textContent = 'Poloha není známá, trasa začíná ve středu mapy.';
    drawRoutes();
    renderRouteList();
    show('routes');
    updateFavBtn();
    fitRoute(S.routes[S.sel]);
  } catch (e) {
    toast('Trasu se nepodařilo spočítat. Zkus to znovu za chvíli.');
  } finally {
    btn.disabled = false; btn.textContent = 'Ukázat trasy';
  }
}

function tagRoutes() {
  const rs = S.routes;
  rs.forEach((r) => { r.tags = []; });
  const fastest = rs.reduce((a, b) => (b.duration < a.duration ? b : a));
  fastest.tags.push(['fast', 'Nejrychlejší']);
  if (rs.length > 1) {
    const calm = rs.reduce((a, b) => (b.turns < a.turns ? b : a));
    if (calm.turns < fastest.turns) calm.tags.push(['calm', 'Klidná']);
    const shortest = rs.reduce((a, b) => (b.distance < a.distance ? b : a));
    if (shortest !== fastest) shortest.tags.push(['short', 'Nejkratší']);
  }
}

function renderRouteList() {
  const box = $('route-list');
  box.innerHTML = '';
  const now = Date.now();
  S.routes.forEach((r) => {
    const b = document.createElement('button');
    b.className = 'route';
    b.setAttribute('aria-pressed', String(r.i === S.sel));
    const tags = r.tags.map(([c, t]) => '<span class="tag ' + c + '">' + t + '</span>').join(' ');
    const name = (r.legs[0].summary || '').split(', ').filter(Boolean).slice(0, 2).join(', ');
    b.innerHTML = '<div class="r-top"><span class="r-time">' + fmtDur(r.duration) + '</span><span>' + tags + '</span></div>' +
      '<span class="r-meta">' + (name ? 'Přes ' + esc(name) + ' · ' : '') + fmtDist(r.distance) +
      ' · příjezd ' + fmtClock(new Date(now + r.duration * 1000)) + ' · ' + r.turns + ' odbočení</span>';
    b.addEventListener('click', () => selectRoute(r.i));
    box.appendChild(b);
  });
}

function selectRoute(i) {
  S.sel = i;
  updateFavBtn();
  drawRoutes();
  document.querySelectorAll('#route-list .route').forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
}

function drawRoutes() {
  const src = map.getSource('routes');
  if (!src) return;
  const feats = S.routes.map((r) => ({ type: 'Feature', properties: { i: r.i, sel: r.i === S.sel }, geometry: r.geometry }));
  feats.sort((a, b) => Number(a.properties.sel) - Number(b.properties.sel));
  src.setData({ type: 'FeatureCollection', features: feats });
}

function clearRoutes() {
  S.routes = [];
  const src = map.getSource('routes');
  if (src) src.setData({ type: 'FeatureCollection', features: [] });
}

function fitRoute(r) {
  const b = new maplibregl.LngLatBounds();
  r.geometry.coordinates.forEach((c) => b.extend(c));
  const sheetH = $('sheet').offsetHeight;
  map.fitBounds(b, { padding: { top: 150, bottom: sheetH + 30, left: 40, right: 40 }, maxZoom: 16, duration: 700 });
}

$('routes-close').addEventListener('click', () => { clearRoutes(); show('place'); });
$('btn-go').addEventListener('click', () => startNav(false));
$('btn-sim').addEventListener('click', () => startNav(true));

/* ---------- Navigace ---------- */
function prepNav(route) {
  const coords = route.geometry.coordinates;
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + dist(coords[i - 1], coords[i]));
  const total = cum[cum.length - 1];
  const scale = route.distance / (total || 1);
  let acc = 0;
  const steps = route.legs[0].steps.map((s) => {
    const st = { ...s, at: acc / scale, spokeFar: false, spokeNear: false };
    acc += s.distance;
    return st;
  });
  return { route, coords, cum, total, steps, idx: 0, progress: 0, lastReroute: 0, offCount: 0, stepIdx: -1 };
}

function startNav(sim) {
  const route = S.routes[S.sel];
  if (!route) return;
  S.routes = [route]; S.sel = route.i; drawRoutes();
  S.nav = prepNav(route);
  S.follow = true;
  $('btn-recenter').hidden = true;
  meEl.className = 'me nav car';
  meEl.innerHTML = carSVG(S.car, 56);
  show('nav');
  unlockSpeech();
  if (sim) startSim();
  else if (S.pos) navUpdate();
  else { const c = S.nav.coords[0]; setPos({ lng: c[0], lat: c[1], heading: 0 }); }
}

function navUpdate() {
  const N = S.nav;
  if (!N || !S.pos) return;
  const p = [S.pos.lng, S.pos.lat];

  // nejbližší bod trasy (hledáme kolem posledního indexu)
  let best = N.idx, bestD = Infinity;
  const from = Math.max(0, N.idx - 5), to = Math.min(N.coords.length - 1, N.idx + 300);
  for (let i = from; i <= to; i++) {
    const d = dist(p, N.coords[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  N.idx = best;
  N.progress = N.cum[best];

  // mimo trasu → přepočítat
  if (bestD > CFG.offRouteMeters) N.offCount++; else N.offCount = 0;
  if (N.offCount >= 3 && !S.sim && Date.now() - N.lastReroute > CFG.rerouteEveryMs) reroute();

  const remaining = Math.max(0, N.total - N.progress);
  if (remaining < 30) { arrive(); return; }

  // další manévr
  let si = N.steps.findIndex((s, i) => i > 0 && s.at > N.progress + 8);
  if (si === -1) si = N.steps.length - 1;
  const step = N.steps[si];
  const toStep = Math.max(0, step.at - N.progress);
  if (si !== N.stepIdx) { N.stepIdx = si; renderBanner(step); }
  $('banner-dist').textContent = fmtDist(toStep);

  // hlas
  const text = instruction(step);
  const adv = laneAdvice(N.lanes);
  const full = (d) => 'Za ' + speakDist(d) + ' ' + lowerFirst(text) + (adv ? '. ' + adv + '.' : '.');
  if (!step.spokeFar && toStep > 450 && toStep < 1500) { step.spokeFar = true; say(full(toStep)); }
  if (!step.spokeMid && toStep <= 320 && toStep > 140) { step.spokeMid = true; step.spokeFar = true; say(full(toStep)); }
  if (!step.spokeNear && toStep <= 70) { step.spokeNear = step.spokeMid = step.spokeFar = true; say(text); }

  // odpočet posledních 300 m
  const cd = $('countdown');
  cd.hidden = toStep > 300;
  if (!cd.hidden) $('countdown-bar').style.width = Math.max(0, Math.min(100, toStep / 3)) + '%';

  // čas příjezdu
  const left = N.route.duration * (remaining / N.total);
  $('nav-eta').textContent = fmtClock(new Date(Date.now() + left * 1000));
  $('nav-rest').textContent = fmtDur(left) + ' · ' + fmtDist(remaining);

  updateAhead();

  if (S.follow) {
    map.easeTo({ center: p, bearing: S.pos.heading || 0, pitch: S.view3d ? 60 : 0, zoom: S.view3d ? 16.8 : 16.5, duration: S.sim ? CFG.simTickMs : 900, padding: { top: 260, bottom: 40 } });
  }
}

async function reroute() {
  const N = S.nav;
  N.lastReroute = Date.now();
  try {
    const [r] = await fetchRoutes(here(), [S.dest.lng, S.dest.lat], false);
    if (!S.nav) return;
    r.i = 0; r.tags = [];
    S.routes = [r]; S.sel = 0; drawRoutes();
    S.nav = prepNav(r);
    say('Přepočítávám trasu.');
    navUpdate();
  } catch (e) { /* zkusí se znovu při další odchylce */ }
}

function arrive() {
  const name = S.dest ? S.dest.name : '';
  stopNav();
  say('Jsi v cíli.');
  $('arrived-name').textContent = name;
  show('arrived');
}

function stopNav() {
  stopSim();
  resetSpeed();
  S.nav = null;
  meEl.className = 'me'; meEl.innerHTML = '';
  meMarker.setRotation(0);
  map.easeTo({ pitch: S.view3d ? 45 : 0, bearing: 0, padding: { top: 0, bottom: 0 }, duration: 600 });
  $('alert-chip').hidden = true;
  if (S.hasFix && S.pos) setPos(S.pos);
}

$('btn-end').addEventListener('click', () => { stopNav(); clearRoutes(); show('place'); });
$('btn-arrived-ok').addEventListener('click', resetAll);
$('btn-recenter').addEventListener('click', () => { S.follow = true; $('btn-recenter').hidden = true; navUpdate(); });
$('btn-mute').addEventListener('click', () => {
  S.muted = !S.muted;
  $('btn-mute').setAttribute('aria-pressed', String(S.muted));
  $('btn-mute').setAttribute('aria-label', S.muted ? 'Zapnout hlas' : 'Ztlumit hlas');
  $('mute-icon').innerHTML = S.muted
    ? '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>'
    : '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9a4 4 0 0 1 0 6"/>';
  if (S.muted && window.speechSynthesis) speechSynthesis.cancel();
});

/* ---------- Pokyny česky ---------- */
const MOD = {
  'left': 'vlevo', 'right': 'vpravo', 'slight left': 'mírně vlevo', 'slight right': 'mírně vpravo',
  'sharp left': 'ostře vlevo', 'sharp right': 'ostře vpravo', 'straight': 'rovně', 'uturn': 'zpět',
};
const ANGLE = {
  'straight': 0, 'slight right': 45, 'right': 90, 'sharp right': 135, 'uturn': 180,
  'sharp left': -135, 'left': -90, 'slight left': -45,
};
function lowerFirst(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
function instruction(step) {
  const m = step.maneuver, type = m.type, mod = m.modifier || 'straight';
  const name = step.name || step.ref || '';
  const na = name ? ' na ' + name : '';
  switch (type) {
    case 'depart': return 'Vyjeď' + (name ? ' po ' + name : '');
    case 'arrive': return 'Cíl' + (mod === 'left' ? ' je vlevo' : mod === 'right' ? ' je vpravo' : ' je před tebou');
    case 'roundabout':
    case 'rotary':
      return 'Na kruhovém objezdu vyjeď ' + (m.exit ? m.exit + '. výjezdem' : '') + na;
    case 'roundabout turn': return 'Na kruhovém objezdu ' + MOD[mod] + na;
    case 'merge': return 'Zařaď se ' + (MOD[mod] || '') + na;
    case 'on ramp': return 'Najeď ' + (MOD[mod] || '') + na;
    case 'off ramp': return 'Sjeď ' + (MOD[mod] || '') + na;
    case 'fork': return 'Na rozcestí drž se ' + (mod.includes('left') ? 'vlevo' : mod.includes('right') ? 'vpravo' : 'rovně') + na;
    case 'continue':
    case 'new name':
      return mod === 'straight' ? 'Pokračuj rovně' + na : 'Pokračuj ' + MOD[mod] + na;
    default:
      if (mod === 'uturn') return 'Otoč se';
      if (mod === 'straight') return 'Pokračuj rovně' + na;
      return 'Odboč ' + MOD[mod] + na;
  }
}
function renderBanner(step) {
  const m = step.maneuver;
  let svg;
  if (m.type === 'arrive') {
    svg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4"/><path d="M6 4h11l-2 4 2 4H6"/></svg>';
  } else if (/roundabout|rotary/.test(m.type)) {
    svg = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="4"/><path d="M12 22v-5M12 9V2M9 5l3-3 3 3"/></svg>';
  } else {
    const a = ANGLE[m.modifier || 'straight'] || 0;
    svg = '<svg viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(' + a + 'deg)"><path d="M12 21V4"/><path d="M6 10l6-6 6 6"/></svg>';
  }
  $('banner-icon').innerHTML = svg;
  $('banner-instr').textContent = instruction(step);
  S.nav.lanes = lanesFor(step);
  renderLanes(S.nav.lanes);
}

/* ---------- Jízdní pruhy ---------- */
// OSRM posílá u křižovatky seznam pruhů zleva doprava: {indications: ['left','straight'], valid: true}
const LANE_PATHS = {
  straight: '<path d="M12 21V5"/><path d="M7 10l5-5 5 5"/>',
  right: '<path d="M8 21v-8a5 5 0 0 1 5-5h6"/><path d="M16 5l3 3-3 3"/>',
  'slight right': '<path d="M9 21v-6l8-8"/><path d="M11 7h6v6"/>',
  'sharp right': '<path d="M7 21V7l10 10"/><path d="M17 11v6h-6"/>',
  uturn: '<path d="M15 21V10a4 4 0 0 0-8 0v5"/><path d="M4 12l3 3 3-3"/>',
};
function laneIcon(ind) {
  let key = ind, mirror = false;
  if (/left/.test(ind)) { key = ind.replace('left', 'right'); mirror = true; }
  const d = LANE_PATHS[key] || LANE_PATHS.straight;
  return mirror ? '<g transform="translate(24 0) scale(-1 1)">' + d + '</g>' : d;
}
function lanesFor(step) {
  const it = step.intersections && step.intersections[0];
  const L = it && it.lanes;
  return L && L.length > 1 && L.some((l) => l.valid) && L.some((l) => !l.valid) ? L : null;
}
function renderLanes(L) {
  const box = $('lanes');
  box.innerHTML = '';
  box.hidden = !L;
  if (!L) return;
  L.forEach((l) => {
    const el = document.createElement('div');
    el.className = 'lane' + (l.valid ? ' ok' : '');
    const inds = (l.indications && l.indications.length ? l.indications : ['straight']).filter((x) => x !== 'none');
    el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (inds.length ? inds : ['straight']).map(laneIcon).join('') + '</svg>';
    box.appendChild(el);
  });
  const adv = laneAdvice(L);
  box.setAttribute('aria-label', adv || 'Jízdní pruhy');
}
function laneAdvice(L) {
  if (!L) return '';
  const n = L.length, ok = L.map((l, i) => (l.valid ? i : -1)).filter((i) => i >= 0);
  if (!ok.length || ok.length === n) return '';
  const many = ok.length > 1;
  if (ok[ok.length - 1] < n / 2) return 'Drž se ' + (many ? 'v levých pruzích' : 'v levém pruhu');
  if (ok[0] >= n / 2) return 'Drž se ' + (many ? 'v pravých pruzích' : 'v pravém pruhu');
  return 'Drž se ' + (many ? 've středních pruzích' : 've středním pruhu');
}
function speakDist(m) {
  if (m >= 1000) return (Math.round(m / 100) / 10).toString().replace('.', ',') + ' kilometru';
  if (m >= 300) return Math.round(m / 50) * 50 + ' metrů';
  return Math.round(m / 10) * 10 + ' metrů';
}

/* ---------- Hlas ---------- */
let voice = null;
function pickVoice() {
  if (!window.speechSynthesis) return;
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => v.lang === 'cs-CZ') || vs.find((v) => v.lang && v.lang.startsWith('cs')) || null;
}
if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function unlockSpeech() {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u);
}
function say(text) {
  if (S.muted || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'cs-CZ'; if (voice) u.voice = voice; u.rate = 1.02;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

/* ---------- Jízda nanečisto ---------- */
function startSim() {
  stopSim();
  let d = 0, v = 0, last = performance.now();
  const avg = S.nav.route.distance / Math.max(1, S.nav.route.duration); // průměrná rychlost trasy v m/s
  S.sim = setInterval(() => {
    const N = S.nav;
    if (!N) { stopSim(); return; }
    const now = performance.now(), dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    // cílová rychlost: o něco nad průměrem trasy, před odbočením zpomalit
    let target = Math.min(avg * 1.2, 36);
    const st = N.steps[N.stepIdx];
    if (st && st.maneuver && st.maneuver.type !== 'arrive') {
      const to = st.at - N.progress;
      if (to < 120) target = Math.min(target, 6 + Math.max(0, to) / 120 * target * 0.7);
    }
    v += (target - v) * Math.min(1, dt * 0.9);
    d = Math.min(N.total, d + v * dt * CFG.simFactor);
    let i = N.idx;
    while (i < N.cum.length - 1 && N.cum[i + 1] < d) i++;
    const a = N.coords[i], b = N.coords[Math.min(i + 1, N.coords.length - 1)];
    const seg = (N.cum[i + 1] || N.cum[i]) - N.cum[i];
    const t = seg > 0 ? (d - N.cum[i]) / seg : 0;
    const pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    setPos({ lng: pt[0], lat: pt[1], heading: bearing(a, b), speed: v });
  }, CFG.simTickMs);
}
function stopSim() { if (S.sim) { clearInterval(S.sim); S.sim = null; } }

/* ---------- Hlášení ---------- */
const repMarkers = new Map();
S.reports = store.get('reports', []).filter((r) => Date.now() - r.t < CFG.reportTtlMs);

function svgIcon(inner) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg>'; }

(function buildReportGrid() {
  const g = $('report-grid');
  Object.entries(REPORT_TYPES).forEach(([key, t]) => {
    const b = document.createElement('button');
    b.className = 'rbtn';
    b.innerHTML = '<span style="color:' + t.color + '">' + svgIcon(t.icon) + '</span>' + t.label;
    b.addEventListener('click', () => addReport(key));
    g.appendChild(b);
  });
})();

$('btn-report').addEventListener('click', () => show('report'));
$('report-close').addEventListener('click', () => show(prevView));

function addReport(type) {
  const [lng, lat] = here();
  S.reports.push({ id: Date.now().toString(36), type, lng, lat, t: Date.now(), ok: 1 });
  saveReports();
  renderReports();
  toast(REPORT_TYPES[type].label + ' nahlášena. Díky!');
  show(prevView);
}
function saveReports() { store.set('reports', S.reports); }

function renderReports() {
  const alive = new Set(S.reports.map((r) => r.id));
  repMarkers.forEach((m, id) => { if (!alive.has(id)) { m.remove(); repMarkers.delete(id); } });
  S.reports.forEach((r) => {
    if (repMarkers.has(r.id)) return;
    const t = REPORT_TYPES[r.type];
    const el = document.createElement('div');
    el.className = 'rep-pin';
    el.style.background = t.color;
    el.innerHTML = svgIcon(t.icon);
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', t.label);
    const pop = new maplibregl.Popup({ offset: 20, closeButton: true }).setDOMContent(reportPopup(r));
    const m = new maplibregl.Marker({ element: el }).setLngLat([r.lng, r.lat]).setPopup(pop).addTo(map);
    repMarkers.set(r.id, m);
  });
}

function reportPopup(r) {
  const t = REPORT_TYPES[r.type];
  const div = document.createElement('div');
  div.className = 'pop';
  const mins = Math.max(1, Math.round((Date.now() - r.t) / 60000));
  div.innerHTML = '<b>' + t.label + '</b><span class="muted">Před ' + mins + ' min · potvrzeno ' + r.ok + '×</span>' +
    '<div class="pop-btns"><button data-a="ok">Stále tam</button><button data-a="gone">Už tam není</button></div>';
  div.querySelector('[data-a="ok"]').addEventListener('click', () => {
    r.ok++; r.t = Date.now(); saveReports();
    div.querySelector('.muted').textContent = 'Právě potvrzeno · ' + r.ok + '×';
  });
  div.querySelector('[data-a="gone"]').addEventListener('click', () => {
    S.reports = S.reports.filter((x) => x.id !== r.id); saveReports(); renderReports();
  });
  return div;
}

// Upozornění na nejbližší hlášení před tebou na trase
function updateAhead() {
  const N = S.nav, chip = $('alert-chip');
  let best = null;
  S.reports.forEach((r) => {
    const rp = [r.lng, r.lat];
    let bi = -1, bd = 45;
    for (let i = N.idx; i < N.coords.length; i += 2) {
      const d = dist(rp, N.coords[i]);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi < 0) return;
    const ahead = N.cum[bi] - N.progress;
    if (ahead > 20 && ahead < 5000 && (!best || ahead < best.ahead)) best = { r, ahead };
  });
  if (!best) { chip.hidden = true; return; }
  const t = REPORT_TYPES[best.r.type];
  chip.innerHTML = '<span class="dot" style="background:' + t.color + '"></span>' + t.label + ' za ' + fmtDist(best.ahead) + ' · potvrzeno ' + best.r.ok + '×';
  chip.hidden = false;
  chip.style.top = Math.round($('banner').getBoundingClientRect().bottom + 8) + 'px';
  if (!best.r.spoken && best.ahead < 800) { best.r.spoken = true; say(t.label + ' za ' + speakDist(best.ahead) + '.'); }
}


/* ---------- 3D: budovy z OpenStreetMap a terén ---------- */
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
let has3dBuildings = false, hasTerrain = false;

async function add3D() {
  try {
    map.addSource('terrain', { type: 'raster-dem', tiles: [TERRAIN_TILES], tileSize: 256, encoding: 'terrarium', maxzoom: 15 });
    hasTerrain = true;
  } catch (e) { console.warn('Terén nedostupný', e); }
  try {
    if (!map.getSource('openmaptiles')) throw new Error('chybí zdroj budov');
    map.addLayer({
      id: 'buildings-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13.5,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8], 0, '#2B2244', 30, '#3B2F5C', 90, '#55487A', 200, '#7A6BA8'],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 15, ['coalesce', ['get', 'render_height'], 8]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.88,
      },
    }, 'routes-alt');
    has3dBuildings = true;
  } catch (e) { console.warn('3D budovy nedostupné', e); }
  apply3D(true);
}

function apply3D(animate) {
  document.querySelectorAll('.view-btn').forEach((b) => {
    b.querySelector('.view-label').textContent = S.view3d ? '2D' : '3D';
    b.setAttribute('aria-label', S.view3d ? 'Přepnout na 2D mapu' : 'Přepnout na 3D pohled');
  });
  if (has3dBuildings) {
    map.setLayoutProperty('buildings-3d', 'visibility', S.view3d ? 'visible' : 'none');
    if (map.getLayer('building')) map.setLayoutProperty('building', 'visibility', S.view3d ? 'none' : 'visible');
  }
  if (hasTerrain) {
    try { map.setTerrain(S.view3d ? { source: 'terrain', exaggeration: 1.3 } : null); } catch (e) { /* bez terénu */ }
  }
  if (animate) {
    if (S.nav) navUpdate();
    else map.easeTo({ pitch: S.view3d ? 50 : 0, duration: 600 });
  }
}

function toggle3D() {
  S.view3d = !S.view3d;
  store.set('view3d', S.view3d);
  apply3D(true);
  toast(S.view3d ? 'Prostorový pohled zapnutý.' : 'Plochá mapa.');
}
$('btn-3d').addEventListener('click', toggle3D);
$('btn-view').addEventListener('click', toggle3D);


/* ---------- Oblíbené trasy ---------- */
S.favs = store.get('favs', []);

S.places = store.get('favPlaces', []);

function favRow(name, sub, onOpen, onDelete) {
  const row = document.createElement('div');
  row.className = 'fav-row';
  const b = document.createElement('button');
  b.className = 'fav';
  b.innerHTML = '<span class="f-name"></span><span class="f-sub"></span>';
  b.children[0].textContent = name;
  b.children[1].textContent = sub;
  b.addEventListener('click', onOpen);
  const del = document.createElement('button');
  del.className = 'fav-del';
  del.setAttribute('aria-label', 'Odebrat z oblíbených: ' + name);
  del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  del.addEventListener('click', onDelete);
  row.append(b, del);
  return row;
}

function renderFavs() {
  const places = $('fav-places'), routes = $('fav-list');
  places.innerHTML = ''; routes.innerHTML = '';
  $('fav-places-empty').hidden = !!S.places.length;
  $('fav-routes-empty').hidden = !!S.favs.length;
  S.places.forEach((f) => {
    places.appendChild(favRow(f.name, f.addr || '', () => {
      closeDrawer();
      setDest({ name: f.name, addr: f.addr, lng: f.lng, lat: f.lat });
    }, () => {
      S.places = S.places.filter((x) => x.id !== f.id);
      store.set('favPlaces', S.places);
      renderFavs(); updatePlaceFavBtn();
      toast('Místo odebráno z oblíbených.');
    }));
  });
  S.favs.forEach((f) => {
    const sub = [f.tagLabel, f.via ? 'přes ' + f.via : ''].filter(Boolean).join(' · ') || f.addr || '';
    routes.appendChild(favRow(f.name, sub, () => {
      closeDrawer();
      setDest({ name: f.name, addr: f.addr, lng: f.lng, lat: f.lat });
      loadRoutes(f);
    }, () => {
      S.favs = S.favs.filter((x) => x.id !== f.id);
      store.set('favs', S.favs);
      renderFavs();
      toast('Trasa odebrána z oblíbených.');
    }));
  });
}

/* oblíbená místa */
const samePlace = (a, b) => Math.abs(a.lng - b.lng) < 1e-5 && Math.abs(a.lat - b.lat) < 1e-5;
function updatePlaceFavBtn() {
  const saved = !!(S.dest && S.places.find((f) => samePlace(f, S.dest)));
  $('btn-fav-place').classList.toggle('saved', saved);
  $('btn-fav-place-label').textContent = saved ? 'V oblíbených' : 'Přidat do oblíbených';
}
$('btn-fav-place').addEventListener('click', () => {
  if (!S.dest) return;
  const ex = S.places.find((f) => samePlace(f, S.dest));
  if (ex) {
    S.places = S.places.filter((f) => f !== ex);
    toast('Místo odebráno z oblíbených.');
  } else {
    S.places.unshift({ id: Date.now().toString(36), name: S.dest.name, addr: S.dest.addr || '', lng: S.dest.lng, lat: S.dest.lat });
    toast('Uloženo. Oblíbená místa najdeš v panelu vlevo.');
  }
  store.set('favPlaces', S.places);
  renderFavs(); updatePlaceFavBtn();
});

/* vysouvací panel */
function openDrawer() {
  const d = $('drawer');
  d.inert = false; d.classList.add('open');
  $('scrim').hidden = false;
  $('drawer-tab').setAttribute('aria-expanded', 'true');
  $('results').hidden = true;
  setTimeout(() => $('drawer-close').focus(), 50);
}
function closeDrawer() {
  const d = $('drawer');
  if (!d.classList.contains('open')) return;
  d.classList.remove('open'); d.inert = true;
  $('scrim').hidden = true;
  $('drawer-tab').setAttribute('aria-expanded', 'false');
}
$('drawer-tab').addEventListener('click', openDrawer);
$('drawer-close').addEventListener('click', closeDrawer);
$('scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
let swipeX = null;
$('drawer').addEventListener('touchstart', (e) => { swipeX = e.touches[0].clientX; }, { passive: true });
$('drawer').addEventListener('touchend', (e) => {
  if (swipeX != null && e.changedTouches[0].clientX - swipeX < -60) closeDrawer();
  swipeX = null;
});
document.addEventListener('touchstart', (e) => {
  if (S.nav || $('drawer').classList.contains('open')) return;
  const t = e.touches[0];
  if (t.clientX < 18) { swipeX = t.clientX; document.addEventListener('touchend', function edge(ev) {
    document.removeEventListener('touchend', edge);
    if (ev.changedTouches[0].clientX - swipeX > 60) openDrawer();
    swipeX = null;
  }); }
}, { passive: true });

function currentFav() {
  const r = S.routes[S.sel];
  if (!r || !S.dest) return null;
  const tag = (r.tags[0] || [])[0] || '';
  return S.favs.find((f) => Math.abs(f.lng - S.dest.lng) < 1e-5 && Math.abs(f.lat - S.dest.lat) < 1e-5 && f.tag === tag) || null;
}

function updateFavBtn() {
  const saved = !!currentFav();
  $('btn-fav').classList.toggle('saved', saved);
  $('btn-fav-label').textContent = saved ? 'V oblíbených' : 'Uložit do oblíbených';
}

$('btn-fav').addEventListener('click', () => {
  const r = S.routes[S.sel];
  if (!r || !S.dest) return;
  const existing = currentFav();
  if (existing) {
    S.favs = S.favs.filter((x) => x !== existing);
    toast('Odebráno z oblíbených.');
  } else {
    const tag = r.tags[0] || [];
    S.favs.unshift({
      id: Date.now().toString(36), name: S.dest.name, addr: S.dest.addr || '', lng: S.dest.lng, lat: S.dest.lat,
      tag: tag[0] || '', tagLabel: tag[1] || '', via: ((r.legs[0].summary || '').split(', ')[0]) || '',
    });
    toast('Trasa uložena. Najdeš ji v panelu vlevo.');
  }
  store.set('favs', S.favs);
  renderFavs();
  updateFavBtn();
});

/* ---------- Tachometr ---------- */
const GAUGE = { max: 180, from: -120, sweep: 240, limits: [0, 30, 50, 70, 90, 110, 130] };
S.limit = store.get('limit', 50);
S.kmh = 0;
let overSince = 0, lastWarn = 0, lastFix = null;
const gAng = (v) => GAUGE.from + Math.max(0, Math.min(v, GAUGE.max)) / GAUGE.max * GAUGE.sweep;
const gPt = (v, r) => { const a = gAng(v) * Math.PI / 180; return [(70 + r * Math.sin(a)).toFixed(2), (70 - r * Math.cos(a)).toFixed(2)]; };

function buildGauge() {
  const F = 'font-family="IBM Plex Sans, Helvetica, sans-serif"';
  let g = '<circle cx="70" cy="70" r="66" fill="#140F22"/>';
  if (S.limit) {
    const [x0, y0] = gPt(S.limit, 62), [x1, y1] = gPt(GAUGE.max, 62);
    const large = (GAUGE.max - S.limit) / GAUGE.max * GAUGE.sweep > 180 ? 1 : 0;
    g += '<path d="M' + x0 + ' ' + y0 + ' A62 62 0 ' + large + ' 1 ' + x1 + ' ' + y1 + '" fill="none" stroke="#FF6B57" stroke-width="5" stroke-opacity=".8"/>';
  }
  for (let v = 0; v <= GAUGE.max; v += 10) {
    const major = v % 20 === 0;
    const [x0, y0] = gPt(v, major ? 49 : 53), [x1, y1] = gPt(v, 57);
    g += '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y1 + '" stroke="' + (major ? '#EEF1F5' : '#6B5E8C') + '" stroke-width="' + (major ? 2 : 1.2) + '" stroke-linecap="round"/>';
  }
  for (let v = 0; v <= GAUGE.max; v += 40) {
    const [x, y] = gPt(v, 38);
    g += '<text x="' + x + '" y="' + (+y + 3.5).toFixed(2) + '" text-anchor="middle" font-size="10" fill="#B5ABCF" ' + F + '>' + v + '</text>';
  }
  g += '<text id="g-num" x="70" y="99" text-anchor="middle" font-size="21" font-weight="700" fill="#EEF1F5" font-family="Sora, Helvetica, sans-serif">' + Math.round(S.kmh) + '</text>';
  g += '<text x="70" y="110" text-anchor="middle" font-size="8" fill="#B5ABCF" ' + F + '>km/h</text>';
  g += '<text x="70" y="126" text-anchor="middle" font-size="8.5" font-weight="600" letter-spacing=".6" fill="' + (S.limit ? '#FF6B57' : '#B5ABCF') + '" ' + F + '>' + (S.limit ? 'LIMIT ' + S.limit : 'BEZ LIMITU') + '</text>';
  g += '<g id="g-needle" style="transform-box:view-box;transform-origin:70px 70px;transform:rotate(' + gAng(S.kmh) + 'deg);transition:transform .45s cubic-bezier(.3,1.3,.5,1)">' +
    '<line x1="70" y1="80" x2="70" y2="15" stroke="#A78BFA" stroke-width="3" stroke-linecap="round"/></g>';
  g += '<circle cx="70" cy="70" r="6" fill="#A78BFA" stroke="#140F22" stroke-width="2"/>';
  $('gauge-svg').innerHTML = g;
  $('gauge').setAttribute('aria-label', 'Tachometr, ' + (S.limit ? 'hlídám rychlost nad ' + S.limit + ' km/h' : 'hlídání rychlosti vypnuté') + '. Klepnutím limit změníš.');
}

function updateSpeed(p) {
  const now = Date.now();
  let ms = null;
  if (p.speed != null && !isNaN(p.speed) && p.speed >= 0) ms = p.speed;
  else if (lastFix) {
    const dt = (now - lastFix.t) / 1000;
    if (dt >= 0.5) ms = dist([lastFix.lng, lastFix.lat], [p.lng, p.lat]) / dt;
  }
  if (!lastFix || ms != null) lastFix = { lng: p.lng, lat: p.lat, t: now };
  if (ms == null) return;
  S.kmh = Math.min(250, ms * 3.6);
  renderSpeed();
}

function renderSpeed() {
  const num = $('g-num');
  if (!num) return;
  const v = Math.round(S.kmh);
  num.textContent = v;
  $('g-needle').style.transform = 'rotate(' + gAng(S.kmh) + 'deg)';
  const over = !!S.limit && v > S.limit + 2;
  $('gauge').classList.toggle('over', over);
  num.setAttribute('fill', over ? '#FF6B57' : '#EEF1F5');
  if (over && S.nav) {
    if (!overSince) overSince = Date.now();
    if (Date.now() - overSince > 2000 && Date.now() - lastWarn > 20000) {
      lastWarn = Date.now();
      say('Zpomal, jedeš ' + v + ' kilometrů v hodině.');
    }
  } else overSince = 0;
}

function resetSpeed() { S.kmh = 0; lastFix = null; overSince = 0; renderSpeed(); }

$('gauge').addEventListener('click', () => {
  const i = GAUGE.limits.indexOf(S.limit);
  S.limit = GAUGE.limits[(i + 1) % GAUGE.limits.length];
  store.set('limit', S.limit);
  buildGauge();
  renderSpeed();
  toast(S.limit ? 'Hlídám rychlost nad ' + S.limit + ' km/h.' : 'Hlídání rychlosti vypnuté.');
});

/* ---------- Moje auto ---------- */
const CAR_COLORS = [['Bílá', '#F2F3F5'], ['Stříbrná', '#B8BEC8'], ['Šedá', '#6E7480'], ['Černá', '#24232B'], ['Modrá', '#2F6FDB'],
  ['Tmavě modrá', '#1E3A6E'], ['Červená', '#D9363E'], ['Zelená', '#2E8B57'], ['Žlutá', '#F2C230'], ['Oranžová', '#F07F2B'], ['Hnědá', '#7A5236'], ['Fialová', '#8B5CF6']];
const CAR_BRANDS = ['Škoda', 'Volkswagen', 'Toyota', 'Hyundai', 'Kia', 'Ford', 'Renault', 'Peugeot', 'Dacia', 'Opel', 'BMW',
  'Mercedes-Benz', 'Audi', 'Volvo', 'Tesla', 'Mazda', 'Honda', 'Citroën', 'Seat', 'Cupra', 'Suzuki', 'Nissan', 'Fiat', 'Jiná'];
const CAR_BODIES = [['hatch', 'Hatchback'], ['sedan', 'Sedan'], ['kombi', 'Kombi'], ['suv', 'SUV'], ['van', 'Dodávka'], ['coupe', 'Kupé']];
S.car = store.get('car', { brand: 'Škoda', body: 'kombi', color: '#B8BEC8', year: 2019 });

// Auto shora, příď nahoru. Tvar podle karoserie, detaily podle roku výroby.
function carSVG(car, height) {
  const dims = { hatch: [26, 52], sedan: [26, 62], kombi: [26, 64], suv: [30, 62], van: [30, 72], coupe: [26, 57] }[car.body] || [26, 60];
  const [w, h] = dims;
  const x = (40 - w) / 2, y = (80 - h) / 2;
  const era = car.year < 2000 ? 'old' : car.year < 2015 ? 'mid' : 'new';
  const rad = era === 'old' ? 3 : era === 'mid' ? 7 : 9.5;
  const cab = { hatch: [0.25, 0.86], sedan: [0.29, 0.72], kombi: [0.26, 0.9], suv: [0.24, 0.88], van: [0.13, 0.95], coupe: [0.34, 0.72] }[car.body] || [0.27, 0.8];
  const gx = x + 3.5, gw = w - 7;
  const ws = y + h * cab[0], wsH = h * (car.body === 'van' ? 0.08 : 0.12);
  const rearEnd = y + h * cab[1], rgH = car.body === 'van' ? 0 : h * 0.07;
  const glass = '#16122A';
  const c = car.color;
  const parts = [];
  parts.push('<ellipse cx="20" cy="' + (y + h / 2 + 2) + '" rx="' + (w / 2 + 3) + '" ry="' + (h / 2 + 3) + '" fill="rgba(0,0,0,.4)"/>');
  // zrcátka
  const my = ws + wsH * 0.6;
  parts.push('<rect x="' + (x - 2.4) + '" y="' + my + '" width="3.4" height="3.2" rx="1" fill="' + c + '" stroke="rgba(238,241,245,.6)" stroke-width=".6"/>');
  parts.push('<rect x="' + (x + w - 1) + '" y="' + my + '" width="3.4" height="3.2" rx="1" fill="' + c + '" stroke="rgba(238,241,245,.6)" stroke-width=".6"/>');
  // karoserie
  parts.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + rad + '" fill="' + c + '" stroke="rgba(238,241,245,.75)" stroke-width="1.1"/>');
  // čelní sklo
  parts.push('<path d="M' + (gx + 2.2) + ' ' + ws + ' L' + (gx + gw - 2.2) + ' ' + ws + ' L' + (gx + gw) + ' ' + (ws + wsH) + ' L' + gx + ' ' + (ws + wsH) + ' Z" fill="' + glass + '"/>');
  // střecha
  const roofTop = ws + wsH + 0.8, roofBot = rearEnd - rgH - 0.8;
  parts.push('<rect x="' + (gx + 0.6) + '" y="' + roofTop + '" width="' + (gw - 1.2) + '" height="' + (roofBot - roofTop) + '" rx="2.2" fill="rgba(0,0,0,.14)"/>');
  // boční okna
  parts.push('<rect x="' + (gx - 1.4) + '" y="' + (ws + wsH) + '" width="1.6" height="' + (rearEnd - rgH - ws - wsH) + '" rx=".8" fill="' + glass + '"/>');
  parts.push('<rect x="' + (gx + gw - 0.2) + '" y="' + (ws + wsH) + '" width="1.6" height="' + (rearEnd - rgH - ws - wsH) + '" rx=".8" fill="' + glass + '"/>');
  // zadní sklo
  if (rgH) parts.push('<path d="M' + gx + ' ' + (rearEnd - rgH) + ' L' + (gx + gw) + ' ' + (rearEnd - rgH) + ' L' + (gx + gw - 1.6) + ' ' + rearEnd + ' L' + (gx + 1.6) + ' ' + rearEnd + ' Z" fill="' + glass + '"/>');
  // střešní ližiny (SUV, kombi) a žebra (dodávka)
  if (car.body === 'suv' || car.body === 'kombi') {
    parts.push('<line x1="' + (gx + 2) + '" y1="' + (roofTop + 2) + '" x2="' + (gx + 2) + '" y2="' + (roofBot - 2) + '" stroke="rgba(0,0,0,.45)" stroke-width="1.1" stroke-linecap="round"/>');
    parts.push('<line x1="' + (gx + gw - 2) + '" y1="' + (roofTop + 2) + '" x2="' + (gx + gw - 2) + '" y2="' + (roofBot - 2) + '" stroke="rgba(0,0,0,.45)" stroke-width="1.1" stroke-linecap="round"/>');
  }
  if (car.body === 'van') {
    for (let k = 1; k <= 3; k++) {
      const ry = roofTop + (roofBot - roofTop) * k / 4;
      parts.push('<line x1="' + (gx + 2) + '" y1="' + ry + '" x2="' + (gx + gw - 2) + '" y2="' + ry + '" stroke="rgba(0,0,0,.25)" stroke-width="1"/>');
    }
  }
  // světla podle roku
  const fy = y + 1.4, ry2 = y + h - 1.4;
  if (era === 'old') {
    parts.push('<rect x="' + (x + 2.5) + '" y="' + fy + '" width="6" height="2.6" fill="#FFF3C4"/><rect x="' + (x + w - 8.5) + '" y="' + fy + '" width="6" height="2.6" fill="#FFF3C4"/>');
    parts.push('<rect x="' + (x + 2.5) + '" y="' + (ry2 - 2.6) + '" width="6" height="2.6" fill="#E0323A"/><rect x="' + (x + w - 8.5) + '" y="' + (ry2 - 2.6) + '" width="6" height="2.6" fill="#E0323A"/>');
  } else if (era === 'mid') {
    parts.push('<ellipse cx="' + (x + 6) + '" cy="' + (fy + 1.8) + '" rx="3.6" ry="1.9" fill="#FFF3C4"/><ellipse cx="' + (x + w - 6) + '" cy="' + (fy + 1.8) + '" rx="3.6" ry="1.9" fill="#FFF3C4"/>');
    parts.push('<ellipse cx="' + (x + 6) + '" cy="' + (ry2 - 1.6) + '" rx="3.4" ry="1.6" fill="#E0323A"/><ellipse cx="' + (x + w - 6) + '" cy="' + (ry2 - 1.6) + '" rx="3.4" ry="1.6" fill="#E0323A"/>');
  } else {
    parts.push('<rect x="' + (x + 3) + '" y="' + (fy + 0.6) + '" width="' + (w - 6) + '" height="1.3" rx=".65" fill="#EAF4FF"/>');
    parts.push('<rect x="' + (x + 3.5) + '" y="' + (ry2 - 1.6) + '" width="' + (w - 7) + '" height="1.3" rx=".65" fill="#FF3D4A"/>');
  }
  return '<svg viewBox="0 0 40 80" style="width:' + (height / 2) + 'px;height:' + height + 'px;fill:none;stroke:none;overflow:visible" aria-hidden="true">' + parts.join('') + '</svg>';
}

let carDraft = null;
function carLabel(c) { return [c.brand, (CAR_BODIES.find((b) => b[0] === c.body) || [])[1], c.year].filter(Boolean).join(' · '); }
function renderCarForm() {
  const c = carDraft;
  $('car-preview').innerHTML = carSVG(c, 110);
  $('car-desc').textContent = carLabel(c);
  document.querySelectorAll('#car-body button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.body === c.body)));
  document.querySelectorAll('#car-color button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === c.color)));
}
(function buildCarForm() {
  const sel = $('car-brand');
  CAR_BRANDS.forEach((b) => { const o = document.createElement('option'); o.value = b; o.textContent = b; sel.appendChild(o); });
  sel.addEventListener('change', () => { carDraft.brand = sel.value; renderCarForm(); });
  const bodies = $('car-body');
  CAR_BODIES.forEach(([k, label]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.body = k; b.textContent = label;
    b.addEventListener('click', () => { carDraft.body = k; renderCarForm(); });
    bodies.appendChild(b);
  });
  const cols = $('car-color');
  CAR_COLORS.forEach(([label, hex]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.color = hex; b.style.background = hex; b.setAttribute('aria-label', label); b.title = label;
    b.addEventListener('click', () => { carDraft.color = hex; renderCarForm(); });
    cols.appendChild(b);
  });
  $('car-year').addEventListener('input', () => {
    const y = parseInt($('car-year').value, 10);
    if (y >= 1960 && y <= 2026) { carDraft.year = y; renderCarForm(); }
  });
})();
$('btn-car').addEventListener('click', () => {
  carDraft = { ...S.car };
  $('car-brand').value = carDraft.brand;
  $('car-year').value = carDraft.year;
  $('results').hidden = true;
  renderCarForm();
  show('car');
});
$('car-close').addEventListener('click', () => show(S.dest ? 'place' : 'idle'));
$('car-save').addEventListener('click', () => {
  const y = parseInt($('car-year').value, 10);
  if (!(y >= 1960 && y <= 2026)) { toast('Zadej rok výroby mezi 1960 a 2026.'); $('car-year').focus(); return; }
  carDraft.year = y;
  S.car = { ...carDraft };
  store.set('car', S.car);
  toast('Auto uloženo: ' + carLabel(S.car));
  show(S.dest ? 'place' : 'idle');
});

renderFavs();
buildGauge();

/* ---------- Rychlé cíle Domů / Práce ---------- */
S.saved = store.get('saved', { home: null, work: null });

function refreshQuick() {
  const box = $('quick');
  box.innerHTML = '';
  [['home', 'Domů'], ['work', 'Práce']].forEach(([key, label]) => {
    const p = S.saved[key];
    const b = document.createElement('button');
    b.className = 'qcard';
    if (p) {
      const t = S.quickTimes[key];
      b.innerHTML = '<span class="q-label">' + label + '</span><span class="q-main">' + (t ? fmtDur(t.duration) : '…') + '</span>' +
        '<span class="q-sub">' + (t ? 'Příjezd ' + fmtClock(new Date(Date.now() + t.duration * 1000)) : esc(p.name)) + '</span>';
      b.addEventListener('click', () => { setDest({ ...p }); loadRoutes(); });
    } else {
      b.innerHTML = '<span class="q-label">' + label + '</span><span class="q-main">Nastavit</span><span class="q-sub unset">Najdi místo a ulož ho</span>';
      b.addEventListener('click', () => { q.focus(); toast('Vyhledej adresu a ulož ji jako ' + label + '.'); });
    }
    box.appendChild(b);
  });
  if (S.pos) {
    ['home', 'work'].forEach(async (key) => {
      const p = S.saved[key];
      if (!p || (S.quickTimes[key] && Date.now() - S.quickTimes[key].at < 300000)) return;
      try {
        const [r] = await fetchRoutes(here(), [p.lng, p.lat], false);
        S.quickTimes[key] = { duration: r.duration, at: Date.now() };
        refreshQuick();
      } catch (e) { /* bez času */ }
    });
  }
}

refreshQuick();
show('idle');
