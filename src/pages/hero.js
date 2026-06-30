// hero.js — logged-out landing 3D hero (Spline robot + Three.js key demo).
//
// PHASE 2: visual port. Builds the full landing layout (headline column +
// sticky-ready stage + features + SM-2 band) and the Three.js glass "History"
// key on its hook. The key REUSES keyBoard.js's r184-correct recipe — the
// glass MeshPhysicalMaterial, the engraved-label fix (sans-serif, SRGB
// colorSpace, depthTest:false, renderOrder 999), the eyelet, and the PMREM
// RoomEnvironment HDR. Visual proportions/copy come from prototype_hero.html;
// the material/texture code comes from keyBoard.js because the prototype is
// three r128 and we run npm three r184 (porting r128 verbatim renders wrong).
//
// Static for now: gentle idle sway only — NO unhook/waterfall choreography
// (Phase 3) and NO faux picker yet. Spline robot still gated off
// (SPLINE_ENABLED). The Phase 1 dual-context lifecycle contract is unchanged.
//
// Public API:
//   initHeroCallbacks({ nav, openAuthModal }) — DI; call before initHero
//   initHero(container)  — build layout + mount Three.js (+Spline if enabled)
//   destroyHero()        — full teardown (idempotent)

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
// The faux picker MIRRORS the real signed-in deck picker by reusing the exact
// same component the real one uses (openClassQuizPanel → renderModeSelector).
import { renderModeSelector } from './QuizSelect.js';

// Spline assets from the prototype. The CDN module script merely *defines* the
// <spline-viewer> custom element; the WebGL context is created when the element
// is connected (initHero) and released when it is removed (destroyHero).
const SPLINE_SCRIPT = 'https://unpkg.com/@splinetool/viewer/build/spline-viewer.js';
const SPLINE_URL    = 'https://prod.spline.design/kZDDjO5HuC9pyZmO/scene.splinecode';
// Spline robot is temporarily OFF: this scene's public export is disabled
// (403 AccessDenied from Spline's CDN), so requesting it only yields a 403, an
// unhandled rejection, and a duplicate-Three.js warning. Flip to true once a
// public scene URL is in place (update SPLINE_URL if it changes) — the entire
// dual-context mount + teardown path below is intact and gated solely on this
// flag. With it off, the hero runs the Three.js key alone over a tasteful
// placeholder and the console stays clean.
const SPLINE_ENABLED = false;

const DPR_CAP = 2;
const KEY_COLOR = 0xff3f6c;     // StudyBlitz red — emissive key edges
const KEY_NAME  = 'History';    // single demo key, per prototype
// Key fob geometry — module-level so the scroll choreography (deck projection)
// shares the exact hole offset the key is built with.
const KEY_FW = 120, KEY_FH = 66, KEY_DEPTH = 16, KEY_HOLEY = KEY_FH / 2 - 10, KEY_HOLER = 7;
const CARDW = 200;              // faux deck card width (matches prototype)
const DECKS = ['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Chapter 5'];

// Scroll-engine math (ported from prototype_hero.html).
const _ease  = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;  // easeInOutCubic
const _lerp  = (a, b, t) => a + (b - a) * t;
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _projectV = new THREE.Vector3();   // reused each frame for deck projection

// ── Module state (single instance; init guarded) ──────────────────
let _renderer = null, _scene = null, _camera = null, _stage = null, _container = null;
let _env = null, _clock = null;
let _pivot = null, _body = null, _rim = null;   // the key + its rim light
let _ang = 0, _vel = 0;                          // idle-sway pendulum state
let _heroEl = null, _decksEl = null, _guide = null, _cards = [];
let _openAmount = 0, _desired = 0;               // scroll-driven open state (0..1)
let _raf = null, _running = false, _frames = 0;
let _onResize = null, _onVis = null, _onCta = null, _onScroll = null;
let _spline = null;                 // the <spline-viewer> element (2nd WebGL context)
let _fallback = null;               // graceful placeholder shown until/unless Spline paints
let _onSplineLoad = null, _onSplineError = null, _onRejection = null;
let _reduce = false, _isMobile = false;

// Injected callbacks — set via initHeroCallbacks before first initHero call.
let _cbNav = null, _cbOpenAuthModal = null;

/* ── Callback injection ───────────────────────────────────────── */
export function initHeroCallbacks({ nav, openAuthModal }) {
  _cbNav = nav;
  _cbOpenAuthModal = openAuthModal;
}

/* ── Spline script loader (once, lazily — only on the landing) ─── */
function _ensureSplineScript() {
  if (document.querySelector('script[data-spline-viewer]')) return;
  const s = document.createElement('script');
  s.type = 'module';
  s.src = SPLINE_SCRIPT;
  s.setAttribute('data-spline-viewer', '1');
  document.head.appendChild(s);
}

/* ── Landing DOM (headline + stage + features + SM-2 band) ──────── */
function _buildLayout(container) {
  container.innerHTML = `
    <div class="hero-wrap">
      <section class="hero">
        <div class="hero-left">
          <div class="hero-eyebrow">// adaptive studying, gamified</div>
          <h1 class="hero-h1">Study smarter,<br><span class="glow">not harder.</span></h1>
          <div class="hero-hand">your whole semester, hanging on the wall</div>
          <p class="hero-sub">StudyBlitz turns your notes into adaptive quizzes that know exactly what you're about to forget — and bring it back right on time.</p>
          <button class="btn-glass hero-cta" type="button">Get Started&nbsp;&nbsp;→</button>
        </div>
        <div class="hero-stage"></div>
      </section>

      <section class="hero-features">
        <h2>Everything you need to actually remember it</h2>
        <div class="hero-fsub">Hover each one. Built for students who'd rather study once and keep it.</div>
        <div class="hero-frow"><span class="ic">🧠</span><span class="fw">Adaptive Recall</span>
          <span class="fline">— tracks every question and resurfaces what you're closest to forgetting.</span></div>
        <div class="hero-frow"><span class="ic">⚡</span><span class="fw">Decks From Anything</span>
          <span class="fline">— drop in a PDF, slides, or a photo of your notes and get a quiz deck back in seconds.</span></div>
        <div class="hero-frow"><span class="ic">🎯</span><span class="fw">Weak-Spot Drilling</span>
          <span class="fline">— see exactly which topics are shaky and drill them until they're locked in.</span></div>
      </section>

      <section class="hero-smband">
        <div class="hero-smcard">
          <div class="tag">// the engine underneath</div>
          <h3>One algorithm ties it all together</h3>
          <p>StudyBlitz runs on <b>SM-2</b>, the spaced-repetition algorithm behind decades of memory
            research. Every answer you give quietly tunes <b>when</b> each question comes back — get it
            right and it waits longer, miss it and it returns soon. So the three pieces above aren't
            separate tricks: they all feed one engine that schedules your studying around the exact
            moment you're about to forget. <b>You just keep answering. It handles the timing.</b></p>
        </div>
      </section>
    </div>`;

  // "Get Started" routes to sign-up (same destination as the faux-picker
  // button and the topbar "Sign In"). Listener removed in destroyHero.
  _onCta = () => _cbOpenAuthModal?.('signup');
  container.querySelector('.hero-cta')?.addEventListener('click', _onCta);

  _heroEl = container.querySelector('.hero');   // scroll-progress reference
  return container.querySelector('.hero-stage');
}

/* ── initHero ─────────────────────────────────────────────────── */
export function initHero(container) {
  if (_renderer || !container) return;          // idempotent — never two GL contexts
  _container = container;
  const mm = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
  _reduce   = mm('(prefers-reduced-motion: reduce)');
  // Performance cap (not a separate version): coarse pointer OR narrow width.
  _isMobile = mm('(pointer: coarse)') || window.innerWidth <= 900;

  container.classList.add('hero-active');
  _stage = _buildLayout(container);

  // ── Graceful fallback (behind everything) — shown until Spline paints, or
  // left in place if the scene fails to load. Keeps the stage from looking
  // broken and lets the key carry the demo on its own. ──
  _fallback = document.createElement('div');
  _fallback.className = 'hero-fallback';
  _fallback.setAttribute('aria-hidden', 'true');
  _fallback.innerHTML = '<span class="hero-fallback-dot"></span><span class="hero-fallback-txt">3D guide</span>';
  _stage.appendChild(_fallback);

  // ── Context #1: Spline robot (ambient, behind the key) ──
  // Gated on SPLINE_ENABLED — see the flag's comment. Off → no <spline-viewer>,
  // so no second WebGL context, no 403, no rejection, and the fallback stays.
  if (SPLINE_ENABLED && SPLINE_URL) {
    _ensureSplineScript();
    _spline = document.createElement('spline-viewer');
    _spline.className = 'hero-spline';
    _spline.setAttribute('url', SPLINE_URL);
    _onSplineLoad = () => { _fallback && _fallback.classList.add('loaded'); };
    _onSplineError = () => { _fallback && _fallback.classList.add('failed'); };
    _spline.addEventListener('load', _onSplineLoad);
    _spline.addEventListener('error', _onSplineError);
    _stage.appendChild(_spline);

    // The <spline-viewer> rejects an internal promise when a scene can't be
    // parsed (a 403/blocked export yields "Data read, but end of buffer not
    // reached"). That bubbles to window with no catchable element event.
    // Swallow ONLY Spline-originated rejections while mounted — scoped tightly
    // so real app errors still surface — and mark the fallback failed.
    _onRejection = (e) => {
      const r = e && e.reason;
      const msg = (r && (r.message || String(r))) || '';
      const stk = (r && r.stack) || '';
      if (/spline/i.test(stk) || /end of buffer not reached/i.test(msg)) {
        e.preventDefault();
        _fallback && _fallback.classList.add('failed');
      }
    };
    window.addEventListener('unhandledrejection', _onRejection);
  }

  // ── Context #2: Three.js key scene (in front) ──
  const { w, h } = _size();
  _scene = new THREE.Scene();
  _camera = new THREE.PerspectiveCamera(46, w / h, 1, 3000);
  _camera.position.set(0, 0, 430);

  _renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, _isMobile ? 1.5 : DPR_CAP));
  _renderer.setSize(w, h);
  _renderer.domElement.className = 'hero-canvas';
  _stage.appendChild(_renderer.domElement);

  // Lights — per prototype (ambient + key directional + red rim point light).
  _scene.add(new THREE.AmbientLight(0x5a5a72, 0.85));
  const dir = new THREE.DirectionalLight(0xffffff, 0.95); dir.position.set(-0.5, 1, 1.4); _scene.add(dir);
  _rim = new THREE.PointLight(KEY_COLOR, 0.6, 1600); _rim.position.set(-200, 150, 260); _scene.add(_rim);

  // HDR environment — PMREM RoomEnvironment on desktop; on mobile skip the bake
  // and use the cheap baked canvas env (lighter, same glassy read).
  _env = _isMobile ? _bakedEnv() : _buildEnv();
  _scene.environment = _env;

  _buildKey();

  // ── Waterfall deck cards (HTML overlay, positioned per-frame in _loop) ──
  _decksEl = document.createElement('div');
  _decksEl.className = 'hero-decks';
  _decksEl.innerHTML = DECKS.map((d, i) =>
    `<div class="hero-ddeck" data-i="${i}"><div class="t">${d}</div><div class="s">20 questions · 4 weak</div></div>`).join('');
  _stage.appendChild(_decksEl);
  _cards = [..._decksEl.querySelectorAll('.hero-ddeck')];
  _cards.forEach((c, i) => c.addEventListener('click', () => _openFauxPicker(DECKS[i])));

  // ── Robot guide-sign (OUR overlay, not Spline) — fades as the class opens ──
  _guide = document.createElement('div');
  _guide.className = 'hero-guide';
  _guide.textContent = 'scroll to open the class ↓';
  _stage.appendChild(_guide);

  // ── Scroll engine: derive desired open state from progress through the hero.
  // Self-completing (opens past ~12%, closes back near the top); _loop eases
  // _openAmount toward _desired so it finishes on its own and reverses. ──
  if (_reduce) {
    // Reduced-motion: present a static OPEN composition — decks visible, key
    // settled, guide hidden. No scroll listener → no scroll-driven motion or
    // jank, and nothing is hidden behind a scroll the user must perform.
    _desired = _openAmount = 1;
  } else {
    _onScroll = () => {
      if (!_heroEl) return;
      const r = _heroEl.getBoundingClientRect();
      const denom = (r.height - window.innerHeight) || 1;
      const prog = _clamp(-r.top / denom, 0, 1);
      if (prog > 0.12) _desired = 1;
      else if (prog < 0.05) _desired = 0;
    };
    window.addEventListener('scroll', _onScroll, { passive: true });
    _onScroll();   // set initial open/closed state
  }

  _onResize = () => _resize();
  window.addEventListener('resize', _onResize);
  _onVis = () => { if (document.hidden) _stop(); else _start(); };
  document.addEventListener('visibilitychange', _onVis);

  _clock = new THREE.Clock();
  _start();
  requestAnimationFrame(() => _resize());       // fix size once layout settles

  console.log(_spline
    ? '[hero] mounted — 2 WebGL contexts (Three.js key + Spline robot)'
    : '[hero] mounted — 1 WebGL context (Three.js key); Spline robot disabled until a live scene URL is set');
}

/* ── destroyHero — exhaustive dual-context teardown ───────────── */
export function destroyHero() {
  if (!_renderer && !_stage && !_spline) return;

  _stop();

  if (_onResize) window.removeEventListener('resize', _onResize);
  if (_onVis) document.removeEventListener('visibilitychange', _onVis);
  if (_onScroll) window.removeEventListener('scroll', _onScroll);
  if (_onRejection) window.removeEventListener('unhandledrejection', _onRejection);
  _onResize = _onVis = _onScroll = _onRejection = null;

  // The faux picker mounts on document.body (like the real one), so it isn't
  // cleared by wiping #page-landing — remove it explicitly.
  document.getElementById('hero-cq-modal')?.remove();

  // ── Three.js teardown (reuse keyBoard pattern) ──
  if (_scene) { _disposeObject(_scene); _scene.environment = null; }
  if (_env) { _env.dispose(); _env = null; }
  if (_renderer) {
    _renderer.dispose();
    _renderer.forceContextLoss();
    const cv = _renderer.domElement;
    if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
  }

  // ── Spline teardown — removing the element releases its WebGL context ──
  if (_spline) {
    if (_onSplineLoad) _spline.removeEventListener('load', _onSplineLoad);
    if (_onSplineError) _spline.removeEventListener('error', _onSplineError);
    try { _spline.dispose?.(); } catch (_) {}
    if (_spline.parentNode) _spline.parentNode.removeChild(_spline);
  }
  _onSplineLoad = _onSplineError = null;

  // Remove the CTA listener, then clear the whole landing DOM we built.
  if (_container && _onCta) _container.querySelector('.hero-cta')?.removeEventListener('click', _onCta);
  _onCta = null;
  if (_container) { _container.innerHTML = ''; _container.classList.remove('hero-active'); }

  _renderer = _scene = _camera = _stage = _container = _clock = _spline = _fallback = null;
  _pivot = _body = _rim = _heroEl = _decksEl = _guide = null;
  _cards = [];
  _ang = _vel = _openAmount = _desired = 0;
  _frames = 0;

  console.log('[hero] destroyed — both contexts released, loop stopped');
}

/* ── Faux deck picker — mirrors the REAL signed-in picker ─────── */
// Same modal-overlay/modal-box shell + same renderModeSelector component as
// openClassQuizPanel (Classes.js), so it's pixel-identical to what a logged-in
// user sees. Only difference: the "▶ Start Quiz" button is replaced with
// "Sign up to create your first deck", which routes to sign-up. The faux deck
// has 20 questions so the count selector shows "5 – 20 · steps of 5".
function _openFauxPicker(deckName) {
  document.getElementById('hero-cq-modal')?.remove();

  const ov = document.createElement('div');
  ov.id = 'hero-cq-modal';
  ov.className = 'modal-overlay';
  ov.style.display = 'flex';
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

  const box = document.createElement('div');
  box.className = 'modal-box';
  box.style.cssText = 'max-width:480px;width:100%;max-height:90vh;overflow-y:auto;';
  box.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:1.2rem;padding-bottom:1rem;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:0.05em;">${deckName}</div>
        <div style="font-size:0.75rem;color:var(--muted);margin-top:0.15rem;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff3f6c;margin-right:0.4rem;vertical-align:middle;"></span>History · 20 questions
        </div>
      </div>
      <button id="hero-cq-close" style="background:transparent;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer;padding:0.2rem 0.4rem;line-height:1;border-radius:6px;flex-shrink:0;" title="Close">✕</button>
    </div>
    <div id="hero-cq-selector-wrap"></div>
    <button class="btn btn-primary" id="hero-cq-signup" style="width:100%;justify-content:center;margin-top:1.2rem;font-size:1rem;padding:0.85rem;">Sign up to create your first deck</button>
    <div style="text-align:center;color:var(--muted);font-size:0.72rem;margin-top:0.7rem;">🔒 Sign up to actually run this quiz and save your progress</div>`;

  ov.appendChild(box);
  document.body.appendChild(ov);

  box.querySelector('#hero-cq-close').onclick = () => ov.remove();
  box.querySelector('#hero-cq-signup').onclick = () => { ov.remove(); _cbOpenAuthModal?.('signup'); };

  // Exact mirror — the same shared selector the real picker renders.
  renderModeSelector(document.getElementById('hero-cq-selector-wrap'), 'hero', { questions: new Array(20) });
}

/* ── Key builders (r184-correct recipe ported from keyBoard.js) ── */
function _buildEnv() {
  try {
    const pmrem = new THREE.PMREMGenerator(_renderer);
    const room = new RoomEnvironment();
    const tex = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose();
    _disposeObject(room);
    return tex;
  } catch (err) {
    console.warn('[hero] PMREM env unavailable, using baked fallback', err);
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

// Engraved label — the r184 fix: sans-serif double-draw (shadow + face),
// SRGB colorSpace on the canvas texture, drawn with depthTest:false +
// renderOrder 999 so it always reads on top of the glass.
function _makeLabel(name) {
  const c = document.createElement('canvas'); c.width = 420; c.height = 150;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const font = n => `700 ${n}px sans-serif`;
  let fs = 58; x.font = font(fs);
  while (x.measureText(name).width > 384 && fs > 26) { fs -= 2; x.font = font(fs); }
  x.fillStyle = 'rgba(0,0,0,0.55)';        x.fillText(name, 210, 80);
  x.fillStyle = 'rgba(240,240,250,0.95)';  x.fillText(name, 210, 76);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

function _buildKey() {
  const metal = new THREE.MeshPhongMaterial({ color: 0xc2c2cc, specular: 0xffffff, shininess: 95 });

  // Wall hook — the key hangs from this (single hook, upper-center per prototype).
  const hook = new THREE.Group();
  const mnt  = new THREE.Mesh(new THREE.CylinderGeometry(7, 8, 6, 18), metal);  mnt.rotation.x = Math.PI / 2; mnt.position.z = 3; hook.add(mnt);
  const sh   = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 22, 14), metal); sh.rotation.x = Math.PI / 2; sh.position.z = 14; hook.add(sh);
  const stub = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 15, 14), metal); stub.position.set(0, 7, 24); hook.add(stub);
  const cap  = new THREE.Mesh(new THREE.SphereGeometry(4.3, 12, 12), metal);    cap.position.set(0, 15, 24); hook.add(cap);
  hook.position.set(0, 95, 0); _scene.add(hook);

  // Glass key fob — MeshPhysicalMaterial cap + emissive red edge (keyBoard recipe).
  const FW = KEY_FW, FH = KEY_FH, DEPTH = KEY_DEPTH, HOLEY = KEY_HOLEY, HOLER = KEY_HOLER;
  _pivot = new THREE.Group();
  _body  = new THREE.Group();

  const geo = new THREE.ExtrudeGeometry(_fobShape(FW, FH, 16, HOLEY, HOLER),
    { depth: DEPTH, bevelEnabled: true, bevelThickness: 3, bevelSize: 3, bevelSegments: 4, steps: 1, curveSegments: 20 });
  geo.translate(0, 0, -DEPTH / 2);

  const capMat = new THREE.MeshPhysicalMaterial({
    color: 0x0e0e15, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.22,
    transparent: true, opacity: 0.78, envMap: _env, envMapIntensity: 0.7,
    reflectivity: 0.5, side: THREE.DoubleSide,
  });
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x0c0c12, emissive: KEY_COLOR, emissiveIntensity: 1.0, roughness: 0.5,
    transparent: true, opacity: 0.92,
  });
  _body.add(new THREE.Mesh(geo, [capMat, edgeMat]));

  const eMat = metal.clone();
  const eyelet = new THREE.Mesh(new THREE.TorusGeometry(HOLER + 1.4, 1.8, 10, 24), eMat);
  eyelet.position.set(0, HOLEY, 0); _body.add(eyelet);

  const lMat = new THREE.MeshBasicMaterial({
    map: _makeLabel(KEY_NAME), transparent: true, opacity: 0.95,
    depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
  const lbl = new THREE.Mesh(new THREE.PlaneGeometry(104, 37), lMat);
  lbl.renderOrder = 999; lbl.position.set(2, -8, DEPTH / 2 + 1.5); _body.add(lbl);

  _body.position.y = -HOLEY;
  _pivot.add(_body);
  _pivot.position.copy(hook.position);
  _scene.add(_pivot);
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
  const w = (_stage && _stage.clientWidth)  || (_container && _container.clientWidth)  || window.innerWidth;
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
  window.__heroFrames = _frames;                // freezes when loop stops — lifecycle verify hook
  const dt = Math.min(_clock.getDelta(), 0.05);
  const t  = _clock.elapsedTime;

  // Scroll-driven open/close — eased toward _desired so it self-completes and
  // reverses (a deliberate sliding-door glide, not a scrubbed 1:1 pin).
  _openAmount += (_desired - _openAmount) * 0.045;
  const me = _ease(_clamp(_openAmount, 0, 1));

  if (_pivot) {
    // Two-phase unhook: lift STRAIGHT UP to clear the hook first (early), THEN
    // glide left + toward the viewer with a slight face-turn (later) — never
    // sliding the fob down through the hook.
    const lift  = _ease(_clamp(_openAmount / 0.3, 0, 1));
    const glide = _ease(_clamp((_openAmount - 0.22) / 0.78, 0, 1));
    _pivot.position.y = _lerp(95, 95 + 26, lift) - _lerp(0, 53, glide);
    _pivot.position.x = _lerp(0, -150, glide);
    _pivot.position.z = _lerp(0, 95, glide);
    _body.scale.setScalar(_lerp(1, 1.2, glide));
    _body.rotation.y = _lerp(0, -0.28, glide);

    // Idle pendulum sway only while essentially closed (off for reduced-motion).
    if (me < 0.02 && !_reduce) _vel += Math.sin(t * 0.7) * 0.0003;
    _vel += (-11 * Math.sin(_ang) - 3.4 * _vel) * dt;
    _vel = _clamp(_vel, -0.05, 0.05);
    _ang += (me < 0.05 && !_reduce) ? _vel : 0;
    _ang = _clamp(_ang, -0.4, 0.4);
    _pivot.rotation.z = _ang * (1 - me);
  }
  if (_rim && !_reduce) _rim.position.x = -200 + Math.sin(t * 0.5) * 60;

  _renderer.render(_scene, _camera);

  // Decks emerge from the key's projected hole position and waterfall down the
  // center, staggered by index (prototype math). Projected AFTER render so the
  // camera matrices reflect this frame's key position.
  if (_decksEl && _cards.length && _stage) {
    _projectV.set(_pivot.position.x, _pivot.position.y - KEY_HOLEY, _pivot.position.z).project(_camera);
    const sw = _stage.clientWidth, sh = _stage.clientHeight;
    const ox = (_projectV.x * 0.5 + 0.5) * sw, oy = (-_projectV.y * 0.5 + 0.5) * sh;
    const cx = sw * 0.5, cyStart = sh * 0.30, gap = 62;
    for (let i = 0; i < _cards.length; i++) {
      const e = _ease(_clamp((_openAmount - 0.18 - i * 0.12) / 0.42, 0, 1));   // staggered = waterfall
      const x = _lerp(ox - CARDW / 2, cx - CARDW / 2, e);
      const y = _lerp(oy - 20, cyStart + i * gap, e);
      _cards[i].style.transform = `translate(${x}px,${y}px) scale(${_lerp(0.35, 1, e)})`;
      _cards[i].style.opacity = _clamp(e * 1.5, 0, 1);
    }
  }
  if (_guide) _guide.style.opacity = 1 - _clamp(_openAmount * 2, 0, 1);
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
