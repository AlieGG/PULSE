'use strict'

const http = require('http')
const { state } = require('./state')

let baseUrl = 'http://localhost:5826'

function setBaseUrl(url) { baseUrl = url }

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL(path, baseUrl)
    const req = http.request(
      { hostname: url.hostname, port: url.port || 80, path: url.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let body = ''
        res.on('data', d => body += d)
        res.on('end', () => {
          state.firestormUp = true
          resolve(JSON.parse(body || 'null'))
        })
      }
    )
    req.on('error', (err) => {
      state.firestormUp = false
      reject(err)
    })
    req.write(data)
    req.end()
  })
}

async function setActivePattern(programName) {
  try {
    await post('/set/activeProgram', { name: programName })
    console.log(`[firestorm] pattern → ${programName}`)
  } catch (e) {
    console.warn(`[firestorm] unreachable: ${e.message}`)
  }
}

async function setGlobalBrightness(value) {
  try {
    await post('/set/brightness', { brightness: value })
  } catch (_) {}
}

module.exports = { setBaseUrl, setActivePattern, setGlobalBrightness }
