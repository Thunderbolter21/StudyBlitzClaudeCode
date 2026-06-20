// keyBoard.js — 3D "key-hook" Classes board (Three.js).
//
// PHASE 2: full visual scene ported from prototype/keyboard.html, populated by
// REAL classes (names engraved, real colors). The Phase-1 LIFECYCLE contract is
// preserved and EXTENDED — PMREM, env texture, wall/label CanvasTextures, and all
// geometries/materials are disposed on teardown so navigating in/out of #classes
// never leaks a GL context.
// Interactions (grab/rehang), the left deck panel, and zoom are Phase 3.
//
// Public API:
//   initKeyBoard(container)  — mount + start loop (idempotent)
//   destroyKeyBoard()        — full teardown (idempotent)

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getClasses } from '../engine/classes.js';

// ── Module state (single instance; init guarded so we never leak a 2nd context) ──
let _renderer = null, _scene = null, _camera = null, _stage = null, _container = null;
let _env = null, _clock = null;
let _raf = null, _running = false, _frames = 0;
let _onResize = null, _onVis = null;
let _keys = [], _hooks = [], _pickable = [];
let _reduce = false;

const DPR_CAP = 2;
// Hook grid — more hooks than classes (4 cols × 3 rows = 12).
const HOOK_COLS = [-300, -100, 100, 300];
const HOOK_ROWS = [150, 0, -150];
const HOOK_Z = 30;

const _toNum = (hex) => {
  if (typeof hex === 'number') return hex;
  const n = parseInt(String(hex).replace('#', ''), 16);
  return Number.isFinite(n) ? n : 0x888888;
};

/* ── initKeyBoard ─────────────────────────────────────────────── */
export function initKeyBoard(container) {
  if (_renderer || !container) return;        // already mounted → never two contexts
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
  // r184 has color management on by default (sRGB output) — colors render true-to-brand.
  _stage.appendChild(_renderer.domElement);

  // Lights (ported from prototype)
  _scene.add(new THREE.AmbientLight(0x5a5a72, 0.8));
  const dir = new THREE.DirectionalLight(0xffffff, 0.95); dir.position.set(-0.5, 1, 1.4); _scene.add(dir);
  const rim = new THREE.PointLight(0xb57bee, 0.55, 1800); rim.position.set(-260, 170, 280); _scene.add(rim);
  const warm = new THREE.PointLight(0xff8c42, 0.3, 1800); warm.position.set(300, -120, 300); _scene.add(warm);

  // True IBL environment (PMREM + RoomEnvironment), baked-canvas fallback.
  _env = _buildEnv();
  _scene.environment = _env;

  // Wall
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

  // Keys — one per REAL class (including empty classes), real name + color.
  _keys = [];
  _pickable = [];
  const classes = getClasses();
  const assign = _spreadHooks(classes.length, _hooks.length);
  classes.forEach((cls, i) => _makeKey(cls, assign[i], metal));

  // Listeners
  _onResize = () => _resize();
  window.addEventListener('resize', _onResize);
  _onVis = () => { if (document.hidden) _stop(); else _start(); };
  document.addEventListener('visibilitychange', _onVis);

  _clock = new THREE.Clock();
  _start();
  requestAnimationFrame(() => _resize());   // re-measure after layout settles (may run in a VT callback)

  console.log('[keyBoard] mounted — 1 WebGL context');
  console.log('%c🔑 key-hook v2 — crafted by Claude & Matt', 'color:#b57bee;font-weight:bold;font-size:13px');
}

/* ── destroyKeyBoard — exhaustive; a leaked GL context will crash the page ── */
export function destroyKeyBoard() {
  if (!_renderer && !_stage) return;          // not mounted

  _stop();

  if (_onResize) window.removeEventListener('resize', _onResize);
  if (_onVis) document.removeEventListener('visibilitychange', _onVis);
  _onResize = _onVis = null;

  if (_scene) {
    _disposeObject(_scene);                   // geometries + materials + their textures
    _scene.environment = null;
  }
  if (_env) { _env.dispose(); _env = null; }  // env map (idempotent if already hit via traverse)

  if (_renderer) {
    _renderer.dispose();
    _renderer.forceContextLoss();
    const cv = _renderer.domElement;
    if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
  }
  if (_stage && _stage.parentNode) _stage.parentNode.removeChild(_stage);
  if (_container) _container.classList.remove('kb-active');

  _renderer = _scene = _camera = _stage = _container = _clock = null;
  _keys = []; _hooks = []; _pickable = [];
  _frames = 0;

  console.log('[keyBoard] destroyed — context released, loop stopped');
}

/* ── scene builders (ported from prototype) ───────────────────── */
function _buildEnv() {
  try {
    const pmrem = new THREE.PMREMGenerator(_renderer);
    const room = new RoomEnvironment();
    const tex = pmrem.fromScene(room, 0.04).texture;   // true roughness-aware IBL
    pmrem.dispose();                                    // generator no longer needed; tex stays valid
    _disposeObject(room);                               // free the room env's geometries/materials
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
  return new THREE.CanvasTexture(c);
}

function _makeHook(h, metal) {
  const g = new THREE.Group();
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(8, 9, 7, 20), metal); mount.rotation.x = Math.PI / 2; mount.position.z = 3.5; g.add(mount);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 26, 16), metal); shaft.rotation.x = Math.PI / 2; shaft.position.z = 19; g.add(shaft);
  const stub = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 18, 16), metal); stub.position.set(0, 9, 30); g.add(stub);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(4.6, 14, 14), metal); cap.position.set(0, 18, 30); g.add(cap);
  g.position.set(h.x, h.y, 0);
  _scene.add(g);
}

// Rounded-rect shape with a punched hole near the top (the fob outline).
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

// Engraved name: dark recessed fill + faint highlight offset for a bevel read.
function _makeLabel(name) {
  const c = document.createElement('canvas'); c.width = 340; c.height = 130;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle';
  let fs = 48; x.font = '700 ' + fs + 'px "Arial Narrow",Arial,sans-serif';
  while (x.measureText(name).width > 300 && fs > 22) { fs -= 2; x.font = '700 ' + fs + 'px "Arial Narrow",Arial,sans-serif'; }
  x.fillStyle = 'rgba(255,255,255,0.10)'; x.fillText(name, 170, 69);  // lower-light catch
  x.fillStyle = 'rgba(0,0,0,0.62)'; x.fillText(name, 170, 67);        // dark engraved body
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
  return t;
}

function _makeKey(cls, hookIndex, metal) {
  const color = _toNum(cls.color);
  const FW = 120, FH = 66, DEPTH = 16, HOLEY = FH / 2 - 15, HOLER = 7;
  const pivot = new THREE.Group();
  const body = new THREE.Group();

  // Frosted liquid-glass block
  const shape = _fobShape(FW, FH, 16, HOLEY, HOLER);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelThickness: 3, bevelSize: 3, bevelSegments: 4, steps: 1, curveSegments: 20 });
  geo.translate(0, 0, -DEPTH / 2);
  const glass = new THREE.MeshPhysicalMaterial({
    color, metalness: 0, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.18,
    transparent: true, opacity: 0.6, envMap: _env, envMapIntensity: 2.2, reflectivity: 0.7,
    emissive: color, emissiveIntensity: 0.22, side: THREE.DoubleSide,
  });
  const block = new THREE.Mesh(geo, glass); block.userData.key = cls; body.add(block); _pickable.push(block);

  // Metal grommet ring around the eyelet (per-key clone so Phase 3 can fade it)
  const eMat = metal.clone(); eMat.transparent = true;
  const eyelet = new THREE.Mesh(new THREE.TorusGeometry(HOLER + 1.4, 1.8, 10, 24), eMat);
  eyelet.position.set(0, HOLEY, 0); body.add(eyelet);

  // Emissive class-color accent band (left edge)
  const bMat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 1.1, shininess: 80, transparent: true });
  const band = new THREE.Mesh(new THREE.BoxGeometry(3.5, 42, DEPTH + 2.5), bMat);
  band.position.set(-FW / 2 + 8, -6, 0); body.add(band); band.userData.key = cls; _pickable.push(band);

  // Engraved name plate
  const lMat = new THREE.MeshBasicMaterial({ map: _makeLabel(cls.name), transparent: true, opacity: 0.9, depthWrite: false });
  const lbl = new THREE.Mesh(new THREE.PlaneGeometry(98, 38), lMat);
  lbl.position.set(4, -6, DEPTH / 2 - 1.2); body.add(lbl); lbl.userData.key = cls; _pickable.push(lbl);

  body.position.y = -HOLEY;       // hang so the punched hole sits at the pivot
  pivot.add(body);
  const h = _hooks[hookIndex];
  pivot.position.set(h.x, h.y, h.z);
  _scene.add(pivot);

  const mats = [{ m: glass, b: 0.6 }, { m: eMat, b: 1 }, { m: bMat, b: 1 }, { m: lMat, b: 0.9 }];
  _keys.push({
    cls, pivot, body, hookIndex, ang: 0, vel: 0,
    pp: new THREE.Vector3(h.x, h.y, h.z), pt: new THREE.Vector3(h.x, h.y, h.z),
    phase: Math.random() * 6.28, mats,
  });
}

// Spread N keys across `total` hooks, evenly + distinct, deterministic.
function _spreadHooks(n, total) {
  const used = new Set(), out = [];
  for (let i = 0; i < n; i++) {
    let v = Math.min(total - 1, Math.round(i * total / Math.max(n, 1)));
    while (used.has(v)) v = (v + 1) % total;
    used.add(v); out.push(v);
  }
  return out;
}

/* ── internals ────────────────────────────────────────────────── */
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
  const w = (_stage && _stage.clientWidth) || (_container && _container.clientWidth) || window.innerWidth;
  const h = (_stage && _stage.clientHeight) || (_container && _container.clientHeight) || window.innerHeight;
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
  window.__kbFrames = _frames;                // freezes when the loop stops (verify hook)
  const dt = Math.min(_clock.getDelta(), 0.05);
  const t = _clock.elapsedTime;

  // Gentle idle sway + tuned pendulum (all keys hung this phase).
  for (const k of _keys) {
    const h = _hooks[k.hookIndex];
    k.pt.set(h.x, h.y, h.z);
    k.pivot.position.lerp(k.pt, 0.12);
    const vx = k.pivot.position.x - k.pp.x; k.pp.copy(k.pivot.position);
    const G = 11, DAMP = 3.4;
    k.vel += (-G * Math.sin(k.ang) - DAMP * k.vel) * dt - vx * 0.0038;
    if (!_reduce) k.vel += Math.sin(t * 0.6 + k.phase) * 0.00022;
    k.vel = Math.max(-0.06, Math.min(0.06, k.vel));
    k.ang += k.vel; k.ang = Math.max(-0.42, Math.min(0.42, k.ang));
    k.pivot.rotation.z = k.ang;
  }

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
