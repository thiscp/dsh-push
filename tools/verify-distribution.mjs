#!/usr/bin/env node
/**
 * verify-distribution.mjs — one command that re-proves this package is installable and onboardable.
 *
 *   node tools/verify-distribution.mjs [--profile pushdist] [--keep]
 *
 * Checks, in order (each prints PASS/FAIL and the raw evidence):
 *   1. tarball       — the packed artifact's file list matches the `files` allow-list (packer dry-run)
 *   2. install       — the tarball installs into a fresh DSH profile via `dsh plugin --profile … add`
 *   3. mount         — `dsh --profile … --dump-config` tail shows `- id: push-host` / `name: dsh-push-host`
 *   4. credentials   — the INSTALLED package (not the working tree) resolves relay/topic/tokens from a
 *                      credentials file, proven by the headers and body it sends to a stub relay:
 *                        • full file      → push carries `Bearer <writeToken>`, poll carries `X-Host-Token`
 *                        • file with no host/token → clean no-op (no traffic, no poll scheduled)
 *                        • no file at all → clean no-op, and no `credentials` complaint in the log
 *
 * It never touches the production profiles (`web`, `desktop`), never restarts a host and never
 * publishes anything. The one intrusive step is installing into the named test profile.
 *
 * Env:
 *   DSH_CLI        path to dsh.cmd (default: the Desktop install under D:\programs\dsh)
 *   DSH_NODE       path to node.exe (default: the Desktop runtime's bundled node)
 *   DSH_SCHEMASTERY path to the host-provided @deepseek-ai/schemastery copy (default: this repo's
 *                  host-plugin/node_modules junction — the `dsh-bundle-peer-…` junction is created
 *                  inside the test profile only while this script runs, and removed afterwards)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const repo = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const args = process.argv.slice(2)
const profileIndex = args.indexOf('--profile')
const profile = profileIndex >= 0 ? args[profileIndex + 1] : 'pushdist'
const keep = args.includes('--keep')

const DSH_CLI = process.env.DSH_CLI ?? 'D:\\programs\\dsh\\resources\\runtime\\cli\\bin\\dsh.cmd'
const DSH_NODE =
  process.env.DSH_NODE ?? 'D:\\programs\\dsh\\resources\\runtime\\primary-runtime\\dependencies\\node\\bin\\node.exe'
const PACKAGER = join(repo, 'tools', 'pack-npm-tarball.mjs')
const PLUGIN_DIR = join(repo, 'host-plugin')
const PROFILE_DIR = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', profile)
const PEER_LINK = join(PROFILE_DIR, 'node_modules', '@deepseek-ai', 'schemastery')
const PEER_SOURCE =
  process.env.DSH_SCHEMASTERY ?? join(PLUGIN_DIR, 'node_modules', '@deepseek-ai', 'schemastery')

/** Loads the *installed* package with a stub relay and prints what it sent. */
const PROBE_SOURCE = `const { apply } = await import('file:///' + process.env.DSH_PUSH_PROOF_PLUGIN.replace(/\\\\/g, '/') + '/lib/index.js')
const calls = { register: [], push: [], ack: [], polls: 0, pendingAuth: undefined }
let pendingItems = []
const reply = (status, json) => ({ status, text: async () => JSON.stringify(json) })
globalThis.fetch = async (url, init = {}) => {
  const target = String(url)
  const body = init.body === undefined ? undefined : JSON.parse(init.body)
  if (target.endsWith('/answer/register')) { calls.register.push(body); return reply(200, { ok: true }) }
  if (target.includes('/answer/pending')) { calls.polls++; calls.pendingAuth = init.headers['X-Host-Token']; return reply(200, { ok: true, items: pendingItems }) }
  if (target.endsWith('/answer/ack')) { calls.ack.push(body); return reply(200, { ok: true, removed: 0 }) }
  calls.push.push({ body, headers: init.headers })
  return reply(200, { id: 'x' })
}
const listeners = new Map()
const intervals = []
const agent = { id: 'ag1', session: { id: 's1' } }
const logged = []
const realLog = console.log
console.log = (line) => logged.push(String(line))
apply({
  on: (name, callback) => listeners.set(name, callback),
  effect: () => {},
  interval: (callback, delay) => intervals.push({ callback, delay }),
  logger: () => ({ info: () => {} }),
  get: (name) => (name === 'agents' ? { get: () => agent, roots: () => [agent] } : undefined),
  userQuestions: { answer: () => true },
}, { regToken: 'rt_verify' })
listeners.get('user-questions/request')(
  { questions: [{ id: 'q1', question: 'which?', options: [{ label: 'first' }, { label: 'second' }] }], wait: { callId: 'dist-1', timed: true }, agent },
  () => 'downstream',
)
await new Promise((resolve) => setTimeout(resolve, 80))
if (intervals.length > 0) await intervals[0].callback()
await new Promise((resolve) => setTimeout(resolve, 80))
console.log = realLog
process.stdout.write('PROOF ' + JSON.stringify({
  registerHostId: calls.register[0]?.hostId,
  pushTopic: calls.push[0]?.body?.topic,
  pushAuth: calls.push[0]?.headers?.Authorization,
  pendingAuth: calls.pendingAuth,
  polls: calls.polls,
  ackCount: calls.ack.length,
  scheduled: intervals.length,
  logged,
}))
`

const results = []
const note = (name, ok, detail) => {
  results.push({ name, ok })
  process.stdout.write((ok === true ? 'PASS  ' : 'FAIL  ') + name + '\n        ' + String(detail).split('\n').join('\n        ') + '\n')
}
/** Native runs via execFileSync; `.cmd` needs cmd.exe on Windows (execFileSync cannot spawn a shim). */
const run = (file, argv, options = {}) => {
  const [command, commandArgs] = /\.(?:cmd|bat)$/i.test(file) ? [process.env.ComSpec ?? 'cmd.exe', ['/c', file, ...argv]] : [file, argv]
  return execFileSync(command, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
}

// ── 1. packed artifact matches the manifest's `files` allow-list ─────────────────────────
const dryRun = run(DSH_NODE, [PACKAGER, PLUGIN_DIR, '--json'])
const report = JSON.parse(dryRun)
const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, 'package.json'), 'utf8'))
const packed = report.files.map((file) => file.path)
const expectedAlways = ['package.json', 'README.md', 'LICENSE']
const selfTests = packed.filter((path) => /selftest/i.test(path))

// Every `files` entry contributes nothing but its contents; the essentials must be present and the
// self-tests must be absent.
const hasEssentials = expectedAlways.every((name) => packed.includes(name)) && packed.includes('cordis.patch.yml')
const libFiles = packed.filter((path) => path.startsWith('lib/'))
note(
  '1. packed file list',
  hasEssentials && libFiles.length >= 5 && selfTests.length === 0 && report.warnings.length === 0,
  'files=' + String(packed.length) + ' unpacked=' + String(report.unpackedSize) + 'B\n' +
    packed.join('\n') +
    (report.warnings.length > 0 ? '\nwarnings: ' + report.warnings.join('; ') : ''),
)

// ── 2. install the tarball into the test profile ─────────────────────────────────────────
const tarball = join(PLUGIN_DIR, report.filename)
const packOutput = run(DSH_NODE, [PACKAGER, PLUGIN_DIR])
note('2a. tarball built', existsSync(tarball), String(packOutput).trim().split('\n').slice(-3).join('\n'))

let installOutput = ''
let installOk = false
try {
  installOutput = run(DSH_CLI, ['plugin', '--profile', profile, 'add', './' + report.filename], { cwd: PLUGIN_DIR })
  installOk = true
} catch (error) {
  installOutput = String(error?.stdout ?? '') + String(error?.stderr ?? '') + String(error?.message ?? error)
}
const profileManifestPath = join(PROFILE_DIR, 'package.json')
const profileManifest = existsSync(profileManifestPath) ? JSON.parse(readFileSync(profileManifestPath, 'utf8')) : {}
note(
  '2b. install from tarball into profile ' + profile,
  installOk,
  String(installOutput).trim().split('\n').slice(-8).join('\n'),
)
note(
  '2c. profile manifest registered the bundle',
  profileManifest.dependencies?.['dsh-push-host']?.includes(report.filename.replace(/\.tgz$/, '')) === true &&
    (profileManifest.dsh?.profile?.bundles ?? []).includes('dsh-push-host'),
  JSON.stringify(profileManifest, undefined, 2),
)

// ── 3. mounting visible in --dump-config ────────────────────────────────────────────────
let dump = ''
try {
  dump = run(DSH_CLI, ['--profile', profile, '--dump-config'])
} catch (error) {
  dump = String(error?.stdout ?? '') + String(error?.stderr ?? '')
}
const tail = dump.trim().split('\n').slice(-3).join('\n')
note(
  '3. dump-config tail shows the mount',
  dump.includes('- id: push-host') && dump.includes('name: dsh-push-host'),
  tail,
)

// ── 4. the installed package honours the credentials file ───────────────────────────────
if (!existsSync(PEER_SOURCE)) {
  note('4. credentials file drives the installed package', false, 'missing peer source: ' + PEER_SOURCE)
} else {
  mkdirSync(dirname(PEER_LINK), { recursive: true })
  if (!existsSync(PEER_LINK)) symlinkSync(PEER_SOURCE, PEER_LINK, 'junction')
  const scratch = join(tmpdir(), 'dsh-push-verify-' + String(Date.now()))
  mkdirSync(scratch, { recursive: true })
  try {
    const probe = join(scratch, 'probe.mjs')
    writeFileSync(probe, PROBE_SOURCE, 'utf8')
    const cases = [
      {
        name: 'full credentials file',
        expect: (printed) =>
          printed.registerHostId === 'alice' &&
          printed.pushTopic === 'dsh-alice' &&
          printed.pushAuth === 'Bearer tk_WRITE_proof' &&
          printed.pendingAuth === 'hk_HOST_proof' &&
          printed.polls === 1,
        file: {
          v: 1,
          relay: 'https://relay.invalid.test',
          host: 'alice',
          topic: 'dsh-alice',
          writeToken: 'tk_WRITE_proof',
          readToken: 'tk_READ_proof',
          hostToken: 'hk_HOST_proof',
        },
      },
      {
        name: 'credentials file with no host/token (clean no-op)',
        expect: (printed) => printed.registerHostId === undefined && printed.polls === 0 && printed.pushTopic === undefined,
        file: { v: 1, relay: 'https://relay.invalid.test', host: '', topic: 'dsh-noop', writeToken: '', readToken: '', hostToken: '' },
      },
      { name: 'no credentials file at all (clean no-op)', expect: (printed) => printed.polls === 0 && !printed.logged.includes('credentials'), file: undefined },
    ]
    for (const testCase of cases) {
      const path = join(scratch, 'credentials.json')
      if (testCase.file === undefined) rmSync(path, { force: true })
      else writeFileSync(path, JSON.stringify(testCase.file), 'utf8')
      const output = run(DSH_NODE, [probe], {
        env: {
          ...process.env,
          DSH_PUSH_PROOF_PLUGIN: join(PROFILE_DIR, 'node_modules', 'dsh-push-host'),
          DSH_PUSH_CREDENTIALS: path,
          DSH_PUSH_HOST_TOKEN: '',
          DSH_PUSH_REG_TOKEN: '',
          DSH_PUSH_NTFY_TOKEN: '',
        },
      })
      const printed = JSON.parse(output.slice(output.indexOf('PROOF ') + 'PROOF '.length))
      note('4. ' + testCase.name, testCase.expect(printed) === true, output.trim())
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    if (!keep) rmSync(PEER_LINK, { force: true })
  }
}

const failed = results.filter((entry) => entry.ok !== true)
process.stdout.write('\n' + String(results.length - failed.length) + '/' + String(results.length) + ' checks passed\n')
if (failed.length > 0) process.stdout.write('failed: ' + failed.map((entry) => entry.name).join(' | ') + '\n')
process.exitCode = failed.length === 0 ? 0 : 1
