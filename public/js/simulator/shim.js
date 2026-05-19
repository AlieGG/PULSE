/**
 * Pixelblaze runtime shim — all built-in functions and globals.
 * Returns a fresh runtime object per Simulator instance.
 */
function mkRuntime() {
  // ── pixel output buffer ─────────────────────────────────────────────────────
  let _pixels = []        // array of [r,g,b] per pixel, 0..1
  let _pixelCount = 1

  // ── color output (called inside render per pixel) ───────────────────────────
  let _currentPixel = 0

  function _setPixel(r, g, b) {
    _pixels[_currentPixel] = [
      Math.max(0, Math.min(1, r)),
      Math.max(0, Math.min(1, g)),
      Math.max(0, Math.min(1, b)),
    ]
  }

  // ── Perlin noise (simple 1D implementation) ──────────────────────────────────
  const _perm = (() => {
    const p = new Uint8Array(512)
    const base = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,
      30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,
      203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,
      165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,
      92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,
      89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,
      226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,
      182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,
      43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,
      228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,
      49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,
      236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180]
    for (let i = 0; i < 256; i++) { p[i] = base[i]; p[i+256] = base[i] }
    return p
  })()

  function _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10) }
  function _lerp(a, b, t) { return a + t * (b - a) }
  function _grad(hash, x) {
    const h = hash & 15
    const grad = 1 + (h & 7)
    return ((h & 8) ? -grad : grad) * x
  }
  function _noise1d(x) {
    const X = Math.floor(x) & 255
    x -= Math.floor(x)
    const u = _fade(x)
    return _lerp(_grad(_perm[X], x), _grad(_perm[X+1], x-1), u) * 0.5 + 0.5
  }

  // ── HSV → RGB ────────────────────────────────────────────────────────────────
  function _hsv2rgb(h, s, v) {
    h = ((h % 1) + 1) % 1
    const i = Math.floor(h * 6)
    const f = h * 6 - i
    const p = v * (1 - s)
    const q = v * (1 - f * s)
    const t = v * (1 - (1 - f) * s)
    switch (i % 6) {
      case 0: return [v, t, p]
      case 1: return [q, v, p]
      case 2: return [p, v, t]
      case 3: return [p, q, v]
      case 4: return [t, p, v]
      case 5: return [v, p, q]
    }
    return [0,0,0]
  }

  // ── transform stack (minimal 2D support) ────────────────────────────────────
  let _tx = 0, _ty = 0, _rot = 0, _scaleX = 1, _scaleY = 1

  // ── time tracking ───────────────────────────────────────────────────────────
  let _startMs = performance.now()

  // ── the runtime object ──────────────────────────────────────────────────────
  const rt = {
    // state injected by Simulator
    pixelCount:   1,
    bpm:          128,
    beatAnchorMs: 0,

    // ── Pixelblaze built-in functions ──────────────────────────────────────────

    // time(interval) — returns 0..1 cycling at interval seconds
    // Pixelblaze contract: time(0.015259)*65536 ≈ elapsed_ms
    // Uses this._startMs if set by Simulator.load(); falls back to closure _startMs.
    time(interval) {
      const origin = this._startMs ?? _startMs
      const ms = performance.now() - origin
      return (ms * interval / 1000) % 1
    },

    wave(v) { return (Math.sin(v * Math.PI * 2) + 1) / 2 },
    square(v, duty = 0.5) { return ((v % 1) + 1) % 1 < duty ? 1 : 0 },
    triangle(v) { v = ((v % 1) + 1) % 1; return v < 0.5 ? v * 2 : 2 - v * 2 },

    sin(v) { return Math.sin(v) },
    cos(v) { return Math.cos(v) },
    tan(v) { return Math.tan(v) },
    asin(v) { return Math.asin(v) },
    acos(v) { return Math.acos(v) },
    atan2(y, x) { return Math.atan2(y, x) },
    sqrt(v) { return Math.sqrt(v) },
    abs(v) { return Math.abs(v) },
    min(a, b) { return Math.min(a, b) },
    max(a, b) { return Math.max(a, b) },
    floor(v) { return Math.floor(v) },
    ceil(v) { return Math.ceil(v) },
    round(v) { return Math.round(v) },
    pow(b, e) { return Math.pow(b, e) },
    log(v) { return Math.log(v) },
    exp(v) { return Math.exp(v) },
    clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) },
    random(n) { return Math.random() * (n ?? 1) },
    randomFloat(n) { return Math.random() * (n ?? 1) },

    noise(x, y, z) { return _noise1d(x + (y ?? 0) * 100 + (z ?? 0) * 10000) },

    // Color output
    hsv(h, s, v) { _setPixel(..._hsv2rgb(h, s, v)) },
    rgb(r, g, b)  { _setPixel(r, g, b) },
    hsl(h, s, l) {
      // convert HSL → HSV then output
      const v = l + s * Math.min(l, 1 - l)
      const sv = v === 0 ? 0 : 2 * (1 - l / v)
      _setPixel(..._hsv2rgb(h, sv, v))
    },

    // Transform (no-op for 1D, minimal for 2D)
    resetTransform() { _tx=0; _ty=0; _rot=0; _scaleX=1; _scaleY=1 },
    translate(x, y) { _tx += x; _ty += y },
    rotate(r) { _rot += r },
    scale(s) { _scaleX *= s; _scaleY *= s },

    // ── internal hooks (called by Simulator, not patterns) ─────────────────────
    _reset(pixelCount) {
      _pixelCount = pixelCount
      _pixels = new Array(pixelCount).fill(null).map(() => [0,0,0])
      this.pixelCount = pixelCount
    },
    _setCurrentPixel(i) { _currentPixel = i },
    _getPixels() { return _pixels },
  }

  return rt
}

// Export for both Node (not used here) and browser
if (typeof module !== 'undefined') module.exports = { mkRuntime }
