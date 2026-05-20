'use strict'

/**
 * PULSEMAP — Pixelblaze proxy routes.
 * Fetches device info, pixel map, and output expander config from
 * Pixelblaze units so the browser mapper can display real LED positions.
 */

const { WebSocket } = require('ws')

const PB_WS_PORT   = 81
const CONN_TIMEOUT = 4000
const DATA_TIMEOUT = 3000

// ── WebSocket connection helper ───────────────────────────────────────────────

function pbConnect(ip) {
  return new Promise((resolve, reject) => {
    let ws
    try { ws = new WebSocket(`ws://${ip}:${PB_WS_PORT}`) } catch (e) { return reject(e) }
    const t = setTimeout(() => { ws.terminate(); reject(new Error(`Cannot reach ${ip}:${PB_WS_PORT}`)) }, CONN_TIMEOUT)
    ws.on('error', e => { clearTimeout(t); reject(e) })
    ws.on('open',  () => { clearTimeout(t); resolve(ws) })
  })
}

// ── Device info ───────────────────────────────────────────────────────────────

async function fetchDeviceInfo(ip) {
  try {
    const res = await fetch(`http://${ip}/settings`, { signal: AbortSignal.timeout(2500) })
    if (res.ok) {
      const d = await res.json()
      return { name: d.name || ip, pixelCount: d.pixelCount || 0 }
    }
  } catch (_) {}

  const ws = await pbConnect(ip)
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.terminate(); reject(new Error('No config received')) }, DATA_TIMEOUT)
    ws.on('error', e => { clearTimeout(t); reject(e) })
    ws.on('message', (data, isBinary) => {
      if (isBinary) return
      try {
        const msg = JSON.parse(data.toString())
        if (msg.pixelCount != null || msg.name != null) {
          clearTimeout(t); ws.terminate()
          resolve({ name: msg.name || ip, pixelCount: msg.pixelCount || 0 })
        }
      } catch (_) {}
    })
    ws.send(JSON.stringify({ getConfig: true }))
  })
}

// ── Pixel map data ────────────────────────────────────────────────────────────

async function fetchMapData(ip, pixelCount) {
  const ws = await pbConnect(ip)
  return new Promise((resolve) => {
    const t = setTimeout(() => { ws.terminate(); resolve({ pixels: null, is3D: false }) }, DATA_TIMEOUT)
    ws.on('error', () => { clearTimeout(t); resolve({ pixels: null, is3D: false }) })
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
      if (buf.length < 5 || buf[0] !== 9) return

      const payload    = buf.slice(1)
      const floatCount = Math.floor(payload.length / 4)
      const floats     = new Float32Array(payload.buffer, payload.byteOffset, floatCount)
      const n          = pixelCount || 1
      const dim        = floatCount >= n * 3 ? 3 : 2
      const pixels     = []
      for (let i = 0; i + dim - 1 < floatCount; i += dim) {
        pixels.push(dim === 3
          ? [floats[i], floats[i+1], floats[i+2]]
          : [floats[i], floats[i+1]])
      }
      clearTimeout(t); ws.terminate()
      resolve({ pixels: pixels.length ? pixels : null, is3D: dim === 3 })
    })
    ws.send(JSON.stringify({ getMapData: true }))
  })
}

// ── Output Expander config ────────────────────────────────────────────────────
// Returns array of { startPixel, pixelCount } per channel, or null if no expander.

async function fetchExpanderConfig(ip) {
  const ws = await pbConnect(ip)
  return new Promise((resolve) => {
    const t = setTimeout(() => { ws.terminate(); resolve(null) }, DATA_TIMEOUT)
    ws.on('error', () => { clearTimeout(t); resolve(null) })
    ws.on('message', (data, isBinary) => {
      if (isBinary) return
      try {
        const msg = JSON.parse(data.toString())
        // PB v3: { expConfig: [{channel, startPixel, pixelCount, ...}, ...] }
        const cfg = msg.expConfig || msg.expanderConfig
        if (cfg !== undefined) {
          clearTimeout(t); ws.terminate()
          resolve(Array.isArray(cfg) && cfg.length ? cfg : null)
        }
      } catch (_) {}
    })
    ws.send(JSON.stringify({ getExpConfig: true }))
  })
}

// ── Segment detection from pixel positions ────────────────────────────────────
// Uses median inter-pixel distance as baseline; flags jumps > threshold×median.

function detectSegments(pixels, threshold = 4) {
  if (!pixels || pixels.length < 2) {
    return [{ start: 0, end: (pixels?.length ?? 1) - 1, auto: true }]
  }
  const dists = []
  for (let i = 1; i < pixels.length; i++) {
    const dx = pixels[i][0] - pixels[i-1][0]
    const dy = pixels[i][1] - pixels[i-1][1]
    dists.push(Math.sqrt(dx*dx + dy*dy))
  }
  const sorted = [...dists].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] || 0
  const cutoff = median * threshold

  const segs = []
  let start = 0
  for (let i = 0; i < dists.length; i++) {
    if (median > 0 && dists[i] > cutoff) {
      segs.push({ start, end: i, auto: true })
      start = i + 1
    }
  }
  segs.push({ start, end: pixels.length - 1, auto: true })
  return segs
}

// ── Combined import ───────────────────────────────────────────────────────────

async function importDevice(ip) {
  const devInfo = await fetchDeviceInfo(ip)
  const pixelCount = devInfo.pixelCount

  const [mapData, expanderCfg] = await Promise.all([
    fetchMapData(ip, pixelCount).catch(() => ({ pixels: null, is3D: false })),
    fetchExpanderConfig(ip).catch(() => null),
  ])

  const pixels = mapData.pixels

  // Determine segment index ranges
  let segRanges
  if (expanderCfg) {
    segRanges = expanderCfg
      .map(ch => ({
        start: ch.startPixel ?? ch.start ?? 0,
        end:   (ch.startPixel ?? ch.start ?? 0) + (ch.pixelCount ?? ch.count ?? 1) - 1,
        source: 'expander',
      }))
      .filter(s => s.start >= 0 && s.end >= s.start)
  }

  if (!segRanges?.length && pixels) {
    segRanges = detectSegments(pixels).map(s => ({ ...s, source: 'heuristic' }))
  }

  if (!segRanges?.length) {
    segRanges = [{ start: 0, end: Math.max(0, pixelCount - 1), source: 'default' }]
  }

  return {
    name:       devInfo.name,
    ip,
    pixelCount,
    is3D:       mapData.is3D,
    hasMap:     !!pixels,
    pixels,
    segments:   segRanges,
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

function registerRoutes(app) {
  // Combined import: device info + map + segments in one call
  app.get('/api/pulsemap/import', async (req, res) => {
    const { ip } = req.query
    if (!ip) return res.status(400).json({ error: 'ip required' })
    try {
      res.json(await importDevice(ip))
    } catch (e) {
      res.status(502).json({ error: e.message })
    }
  })

  // Individual endpoints (kept for compatibility)
  app.get('/api/pulsemap/device', async (req, res) => {
    const { ip } = req.query
    if (!ip) return res.status(400).json({ error: 'ip required' })
    try { res.json(await fetchDeviceInfo(ip)) }
    catch (e) { res.status(502).json({ error: e.message }) }
  })

  app.get('/api/pulsemap/mapdata', async (req, res) => {
    const { ip, pixelCount } = req.query
    if (!ip) return res.status(400).json({ error: 'ip required' })
    try { res.json(await fetchMapData(ip, parseInt(pixelCount || '0', 10))) }
    catch (e) { res.status(502).json({ error: e.message }) }
  })
}

module.exports = { registerRoutes }
