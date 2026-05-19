'use strict'

const osc = require('osc')
const { state } = require('./state')

let udp = null

function start(port = 9000) {
  udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: port })

  udp.on('message', (msg) => {
    const addr = msg.address

    if (addr === '/beat') {
      state.bpm = msg.args[0] ?? state.bpm
      state.beatAnchorMs = Date.now()
      state.lastBltMs = Date.now()
      if (!state.modeLocked && state.mode !== 'panic') state.mode = 'live'
      state.downbeat = 0
      console.log(`[osc] beat  bpm=${state.bpm.toFixed(1)}`)
    }

    if (addr === '/bar') {
      state.bar = msg.args[0] ?? state.bar
      if (state.bar === 1) state.downbeat = 1
    }

    if (addr === '/bpm') {
      state.bpm = msg.args[0] ?? state.bpm
      state.lastBltMs = Date.now()
    }

    if (addr === '/track/changed') {
      const title  = msg.args[0] ?? ''
      const artist = msg.args[1] ?? ''
      const player = msg.args[2] ?? 0
      state.nowPlaying = { title, artist, player }
      console.log(`[osc] track  player=${player}  "${artist} — ${title}"`)
    }

    if (addr === '/energy') {
      state.energy = Math.max(0, Math.min(1, msg.args[0] ?? 0))
    }
  })

  udp.on('error', (err) => {
    console.error('[osc] error', err.message)
  })

  udp.open()
  console.log(`[osc] listening on UDP :${port}`)
}

function stop() {
  udp?.close()
}

module.exports = { start, stop }
