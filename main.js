// Track Glow: DOM wiring. One glowing bar per track, moved by transforms only (DRAWING.md).

const $ = (id) => document.getElementById(id);
let luna;
let session;
let setupGen = 0;          // each session setup gets a number; an older one stops when a newer starts
let sessionReleases = [];  // listeners for the whole session
let trackReleases = [];    // listeners for the current set of bars
let bars = [];             // { track, el, fill, peak, state, lastLevel, lastPeak, lastOpacity }
let rafId = 0;
let lastFrame = 0;

const releaseAll = (list) => { for (const u of list) { try { u(); } catch { /* already gone */ } } };

function setStatus(text) {
  if ($('status').textContent !== text) $('status').textContent = text;
}

// ---- animation ---------------------------------------------------------------------------

function kick() {
  if (!rafId) { lastFrame = performance.now(); rafId = requestAnimationFrame(frame); }
}

function frame(now) {
  rafId = 0;
  const dt = now - lastFrame;
  lastFrame = now;
  let moving = false;
  for (const b of bars) {
    const target = b.track.disposed ? 0 : AddOnLogic.meterLevel(b.track);
    const s = AddOnLogic.stepBar(b.state, target, dt, now);
    if (Math.abs(s.level - b.lastLevel) > 0.0005) {
      b.lastLevel = s.level;
      b.fill.style.transform = `translateY(${((1 - s.level) * 100).toFixed(2)}%)`;
    }
    if (Math.abs(s.peak - b.lastPeak) > 0.0005) {
      b.lastPeak = s.peak;
      b.peak.style.transform = `translateY(${((1 - s.peak) * 100).toFixed(2)}%)`;
    }
    const opacity = s.peak > 0.002 ? (now < s.holdUntil ? '1' : '0.75') : '0';
    if (opacity !== b.lastOpacity) { b.lastOpacity = opacity; b.peak.style.opacity = opacity; }
    if (AddOnLogic.isMoving(s, target)) moving = true;
  }
  if (moving) rafId = requestAnimationFrame(frame);
}

// ---- bars --------------------------------------------------------------------------------

function paintIdentity(b) {
  const name = b.track.name.value ?? b.track.id;
  const nameEl = b.el.querySelector('.name');
  if (nameEl.textContent !== name) { nameEl.textContent = name; nameEl.title = name; }
  const c = AddOnLogic.colorCss(b.track.color.value);
  if (b.el.style.getPropertyValue('--c') !== c) b.el.style.setProperty('--c', c);
}

function buildBars(gen) {
  if (gen !== setupGen || !session) return;
  const old = trackReleases;
  const keep = [];
  const previous = new Map(bars.map((b) => [b.track.id, b.state]));
  const root = $('bars');
  root.textContent = '';
  bars = [];
  for (const row of AddOnLogic.bars(session)) {
    const track = session.tracks.byId(row.id);
    if (!track) continue;
    const el = document.createElement('div');
    el.className = 'bar';
    el.innerHTML = '<div class="lane"><div class="rail"></div><div class="fill"></div><div class="peak"></div></div><div class="floor"></div><div class="name"></div>';
    const b = {
      track, el,
      fill: el.querySelector('.fill'),
      peak: el.querySelector('.peak'),
      state: previous.get(track.id) ?? AddOnLogic.newBarState(),
      lastLevel: -1, lastPeak: -1, lastOpacity: '',
    };
    paintIdentity(b);
    root.appendChild(el);
    bars.push(b);
    // Subscribe again on every build, then drop the old listeners, so no meter loses its last one.
    keep.push(track.meter.onChange(kick));
    keep.push(track.name.onChange(() => paintIdentity(b)));
    keep.push(track.color.onChange(() => paintIdentity(b)));
    keep.push(track.order.onChange(() => scheduleBuild(gen)));
  }
  trackReleases = keep;
  releaseAll(old);
  $('empty').hidden = bars.length > 0;
  kick();
}

let buildQueued = false;
function scheduleBuild(gen) {
  if (buildQueued) return;
  buildQueued = true;
  requestAnimationFrame(() => { buildQueued = false; buildBars(gen); });
}

// ---- session -----------------------------------------------------------------------------

async function bindSession() {
  const gen = ++setupGen;
  releaseAll(sessionReleases);
  sessionReleases = [];
  const s = luna.sessions.current();
  if (!s) {
    session = undefined;
    releaseAll(trackReleases); trackReleases = [];
    bars = []; $('bars').textContent = '';
    $('empty').hidden = false; $('empty').textContent = 'No session open';
    setStatus('');
    return;
  }
  await s.ready();
  if (gen !== setupGen) return;            // a newer setup has started
  try { await s.tracks.membersReady(); } catch { /* keep going with what loaded */ }
  if (gen !== setupGen) return;
  session = s;
  $('empty').textContent = 'No tracks in this session';
  setStatus('');
  sessionReleases.push(s.tracks.onChange(() => scheduleBuild(gen)));
  buildBars(gen);
}

async function connect() {
  for (;;) {
    try {
      luna = await Luna.connect();
      break;
    } catch (e) {
      setStatus(e instanceof Luna.NotRunning ? 'waiting for LUNA...' : e.message);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  Luna.bindShortcuts(luna);
  await luna.sessions.ready();
  luna.sessions.focused.onChange(bindSession);
  luna.sessions.items.onChange(bindSession);
  luna.status.onChange(() => {
    if (luna.status.value === 'disconnected') setStatus('reconnecting...');
    else if (luna.status.value === 'connected') setStatus('');
  });
  await bindSession();
}

connect();
