'use strict'

// Load .env if present (no external dep needed in Node 20+)
const fs_env = require('fs')
const env_path = require('path').join(__dirname, '../.env')
if (fs_env.existsSync(env_path)) {
  for (const line of fs_env.readFileSync(env_path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const path      = require('path')
const fs        = require('fs')
const express   = require('express')
const { WebSocketServer, WebSocket } = require('ws')
const { state, varsPayload, statusSnapshot } = require('./state')
const { getLogs } = require('./logger')   // must be first — patches console
const pb        = require('./pixelblaze')
const firestorm = require('./firestorm')
const forge     = require('./forge')

const DEV  = process.argv.includes('--dev')
const PORT = parseInt(process.env.PORT || '8080', 10)

// ─── Config ──────────────────────────────────────────────────────────────────

const scenesPath   = path.join(__dirname, 'config/scenes.json')
const topologyPath = path.join(__dirname, 'config/topology.json')

function loadConfig() {
  const scenes   = JSON.parse(fs.readFileSync(scenesPath,   'utf8')).scenes
  const topology = JSON.parse(fs.readFileSync(topologyPath, 'utf8'))
  return { scenes, topology }
}

let config = loadConfig()

// ─── Tap tempo ───────────────────────────────────────────────────────────────

const tapTimes = []
function handleTap(t) {
  tapTimes.push(t)
  if (tapTimes.length > 8) tapTimes.shift()
  if (tapTimes.length < 2) return
  const gaps = []
  for (let i = 1; i < tapTimes.length; i++) gaps.push(tapTimes[i] - tapTimes[i-1])
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
  state.bpm = 60000 / avg
  state.beatAnchorMs = t
  console.log(`[tap] bpm=${state.bpm.toFixed(1)}`)
}

// ─── Scene management ────────────────────────────────────────────────────────

async function setScene(sceneId) {
  const scene = config.scenes.find(s => s.id === sceneId)
  if (!scene) return
  state.activeScene = sceneId
  console.log(`[scene] → ${scene.name}`)
  await firestorm.setActivePattern(scene.program).catch(() => {})
  broadcastDeckState()
}

function panicAllBlack() {
  state.killActive = state.killActive ? 0 : 1
  if (state.killActive) {
    console.log('[panic] KILL ACTIVE — all black')
    firestorm.setGlobalBrightness(0).catch(() => {})
  } else {
    console.log('[panic] cleared')
    firestorm.setGlobalBrightness(state.masterBrightness).catch(() => {})
  }
  broadcastDeckState()
}

// ─── PULSEDECK WebSocket clients ─────────────────────────────────────────────

const deckClients = new Set()

function broadcastDeckState() {
  const msg = JSON.stringify({ type: 'state', ...statusSnapshot() })
  for (const ws of deckClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg)
  }
}

function handleDeckMessage(raw) {
  let cmd
  try { cmd = JSON.parse(raw) } catch { return }

  switch (cmd.type) {
    case 'scene':
      setScene(cmd.scene)
      break
    case 'brightness':
      state.masterBrightness = Math.max(0, Math.min(1, cmd.value))
      broadcastDeckState()
      break
    case 'hue':
      state.hueOffset = ((cmd.value % 1) + 1) % 1
      broadcastDeckState()
      break
    case 'strobe':
      state.strobeRate = cmd.value
      broadcastDeckState()
      break
    case 'divider':
      state.beatDivider = cmd.value
      broadcastDeckState()
      break
    case 'kill':
      panicAllBlack()
      break
    case 'tap':
      handleTap(cmd.t ?? Date.now())
      break
    case 'mode':
      if (['live','sensor','freerun'].includes(cmd.mode)) {
        state.mode = cmd.mode
        state.modeLocked = true
        console.log(`[mode] locked → ${state.mode}`)
        broadcastDeckState()
      }
      break
    case 'unlock':
      state.modeLocked = false
      console.log('[mode] unlocked — auto transitions resumed')
      broadcastDeckState()
      break
  }
}

// ─── HTTP + WS server ────────────────────────────────────────────────────────

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, '../public')))

// Health endpoint
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, ...statusSnapshot() })
})

// Scenes list
app.get('/api/scenes', (_req, res) => {
  res.json(config.scenes)
})

// Topology
app.get('/api/topology', (_req, res) => {
  res.json(JSON.parse(fs.readFileSync(topologyPath, 'utf8')))
})

app.post('/api/topology', (req, res) => {
  fs.writeFileSync(topologyPath, JSON.stringify(req.body, null, 2))
  config = loadConfig()
  res.json({ ok: true })
})

// Catalog patterns
app.get('/api/catalog', (_req, res) => {
  const catalogDir = path.join(__dirname, '../catalog')
  const entries = fs.readdirSync(catalogDir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(catalogDir, f), 'utf8')))
  res.json(entries)
})

app.post('/api/catalog', (req, res) => {
  const entry = req.body
  if (!entry.id) return res.status(400).json({ error: 'missing id' })
  const file = path.join(__dirname, '../catalog', `${entry.id}.json`)
  fs.writeFileSync(file, JSON.stringify(entry, null, 2))
  res.json({ ok: true })
})

// PULSEFORGE API
forge.registerRoutes(app)

// Logs
app.get('/api/logs', (_req, res) => {
  res.json(getLogs(100))
})

// Bug report — logs to disk for offline review
app.post('/api/bugreport', (req, res) => {
  const { description, page, code, issues, screenshot } = req.body
  if (!description) return res.status(400).json({ error: 'description required' })

  const entry = {
    ts: new Date().toISOString(),
    page: page || 'unknown',
    description,
    state: statusSnapshot(),
    logs: getLogs(60),
    ...(code   ? { code }   : {}),
    ...(issues ? { issues } : {}),
    ...(screenshot ? { screenshotBytes: screenshot.length } : {}),
  }

  const logDir  = path.join(__dirname, '../logs')
  const logFile = path.join(logDir, 'bugreports.jsonl')
  try {
    fs.mkdirSync(logDir, { recursive: true })
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n')
    console.log(`[bugreport] logged: ${description.slice(0, 80)}`)
  } catch (e) {
    console.error('[bugreport] failed to write log:', e.message)
  }

  res.json({ ok: true })
})

const server = app.listen(PORT, () => {
  console.log(`[http] http://localhost:${PORT}`)
})

// Upgrade WS on /ws path for PULSEDECK
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  } else {
    socket.destroy()
  }
})

wss.on('connection', (ws) => {
  deckClients.add(ws)
  // Send current state immediately on connect
  ws.send(JSON.stringify({ type: 'state', ...statusSnapshot(), scenes: config.scenes }))

  ws.on('message', (data) => handleDeckMessage(data.toString()))
  ws.on('close', () => deckClients.delete(ws))
  ws.on('error', () => deckClients.delete(ws))
})

// ─── Heartbeat — 250ms ───────────────────────────────────────────────────────

setInterval(() => {
  const vars = varsPayload()
  pb.broadcast(vars)
  // Reset one-frame flags
  state.downbeat = 0
}, 250)

// ─── State broadcast to PULSEDECK — 500ms ────────────────────────────────────

setInterval(() => {
  broadcastDeckState()
}, 500)

// ─── Watchdog — BLT silence detection ───────────────────────────────────────

setInterval(() => {
  if (!state.modeLocked && state.mode === 'live' && Date.now() - state.lastBltMs > 5000) {
    state.mode = 'sensor'
    console.log('[watchdog] BLT silent → sensor mode')
    broadcastDeckState()
  }
}, 1000)

// ─── Dev mode — fake beat generator ──────────────────────────────────────────

if (DEV) {
  console.log('[dev] fake beat generator running at 128 BPM')
  state.mode = 'freerun'

  let beatCount = 0
  const beatInterval = () => {
    const bps = state.bpm / 60
    return 1000 / bps
  }

  function fakeBeat() {
    state.beatAnchorMs = Date.now()
    state.lastBltMs    = Date.now()
    beatCount++
    state.bar = ((beatCount - 1) % 4) + 1
    if (state.bar === 1) state.downbeat = 1
    if (state.mode === 'freerun' && !state.modeLocked) state.mode = 'live'
    setTimeout(fakeBeat, beatInterval())
  }

  setTimeout(fakeBeat, beatInterval())
} else {
  // Start real OSC listener
  const oscModule = require('./osc')
  oscModule.start(parseInt(process.env.OSC_PORT || '9000', 10))
}

// ─── Pixelblaze discovery (from topology) ────────────────────────────────────

function connectFromTopology() {
  const { controllers } = config.topology ?? {}
  if (!controllers?.length) {
    if (DEV) console.log('[pb] no controllers in topology — running without hardware')
    return
  }
  for (const ctrl of controllers) {
    pb.connect(ctrl.id, ctrl.ip)
  }
}

connectFromTopology()

console.log(`[pulse] conductor started${DEV ? ' (DEV mode)' : ''}`)
