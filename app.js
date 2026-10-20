/* Tamio – prototyp navigace
 * Mapa: OpenStreetMap (podklad CARTO Dark Matter)
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
  simMetersPerTick: 22,               // rychlost jízdy nanečisto
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
  if (m >= 100) return Math.round(m / 50) * 50 + ' m';
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
  style: {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        ],
        tileSize: 256,
        maxzoom: 20,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · © <a href="https://carto.com/attributions" target="_blank">CARTO</a> · trasy <a href="https://project-osrm.org" target="_blank">OSRM</a>',
      },
    },
    layers: [{ id: 'base', type: 'raster', source: 'base', paint: { 'raster-brightness-max': 0.9, 'raster-saturation': -0.2 } }],
  },
  center: CFG.start,
  zoom: 12,
  attributionControl: { compact: true },
  pitchWithRotate: true,
});

map.on('load', () => {
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
const VIEWS = ['idle', 'place', 'routes', 'nav', 'report', 'arrived'];
let prevView = 'idle';
function show(v) {
  VIEWS.forEach((n) => { $('v-' + n).hidden = n !== v; });
  if (v !== 'report') prevView = v;
  const navOn = v === 'nav' || (v === 'report' && S.nav);
  $('top').hidden = navOn;
  $('banner').hidden = !navOn;
  $('fabs').hidden = !navOn;
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

async function loadRoutes() {
  if (!S.dest) return;
  const btn = $('btn-routes');
  btn.disabled = true; btn.textContent = 'Počítám trasy…';
  try {
    const routes = await fetchRoutes(here(), [S.dest.lng, S.dest.lat], true);
    S.routes = routes.map((r, i) => ({ ...r, i, turns: r.legs[0].steps.filter((s) => /turn|end of road|fork|roundabout|rotary/.test(s.maneuver.type)).length }));
    tagRoutes();
    S.sel = 0;
    $('routes-note').hidden = !!S.pos;
    $('routes-note').textContent = 'Poloha není známá, trasa začíná ve středu mapy.';
    drawRoutes();
    renderRouteList();
    show('routes');
    fitRoute(S.routes[0]);
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
  meEl.className = 'me nav';
  meEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l7 19-7-4-7 4z"/></svg>';
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
  if (!step.spokeFar && toStep > 250 && toStep < 1200) { step.spokeFar = true; say('Za ' + fmtDist(toStep).replace('km', 'kilometrů').replace(' m', ' metrů') + ' ' + lowerFirst(text)); }
  if (!step.spokeNear && toStep <= 120) { step.spokeNear = true; step.spokeFar = true; say(text); }

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
  let d = 0;
  S.sim = setInterval(() => {
    const N = S.nav;
    if (!N) { stopSim(); return; }
    d += CFG.simMetersPerTick;
    if (d >= N.total) d = N.total;
    let i = N.idx;
    while (i < N.cum.length - 1 && N.cum[i + 1] < d) i++;
    const a = N.coords[i], b = N.coords[Math.min(i + 1, N.coords.length - 1)];
    const seg = (N.cum[i + 1] || N.cum[i]) - N.cum[i];
    const t = seg > 0 ? (d - N.cum[i]) / seg : 0;
    const pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    setPos({ lng: pt[0], lat: pt[1], heading: bearing(a, b), speed: null });
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
  if (!best.r.spoken && best.ahead < 800) { best.r.spoken = true; say(t.label + ' za ' + fmtDist(best.ahead).replace(' m', ' metrů')); }
}


/* ---------- 3D: budovy z OpenStreetMap a terén ---------- */
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const BUILDINGS_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
let has3dBuildings = false, hasTerrain = false;

async function add3D() {
  try {
    map.addSource('terrain', { type: 'raster-dem', tiles: [TERRAIN_TILES], tileSize: 256, encoding: 'terrarium', maxzoom: 15 });
    hasTerrain = true;
  } catch (e) { console.warn('Terén nedostupný', e); }
  try {
    const style = await (await fetch(BUILDINGS_STYLE)).json();
    const src = style.sources && style.sources.openmaptiles;
    if (!src || !src.url) throw new Error('chybí zdroj budov');
    map.addSource('omt', { type: 'vector', url: src.url, attribution: '© OpenFreeMap' });
    map.addLayer({
      id: 'buildings-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13.5,
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
  if (has3dBuildings) map.setLayoutProperty('buildings-3d', 'visibility', S.view3d ? 'visible' : 'none');
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
