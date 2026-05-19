/**
 * PULSE Bug Reporter
 * Drop <script src="/js/bugreport.js"></script> into any page.
 * Call PulseBugReporter.open({ code, issues }) to open with context pre-filled.
 */
;(function () {
  'use strict'

  // ── Styles ──────────────────────────────────────────────────────────────────
  const CSS = `
#pulse-bug-btn {
  position: fixed; bottom: 1rem; right: 1rem; z-index: 900;
  background: #161d25; border: 1px solid #2c3a4a;
  color: #525d6c; font-family: 'JetBrains Mono', monospace;
  font-size: 10px; letter-spacing: .12em; text-transform: uppercase;
  padding: .4rem .75rem; border-radius: 4px; cursor: pointer;
  transition: all .15s;
}
#pulse-bug-btn:hover { border-color: #ff4d5e; color: #ff4d5e; }

#pulse-bug-overlay {
  display: none; position: fixed; inset: 0; z-index: 1000;
  background: rgba(6,8,10,.8); backdrop-filter: blur(4px);
  align-items: center; justify-content: center;
}
#pulse-bug-overlay.open { display: flex; }

#pulse-bug-modal {
  width: min(680px, 95vw); max-height: 90vh;
  background: #11161c; border: 1px solid #2c3a4a;
  border-radius: 10px; display: flex; flex-direction: column;
  overflow: hidden; box-shadow: 0 32px 80px rgba(0,0,0,.7);
}
#pulse-bug-header {
  padding: .75rem 1rem; background: #161d25;
  border-bottom: 1px solid #1f2a36;
  display: flex; align-items: center; justify-content: space-between;
  font-family: 'JetBrains Mono', monospace; font-size: 11px;
  letter-spacing: .15em; text-transform: uppercase; color: #ff4d5e;
}
#pulse-bug-close {
  background: none; border: none; color: #525d6c;
  font-size: 1.1rem; cursor: pointer; line-height: 1;
}
#pulse-bug-close:hover { color: #d8dde3; }

#pulse-bug-body { padding: 1rem; display: flex; flex-direction: column; gap: .75rem; overflow-y: auto; flex: 1; }

#pulse-bug-desc {
  width: 100%; background: #161d25; border: 1px solid #1f2a36;
  color: #d8dde3; font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: 13px; padding: .65rem .85rem; border-radius: 4px;
  resize: vertical; min-height: 80px; line-height: 1.5;
}
#pulse-bug-desc:focus { outline: none; border-color: #ff4d5e; }

.bug-section-label {
  font-family: 'JetBrains Mono', monospace; font-size: 9px;
  letter-spacing: .18em; text-transform: uppercase; color: #525d6c;
  margin-bottom: .25rem;
}

#pulse-bug-screenshot-wrap {
  border: 1px solid #1f2a36; border-radius: 4px; overflow: hidden;
  background: #06080a; max-height: 160px;
}
#pulse-bug-screenshot-wrap img { width: 100%; display: block; }
#pulse-bug-screenshot-wrap .no-shot {
  padding: .6rem .85rem; font-family: 'JetBrains Mono', monospace;
  font-size: 10px; color: #525d6c;
}

#pulse-bug-context {
  background: #0a0e12; border: 1px solid #1f2a36; border-radius: 4px;
  padding: .6rem .85rem; font-family: 'JetBrains Mono', monospace;
  font-size: 10px; color: #8b95a3; line-height: 1.6;
  max-height: 120px; overflow-y: auto; white-space: pre-wrap;
}

#pulse-bug-footer {
  padding: .75rem 1rem; border-top: 1px solid #1f2a36;
  background: #161d25; display: flex; align-items: center; gap: .75rem;
}
#pulse-bug-submit {
  background: linear-gradient(135deg, #ff4d5e, #cc2233);
  border: none; padding: .5rem 1.1rem; border-radius: 4px;
  color: #fff; font-family: 'JetBrains Mono', monospace;
  font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
  font-weight: 700; cursor: pointer;
}
#pulse-bug-submit:disabled { opacity: .4; cursor: not-allowed; }
#pulse-bug-submit-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #8b95a3; }

#pulse-bug-diagnosis {
  display: none; padding: 1rem; background: #0a0e12;
  border-top: 1px solid #1f2a36; overflow-y: auto;
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: 13px; line-height: 1.65; color: #d8dde3;
  max-height: 300px;
}
#pulse-bug-diagnosis.open { display: block; }
#pulse-bug-diagnosis h2, #pulse-bug-diagnosis h3 {
  font-family: 'JetBrains Mono', monospace; font-size: 11px;
  letter-spacing: .1em; text-transform: uppercase;
  color: #ff4d5e; margin: .75rem 0 .35rem;
}
#pulse-bug-diagnosis code {
  font-family: 'JetBrains Mono', monospace; font-size: 11px;
  background: #161d25; padding: 1px 5px; border-radius: 3px; color: #00e1ff;
}
#pulse-bug-diagnosis pre {
  background: #161d25; border: 1px solid #1f2a36; border-radius: 4px;
  padding: .75rem; overflow-x: auto; font-family: 'JetBrains Mono', monospace;
  font-size: 11px; line-height: 1.55; margin: .5rem 0;
}
#pulse-bug-diagnosis strong { color: #fff; }
#pulse-bug-diagnosis p { margin-bottom: .6rem; }
`

  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)

  // ── DOM ──────────────────────────────────────────────────────────────────────
  document.body.insertAdjacentHTML('beforeend', `
<button id="pulse-bug-btn">⚠ Report Bug</button>

<div id="pulse-bug-overlay">
  <div id="pulse-bug-modal">
    <div id="pulse-bug-header">
      Bug Report
      <button id="pulse-bug-close">✕</button>
    </div>
    <div id="pulse-bug-body">
      <div>
        <div class="bug-section-label">Describe the bug</div>
        <textarea id="pulse-bug-desc" placeholder="What went wrong? What did you expect?"></textarea>
      </div>
      <div>
        <div class="bug-section-label">Screenshot</div>
        <div id="pulse-bug-screenshot-wrap"><div class="no-shot">Capturing…</div></div>
      </div>
      <div>
        <div class="bug-section-label">Auto-collected context</div>
        <div id="pulse-bug-context">Loading…</div>
      </div>
    </div>
    <div id="pulse-bug-diagnosis"></div>
    <div id="pulse-bug-footer">
      <button id="pulse-bug-submit">Send to Claude</button>
      <span id="pulse-bug-submit-label"></span>
    </div>
  </div>
</div>
`)

  // ── Screenshot via html2canvas (loaded on demand) ─────────────────────────
  let screenshotDataUrl = null

  function loadHtml2Canvas() {
    return new Promise((resolve) => {
      if (window.html2canvas) return resolve(window.html2canvas)
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'
      s.onload = () => resolve(window.html2canvas)
      s.onerror = () => resolve(null)
      document.head.appendChild(s)
    })
  }

  async function captureScreenshot() {
    const wrap = document.getElementById('pulse-bug-screenshot-wrap')
    wrap.innerHTML = '<div class="no-shot">Capturing screenshot…</div>'

    // First try: grab sim-canvas directly (best quality for PULSEFORGE)
    const simCanvas = document.getElementById('sim-canvas')
    if (simCanvas) {
      try {
        screenshotDataUrl = simCanvas.toDataURL('image/png')
        const img = document.createElement('img')
        img.src = screenshotDataUrl
        wrap.innerHTML = ''
        wrap.appendChild(img)
        return
      } catch (_) {}
    }

    // Fallback: html2canvas of whole page
    try {
      const h2c = await loadHtml2Canvas()
      if (!h2c) throw new Error('unavailable')
      const canvas = await h2c(document.body, {
        scale: 0.5, useCORS: true, logging: false,
        ignoreElements: el => el.id === 'pulse-bug-overlay'
      })
      screenshotDataUrl = canvas.toDataURL('image/png')
      const img = document.createElement('img')
      img.src = screenshotDataUrl
      wrap.innerHTML = ''
      wrap.appendChild(img)
    } catch (_) {
      wrap.innerHTML = '<div class="no-shot">Screenshot unavailable</div>'
      screenshotDataUrl = null
    }
  }

  // ── Context collection ────────────────────────────────────────────────────
  async function collectContext() {
    const lines = []
    try {
      const health = await fetch('/healthz').then(r => r.json())
      lines.push(`Mode: ${health.mode}  BPM: ${health.bpm}  PBs: ${health.pbCount}/${health.pbTotal}  Kill: ${health.killActive}`)
      if (health.activeScene) lines.push(`Active scene: ${health.activeScene}`)
    } catch (_) { lines.push('Conductor: unreachable') }

    try {
      const logs = await fetch('/api/logs').then(r => r.json())
      lines.push('')
      lines.push('--- recent logs ---')
      lines.push(...logs.slice(-20))
    } catch (_) {}

    document.getElementById('pulse-bug-context').textContent = lines.join('\n')
    return lines.join('\n')
  }

  // ── Open / close ──────────────────────────────────────────────────────────
  let _ctx = { code: null, issues: null }

  function open(ctx = {}) {
    _ctx = ctx
    screenshotDataUrl = null
    document.getElementById('pulse-bug-desc').value = ''
    document.getElementById('pulse-bug-submit-label').textContent = ''
    document.getElementById('pulse-bug-diagnosis').className = ''
    document.getElementById('pulse-bug-diagnosis').innerHTML = ''
    document.getElementById('pulse-bug-submit').disabled = false
    document.getElementById('pulse-bug-overlay').classList.add('open')
    document.getElementById('pulse-bug-desc').focus()

    // Async: capture screenshot + context in parallel
    captureScreenshot()
    collectContext()
  }

  function close() {
    document.getElementById('pulse-bug-overlay').classList.remove('open')
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function submit() {
    const desc = document.getElementById('pulse-bug-desc').value.trim()
    if (!desc) { document.getElementById('pulse-bug-desc').focus(); return }

    const btn   = document.getElementById('pulse-bug-submit')
    const label = document.getElementById('pulse-bug-submit-label')
    btn.disabled = true
    label.textContent = 'Sending…'

    const diagEl = document.getElementById('pulse-bug-diagnosis')
    diagEl.className = 'open'
    diagEl.innerHTML = '<p style="color:#525d6c;font-family:\'JetBrains Mono\',monospace;font-size:10px">Asking Claude…</p>'

    try {
      const resp = await fetch('/api/bugreport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: desc,
          page: location.pathname,
          code:   _ctx.code   ?? null,
          issues: _ctx.issues ?? null,
          screenshot: screenshotDataUrl,
        })
      })

      const body = await resp.json()
      if (body.error) throw new Error(body.error)

      diagEl.innerHTML = '<p style="color:#8b95a3;font-family:\'JetBrains Mono\',monospace;font-size:10px">Report logged. It will be reviewed and addressed in the next session.</p>'
      label.textContent = 'Logged ✓'
    } catch (e) {
      diagEl.innerHTML = `<p style="color:#ff4d5e">${e.message}</p>`
      label.textContent = 'Failed'
      btn.disabled = false
    }
  }

  // ── Wire ──────────────────────────────────────────────────────────────────
  document.getElementById('pulse-bug-btn').addEventListener('click',   () => open())
  document.getElementById('pulse-bug-close').addEventListener('click', close)
  document.getElementById('pulse-bug-submit').addEventListener('click', submit)
  document.getElementById('pulse-bug-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('pulse-bug-overlay')) close()
  })

  window.PulseBugReporter = { open, close }
})()
