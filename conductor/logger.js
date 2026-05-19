'use strict'

const MAX_LINES = 200
const buf = []

function stamp() {
  return new Date().toISOString().replace('T',' ').slice(0,23)
}

function push(level, args) {
  const line = `[${stamp()}] [${level}] ${args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ')}`
  buf.push(line)
  if (buf.length > MAX_LINES) buf.shift()
  return line
}

// Patch console so all Conductor output lands in the buffer too
const _log   = console.log.bind(console)
const _warn  = console.warn.bind(console)
const _error = console.error.bind(console)

console.log   = (...a) => { _log(push('INFO',  a)) }
console.warn  = (...a) => { _warn(push('WARN',  a)) }
console.error = (...a) => { _error(push('ERROR', a)) }

function getLogs(n = 100) {
  return buf.slice(-n)
}

module.exports = { getLogs }
