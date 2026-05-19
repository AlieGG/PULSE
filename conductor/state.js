'use strict'

// Central mutable state — single object, mutated in place.
// Everything in the Conductor reads from here; nothing owns its own copy.

const state = {
  // Beat
  bpm: 128,
  beatAnchorMs: Date.now(),
  bar: 0,
  downbeat: 0,

  // Audio energy (sensor mode)
  energy: 0,

  // Mode: 'live' | 'sensor' | 'freerun' | 'panic'
  mode: 'freerun',
  // When true, automatic mode transitions (watchdog, beat generator) are suppressed
  modeLocked: false,

  // PULSEDECK operator controls
  masterBrightness: 1,
  hueOffset: 0,
  strobeRate: 1,
  beatDivider: 1,
  killActive: 0,

  // Active scene ID
  activeScene: null,

  // Timestamp of last BLT beat packet (ms)
  lastBltMs: 0,

  // Connected Pixelblazes: Map<id, { ip, ws, online }>
  pixelblazes: new Map(),

  // Firestorm status
  firestormUp: false,
}

function modeNum(mode) {
  return { live: 1, sensor: 2, freerun: 3, panic: 0 }[mode] ?? 3
}

// Flat object sent to PBs as setVars on every heartbeat
function varsPayload() {
  return {
    bpm:              state.bpm,
    beatAnchorMs:     state.beatAnchorMs,
    bar:              state.bar,
    downbeat:         state.downbeat,
    energy:           state.energy,
    mode:             modeNum(state.mode),
    masterBrightness: state.masterBrightness,
    hueOffset:        state.hueOffset,
    strobeRate:       state.strobeRate,
    beatDivider:      state.beatDivider,
    killActive:       state.killActive,
  }
}

// Snapshot for PULSEDECK status polls
function statusSnapshot() {
  const pbs = [...state.pixelblazes.values()]
  return {
    mode:             state.mode,
    bpm:              state.bpm,
    bar:              state.bar,
    masterBrightness: state.masterBrightness,
    hueOffset:        state.hueOffset,
    strobeRate:       state.strobeRate,
    beatDivider:      state.beatDivider,
    killActive:       state.killActive,
    activeScene:      state.activeScene,
    firestormUp:      state.firestormUp,
    pbCount:          pbs.filter(p => p.online).length,
    pbTotal:          pbs.length,
    nowPlaying:       state.nowPlaying ?? null,
  }
}

module.exports = { state, modeNum, varsPayload, statusSnapshot }
