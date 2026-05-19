/**
 * Transpiles Pixelblaze source to safe browser JavaScript.
 *
 * Key transforms:
 *   export var foo = val   →  rt.foo = val   (and stored as a pattern var)
 *   export function fn()   →  rt._exports.fn = function()  (for beforeRender/render)
 *   All built-in calls (hsv, wave, time…)  →  rt.hsv(…)
 *
 * Strategy: string-replacement rather than full AST rewrite — fast enough,
 * handles the small PB subset, avoids a heavy code-generation dependency in browser.
 */
function transpile(source) {
  let out = source

  // 1. export var <name> = <val>  →  rt.<name> = <val>
  //    We also collect these names so the simulator can expose them.
  const exportedVars = []
  out = out.replace(/\bexport\s+var\s+(\w+)/g, (_, name) => {
    exportedVars.push(name)
    return `rt.${name}`
  })

  // 2. export function <name>(…) { … }  →  rt._exports.<name> = function(…) { … }
  out = out.replace(/\bexport\s+function\s+(\w+)/g, (_, name) => {
    return `rt._exports.${name} = function`
  })

  // 3. Bare function declarations for beforeRender / render / render2D / render3D
  //    that didn't have `export` — treat them as exported too
  out = out.replace(/^function\s+(beforeRender|render|render2D|render3D)\b/gm, (_, name) => {
    return `rt._exports.${name} = function`
  })

  // 4. Built-in function calls → rt.builtIn(…)
  //    Only replace identifiers that are standalone calls, not property accesses.
  const builtins = [
    'time','wave','square','triangle','sin','cos','tan','asin','acos','atan2',
    'sqrt','abs','min','max','floor','ceil','round','pow','log','exp','clamp',
    'random','randomFloat','noise','hsv','rgb','hsl',
    'resetTransform','translate','rotate','scale',
  ]
  // Build a regex that matches `<builtin>(` not preceded by a `.` (i.e., not already rt.foo)
  const builtinRe = new RegExp(`(?<![.\\w])(${builtins.join('|')})(?=\\s*\\()`, 'g')
  out = out.replace(builtinRe, (_, name) => `rt.${name}`)

  // 5. `pixelCount` bare reference → rt.pixelCount
  out = out.replace(/(?<![.\w])pixelCount(?!\s*=)/g, 'rt.pixelCount')

  // 6. Exported var references in the body (reads/writes) → rt.<name>
  //    Do this after the previous steps to avoid double-replacing.
  for (const name of exportedVars) {
    // Skip: already prefixed with rt., skip lhs of `rt.name =`
    const re = new RegExp(`(?<![.\\w])${name}(?![\\w])`, 'g')
    out = out.replace(re, `rt.${name}`)
  }

  return { code: out, exportedVars }
}

if (typeof module !== 'undefined') module.exports = { transpile }
