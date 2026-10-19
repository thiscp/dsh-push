/**
 * openspec-modify-check.mjs — verify a change's MODIFIED/REMOVED deltas keep every baseline scenario.
 *
 *   node tools/openspec-modify-check.mjs <change-name>
 *
 * `openspec archive` refuses a MODIFIED block that drops one of the baseline requirement's scenario
 * titles ("改标题也算删除"). The CLI is not installed on every host, so this reproduces that one
 * check: for each requirement the delta modifies, list the baseline scenario titles and report any
 * that are missing from the delta. Baseline requirement headers must also appear in the delta.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const REQUIRED = /^### Requirement:\s*(.+?)\s*$/
const SCENARIO = /^#### Scenario:\s*(.+?)\s*$/

/** `{requirements: Map<capability, Map<title, string[]>>}` from one spec.md text. */
function parse(text) {
  const out = new Map()
  let requirement
  for (const raw of text.split(/\r?\n/)) {
    const req = REQUIRED.exec(raw)
    if (req !== null) {
      requirement = req[1]
      out.set(requirement, [])
      continue
    }
    const scenario = SCENARIO.exec(raw)
    if (scenario !== null && requirement !== undefined) out.get(requirement).push(scenario[1])
  }
  return out
}

function section(text, kind) {
  const start = text.indexOf('## ' + kind)
  if (start < 0) return undefined
  const rest = text.slice(start)
  const next = rest.slice(1).search(/\n## /)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

const repo = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const change = process.argv[2]
if (change === undefined) {
  console.error('usage: node tools/openspec-modify-check.mjs <change-name>')
  process.exit(2)
}
const changeDir = join(repo, 'openspec', 'changes', change)
if (!existsSync(changeDir)) {
  console.error('no such change: ' + changeDir)
  process.exit(2)
}

let failures = 0
let checked = 0
for (const capability of readdirSync(join(changeDir, 'specs'))) {
  const baselinePath = join(repo, 'openspec', 'specs', capability, 'spec.md')
  const deltaPath = join(changeDir, 'specs', capability, 'spec.md')
  if (!existsSync(baselinePath)) continue
  const delta = readFileSync(deltaPath, 'utf8')
  const baseline = parse(readFileSync(baselinePath, 'utf8'))

  for (const kind of ['## MODIFIED Requirements', '## REMOVED Requirements']) {
    const body = section(delta, kind.slice(3))
    if (body === undefined) continue
    const modified = parse(body)
    for (const [requirement] of modified) {
      // Baseline scenario titles must all still appear in the delta for this requirement
      // (`openspec archive` treats a renamed/removed title as a dropped scenario).
      checked++
      const baselineScenarios = baseline.get(requirement) ?? []
      const deltaScenarios = modified.get(requirement) ?? []
      const missing = baselineScenarios.filter((title) => !deltaScenarios.includes(title))
      if (missing.length > 0) {
        failures++
        console.log('FAIL  ' + capability + ' :: ' + requirement)
        for (const title of missing) console.log('        dropped baseline scenario: ' + title)
      } else {
        console.log('PASS  ' + capability + ' :: ' + requirement + ' (' + String(baselineScenarios.length) + ' baseline scenario(s) kept, ' + String(deltaScenarios.length) + ' in delta)')
      }
    }
  }
}

// ADDED requirements that already exist in the baseline are reported as notes, not failures: a
// change may legitimately ADD a requirement that a *later* change folded into the baseline, which is
// exactly this repository's state for the archived dsh-host-plugin-push change.
for (const capability of readdirSync(join(changeDir, 'specs'))) {
  const baselinePath = join(repo, 'openspec', 'specs', capability, 'spec.md')
  if (!existsSync(baselinePath)) continue
  const delta = readFileSync(join(changeDir, 'specs', capability, 'spec.md'), 'utf8')
  const addedBody = section(delta, 'ADDED Requirements')
  if (addedBody === undefined) continue
  const baseline = parse(readFileSync(baselinePath, 'utf8'))
  for (const requirement of parse(addedBody).keys()) {
    if (baseline.has(requirement)) {
      console.log('NOTE  ' + capability + ' :: ADDED "' + requirement + '" also exists in the baseline (fine if a later change folded it in)')
    }
  }
}

console.log('\n' + String(checked) + ' modified requirement(s) checked, ' + String(failures) + ' problem(s)')
process.exitCode = failures === 0 ? 0 : 1
