/**
 * PULSE Pattern Validator — runs in both Node.js and the browser.
 * Parses Pixelblaze source with acorn, then runs the P001-P012 rule set.
 */
;(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    // Node — acorn is a real dependency
    module.exports = factory(require('acorn'))
  } else {
    // Browser — acorn loaded via <script> as window.acorn
    root.PulseValidator = factory(root.acorn)
  }
}(typeof self !== 'undefined' ? self : this, function (acorn) {
  'use strict'

  const REQUIRED_EXPORTS = ['bpm','beatAnchorMs','bar','masterBrightness','hueOffset','killActive']
  const FORBIDDEN        = ['let','const','switch','class','import','export default']
  const PB_MAX_BYTES     = 8192   // conservative Pixelblaze program memory limit
  const WARN_BYTES       = Math.round(PB_MAX_BYTES * 0.6)

  // ── helpers ─────────────────────────────────────────────────────────────────

  function findAll(ast, type) {
    const results = []
    walk(ast, node => { if (node.type === type) results.push(node) })
    return results
  }

  function walk(node, visit) {
    if (!node || typeof node !== 'object') return
    visit(node)
    for (const key of Object.keys(node)) {
      const child = node[key]
      if (Array.isArray(child)) child.forEach(c => walk(c, visit))
      else if (child && typeof child === 'object' && child.type) walk(child, visit)
    }
  }

  function srcLines(source) { return source.split('\n') }

  function lineOf(node) { return node?.loc?.start?.line ?? 0 }

  // ── rule implementations ────────────────────────────────────────────────────

  // Strip `export` keyword so acorn parses PB source in script mode.
  // All contract checks use regex on the original source; AST checks use the stripped version.
  function stripExports(source) {
    return source.replace(/\bexport\s+(var|function)\b/g, '$1')
  }

  function ruleP001(source) {
    // Syntax — parse fails
    try {
      acorn.parse(stripExports(source), { ecmaVersion: 2020, sourceType: 'script', locations: true })
      return []
    } catch (e) {
      return [{ rule:'P001', severity:'error', msg: e.message, line: e.loc?.line ?? 1 }]
    }
  }

  function ruleP002(ast, source) {
    // Required exported vars must all be present
    const declared = new Set()
    walk(ast, node => {
      // `export var foo = ...` transpiles in PB as just `var foo = ...` with special prefix
      // PB uses: export var foo = val
      if (node.type === 'ExpressionStatement' && node.expression?.type === 'AssignmentExpression') return
      // Detect: identifier names in VariableDeclarations preceded by 'export' keyword in source
    })
    // Simpler: grep source for `export var <name>`
    for (const name of REQUIRED_EXPORTS) {
      const re = new RegExp(`export\\s+var\\s+${name}\\b`)
      if (!re.test(source)) {
        declared.add(name)
      }
    }
    return [...declared].map(name => ({
      rule:'P002', severity:'error',
      msg: `Missing required export: \`export var ${name}\``, line: 1
    }))
  }

  function ruleP003(ast, source) {
    // kill switch — render() must read killActive before any rgb/hsv call
    // Find render function body — handles both declaration and assignment forms:
    //   function render(i) { ... }
    //   render = function(i) { ... }   (common in PB patterns)
    const fns = findAll(ast, 'FunctionDeclaration').concat(findAll(ast, 'FunctionExpression'))
    let renderFn = fns.find(fn => fn.id?.name === 'render' || fn.id?.name === 'render2D' || fn.id?.name === 'render3D')

    if (!renderFn) {
      // Try assignment form: render = function(...) or render2D = function(...)
      const assignments = findAll(ast, 'AssignmentExpression')
      for (const assign of assignments) {
        const name = assign.left?.name
        if ((name === 'render' || name === 'render2D' || name === 'render3D') &&
            (assign.right?.type === 'FunctionExpression' || assign.right?.type === 'ArrowFunctionExpression')) {
          renderFn = assign.right
          break
        }
      }
    }

    if (!renderFn) return [{ rule:'P003', severity:'error', msg:'No render() function found', line:1 }]

    const body = renderFn.body?.body ?? []
    if (!body.length) return [{ rule:'P003', severity:'error', msg:'render() is empty', line:lineOf(renderFn) }]

    // First statement should be an if(killActive) check
    const first = body[0]
    let hasKill = false
    walk(first, node => {
      if (node.type === 'Identifier' && node.name === 'killActive') hasKill = true
    })
    if (!hasKill) {
      return [{ rule:'P003', severity:'error', msg:'render() must check killActive in its first statement before any rgb/hsv call', line:lineOf(first) }]
    }
    return []
  }

  function ruleP004(ast, source) {
    // masterBrightness must be multiplied into the final brightness value
    if (!source.includes('masterBrightness')) {
      return [{ rule:'P004', severity:'error', msg:'masterBrightness is never used — multiply final brightness by masterBrightness', line:1 }]
    }
    // Check it's actually in a multiplication context (not just declared)
    const usages = []
    walk(ast, node => {
      if (node.type === 'BinaryExpression' && node.operator === '*') {
        walk(node, inner => {
          if (inner.type === 'Identifier' && inner.name === 'masterBrightness') usages.push(inner)
        })
      }
    })
    if (!usages.length) {
      return [{ rule:'P004', severity:'error', msg:'masterBrightness is declared but never multiplied into a color value', line:1 }]
    }
    return []
  }

  function ruleP005(ast, source, zoneGeometry) {
    // Geometry match: 2D zone → must use render2D; 1D zone → must not use render2D/render3D
    if (!zoneGeometry) return []
    const is2D = zoneGeometry === '2d' || zoneGeometry === '2D'
    const is3D = zoneGeometry === '3d' || zoneGeometry === '3D'

    const has2D = /render2D/.test(source)
    const has3D = /render3D/.test(source)

    if (is2D && !has2D) return [{ rule:'P005', severity:'error', msg:'2D zone requires render2D(i, x, y)', line:1 }]
    if (is3D && !has3D) return [{ rule:'P005', severity:'error', msg:'3D zone requires render3D(i, x, y, z)', line:1 }]
    if (!is2D && !is3D && has2D) return [{ rule:'P005', severity:'error', msg:'render2D used on a 1D zone', line:1 }]
    return []
  }

  function ruleP006(ast, source) {
    // Forbidden language constructs
    const issues = []
    const lines  = srcLines(source)
    for (const kw of FORBIDDEN) {
      const re = new RegExp(`\\b${kw}\\b`)
      lines.forEach((line, i) => {
        if (re.test(line) && !line.trimStart().startsWith('//')) {
          issues.push({ rule:'P006', severity:'error', msg:`Forbidden construct: \`${kw}\` is not in the Pixelblaze language subset`, line:i+1 })
        }
      })
    }
    // Closures: arrow functions or nested function expressions
    findAll(ast, 'ArrowFunctionExpression').forEach(node => {
      issues.push({ rule:'P006', severity:'error', msg:'Arrow functions (closures) are not supported', line:lineOf(node) })
    })
    return issues
  }

  function ruleP007(source) {
    // Code size warning
    const bytes = new TextEncoder().encode(source).length
    if (bytes > PB_MAX_BYTES) return [{ rule:'P007', severity:'error', msg:`Pattern is ${bytes}B — exceeds ${PB_MAX_BYTES}B device limit`, line:1 }]
    if (bytes > WARN_BYTES)   return [{ rule:'P007', severity:'warn',  msg:`Pattern is ${bytes}B / ${WARN_BYTES}B warn threshold (${PB_MAX_BYTES}B limit)`, line:1, meta:{ bytes, limit:PB_MAX_BYTES } }]
    return []
  }

  function ruleP008(ast) {
    // Unbounded while loops
    return findAll(ast, 'WhileStatement').map(node => ({
      rule:'P008', severity:'warn', msg:'while loop without obvious termination — may stall device', line:lineOf(node)
    }))
  }

  function ruleP009(ast) {
    // render() complexity — count nodes inside render body as a proxy
    const fns = findAll(ast, 'FunctionDeclaration').concat(findAll(ast, 'FunctionExpression'))
    const renderFn = fns.find(fn => fn.id?.name === 'render' || fn.id?.name === 'render2D' || fn.id?.name === 'render3D')
    if (!renderFn) return []
    let count = 0
    walk(renderFn, () => count++)
    if (count > 200) return [{ rule:'P009', severity:'warn', msg:`render() has ${count} AST nodes — may struggle to maintain 100fps`, line:lineOf(renderFn) }]
    return []
  }

  function ruleP010(ast, source) {
    // hueOffset declared but unused
    if (/export\s+var\s+hueOffset/.test(source) && !source.includes('hueOffset')) return []
    // Check it's actually used somewhere beyond its own declaration
    const usages = []
    walk(ast, node => {
      if (node.type === 'Identifier' && node.name === 'hueOffset') usages.push(node)
    })
    if (usages.length <= 1) { // only the export var declaration
      return [{ rule:'P010', severity:'warn', msg:'hueOffset is declared but not used in color calculation', line:1 }]
    }
    return []
  }

  function ruleP011(source) {
    // Rest mode — pattern has no low-energy fallback
    if (!source.includes('energy') || !source.includes('0.05')) {
      return [{ rule:'P011', severity:'warn', msg:'No rest-mode fallback (check energy < 0.05 for calm idle state)', line:1 }]
    }
    return []
  }

  function ruleP012(ast) {
    // Division that could overflow 16.16 fixed-point (value > 32767)
    const issues = []
    findAll(ast, 'BinaryExpression').forEach(node => {
      if (node.operator === '/') {
        // Flag division by literals close to 0 (common cause of overflow)
        if (node.right?.type === 'Literal' && Math.abs(node.right.value) < 0.001 && node.right.value !== 0) {
          issues.push({ rule:'P012', severity:'warn', msg:'Division by very small literal — possible 16.16 fixed-point overflow', line:lineOf(node) })
        }
      }
    })
    return issues
  }

  // ── public API ───────────────────────────────────────────────────────────────

  function validate(source, zoneGeometry) {
    const syntaxIssues = ruleP001(source)
    if (syntaxIssues.length) return syntaxIssues   // can't parse → stop here

    const ast = acorn.parse(stripExports(source), { ecmaVersion: 2020, sourceType: 'script', locations: true })

    return [
      ...ruleP002(ast, source),
      ...ruleP003(ast, source),
      ...ruleP004(ast, source),
      ...ruleP005(ast, source, zoneGeometry),
      ...ruleP006(ast, source),
      ...ruleP007(source),
      ...ruleP008(ast),
      ...ruleP009(ast),
      ...ruleP010(ast, source),
      ...ruleP011(source),
      ...ruleP012(ast),
    ]
  }

  function issuesToFixPrompt(issues) {
    const errors = issues.filter(i => i.severity === 'error')
    if (!errors.length) return null
    return 'The pattern has these problems. Fix ALL of them:\n' +
      errors.map(i => `- [${i.rule}] line ${i.line}: ${i.msg}`).join('\n')
  }

  function codeSize(source) {
    try { return new TextEncoder().encode(source).length } catch { return source.length }
  }

  return { validate, issuesToFixPrompt, codeSize, REQUIRED_EXPORTS }
}))
