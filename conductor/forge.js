'use strict'

const Anthropic = require('@anthropic-ai/sdk')

let client = null

function getClient() {
  if (!client) {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) throw new Error('ANTHROPIC_API_KEY not set')
    client = new Anthropic({ apiKey: key })
  }
  return client
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(zone) {
  return `You are generating code for the Pixelblaze LED controller running the PULSE protocol.

LANGUAGE RULES (Pixelblaze subset — strict):
- All numbers are 16.16 fixed-point. No integer vs float distinction.
- No closures, no arrow functions, no object literals, no arrays, no classes.
- No \`let\`, \`const\`, or \`switch\`. Use \`var\` only.
- No \`import\`. No \`export default\`.
- \`export var\` declares parameters readable/writable by the Conductor.
- \`beforeRender(delta)\` runs once per frame (delta = ms since last frame).
- \`render(i)\` runs per pixel for 1D strips.
- \`render2D(i, x, y)\` runs per pixel for 2D matrices (x,y are 0..1).
- \`render3D(i, x, y, z)\` for 3D volumes.
- Available built-ins: time(interval), wave(v), square(v,duty), triangle(v),
  sin, cos, tan, sqrt, abs, min, max, floor, ceil, round, pow, random(n),
  noise(x,y,z), hsv(h,s,v), rgb(r,g,b), resetTransform, translate, rotate, scale.
- \`time(interval)\` returns 0..1 cycling every \`interval\` seconds.
- \`wave(v)\` = (sin(v*2π)+1)/2, output 0..1.
- pixelCount is a global giving the strip/matrix length.

PULSE PROTOCOL CONTRACT (every pattern MUST follow):
1. Declare ALL of these with \`export var\`:
   bpm = 128, beatAnchorMs = 0, bar = 0, downbeat = 0, energy = 0, mode = 1,
   masterBrightness = 1, hueOffset = 0, strobeRate = 1, beatDivider = 1, killActive = 0
2. In beforeRender, compute beatPhase from bpm and beatAnchorMs:
   var nowMs = time(0.015259) * 65536
   var interval = 60000 / (bpm * beatDivider)
   beatPhase = ((nowMs - beatAnchorMs) % interval) / interval
3. In render(), the FIRST statement must be:
   if (killActive) { rgb(0,0,0); return }
4. Multiply the final brightness value by masterBrightness before any hsv/rgb call.
5. Apply hueOffset to any hue calculation: h = (myHue + hueOffset) % 1

TARGET ZONE:
- ID: ${zone.id}
- Geometry: ${zone.geometry} ${zone.rows ? `(${zone.rows}×${zone.cols})` : ''}
- Pixel count: ${zone.pixelCount}
${zone.physicalLength ? `- Physical length: ${zone.physicalLength}` : ''}

OUTPUT FORMAT:
Output ONLY the Pixelblaze code. No prose. No markdown fences. No comments except a brief one-line header comment with the pattern name and generation date.`
}

// ── Generation ────────────────────────────────────────────────────────────────

async function generate({ prompt, zone, history = [], catalog = [] }) {
  const anthropic = getClient()

  const systemPrompt = buildSystemPrompt(zone)

  // Build few-shot examples from catalog (first 3 by tag similarity, or just first 3)
  let examples = ''
  if (catalog.length > 0) {
    const sample = catalog.slice(0, 3)
    examples = '\n\nREFERENCE PATTERNS (style reference only — do not copy verbatim):\n' +
      sample.map(p => `// ${p.name}\n${p.code}`).join('\n\n---\n\n')
  }

  // Conversation messages
  const messages = []

  // Previous turns
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content })
  }

  // Current user prompt
  messages.push({ role: 'user', content: prompt + examples })

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 2048,
    system:     systemPrompt,
    messages,
  })

  const code = response.content[0]?.text?.trim() ?? ''
  return { code, usage: response.usage }
}

// ── Fix retry ─────────────────────────────────────────────────────────────────

async function fix({ code, issues, zone, history = [] }) {
  const anthropic = getClient()
  const fixPrompt = 'The pattern has these problems. Fix ALL of them. Output only the corrected code:\n' +
    issues.filter(i => i.severity === 'error').map(i => `- [${i.rule}] line ${i.line}: ${i.msg}`).join('\n')

  const messages = [
    ...history,
    { role: 'assistant', content: code },
    { role: 'user',      content: fixPrompt },
  ]

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 2048,
    system:     buildSystemPrompt(zone),
    messages,
  })

  return { code: response.content[0]?.text?.trim() ?? '', usage: response.usage }
}

// ── Express route handler ─────────────────────────────────────────────────────

function registerRoutes(app) {
  const { validate, issuesToFixPrompt } = require('../public/js/validator')

  // Generate a pattern (with auto-retry on validation failure)
  app.post('/api/forge/generate', async (req, res) => {
    const { prompt, zone, history, catalog } = req.body
    if (!prompt || !zone) return res.status(400).json({ error: 'prompt and zone required' })

    try {
      let { code, usage } = await generate({ prompt, zone, history, catalog })
      let issues = validate(code, zone.geometry)
      let attempts = 1

      // Auto-retry up to 2 times if there are errors
      while (issues.some(i => i.severity === 'error') && attempts < 3) {
        console.log(`[forge] validation failed (attempt ${attempts}) — retrying fix`)
        const result = await fix({ code, issues, zone, history })
        code   = result.code
        issues = validate(code, zone.geometry)
        attempts++
      }

      res.json({ code, issues, attempts })
    } catch (e) {
      console.error('[forge] error', e.message)
      res.status(500).json({ error: e.message })
    }
  })

  // Generate 4 variants in parallel
  app.post('/api/forge/variants', async (req, res) => {
    const { prompt, zone, catalog } = req.body
    if (!prompt || !zone) return res.status(400).json({ error: 'prompt and zone required' })

    const variants = ['A', 'B', 'C', 'D']
    const modifiers = [
      '',
      ' (more contrast, sharper beats)',
      ' (alternate color palette, cooler tones)',
      ' (slower, more fluid motion)',
    ]

    try {
      const results = await Promise.all(
        variants.map(async (label, i) => {
          const augmented = prompt + modifiers[i]
          let { code } = await generate({ prompt: augmented, zone, catalog })
          const issues = validate(code, zone.geometry)
          return { label, code, issues }
        })
      )
      res.json(results)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })
}

module.exports = { registerRoutes, generate, fix }
