/**
 * PulseSimulator — loads a Pixelblaze pattern and renders it to a canvas.
 *
 * Usage:
 *   const sim = new PulseSimulator(canvas)
 *   sim.load(patternSource, { geometry:'1d', pixelCount:144 })
 *   sim.setBeat(128, Date.now())
 *   sim.start()
 *   sim.stop()
 */
class PulseSimulator {
  constructor(canvas) {
    this.canvas  = canvas
    this.ctx     = canvas.getContext('2d')
    this.rt      = mkRuntime()
    this.rt._exports = {}
    this._running  = false
    this._rafId    = null
    this._lastT    = 0
    this._frames   = 0
    this._fpsTime  = 0
    this.fps       = 0
    this.pixelCount = 60
    this.geometry   = '1d'
    this.onFps      = null   // callback(fps, frames)
    this.onError    = null   // callback(err)

    // Synthetic beat
    this._bpm        = 128
    this._anchorMs   = performance.now()
    this._beatTimer  = null
  }

  // ── Load & compile ──────────────────────────────────────────────────────────

  load(source, options = {}) {
    this.geometry   = options.geometry   ?? '1d'
    this.pixelCount = options.pixelCount ?? 60

    this.rt._exports = {}
    this.rt._reset(this.pixelCount)
    this.rt._startMs = performance.now()  // reset time base

    const { code, exportedVars } = transpile(source)

    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('rt', code + '\n;')
      fn(this.rt)
    } catch (e) {
      this.onError?.(`Compile error: ${e.message}`)
      return false
    }

    // Inject current beat state into the pattern vars (simulator-domain ms)
    this._anchorMs = 0   // beat started at simulator t=0
    this.rt.bpm          = this._bpm
    this.rt.beatAnchorMs = this._anchorMs
    this.rt.killActive   = 0
    this.rt.masterBrightness = 1
    this.rt.hueOffset    = 0
    this.rt.strobeRate   = 1
    this.rt.beatDivider  = 1

    // Warmup: run a few beforeRender+render cycles so the pattern has state
    // before the first visible frame, preventing black-flash on load.
    if (this.rt._exports.beforeRender || this.rt._exports.render) {
      const warmupDt = 16
      for (let w = 0; w < 8; w++) {
        try {
          this.rt._exports.beforeRender?.(warmupDt)
          this.rt._reset(this.pixelCount)
          for (let i = 0; i < this.pixelCount; i++) {
            this.rt._setCurrentPixel(i)
            this.rt._exports.render?.(i)
          }
        } catch (_) { break }
      }
    }

    this._frames = 0
    return true
  }

  // ── Beat control ────────────────────────────────────────────────────────────

  setBeat(bpm, anchorMs) {
    this._bpm      = bpm
    // beatAnchorMs lives in simulator-start-relative ms, same domain as time()
    this._anchorMs = performance.now() - (this.rt._startMs ?? 0)
    this.rt.bpm          = this._bpm
    this.rt.beatAnchorMs = this._anchorMs
    this._scheduleSyntheticBeat()
  }

  setBpm(bpm) {
    this.setBeat(bpm)
  }

  _scheduleSyntheticBeat() {
    clearTimeout(this._beatTimer)
    const interval = 60000 / this._bpm
    this._beatTimer = setTimeout(() => {
      this._anchorMs = performance.now() - (this.rt._startMs ?? 0)
      this.rt.beatAnchorMs = this._anchorMs
      this._scheduleSyntheticBeat()
    }, interval)
  }

  // ── Playback ────────────────────────────────────────────────────────────────

  start() {
    if (this._running) return
    this._running = true
    this._lastT   = performance.now()
    this._fpsTime = performance.now()
    this._scheduleSyntheticBeat()
    this._tick()
  }

  stop() {
    this._running = false
    cancelAnimationFrame(this._rafId)
    clearTimeout(this._beatTimer)
  }

  _tick() {
    if (!this._running) return
    this._rafId = requestAnimationFrame(() => this._tick())

    const now = performance.now()
    const dt  = now - this._lastT
    this._lastT = now

    try {
      this.rt._exports.beforeRender?.(dt)

      this.rt._reset(this.pixelCount)
      if (this.geometry === '2d') {
        const rows = Math.round(Math.sqrt(this.pixelCount))
        const cols = Math.ceil(this.pixelCount / rows)
        for (let i = 0; i < this.pixelCount; i++) {
          this.rt._setCurrentPixel(i)
          const x = (i % cols) / (cols - 1 || 1)
          const y = Math.floor(i / cols) / (rows - 1 || 1)
          this.rt._exports.render2D?.(i, x, y) ?? this.rt._exports.render?.(i)
        }
      } else {
        for (let i = 0; i < this.pixelCount; i++) {
          this.rt._setCurrentPixel(i)
          this.rt._exports.render?.(i)
        }
      }

      this._drawPixels(this.rt._getPixels())
    } catch (e) {
      this.onError?.(`Runtime error: ${e.message}`)
      this.stop()
      return
    }

    this._frames++
    if (now - this._fpsTime >= 500) {
      this.fps = Math.round(this._frames / ((now - this._fpsTime) / 1000))
      this._frames = 0
      this._fpsTime = now
      this.onFps?.(this.fps, this._totalFrames)
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  _drawPixels(pixels) {
    const { canvas, ctx } = this
    const n = pixels.length
    if (!n) return

    if (this.geometry === '2d') {
      this._draw2D(pixels)
      return
    }

    // 1D strip — horizontal row of circles
    const dpr  = window.devicePixelRatio || 1
    const w    = canvas.clientWidth  * dpr
    const h    = canvas.clientHeight * dpr
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h
    }

    ctx.fillStyle = '#06080a'
    ctx.fillRect(0, 0, w, h)

    const diameter  = Math.min(Math.floor(w / n), Math.floor(h * 0.9))
    const radius    = diameter / 2
    const totalW    = diameter * n
    const startX    = (w - totalW) / 2 + radius
    const y         = h / 2

    for (let i = 0; i < n; i++) {
      const [r, g, b] = pixels[i]
      const color = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`
      const cx = startX + i * diameter

      // Glow
      if (r + g + b > 0.05) {
        const glow = ctx.createRadialGradient(cx, y, 0, cx, y, radius * 2.5)
        glow.addColorStop(0, color.replace('rgb', 'rgba').replace(')', ',0.6)'))
        glow.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.beginPath()
        ctx.arc(cx, y, radius * 2.5, 0, Math.PI * 2)
        ctx.fillStyle = glow
        ctx.fill()
      }

      // Pixel dot
      ctx.beginPath()
      ctx.arc(cx, y, radius * 0.85, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    }
  }

  _draw2D(pixels) {
    const { canvas, ctx } = this
    const n    = pixels.length
    const cols = Math.ceil(Math.sqrt(n))
    const rows = Math.ceil(n / cols)
    const dpr  = window.devicePixelRatio || 1
    const w    = canvas.clientWidth  * dpr
    const h    = canvas.clientHeight * dpr
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h
    }

    ctx.fillStyle = '#06080a'
    ctx.fillRect(0, 0, w, h)

    const cellW = w / cols
    const cellH = h / rows

    for (let i = 0; i < n; i++) {
      const [r, g, b] = pixels[i]
      const col = i % cols
      const row = Math.floor(i / cols)
      const color = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`

      ctx.fillStyle = color
      ctx.fillRect(col * cellW + 1, row * cellH + 1, cellW - 2, cellH - 2)
    }
  }

  // ── Operator setVar overrides (from PULSEDECK mirror) ───────────────────────

  setVar(name, value) {
    this.rt[name] = value
  }
}
