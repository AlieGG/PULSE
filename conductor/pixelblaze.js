'use strict'

const WebSocket = require('ws')
const { state, varsPayload } = require('./state')

const RECONNECT_MS = 3000

function connect(id, ip) {
  const url = `ws://${ip}:81`
  let ws

  function open() {
    ws = new WebSocket(url)

    ws.on('open', () => {
      console.log(`[pb] connected  id=${id}  ip=${ip}`)
      const entry = state.pixelblazes.get(id)
      if (entry) { entry.ws = ws; entry.online = true }
      push(varsPayload())
    })

    ws.on('close', () => {
      console.log(`[pb] disconnected  id=${id}`)
      const entry = state.pixelblazes.get(id)
      if (entry) entry.online = false
      setTimeout(open, RECONNECT_MS)
    })

    ws.on('error', () => {
      // close handler fires after error, triggers reconnect
    })
  }

  state.pixelblazes.set(id, { id, ip, ws: null, online: false })
  open()
}

// Send setVars to one PB
function push(vars, entry) {
  if (!entry?.ws || entry.ws.readyState !== WebSocket.OPEN) return
  try {
    // Pixelblaze setVars message format: { setVars: { key: val, ... } }
    entry.ws.send(JSON.stringify({ setVars: vars }))
  } catch (_) {}
}

// Broadcast to all connected PBs
function broadcast(vars) {
  for (const entry of state.pixelblazes.values()) {
    push(vars, entry)
  }
}

// Set a pattern by name on a specific PB (or all if id=null)
function setProgram(programName, id = null) {
  const msg = JSON.stringify({ setActivePattern: { name: programName } })
  for (const [entryId, entry] of state.pixelblazes.entries()) {
    if (id && entryId !== id) continue
    if (entry.ws?.readyState === WebSocket.OPEN) {
      try { entry.ws.send(msg) } catch (_) {}
    }
  }
}

// Set brightness directly on a PB
function setBrightness(brightness, id = null) {
  const msg = JSON.stringify({ setBrightness: brightness })
  for (const [entryId, entry] of state.pixelblazes.entries()) {
    if (id && entryId !== id) continue
    if (entry.ws?.readyState === WebSocket.OPEN) {
      try { entry.ws.send(msg) } catch (_) {}
    }
  }
}

module.exports = { connect, broadcast, setProgram, setBrightness }
