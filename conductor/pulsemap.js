'use strict'

/**
 * PULSEMAP — Pixelblaze proxy routes.
 * Fetches device info and pixel map coordinates from Pixelblaze units
 * so the browser-side mapper can display real LED positions.
 */

const { WebSocket } = require('ws')

const PB_WS_PORT = 81
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
// Try HTTP /settings first (PB v3), fall back to WebSocket config frame.

async function fetchDeviceInfo(ip) {
  // HTTP attempt
  try {
    const res = await fetch(`http://${ip}/settings`, {
      signal: AbortSignal.timeout(2500)
    })
    if (res.ok) {
      const d = await res.json()
      return {
        name:       d.name       || ip,
        pixelCount: d.pixelCount || 0,
        hasMap:     false,        // unknown until we try mapdata
      }
    }
  } catch (_) {}

  // WebSocket fallback
  const ws = await pbConnect(ip)
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.terminate(); reject(new Error('No config received')) }, DATA_TIMEOUT)

    ws.on('error', e => { clearTimeout(t); reject(e) })
    ws.on('message', (data, isBinary) => {
      if (isBinary) return   // wait for text config frame
      try {
        const msg = JSON.parse(data.toString())
        // PB sends a config object on connect; look for pixelCount or name
        if (msg.pixelCount != null || msg.name != null) {
          clearTimeout(t)
          ws.terminate()
          resolve({
            name:       msg.name       || ip,
            pixelCount: msg.pixelCount || 0,
            hasMap:     false,
          })
        }
      } catch (_) {}
    })
    // Also request config explicitly
    ws.send(JSON.stringify({ getConfig: true }))
  })
}

// ── Pixel map data ────────────────────────────────────────────────────────────
// Sends `getMapData`, waits for a binary frame with type byte 0x09.
// Returns { pixels: [[x,y], ...] | null, is3D: bool }
// Pixel coords are normalized 0-1 as emitted by PB's mapping function.

async function fetchMapData(ip, pixelCount) {
  const ws = await pbConnect(ip)
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      ws.terminate()
      resolve({ pixels: null, is3D: false })
    }, DATA_TIMEOUT)

    ws.on('error', () => { clearTimeout(t); resolve({ pixels: null, is3D: false }) })
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
      if (buf.length < 5) return

      const frameType = buf[0]
      // Frame type 9 = map coordinate data in PB v3
      if (frameType !== 9) return

      const payload    = buf.slice(1)
      const floatCount = Math.floor(payload.length / 4)
      const floats     = new Float32Array(payload.buffer, payload.byteOffset, floatCount)

      // Determine dimensionality from float count vs pixel count
      const n    = pixelCount || 1
      const dim  = floatCount >= n * 3 ? 3 : 2
      const is3D = dim === 3

      const pixels = []
      for (let i = 0; i + dim - 1 < floatCount; i += dim) {
        if (dim === 3) pixels.push([floats[i], floats[i+1], floats[i+2]])
        else           pixels.push([floats[i], floats[i+1]])
      }

      clearTimeout(t)
      ws.terminate()
      resolve({ pixels: pixels.length ? pixels : null, is3D })
    })

    ws.send(JSON.stringify({ getMapData: true }))
  })
}

// ── Routes ────────────────────────────────────────────────────────────────────

function registerRoutes(app) {
  // GET /api/pulsemap/device?ip=<ip>  — name + pixelCount
  app.get('/api/pulsemap/device', async (req, res) => {
    const { ip } = req.query
    if (!ip) return res.status(400).json({ error: 'ip required' })
    try {
      res.json(await fetchDeviceInfo(ip))
    } catch (e) {
      res.status(502).json({ error: e.message })
    }
  })

  // GET /api/pulsemap/mapdata?ip=<ip>&pixelCount=<n>  — pixel XY(Z) coords
  app.get('/api/pulsemap/mapdata', async (req, res) => {
    const { ip, pixelCount } = req.query
    if (!ip) return res.status(400).json({ error: 'ip required' })
    try {
      res.json(await fetchMapData(ip, parseInt(pixelCount || '0', 10)))
    } catch (e) {
      res.status(502).json({ error: e.message })
    }
  })
}

module.exports = { registerRoutes }
