// Track Glow: logic that does not touch the DOM, so tests can exercise it against Luna.MockEngine.

const AddOnLogic = {
  /** How long the peak marker sits still before it starts to fall, in ms. */
  HOLD_MS: 1100,
  /** How fast the peak falls once released: acceleration in level units per ms^2. */
  PEAK_GRAVITY: 0.0000035,
  /** Release time constant of the bar itself, in ms (attack is instant). */
  RELEASE_MS: 140,
  /** Colour used when a track has none. */
  FALLBACK_RGB: [120, 150, 200],

  /** [r, g, b] from LUNA's packed ARGB integer, lifted a little if it is too dark to glow. */
  rgb(argb) {
    if (typeof argb !== 'number' || !Number.isFinite(argb)) return AddOnLogic.FALLBACK_RGB.slice();
    const c = argb >>> 0;
    let rgb = [(c >>> 16) & 255, (c >>> 8) & 255, c & 255];
    const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    if (lum < 0.22) {
      const mix = (0.22 - lum) / 0.22 * 0.55; // up to 55% towards white
      rgb = rgb.map((v) => Math.round(v + (255 - v) * mix));
    }
    return rgb;
  },

  /** CSS colour for a packed ARGB integer. */
  colorCss(argb, alpha) {
    const [r, g, b] = AddOnLogic.rgb(argb);
    return alpha === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
  },

  /** One bar per user-visible track, in LUNA's order. */
  bars(session) {
    return session.visibleTracks.map((t) => ({
      id: t.id,
      name: t.name.value ?? t.id,
      color: t.color.value,
    }));
  },

  /** The level a track's meter shows now, 0..1 (the loudest stream). */
  meterLevel(track) {
    const v = track.meter.max;
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  },

  /** Fresh animation state for one bar. */
  newBarState() {
    return { level: 0, peak: 0, holdUntil: 0, fallSpeed: 0 };
  },

  /**
   * Advance one bar by dtMs towards the meter's target level: instant attack, smooth
   * release, and a peak that holds for HOLD_MS then falls with gentle acceleration,
   * never below the bar. Mutates and returns state.
   */
  stepBar(state, target, dtMs, nowMs) {
    const t = Math.max(0, Math.min(1, Number.isFinite(target) ? target : 0));
    const dt = Math.max(0, Math.min(dtMs, 100));
    if (t >= state.level) state.level = t;
    else {
      state.level += (t - state.level) * (1 - Math.exp(-dt / AddOnLogic.RELEASE_MS));
      if (state.level < 0.0005) state.level = t < 0.0005 ? 0 : t;
    }
    if (state.level >= state.peak) {
      state.peak = state.level;
      state.holdUntil = nowMs + AddOnLogic.HOLD_MS;
      state.fallSpeed = 0;
    } else if (nowMs >= state.holdUntil) {
      state.fallSpeed += AddOnLogic.PEAK_GRAVITY * dt;
      state.peak = Math.max(state.level, state.peak - state.fallSpeed * dt);
      if (state.peak < 0.0005) state.peak = 0;
    }
    return state;
  },

  /** True while a bar still has something to animate. */
  isMoving(state, target) {
    return state.level > 0 || state.peak > 0 || target > 0;
  },
};

globalThis.AddOnLogic = AddOnLogic;
