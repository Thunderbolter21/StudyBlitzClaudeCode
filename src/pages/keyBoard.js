// keyBoard.js — 3D "key-hook" Classes board (Three.js).
//
// PHASE 3: grab/rehang (visual only, no persistence), left-dock deck panel,
// zoom slider + buttons, pointer parallax, real openClassQuizPanel quiz launch.
// Phase 1 lifecycle contract and Phase 2 visuals unchanged.
//
// Public API:
//   initKeyBoardCallbacks({ openClassQuizPanel, nav }) — DI; call before initKeyBoard
//   initKeyBoard(container)  — mount + start loop (idempotent)
//   destroyKeyBoard()        — full teardown (idempotent)

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getClasses } from '../engine/classes.js';
import { getDecks } from '../engine/decks.js';
import { getMem, getRec, isWeak } from '../engine/memory.js';

// ── Module state (single instance; init guarded) ──────────────────
let _renderer = null, _scene = null, _camera = null, _stage = null, _container = null;
let _env = null, _clock = null;
let _raf = null, _running = false, _frames = 0;
let _onResize = null, _onVis = null;
let _keys = [], _hooks = [], _pickable = [];
let _reduce = false;

// Phase 3 — interaction / UI
let _held = null, _presented = null;
let _zTarget = 560, _mx = 0, _my = 0;
let _panel = null, _zoom = null;
let _onPtrDown = null, _onPtrMove = null, _onPtrUp = null, _onDocPtrMove = null;

// Injected callbacks — set via initKeyBoardCallbacks before first initKeyBoard call
let _cbOpenQuizPanel = null, _cbNav = null, _cbToggleDeckMenu = null;

// Raycaster — module-level, reused every frame
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

const DPR_CAP = 2;
const HOOK_COLS = [-300, -100, 100, 300];
const HOOK_ROWS = [150, 0, -150];
const HOOK_Z = 30;

const _toNum = (hex) => {
  if (typeof hex === 'number') return hex;
  const n = parseInt(String(hex).replace('#', ''), 16);
  return Number.isFinite(n) ? n : 0x888888;
};
const _hex = (n) => '#' + _toNum(n).toString(16).padStart(6, '0');

/* ── Callback injection ───────────────────────────────────────── */
export function initKeyBoardCallbacks({ openClassQuizPanel, nav, toggleDeckMenu }) {
  _cbOpenQuizPanel = openClassQuizPanel;
  _cbNav = nav;
  _cbToggleDeckMenu = toggleDeckMenu;
}

/* ── initKeyBoard ─────────────────────────────────────────────── */
export function initKeyBoard(container) {
  if (_renderer || !container) return;          // idempotent — never two GL contexts
  _container = container;
  _reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  container.classList.add('kb-active');
  _stage = document.createElement('div');
  _stage.className = 'kb-stage';
  container.appendChild(_stage);

  const { w, h } = _size();

  _scene = new THREE.Scene();
  _camera = new THREE.PerspectiveCamera(46, w / h, 1, 5000);
  _camera.position.set(0, 0, 560);

  _renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP));
  _renderer.setSize(w, h);
  _stage.appendChild(_renderer.domElement);

  // Lights
  _scene.add(new THREE.AmbientLight(0x5a5a72, 0.8));
  const dir = new THREE.DirectionalLight(0xffffff, 0.95); dir.position.set(-0.5, 1, 1.4); _scene.add(dir);
  const rim = new THREE.PointLight(0xb57bee, 0.55, 1800); rim.position.set(-260, 170, 280); _scene.add(rim);
  const warm = new THREE.PointLight(0xff8c42, 0.3, 1800); warm.position.set(300, -120, 300); _scene.add(warm);

  _env = _buildEnv();
  _scene.environment = _env;

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(1700, 1100),
    new THREE.MeshBasicMaterial({ map: _wallTexture() })
  );
  wall.position.z = -4;
  _scene.add(wall);

  // Hooks
  _hooks = [];
  let hi = 0;
  HOOK_ROWS.forEach(y => HOOK_COLS.forEach(x => _hooks.push({ id: hi++, x, y, z: HOOK_Z })));
  const metal = new THREE.MeshPhongMaterial({ color: 0xc2c2cc, specular: 0xffffff, shininess: 95 });
  _hooks.forEach(hk => _makeHook(hk, metal));

  // Keys — one per real class, read fresh from storage every mount.
  // Sequential assignment: class[i] → hook[i], so a newly created class
  // always lands on the next empty hook without reshuffling existing ones.
  _keys = [];
  _pickable = [];
  const classes = getClasses();
  classes.forEach((cls, i) => _makeKey(cls, i % _hooks.length, metal));

  // Panel + zoom overlays (inside _stage → auto-cleaned on teardown)
  _panel = _createPanel();
  _zoom  = _createZoom();

  // Pointer interaction on canvas
  _wireInteraction();

  // Document-level parallax (works even when pointer is over the panel)
  _onDocPtrMove = (e) => {
    if (_reduce) return;
    _mx = e.clientX / window.innerWidth - 0.5;
    _my = e.clientY / window.innerHeight - 0.5;
  };
  document.addEventListener('pointermove', _onDocPtrMove);

  _onResize = () => _resize();
  window.addEventListener('resize', _onResize);
  _onVis = () => { if (document.hidden) _stop(); else _start(); };
  document.addEventListener('visibilitychange', _onVis);

  _clock = new THREE.Clock();
  _start();
  requestAnimationFrame(() => _resize());

  console.log('[keyBoard] mounted — 1 WebGL context');
  console.log('%c🔑 key-hook v2 — crafted by Claude & Matt', 'color:#b57bee;font-weight:bold;font-size:13px');
}

/* ── destroyKeyBoard — exhaustive teardown ────────────────────── */
export function destroyKeyBoard() {
  if (!_renderer && !_stage) return;

  _stop();

  // Close any open app deck-context menu (it lives on document.body, not _stage).
  document.getElementById('deck-ctx-menu')?.remove();

  if (_onResize) window.removeEventListener('resize', _onResize);
  if (_onVis) document.removeEventListener('visibilitychange', _onVis);
  if (_onDocPtrMove) document.removeEventListener('pointermove', _onDocPtrMove);
  _onResize = _onVis = _onDocPtrMove = null;

  // Remove canvas pointer listeners before disposing the renderer
  if (_renderer) {
    const cv = _renderer.domElement;
    if (_onPtrDown) cv.removeEventListener('pointerdown', _onPtrDown);
    if (_onPtrMove) cv.removeEventListener('pointermove', _onPtrMove);
    if (_onPtrUp)   cv.removeEventListener('pointerup',   _onPtrUp);
  }
  _onPtrDown = _onPtrMove = _onPtrUp = null;

  if (_scene) { _disposeObject(_scene); _scene.environment = null; }
  if (_env) { _env.dispose(); _env = null; }

  if (_renderer) {
    _renderer.dispose();
    _renderer.forceContextLoss();
    const cv = _renderer.domElement;
    if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
  }
  if (_stage && _stage.parentNode) _stage.parentNode.removeChild(_stage);
  if (_container) _container.classList.remove('kb-active');

  _renderer = _scene = _camera = _stage = _container = _clock = null;
  _panel = _zoom = null;
  _keys = []; _hooks = []; _pickable = [];
  _held = null; _presented = null;
  _zTarget = 560; _mx = 0; _my = 0;
  _frames = 0;

  console.log('[keyBoard] destroyed — context released, loop stopped');
}

/* ── Panel DOM ────────────────────────────────────────────────── */
function _createPanel() {
  const p = document.createElement('div');
  p.id = 'kb-panel';
  _stage.appendChild(p);
  return p;
}

function _showPanel(k) {
  const cls = k.cls;
  const decks = getDecks().filter(d => d.classId === cls.id);
  const mem = getMem();
  const colorHex = _hex(cls.color);

  let html = `
    <div class="kb-ph" id="kb-ph">
      <span class="kb-dot" style="background:${colorHex}"></span>
      <span class="kb-pname">${cls.name}</span>
    </div>
    <div class="kb-phint">// click title to re-hook</div>`;

  if (decks.length === 0) {
    html += `<div class="kb-dcard kb-empty" style="animation-delay:60ms">
      No decks on this key yet.
      <button class="kb-build">＋ Build a deck</button>
    </div>`;
  } else {
    decks.forEach((deck, i) => {
      const weakQs = deck.questions.filter(q => isWeak(getRec(mem, q.id)));
      html += `<div class="kb-dcard" style="animation-delay:${i * 80}ms">
        <button class="deck-ellipsis kb-ellipsis" title="Options" data-did="${deck.id}">⋯</button>
        <div class="kb-dn">${deck.name}</div>
        <div class="kb-ds">${deck.questions.length} question${deck.questions.length !== 1 ? 's' : ''}${weakQs.length ? ` · <span class="kb-weak">${weakQs.length} weak</span>` : ''}</div>
        <button class="kb-qz" style="background:${colorHex}" data-did="${deck.id}">▶ Quiz</button>
      </div>`;
    });
  }

  _panel.innerHTML = html;
  _panel.classList.add('show');

  // Re-hook on header click
  _panel.querySelector('#kb-ph')?.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    _dismiss();
  });
  // Quiz buttons — full cls.name goes to openClassQuizPanel, not shortLabel
  _panel.querySelectorAll('.kb-qz').forEach(btn => {
    btn.addEventListener('click', () => {
      const deck = getDecks().find(d => d.id === btn.dataset.did);
      if (deck) _cbOpenQuizPanel?.(deck, cls);
    });
  });
  // Ellipsis menus — reuse the app-wide deck context menu (toggleDeckMenu).
  // It stopPropagation()s + positions at e.clientX/Y and appends #deck-ctx-menu
  // to document.body, exactly as on every other deck card in the app.
  _panel.querySelectorAll('.kb-ellipsis').forEach(btn => {
    btn.addEventListener('click', (e) => _cbToggleDeckMenu?.(e, btn.dataset.did));
  });
  // Empty-state build button
  _panel.querySelector('.kb-build')?.addEventListener('click', () => _cbNav?.('generator'));
}

function _dismiss() {
  if (_presented) { _presented.mode = 'hung'; _presented = null; }
  _panel?.classList.remove('show');
}

/* ── Zoom DOM ─────────────────────────────────────────────────── */
function _createZoom() {
  const z = document.createElement('div');
  z.id = 'kb-zoom';
  z.innerHTML = `
    <button id="kb-zin" aria-label="Zoom in">+</button>
    <input id="kb-zrange" type="range" min="0" max="100" value="50" aria-label="Zoom level">
    <button id="kb-zout" aria-label="Zoom out">−</button>`;
  _stage.appendChild(z);

  const zr = z.querySelector('#kb-zrange');
  const applyZoom = () => { _zTarget = 860 - (+zr.value / 100) * 500; }; // 0→860(out) 100→360(in)
  zr.addEventListener('input', applyZoom);
  z.querySelector('#kb-zin').addEventListener('click',  () => { zr.value = Math.min(100, +zr.value + 12); applyZoom(); });
  z.querySelector('#kb-zout').addEventListener('click', () => { zr.value = Math.max(0,   +zr.value - 12); applyZoom(); });
  applyZoom();
  return z;
}

/* ── Pointer interaction ──────────────────────────────────────── */
function _setNDC(e) {
  const rect = _renderer.domElement.getBoundingClientRect();
  _ndc.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
  _ndc.y = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
}

function _worldOnPlane(e, z) {
  _setNDC(e);
  _ray.setFromCamera(_ndc, _camera);
  const d = _ray.ray.direction, o = _ray.ray.origin;
  const t = (z - o.z) / d.z;
  return new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, z);
}

function _nearestHook(p) {
  let best = null, bd = Infinity;
  _hooks.forEach(h => {
    const d = Math.hypot(h.x - p.x, h.y - p.y);
    if (d < bd) { bd = d; best = h; }
  });
  return { hook: best, dist: bd };
}

function _wireInteraction() {
  const cv = _renderer.domElement;

  _onPtrDown = (e) => {
    _setNDC(e);
    _ray.setFromCamera(_ndc, _camera);
    const hit = _ray.intersectObjects(_pickable, false)[0];
    if (hit) {
      const k = hit.object.userData.key?._kb;
      if (!k || k.mode === 'presented') return;
      if (_presented && _presented !== k) _dismiss();
      _held = k; k.mode = 'held';
      cv.setPointerCapture(e.pointerId);
    } else if (_presented) {
      _dismiss();
    }
  };

  _onPtrMove = (e) => {
    if (!_held) return;
    const p = _worldOnPlane(e, 40);
    _held.pt.set(p.x, p.y, 40);
  };

  _onPtrUp = (e) => {
    if (!_held) return;
    const k = _held; _held = null;
    const p = _worldOnPlane(e, 40);
    const { hook, dist } = _nearestHook(p);
    if (dist < 95) {
      // Rehang — swap if target hook already occupied
      const occ = _keys.find(o => o !== k && o.hookIndex === hook.id);
      if (occ) { occ.hookIndex = k.hookIndex; occ.mode = 'hung'; }
      k.hookIndex = hook.id;
      k.mode = 'hung';
      k.vel = 0.25 * (Math.random() - 0.5);
    } else {
      // Drop in open space → present + open deck panel
      k.mode = 'presented';
      _presented = k;
      _showPanel(k);
    }
  };

  cv.addEventListener('pointerdown', _onPtrDown);
  cv.addEventListener('pointermove', _onPtrMove);
  cv.addEventListener('pointerup',   _onPtrUp);
}

/* ── Scene builders ───────────────────────────────────────────── */
function _buildEnv() {
  try {
    const pmrem = new THREE.PMREMGenerator(_renderer);
    const room = new RoomEnvironment();
    const tex = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose();
    _disposeObject(room);
    return tex;
  } catch (err) {
    console.warn('[keyBoard] PMREM env unavailable, using baked fallback', err);
    return _bakedEnv();
  }
}

function _bakedEnv() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#3a3a52'); g.addColorStop(0.45, '#14141d'); g.addColorStop(1, '#05050a');
  x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  const b = x.createRadialGradient(150, 60, 10, 150, 60, 140);
  b.addColorStop(0, 'rgba(255,255,255,0.9)'); b.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = b; x.fillRect(0, 0, 512, 256);
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

function _wallTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = '#0d0d14'; x.fillRect(0, 0, 1024, 1024);
  const g = x.createRadialGradient(512, 150, 80, 512, 520, 760);
  g.addColorStop(0, 'rgba(120,90,200,0.18)'); g.addColorStop(1, 'rgba(120,90,200,0)');
  x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
  x.strokeStyle = 'rgba(255,255,255,0.035)'; x.lineWidth = 1;
  for (let i = 0; i <= 1024; i += 48) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 1024); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(1024, i); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;  // r184: tag canvas textures or they render wrong
  t.needsUpdate = true;
  return t;
}

function _makeHook(h, metal) {
  const g = new THREE.Group();
  const mount  = new THREE.Mesh(new THREE.CylinderGeometry(8, 9, 7, 20), metal);   mount.rotation.x = Math.PI / 2; mount.position.z = 3.5;  g.add(mount);
  const shaft  = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 26, 16), metal); shaft.rotation.x = Math.PI / 2; shaft.position.z = 19; g.add(shaft);
  const stub   = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 18, 16), metal); stub.position.set(0, 9, 30);  g.add(stub);
  const cap    = new THREE.Mesh(new THREE.SphereGeometry(4.6, 14, 14), metal);         cap.position.set(0, 18, 30); g.add(cap);
  g.position.set(h.x, h.y, 0);
  _scene.add(g);
}

function _fobShape(w, h, r, holeY, holeR) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const hole = new THREE.Path(); hole.absarc(0, holeY, holeR, 0, Math.PI * 2, true); s.holes.push(hole);
  return s;
}

function _shortLabel(name) {
  let n = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();   // strip "(Math 125)"
  if (n.length <= 16) return n;                            // short enough → as-is
  const numMatch = n.match(/\b(\d+)\b\s*$/);
  const num = numMatch ? numMatch[1] : '';
  const skip = new Set(['of', 'the', 'and', 'to', 'in', 'for', 'a', 'an', '&']);
  const acr = n.replace(/\d+\s*$/, '').trim().split(/\s+/)
    .filter(w => w && !skip.has(w.toLowerCase()))
    .map(w => w[0].toUpperCase()).join('');
  const out = (acr + (num ? ' ' + num : '')).trim();
  return out.length ? out : n.slice(0, 16);
}

function _makeLabel(name) {
  const c = document.createElement('canvas'); c.width = 420; c.height = 150;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const font = n => `700 ${n}px sans-serif`;
  let fs = 54; x.font = font(fs);
  while (x.measureText(name).width > 380 && fs > 22) { fs -= 2; x.font = font(fs); }
  x.fillStyle = 'rgba(0,0,0,0.55)';        x.fillText(name, 210, 78);
  x.fillStyle = 'rgba(240,240,250,0.95)';  x.fillText(name, 210, 75);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

function _makeKey(cls, hookIndex, metal) {
  const color = _toNum(cls.color);
  const FW = 120, FH = 66, DEPTH = 16, HOLEY = FH / 2 - 10, HOLER = 7;
  const pivot = new THREE.Group();
  const body  = new THREE.Group();

  const shape = _fobShape(FW, FH, 16, HOLEY, HOLER);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelThickness: 3, bevelSize: 3, bevelSegments: 4, steps: 1, curveSegments: 20 });
  geo.translate(0, 0, -DEPTH / 2);

  const capMat = new THREE.MeshPhysicalMaterial({
    color: 0x0e0e15, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.22,
    transparent: true, opacity: 0.74, envMap: _env, envMapIntensity: 0.7,
    reflectivity: 0.5, side: THREE.DoubleSide,
  });
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x0c0c12, emissive: color, emissiveIntensity: 1.0, roughness: 0.5,
    transparent: true, opacity: 0.92,
  });
  const block = new THREE.Mesh(geo, [capMat, edgeMat]);
  block.userData.key = cls; body.add(block); _pickable.push(block);

  const eMat = metal.clone(); eMat.transparent = true;
  const eyelet = new THREE.Mesh(new THREE.TorusGeometry(HOLER + 1.4, 1.8, 10, 24), eMat);
  eyelet.position.set(0, HOLEY, 0); body.add(eyelet);

  const lMat = new THREE.MeshBasicMaterial({
    map: _makeLabel(_shortLabel(cls.name)),
    transparent: true, opacity: 0.95,
    depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
  const lbl = new THREE.Mesh(new THREE.PlaneGeometry(98, 38), lMat);
  lbl.position.set(4, -6, DEPTH / 2 + 1.5); lbl.renderOrder = 999;
  body.add(lbl); lbl.userData.key = cls; _pickable.push(lbl);

  body.position.y = -HOLEY;
  pivot.add(body);
  const h = _hooks[hookIndex];
  pivot.position.set(h.x, h.y, h.z);
  _scene.add(pivot);

  const mats = [{ m: capMat, b: 0.74 }, { m: edgeMat, b: 0.92 }, { m: eMat, b: 1 }, { m: lMat, b: 0.95 }];
  const k = {
    cls, pivot, body, hookIndex, ang: 0, vel: 0, mode: 'hung', vis: 1,
    pp: new THREE.Vector3(h.x, h.y, h.z), pt: new THREE.Vector3(h.x, h.y, h.z),
    phase: Math.random() * 6.28, mats,
  };
  cls._kb = k;   // back-ref so raycaster hit → key record lookup works
  _keys.push(k);
}

/* ── Internals ────────────────────────────────────────────────── */
function _disposeObject(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => {
        for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
        m.dispose();
      });
    }
  });
}

function _size() {
  const w = (_stage && _stage.clientWidth)     || (_container && _container.clientWidth)  || window.innerWidth;
  const h = (_stage && _stage.clientHeight)    || (_container && _container.clientHeight) || window.innerHeight;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

function _resize() {
  if (!_renderer || !_camera) return;
  const { w, h } = _size();
  _camera.aspect = w / h;
  _camera.updateProjectionMatrix();
  _renderer.setSize(w, h);
}

function _loop() {
  _raf = requestAnimationFrame(_loop);
  _frames++;
  window.__kbFrames = _frames;                  // freezes when loop stops — lifecycle verify hook
  const dt = Math.min(_clock.getDelta(), 0.05);
  const t  = _clock.elapsedTime;

  for (const k of _keys) {
    const h = _hooks[k.hookIndex];
    if      (k.mode === 'hung')      k.pt.set(h.x, h.y, h.z);
    else if (k.mode === 'presented') k.pt.set(-320, 90, 200);
    // 'held': k.pt is updated continuously by _onPtrMove
    k.pivot.position.lerp(k.pt, k.mode === 'held' ? 0.3 : 0.12);

    const vx = k.pivot.position.x - k.pp.x; k.pp.copy(k.pivot.position);
    const G = 11, DAMP = 3.4;
    k.vel += (-G * Math.sin(k.ang) - DAMP * k.vel) * dt - vx * 0.0038;
    if (k.mode === 'hung' && !_reduce) k.vel += Math.sin(t * 0.6 + k.phase) * 0.00022;
    k.vel = Math.max(-0.06, Math.min(0.06, k.vel));
    k.ang += k.vel; k.ang = Math.max(-0.42, Math.min(0.42, k.ang));
    if (k.mode === 'presented') k.ang *= 0.8;
    k.pivot.rotation.z = k.ang;

    // Fade out when presented (key floats off toward the panel)
    const vt = k.mode === 'presented' ? 0 : 1;
    k.vis += (vt - k.vis) * 0.14;
    k.mats.forEach(o => { o.m.opacity = o.b * k.vis; });
    k.body.visible = k.vis > 0.02;
  }

  // Pointer parallax (disabled for reduced-motion)
  if (!_reduce) {
    _camera.position.x += (_mx * 70  - _camera.position.x) * 0.05;
    _camera.position.y += (-_my * 50 - _camera.position.y) * 0.05;
  }
  // Zoom dolly
  _camera.position.z += (_zTarget - _camera.position.z) * 0.08;

  _camera.lookAt(0, 0, 0);
  _renderer.render(_scene, _camera);
}

function _start() {
  if (_running || !_renderer) return;
  _running = true;
  _raf = requestAnimationFrame(_loop);
}

function _stop() {
  _running = false;
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
}
