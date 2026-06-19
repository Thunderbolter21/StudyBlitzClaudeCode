// keyBoard.js — 3D "key-hook" Classes board (Three.js).
//
// PHASE 1: dependency + scaffold + LIFECYCLE only. This is the de-risk phase —
// a minimal scene (wall + one placeholder cube) that mounts on #classes and tears
// itself down completely on navigation away. No keys/decks/interactions yet.
//
// Public API (exactly two entry points):
//   initKeyBoard(container)  — mount + start loop (idempotent)
//   destroyKeyBoard()        — full teardown (idempotent)

import * as THREE from 'three';

// ── Module state (single instance; init is guarded so we never leak a 2nd context) ──
let _renderer = null;
let _scene = null;
let _camera = null;
let _stage = null;
let _container = null;
let _placeholder = null;
let _raf = null;
let _running = false;
let _frames = 0;

// Listener handles kept so destroy can remove the exact same references.
let _onResize = null;
let _onVis = null;

const DPR_CAP = 2;

/* ── initKeyBoard ─────────────────────────────────────────────── */
export function initKeyBoard(container) {
  if (_renderer || !container) return;        // already mounted → never two contexts
  _container = container;

  // Stage fills the page; hide the legacy Classes content while the board is up.
  container.classList.add('kb-active');
  _stage = document.createElement('div');
  _stage.className = 'kb-stage';
  container.appendChild(_stage);

  const { w, h } = _size();

  _scene = new THREE.Scene();
  _scene.background = new THREE.Color(0x07070e);

  _camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
  _camera.position.set(0, 0, 9);

  _renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP));
  _renderer.setSize(w, h);
  _stage.appendChild(_renderer.domElement);

  // Dark wall plane (placeholder for the gridded wall in Phase 2)
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 24),
    new THREE.MeshStandardMaterial({ color: 0x0c0c16, roughness: 0.95, metalness: 0.0 })
  );
  wall.position.z = -2;
  _scene.add(wall);

  // ONE placeholder cube — proves render + animation. Removed in Phase 2.
  _placeholder = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.6, 1.6),
    new THREE.MeshStandardMaterial({ color: 0xff3f6c, roughness: 0.35, metalness: 0.25, emissive: 0x330011 })
  );
  _scene.add(_placeholder);

  // Temporary lights — Phase 2 swaps in PMREM + RoomEnvironment IBL.
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 4, 6);
  _scene.add(key);
  _scene.add(new THREE.AmbientLight(0x404060, 1.2));

  // Listeners
  _onResize = () => _resize();
  window.addEventListener('resize', _onResize);
  _onVis = () => { if (document.hidden) _stop(); else _start(); };
  document.addEventListener('visibilitychange', _onVis);

  _start();
  // Re-measure once layout has settled (init may run inside a View Transition callback).
  requestAnimationFrame(() => _resize());

  console.log('[keyBoard] mounted — 1 WebGL context');
}

/* ── destroyKeyBoard — exhaustive; a leaked GL context will crash the page ── */
export function destroyKeyBoard() {
  if (!_renderer && !_stage) return;          // not mounted

  _stop();

  if (_onResize) window.removeEventListener('resize', _onResize);
  if (_onVis) document.removeEventListener('visibilitychange', _onVis);
  _onResize = _onVis = null;

  if (_scene) {
    _scene.traverse(o => {
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

  if (_renderer) {
    _renderer.dispose();
    _renderer.forceContextLoss();
    const cv = _renderer.domElement;
    if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
  }
  if (_stage && _stage.parentNode) _stage.parentNode.removeChild(_stage);
  if (_container) _container.classList.remove('kb-active');

  // Null everything so GC can reclaim.
  _renderer = _scene = _camera = _placeholder = _stage = _container = null;
  _frames = 0;

  console.log('[keyBoard] destroyed — context released, loop stopped');
}

/* ── internals ────────────────────────────────────────────────── */
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
  window.__kbFrames = _frames;               // freezes when the loop stops (verify hook)
  if (_placeholder) {
    _placeholder.rotation.x += 0.010;
    _placeholder.rotation.y += 0.013;
  }
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
