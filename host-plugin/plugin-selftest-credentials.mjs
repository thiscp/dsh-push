/**
 * Self-test for the onboarding layer added in v0.1.0: the credentials file, its precedence rules
 * against profile config and environment variables, the clean no-op when the file is missing, the
 * malformed-file path, and the pairing payload schema.
 *
 *   node plugin-selftest-credentials.mjs
 *
 * It writes its own throwaway credentials files (never the operator's `~/.config/dsh-push`), drives
 * the real `apply()` against a fake Cordis context and a fake relay, and asserts on the relay calls
 * the plugin actually made — i.e. it proves the tokens reached the wire, not just a getter.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, resolvePluginConfig, credentialFilePath, resolveConfig, CREDENTIAL_CONFIG_KEYS } from './lib/index.js'
import { parseCredentials, loadCredentials, credentialsPath, expandHome, describeSecrets, CREDENTIAL_KEYS } from './lib/credentials.mjs'
import { buildPairingPayload, PAYLOAD_FIELDS, PAYLOAD_VERSION } from './lib/pairing-lib.mjs'

const checks = []
/** Mutable so the plugin's own `console.log` diagnostics can be captured during one section. */
let emit = (line) => process.stdout.write(line + '\n')
function check(name, condition, detail = '') {
  const ok = condition === true
  checks.push({ name, ok })
  emit((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || detail === '' ? '' : '  → ' + detail))
}
const tick = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms))

// ── relay + log capture ────────────────────────────────────────────────────────────────
const calls = { push: [], register: [], ack: [], pending: 0 }
let pendingItems = []
const reply = (status, json) => ({ status, text: async () => JSON.stringify(json) })
globalThis.fetch = async (url, init = {}) => {
  const target = String(url)
  const body = init.body === undefined ? undefined : JSON.parse(init.body)
  if (target.endsWith('/answer/register')) {
    calls.register.push({ body, headers: init.headers })
    return reply(200, { ok: true })
  }
  if (target.includes('/answer/pending')) {
    calls.pending++
    calls.lastPendingHeaders = init.headers
    return reply(200, { ok: true, items: pendingItems })
  }
  if (target.endsWith('/answer/ack')) {
    calls.ack.push({ body, headers: init.headers })
    return reply(200, { ok: true, removed: 0 })
  }
  calls.push.push({ body, headers: init.headers })
  return reply(200, { id: 'x' })
}
function reset() {
  calls.push.length = 0
  calls.register.length = 0
  calls.ack.length = 0
  calls.pending = 0
  calls.lastPendingHeaders = undefined
  pendingItems = []
}

const logged = []
const realLog = console.log
/** Capture the plugin's `console.log` diagnostics without losing this test's own PASS/FAIL lines. */
const capture = () => {
  logged.length = 0
  console.log = (line) => {
    logged.push(String(line))
  }
}
const release = () => {
  console.log = realLog
}

function makeCtx(agents = []) {
  const registry = new Map(agents.map((agent) => [agent.id, agent]))
  const state = { listeners: new Map(), intervals: [], answers: [] }
  const ctx = {
    on(name, callback) {
      state.listeners.set(name, callback)
    },
    effect(callback) {
      state.teardown = callback()
    },
    interval(callback, delay) {
      state.intervals.push({ callback, delay })
      return () => {}
    },
    logger: () => ({ info: () => {} }),
    get: (name) => {
      if (name === 'agents') return { get: (id) => registry.get(id), roots: () => [...registry.values()] }
      return undefined
    },
    userQuestions: { answer: () => true },
  }
  return { ctx, state }
}

const question = () => ({ id: 'q1', question: 'Which option?', options: [{ label: 'first' }, { label: 'second' }] })

// Throwaway credentials location: never the operator's real one.
const dir = mkdtempSync(join(tmpdir(), 'dsh-push-cred-'))
const credentialsFile = join(dir, 'credentials.json')

/** The exact payload `deploy/relay-user-add.sh` prints, saved verbatim. */
const pairingPayload = {
  v: 1,
  relay: 'https://ntfy.example.test',
  host: 'alice',
  topic: 'dsh-alice',
  writeToken: 'tk_FAKE_write_token_fixture',
  readToken: 'tk_FAKE_read_token_fixture',
  hostToken: 'hk_hosttoken0000000000000000',
}
writeFileSync(credentialsFile, JSON.stringify(pairingPayload), 'utf8')

// ── 1. the pairing payload saved as-is resolves to working plugin config ───────────────
{
  const { resolved, file } = resolvePluginConfig({ credentialsFile }, { env: {}, readFile: undefined })
  check('credentials file found and reported as present', file.present === true && file.error === undefined, JSON.stringify(file))
  check('relay from `relay` field', resolved.relayBase === pairingPayload.relay, resolved.relayBase)
  check('host from `host` field', resolved.host === 'alice', resolved.host)
  check('topic from `topic` field', resolved.topic === 'dsh-alice', resolved.topic)
  check('`writeToken` maps to the ntfy write token', resolved.ntfyToken === pairingPayload.writeToken, resolved.ntfyToken)
  check('`readToken` maps to phoneToken (phone side only)', resolved.phoneToken === pairingPayload.readToken, resolved.phoneToken)
  check('`hostToken` maps to the relay queue token', resolved.hostToken === pairingPayload.hostToken, resolved.hostToken)
  check('no regToken in the payload = no regToken resolved', resolved.regToken === '', resolved.regToken)
  check('defaults still apply (pollIntervalMs)', resolved.pollIntervalMs === 3000, String(resolved.pollIntervalMs))
}

// ── 2. precedence: env vars > profile config > credentials > defaults ──────────────────
{
  const envWins = resolvePluginConfig({ credentialsFile, hostToken: 'hk_from_config' }, {
    env: { DSH_PUSH_HOST_TOKEN: 'hk_from_env', DSH_PUSH_REG_TOKEN: 'rt_from_env', DSH_PUSH_NTFY_TOKEN: 'tk_env' },
  })
  check(
    'environment overrides both file and profile config',
    envWins.resolved.hostToken === 'hk_from_env' && envWins.resolved.regToken === 'rt_from_env' && envWins.resolved.ntfyToken === 'tk_env',
    JSON.stringify({ hostToken: envWins.resolved.hostToken, regToken: envWins.resolved.regToken, ntfyToken: envWins.resolved.ntfyToken }),
  )

  const configWins = resolvePluginConfig({ credentialsFile, topic: 'dsh-override', host: 'bob' }, { env: {} })
  check(
    'profile config overrides the credentials file field by field',
    configWins.resolved.topic === 'dsh-override' && configWins.resolved.host === 'bob' && configWins.resolved.hostToken === pairingPayload.hostToken,
    JSON.stringify({ topic: configWins.resolved.topic, host: configWins.resolved.host, hostToken: configWins.resolved.hostToken }),
  )

  const credentialEnv = resolvePluginConfig({ credentialsFile }, { env: { DSH_PUSH_CREDENTIALS: credentialsFile, DSH_PUSH_NTFY_TOKEN: 'tk_env_only' } })
  check('DSH_PUSH_CREDENTIALS can point at the file', credentialEnv.path === credentialsFile, credentialEnv.path)
  check('an env token outranks the file token for the same slot', credentialEnv.resolved.ntfyToken === 'tk_env_only', credentialEnv.resolved.ntfyToken)
}

// ── 3. the file is read through the plugin, and the tokens reach the wire ──────────────
{
  reset()
  capture()
  const { ctx, state } = makeCtx()
  apply(ctx, { credentialsFile, regToken: 'rt_test', hostTokenEnv: 'DSH_PUSH_HOST_TOKEN_UNSET' })
  state.listeners.get('user-questions/request')(
    { questions: [question()], wait: { callId: 'cred-1' }, agent: { id: 'ag1', session: { id: 's1' } } },
    () => undefined,
  )
  await tick()
  check(
    'apply() registers with the credentials-file hostId',
    calls.register.length === 1 && calls.register[0].body.hostId === 'alice',
    JSON.stringify(calls.register[0]?.body ?? null),
  )
  check(
    'the ntfy push carries the credentials-file write token',
    calls.push.length === 1 && calls.push[0].headers.Authorization === 'Bearer ' + pairingPayload.writeToken,
    String(calls.push[0]?.headers?.Authorization ?? '(no push)'),
  )
  check(
    'the push goes to the credentials-file topic',
    calls.push[0]?.body?.topic === 'dsh-alice',
    String(calls.push[0]?.body?.topic ?? '(no push)'),
  )
  pendingItems = [{ callId: 'cred-1', agentId: 'ag1', qids: ['q1'], answers: [{ id: 'q1', selected: ['first'] }] }]
  await state.intervals[0].callback()
  await tick()
  check(
    'the poll sends the credentials-file hostToken as X-Host-Token',
    calls.lastPendingHeaders['X-Host-Token'] === pairingPayload.hostToken,
    String(calls.lastPendingHeaders?.['X-Host-Token'] ?? '(none)'),
  )
  check(
    'a credentials file is announced once (operator can see which file is live)',
    logged.filter((line) => line.includes('credentials file:')).length === 1,
    JSON.stringify(logged.filter((line) => line.includes('credentials'))),
  )
  release()
}

// ── 4. no credentials file anywhere = clean no-op (no crash, no network, no log noise) ──
{
  reset()
  capture()
  const { ctx, state } = makeCtx()
  apply(ctx, { credentialsFile: join(dir, 'does-not-exist.json') })
  const value = state.listeners.get('user-questions/request')({ questions: [question()], wait: { callId: 'none-1' } }, () => 'downstream')
  await tick()
  release()
  check('missing credentials file: plugin still transparent', value === 'downstream')
  check('missing credentials file: zero relay traffic', calls.register.length === 0 && calls.push.length === 0 && calls.pending === 0, JSON.stringify(calls))
  check(
    'missing credentials file: no credentials complaint (clean no-op)',
    logged.some((line) => line.includes('relay disabled')) && !logged.some((line) => /credentials/.test(line)),
    JSON.stringify(logged),
  )
  check('missing credentials file: no poll interval scheduled', state.intervals.length === 0, String(state.intervals.length))
}

// ── 5. broken credentials file = reported once, plugin still boots ─────────────────────
{
  const broken = join(dir, 'broken.json')
  writeFileSync(broken, '{ "host": "alice", oops', 'utf8')
  capture()
  const { ctx, state } = makeCtx()
  apply(ctx, { credentialsFile: broken })
  await tick()
  release()
  check(
    'malformed credentials file is reported with its path',
    logged.some((line) => line.includes('credentials ignored') && line.includes('broken.json')),
    JSON.stringify(logged),
  )
  check('malformed credentials file does not stop the plugin', state.listeners.has('user-questions/request'))

  const wrongShape = join(dir, 'array.json')
  writeFileSync(wrongShape, '[1, 2, 3]', 'utf8')
  const parsed = loadCredentials(wrongShape)
  check('a JSON array is refused with a clear message', parsed.error !== undefined && parsed.value !== undefined, String(parsed.error))
}

// ── 6. credential parsing details (aliases, nested multi-host, case/separator tolerance) ─
{
  const alias = parseCredentials(JSON.stringify({ host_token: 'hk_x', write_token: 'tk_w', read_token: 'tk_r', HostId: 'carol', RELAY: 'https://r.test/' }))
  check(
    'snake_case / upper-case / aliased keys all parse',
    alias.value.hostToken === 'hk_x' && alias.value.ntfyToken === 'tk_w' && alias.value.phoneToken === 'tk_r' && alias.value.host === 'carol' && alias.value.relayBase === 'https://r.test/',
    JSON.stringify(alias.value),
  )

  const nested = parseCredentials(
    JSON.stringify({
      relay: 'https://relay.test',
      hosts: {
        alice: { topic: 'dsh-alice', writeToken: 'tk_a', hostToken: 'hk_a' },
        bob: { topic: 'dsh-bob', writeToken: 'tk_b', hostToken: 'hk_b' },
      },
    }),
    { source: 'nested.json' },
  )
  check('nested multi-host file without a root host takes the first entry', nested.value.host === 'alice' && nested.value.topic === 'dsh-alice', JSON.stringify(nested.value))
  const chosen = parseCredentials(
    JSON.stringify({ host: 'bob', relay: 'https://relay.test', hosts: { alice: { topic: 'dsh-alice' }, bob: { topic: 'dsh-bob', hostToken: 'hk_b' } } }),
  )
  check('root `host` selects the matching nested entry', chosen.value.host === 'bob' && chosen.value.topic === 'dsh-bob' && chosen.value.hostToken === 'hk_b' && chosen.value.relayBase === 'https://relay.test', JSON.stringify(chosen.value))

  check('empty text parses to empty credentials', JSON.stringify(parseCredentials('   ').value) === '{}')
  check('missing file is reported as absent, not broken', loadCredentials(join(dir, 'nope.json')).present === false)
}

// ── 7. path resolution: default, ~, env override, absolute ─────────────────────────────
{
  const home = 'C:\\Users\\tester'
  const base = credentialsPath({}, {}, home)
  check('default path is ~/.config/dsh-push/credentials.json', base.endsWith(join('.config', 'dsh-push', 'credentials.json')), base)
  // 2026-10-13: the default used to be the bare relative path, so `path.resolve` made it depend on
  // the process cwd — a DSH started from any other directory silently lost its credentials.
  check(
    '⑤ the default path is anchored to the home directory, not to the process cwd',
    credentialsPath({}, {}, home) === join(home, '.config', 'dsh-push', 'credentials.json'),
    credentialsPath({}, {}, home),
  )
  check('DSH_PUSH_CREDENTIALS overrides the default location', credentialsPath({}, { DSH_PUSH_CREDENTIALS: 'C:\\creds\\a.json' }, home) === 'C:\\creds\\a.json')
  check('config credentialsFile outranks the env var', credentialsPath({ credentialsFile: 'C:\\creds\\b.json' }, { DSH_PUSH_CREDENTIALS: 'C:\\creds\\a.json' }, home) === 'C:\\creds\\b.json')
  check('`~` expands to the home directory', expandHome('~/x.json', home) === join(home, 'x.json'), expandHome('~/x.json', home))
  check('credentialFilePath() (public, for the pair command) uses the same rules', credentialFilePath({ credentialsFile: 'C:\\creds\\b.json' }, {}) === 'C:\\creds\\b.json')
}

// ── 8. pairing payload: same schema and field names as relay-user-add.sh ───────────────
{
  const { payload, missing } = buildPairingPayload({ credentials: { host: 'alice', topic: 'dsh-alice', ntfyToken: 'tk_w', phoneToken: 'tk_r', hostToken: 'hk_a' }, relayBase: 'https://ntfy.cpyh.xyz/' })
  check('payload field order matches relay-user-add.sh', PAYLOAD_FIELDS.every((field, index) => Object.keys(payload)[index] === field), Object.keys(payload).join(','))
  check('payload version is the same `v` the script writes', payload.v === PAYLOAD_VERSION && payload.v === 1, String(payload.v))
  check('payload carries the relay base without a trailing slash', payload.relay === 'https://ntfy.cpyh.xyz', payload.relay)
  check(
    'payload maps writeToken/readToken/hostToken exactly as the script does',
    payload.writeToken === 'tk_w' && payload.readToken === 'tk_r' && payload.hostToken === 'hk_a',
    JSON.stringify(payload),
  )
  check('a complete payload reports nothing missing', missing.length === 0, missing.join(','))
  const partial = buildPairingPayload({ credentials: { host: 'alice' } })
  check(
    'an incomplete payload is refused, listing the missing fields',
    partial.missing.includes('topic') && partial.missing.includes('writeToken') && partial.missing.includes('hostToken'),
    partial.missing.join(','),
  )
  check('secrets are masked in diagnostics', describeSecrets({ hostToken: 'hk_abcdef', ntfyToken: '' }).every((line) => !line.includes('abcdef')), describeSecrets({ hostToken: 'hk_abcdef' }).join('|'))
}

// ── 9. regression: the legacy env-only shape still resolves ───────────────────────────
{
  const legacy = resolveConfig({ host: 'test1', pollIntervalMs: '5000', pushQuestions: 'false', hostToken: 'hk_literal' })
  check('resolveConfig still coerces types', legacy.pollIntervalMs === 5000 && legacy.pushQuestions === false, JSON.stringify(legacy.pollIntervalMs))
  const viaEnv = resolvePluginConfig({ host: 'test1' }, { env: { DSH_PUSH_CREDENTIALS: join(dir, 'nope.json'), DSH_PUSH_HOST_TOKEN: 'hk_from_env' } })
  check('env-var-only setup (no credentials file) still activates the relay side', viaEnv.resolved.hostToken === 'hk_from_env', viaEnv.resolved.hostToken)
}

// ── 10. regressions for the four production-cutover pitfalls (2026-10-12) ──────────────
// ① schema-validated config shadows the credentials file with its empty defaults;
// ② the registration token has to survive BOTH key tables (credentials.mjs ↔ index.js) or
//    `X-Reg-Token` goes out empty and the relay answers `401 bad reg token` forever.
{
  // A file that also carries the relay's registration token (this is what the production host
  // has: `deploy/relay-user-add.sh` prints it and the operator saves the payload verbatim).
  const withReg = join(dir, 'with-regtoken.json')
  writeFileSync(
    withReg,
    JSON.stringify({ ...pairingPayload, regToken: 'rt_from_file' }),
    'utf8',
  )
  const parsed = parseCredentials(JSON.stringify({ ...pairingPayload, regToken: 'rt_from_file' }))
  check('① `regToken` in the credentials file is projected (was silently dropped)', parsed.value.regToken === 'rt_from_file', JSON.stringify(parsed.value))
  const snakeReg = parseCredentials(JSON.stringify({ host: 'alice', reg_token: 'rt_snake' }))
  check('① `reg_token` (separator-tolerant) is projected too', snakeReg.value.regToken === 'rt_snake', JSON.stringify(snakeReg.value))

  // ① The exact shape `apply()` receives: every schema default is *present*, empty strings and all.
  const schemaShaped = {
    relayBase: 'https://ntfy.cpyh.xyz',
    topic: 'dsh',
    host: '',
    hostToken: '',
    hostTokenEnv: 'DSH_PUSH_HOST_TOKEN',
    regToken: '',
    regTokenEnv: 'DSH_PUSH_REG_TOKEN',
    ntfyToken: '',
    phoneToken: '',
    credentialsFile: withReg,
    webLog: 'C:\\Users\\x\\.dsh\\web.log',
    webBase: '',
    webName: '',
    answerBase: '',
    pollIntervalMs: 3000,
    pushQuestions: true,
    notifyTurns: true,
    echoAnswers: true,
    claimForeground: false,
    log: true,
  }
  const shadowed = resolvePluginConfig(schemaShaped, { env: {} })
  check(
    '① empty schema defaults do NOT shadow the credentials file (host/hostToken/regToken survive)',
    shadowed.resolved.host === 'alice' && shadowed.resolved.hostToken === pairingPayload.hostToken && shadowed.resolved.regToken === 'rt_from_file',
    JSON.stringify({ host: shadowed.resolved.host, hostToken: shadowed.resolved.hostToken, regToken: shadowed.resolved.regToken }),
  )
  const explicit = resolvePluginConfig({ ...schemaShaped, host: 'bob', pushQuestions: false }, { env: {} })
  check(
    '① an explicit non-empty config still wins, and `false` is not mistaken for "unset"',
    explicit.resolved.host === 'bob' && explicit.resolved.pushQuestions === false,
    JSON.stringify({ host: explicit.resolved.host, pushQuestions: explicit.resolved.pushQuestions }),
  )

  // ② the two key tables must stay in sync: a field the file can carry but index.js refuses to
  //    pick up (or vice versa) is exactly how the 401 shipped.
  const unSync = Object.keys(CREDENTIAL_KEYS).filter((field) => !CREDENTIAL_CONFIG_KEYS.includes(field))
  check('② every CREDENTIAL_KEYS field is also a CREDENTIAL_CONFIG_KEYS entry', unSync.length === 0, unSync.join(','))

  // ② wire-level: the token really leaves on the register request
  reset()
  capture()
  const { ctx, state } = makeCtx()
  apply(ctx, { credentialsFile: withReg, hostTokenEnv: 'DSH_PUSH_HOST_TOKEN_UNSET', regTokenEnv: 'DSH_PUSH_REG_TOKEN_UNSET' })
  state.listeners.get('user-questions/request')(
    { questions: [question()], wait: { callId: 'reg-1', timed: true }, agent: { id: 'ag1', session: { id: 's1' } } },
    () => undefined,
  )
  await tick()
  release()
  check(
    '② POST /answer/register carries X-Reg-Token from the credentials file',
    calls.register.length === 1 && calls.register[0].headers['X-Reg-Token'] === 'rt_from_file',
    String(calls.register[0]?.headers?.['X-Reg-Token'] ?? '(no register)'),
  )
  check(
    '② a 200 register is logged positively (the acceptance step needs a visible line)',
    logged.some((line) => line.includes('register reg-1 -> HTTP 200')),
    JSON.stringify(logged.filter((line) => line.includes('register'))),
  )
  reset()
  capture()
  // ③ the misleading `timed=` line: a timed question the model asked without a timeout argument is
  // announced first by `tools/pre-execute` (which can only guess) and then corrected.
  const guess = makeCtx()
  apply(guess.ctx, { credentialsFile: withReg })
  guess.state.listeners.get('tools/pre-execute')(
    { callId: 't1', arguments: { questions: [{ id: 'q1', question: 'Which?', options: [{ label: 'first' }] }] }, agent: { id: 'ag1', session: { header: { id: 's1' } } } },
    () => undefined,
  )
  guess.state.listeners.get('user-questions/request')(
    { questions: [question()], wait: { callId: 't1', timed: true }, agent: { id: 'ag1', session: { id: 's1' } } },
    () => undefined,
  )
  await tick()
  release()
  check(
    '③ a waterfall-corrected `timed` is logged instead of leaving the pre-execute guess as the only evidence',
    logged.some((line) => line.includes('timed corrected to true')),
    JSON.stringify(logged.filter((line) => line.includes('timed'))),
  )
  check('③ the correction does not double-push', calls.push.filter((call) => call.body?.title?.includes('等你选择')).length === 1, String(calls.push.length))
}

rmSync(dir, { recursive: true, force: true })
console.log = realLog

const failed = checks.filter((entry) => !entry.ok)
console.log('\n' + String(checks.length - failed.length) + '/' + String(checks.length) + ' checks passed')
if (failed.length > 0) {
  console.log('failed: ' + failed.map((entry) => entry.name).join(' | '))
  process.exitCode = 1
}
