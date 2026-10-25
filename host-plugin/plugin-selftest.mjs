/**
 * Offline self-test for the host plugin: drives `apply()` against a fake Cordis context and a
 * fake relay, so both layers can be checked without a running DSH host.
 *
 *   node plugin-selftest.mjs
 *
 * It imports the real `lib/index.js`; a local `node_modules/@deepseek-ai/schemastery` junction
 * is enough, the host provides that peer with its own closure at runtime.
 */
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AskUserModeSwitch,
  apply,
  askUserBackupPath,
  CREDENTIAL_CONFIG_KEYS,
  askUserSyncPlan,
  isTimedAskUserQuestion,
  nextAskUserConfig,
  passText,
  provisionCall,
  provisionNameSuggest,
  provisionUrl,
  PassProvisioner,
  resolveConfig,
  writeCredentialsPatch,
  setVolatileValue,
  volatileValue,
  fiberIsActive,
} from './lib/index.js'
import { CREDENTIAL_KEYS, describeSecrets, parseCredentials } from './lib/credentials.mjs'
import { panelStore } from './lib/index.js'
import { buildPairingPayload } from './lib/pairing-lib.mjs'
import { parseArgs } from './lib/pairing.mjs'

// Hermetic: never read the machine's real credentials file. (2026-10-13: the real file gained
// webBase/webName, and section 11's "empty webBase" case silently rehosted on it — a self-test
// that passes only on machines without that field is not a self-test.)
process.env.DSH_PUSH_CREDENTIALS = join(tmpdir(), 'dsh-push-selftest-no-creds.json')

const checks = []
function check(name, condition, detail = '') {
  const ok = condition === true
  checks.push({ name, ok })
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || detail === '' ? '' : '  → ' + detail))
}

const tick = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms))

/** Collect every relay call the plugin makes. */
const calls = { push: [], register: [], ack: [], pending: 0 }
let pendingItems = []
const reply = (status, json) => ({ status, text: async () => JSON.stringify(json) })
globalThis.fetch = async (url, init = {}) => {
  const target = String(url)
  const body = init.body === undefined ? undefined : JSON.parse(init.body)
  if (target.endsWith('/answer/register')) {
    calls.register.push(body)
    return reply(200, { ok: true })
  }
  if (target.includes('/answer/pending')) {
    calls.pending++
    return reply(200, { ok: true, items: pendingItems })
  }
  if (target.endsWith('/answer/ack')) {
    calls.ack.push(body)
    return reply(200, { ok: true, removed: body.callIds.length })
  }
  calls.push.push(body)
  return reply(200, { id: 'x' })
}
function reset() {
  calls.push.length = 0
  calls.register.length = 0
  calls.ack.length = 0
  calls.pending = 0
  pendingItems = []
}

/** Minimal stand-in for the Cordis context the host hands to `apply()`. */
function makeCtx(agents = [], projections) {
  const registry = new Map(agents.map((agent) => [agent.id, agent]))
  const state = { listeners: new Map(), intervals: [], answers: [], answerResult: () => true, teardown: null }
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
      if (name === 'agents') {
        return { get: (id) => registry.get(id), roots: () => [...registry.values()], list: () => [...registry.values()] }
      }
      if (name === 'sessionProjections') return projections
      return undefined
    },
    userQuestions: {
      answer(agent, callId, answer) {
        state.answers.push({ agent, callId, answer })
        return state.answerResult(agent, callId, answer)
      },
    },
  }
  return { ctx, state }
}

const question = (overrides = {}) => ({
  id: 'q1',
  question: 'Which option?',
  options: [{ label: 'first' }, { label: 'second' }],
  ...overrides,
})

const TOKENS = { host: 'test1', hostToken: 'hk_x', regToken: 'rt', ntfyToken: 'tk_x', topic: 'dsh-test1' }

// ── 1. notify layer: push + register, then hand the request back to the Web UI ──────────
{
  reset()
  const { ctx, state } = makeCtx()
  apply(ctx, { ...TOKENS, webName: 'win-test', webLog: join(tmpdir(), 'dsh-push-selftest-no-web.log') })
  const listener = state.listeners.get('user-questions/request')
  check('listener registered on user-questions/request', typeof listener === 'function')
  check('poll interval scheduled at 3000ms', state.intervals.length === 1 && state.intervals[0].delay === 3000)

  let nextCalled = 0
  const downstream = { answers: [{ id: 'q1', selected: ['first'] }] }
  const returned = listener(
    { questions: [question()], wait: { callId: 'call-1' }, agent: { id: 'ag1', session: { id: 'session-abcdefgh' } } },
    () => {
      nextCalled++
      return downstream
    },
  )
  await tick()
  check('default mode returns next() (Web UI keeps foreground answering)', returned === downstream)
  check('next() invoked exactly once', nextCalled === 1, 'calls=' + String(nextCalled))

  check(
    'question registered with hostId + relay vocabulary',
    calls.register.length === 1 &&
      calls.register[0].hostId === 'test1' &&
      JSON.stringify(calls.register[0].questions) ===
        JSON.stringify([{ id: 'q1', question: 'Which option?', options: ['first', 'second'] }]),
    JSON.stringify(calls.register[0] ?? null),
  )

  const push = calls.push.at(-1)
  const body = String(push?.message ?? '')
  check('ntfy push sent with priority 4', push?.priority === 4, JSON.stringify(push ?? null))
  check('push title names the session tail', push?.title === 'DSH 等你选择 [abcdefgh]', String(push?.title))
  check('push carries the answer link with the callId', body.includes('📱 作答: https://ntfy.cpyh.xyz/answer/call-1'), body)
  check('push carries #qid trailer', body.includes('\n#qid q1'), body)
  check('push carries #opts for a single 2-option question', body.includes('\n#opts q1=first|second'), body)
  check('push carries #name trailer', body.includes('\n#name win-test'), body)
  check('no #web trailer when web.log is missing (webBase empty too)', !body.includes('#web'), body)
  check('one notification per question (dedupe)', calls.push.length === 1, 'pushes=' + String(calls.push.length))
}

// ── 2. legacy-mode question (no timed wait): the answer cannot land, and we say so ──────
{
  reset()
  const { ctx, state } = makeCtx()
  apply(ctx, { ...TOKENS })
  state.listeners.get('user-questions/request')(
    { questions: [question()], wait: { callId: 'legacy-1' }, agent: { id: 'ag1', session: { id: 's1' } } },
    () => undefined,
  )
  await tick()
  pendingItems = [{ callId: 'legacy-1', agentId: 'ag1', qids: ['q1'], answers: [{ id: 'q1', selected: ['second'] }] }]
  await state.intervals[0].callback()
  await tick()
  check('legacy question: answer acked away, not retried forever', calls.ack.length === 1 && calls.ack[0].callIds[0] === 'legacy-1', JSON.stringify(calls.ack))
  check('legacy question: userQuestions.answer never called', state.answers.length === 0)
}

// ── 3. timed question + live root agent: answer() with a padded batch ──────────────────
{
  reset()
  const agent = { id: 'ag1', session: { id: 's1' } }
  const { ctx, state } = makeCtx([agent])
  apply(ctx, { ...TOKENS })
  state.listeners.get('user-questions/request')(
    { questions: [question(), question({ id: 'q2', question: 'Second?' })], wait: { callId: 'timed-1', timed: true }, agent },
    () => undefined,
  )
  await tick()
  const body = String(calls.push.at(-1)?.message ?? '')
  check('no #opts for a two-question batch', !body.includes('#opts'), body)

  pendingItems = [{ callId: 'timed-1', agentId: 'ag1', qids: ['q1', 'q2'], answers: [{ id: 'q1', selected: ['first'] }] }]
  await state.intervals[0].callback()
  await tick()
  const answer = state.answers[0]
  check(
    'answer() called on the live root agent with the callId',
    answer?.agent === agent && answer?.callId === 'timed-1',
    JSON.stringify(answer?.callId),
  )
  check(
    'partial phone batch padded with a skipped question',
    JSON.stringify(answer?.answer?.answers) === JSON.stringify([{ id: 'q1', selected: ['first'] }, { id: 'q2', selected: [] }]),
    JSON.stringify(answer?.answer?.answers),
  )
  check('answer acked after delivery', calls.ack.length === 1 && calls.ack[0].callIds[0] === 'timed-1', JSON.stringify(calls.ack))
  check(
    'silent #ans echo pushed to this host topic',
    calls.push.at(-1)?.message === '#ans timed-1 first' && calls.push.at(-1)?.priority === 1,
    JSON.stringify(calls.push.at(-1)),
  )
}

// ── 4. timed question without a live agent: keep it queued (no ack) ────────────────────
{
  reset()
  const { ctx, state } = makeCtx()
  apply(ctx, { ...TOKENS })
  state.listeners.get('user-questions/request')(
    { questions: [question()], wait: { callId: 'timed-2', timed: true }, agent: { id: 'ag9', session: { id: 's9' } } },
    () => undefined,
  )
  await tick()
  pendingItems = [{ callId: 'timed-2', agentId: 'ag9', qids: ['q1'], answers: [{ id: 'q1', selected: ['first'] }] }]
  await state.intervals[0].callback()
  await tick()
  check('no live agent → nothing answered', state.answers.length === 0)
  check('no live agent → not acked (answer stays queued)', calls.ack.length === 0, JSON.stringify(calls.ack))
}

// ── 5. relay unconfigured: pure pass-through, no network ───────────────────────────────
{
  reset()
  const { ctx, state } = makeCtx()
  // `credentialsFile` must be pinned to a non-existent path: the *default* now resolves to the real
  // `~/.config/dsh-push/credentials.json`, and this check has to describe "no credentials anywhere",
  // not "whatever the developer's machine happens to have" (2026-10-13).
  apply(ctx, { credentialsFile: 'C:\\dsh-push-selftest-does-not-exist\\credentials.json' })
  const value = state.listeners.get('user-questions/request')({ questions: [question()], wait: { callId: 'x' } }, () => 'downstream')
  await tick()
  check('no host token → next() only', value === 'downstream')
  check('no host token → no relay traffic', calls.register.length === 0 && calls.push.length === 0)
}

// ── 6. opt-in foreground claim resolves from the relay queue ───────────────────────────
{
  reset()
  const { ctx, state } = makeCtx()
  apply(ctx, { ...TOKENS, claimForeground: true })
  const settled = state.listeners.get('user-questions/request')(
    { questions: [question()], wait: { callId: 'claim-1' }, agent: { id: 'ag1', session: { id: 's1' } } },
    () => new Promise(() => {}), // the Web UI never answers
  )
  await tick()
  pendingItems = [{ callId: 'claim-1', agentId: 'ag1', qids: ['q1'], answers: [{ id: 'q1', selected: ['second'] }] }]
  await state.intervals[0].callback()
  const result = await settled
  await tick()
  check(
    'claimForeground: phone answer settles the foreground request',
    JSON.stringify(result) === JSON.stringify({ answers: [{ id: 'q1', selected: ['second'] }] }),
    JSON.stringify(result),
  )
  check('claimForeground: answer acked', calls.ack.length === 1)
}

// ── 7. an answer that arrives while the question is still `open` is not thrown away ────
{
  reset()
  const agent = { id: 'ag1', session: { id: 's1' } }
  // Real shape of `sessionProjections.stateOf(session, 'userQuestions')`: the
  // dsh-user-questions fold nests the lists under `questions`.
  const projections = {
    stateOf: () => ({ timed: true, questions: { active: [{ callId: 'timed-3', state: 'open' }], settled: [] } }),
  }
  const { ctx, state } = makeCtx([agent], projections)
  state.answerResult = () => false // the service rejects: the question is not `continued` yet
  apply(ctx, { ...TOKENS })
  state.listeners.get('user-questions/request')(
    { questions: [question()], wait: { callId: 'timed-3', timed: true }, agent },
    () => undefined,
  )
  await tick()
  pendingItems = [{ callId: 'timed-3', agentId: 'ag1', qids: ['q1'], answers: [{ id: 'q1', selected: ['first'] }] }]
  await state.intervals[0].callback()
  await tick()
  check('open question: answer() attempted', state.answers.length === 1)
  check('open question: answer kept queued (no ack)', calls.ack.length === 0, JSON.stringify(calls.ack))

  // An unreadable projection must also hold the answer: never drop on a failed lookup.
  projections.stateOf = () => undefined
  await state.intervals[0].callback()
  await tick()
  check('unreadable projection: answer still kept queued', calls.ack.length === 0, JSON.stringify(calls.ack))

  // Positively settled -> the stale queued answer is dropped.
  projections.stateOf = () => ({ timed: true, questions: { active: [], settled: [{ callId: 'timed-3' }] } })
  await state.intervals[0].callback()
  await tick()
  check('settled question: stale answer acked away', calls.ack.length === 1 && calls.ack[0].callIds[0] === 'timed-3', JSON.stringify(calls.ack))

  // Happy path: continued -> delivered + acked.
  pendingItems = [{ callId: 'timed-3', agentId: 'ag1', qids: ['q1'], answers: [{ id: 'q1', selected: ['first'] }] }]
  projections.stateOf = () => ({ timed: true, questions: { active: [{ callId: 'timed-3', state: 'continued' }], settled: [] } })
  state.answerResult = () => true
  await state.intervals[0].callback()
  await tick()
  check('continued question: the held answer is delivered and acked', calls.ack.length === 2, JSON.stringify(calls.ack))
}

// ── 8. turn-end notification (Stop-hook parity) ────────────────────────────────────────
{
  reset()
  const { ctx, state } = makeCtx()
  apply(ctx, { ...TOKENS, webName: 'win-test', webLog: join(tmpdir(), 'dsh-push-selftest-no-web.log') })
  const stopping = state.listeners.get('agent/turn-stopping')
  check('turn-stopping listener registered', typeof stopping === 'function')

  const session = { header: { id: 'session-abcdefgh', cwd: 'F:/work/work_dsh' } }
  stopping({ agent: { id: 'ag1', session }, turn: 3 })
  await tick()
  const push = calls.push.at(-1)
  check('turn end pushes a notification', push !== undefined && push.title === 'DSH 任务结束 [abcdefgh]', String(push?.title))
  check('turn push body carries the workdir', String(push?.message ?? '').startsWith('目录: F:/work/work_dsh'), String(push?.message))
  check('turn push is normal priority (3)', push?.priority === 3, String(push?.priority))
  check('turn push carries #name', String(push?.message ?? '').includes('\n#name win-test'), String(push?.message))

  const before = calls.push.length
  stopping({ agent: { id: 'ag1', session }, turn: 3 })
  await tick()
  check('same turn is deduped (no second push)', calls.push.length === before, 'pushes=' + String(calls.push.length))
  stopping({ agent: { id: 'ag1', session }, turn: 4 })
  await tick()
  check('next turn pushes again', calls.push.length === before + 1, 'pushes=' + String(calls.push.length))
}

// ── 9. `#ans` echo on the PostToolUse seam ─────────────────────────────────────────────
{
  reset()
  const { ctx, state } = makeCtx()
  apply(ctx, { ...TOKENS })
  const post = state.listeners.get('tools/post-execute')
  check('post-execute listener registered', typeof post === 'function')

  state.listeners.get('user-questions/request')(
    { questions: [question()], wait: { callId: 'call-echo', timed: true }, agent: { id: 'ag1', session: { id: 's1' } } },
    () => undefined,
  )
  await tick()
  let downstream = 0
  post({ callId: 'call-echo' }, { value: { answers: [{ id: 'q1', selected: ['second'] }] } }, () => {
    downstream++
    return 'policy-result'
  })
  await tick()
  check('answered question echoes #ans', calls.push.at(-1)?.message === '#ans call-echo second', String(calls.push.at(-1)?.message))
  check('echo priority is 1 (silent)', calls.push.at(-1)?.priority === 1)
  check('post-execute stays transparent to the chain', downstream === 1)

  const before = calls.push.length
  state.listeners.get('user-questions/request')(
    { questions: [question()], wait: { callId: 'call-pending', timed: true }, agent: { id: 'ag1', session: { id: 's1' } } },
    () => undefined,
  )
  await tick()
  post({ callId: 'call-pending' }, { value: { pending: true, callId: 'call-pending' } }, () => undefined)
  await tick()
  check('pending (timed-out) result pushes no #ans', calls.push.length === before + 1, 'pushes=' + String(calls.push.length))

  const quiet = calls.push.length
  post({ callId: 'some-other-tool' }, { value: {} }, () => undefined)
  await tick()
  check('unrelated tool result is ignored', calls.push.length === quiet)
}

// ── 10. config: defaults, coercion, env-provided tokens ────────────────────────────────
{
  const resolved = resolveConfig({ host: 'test1', pollIntervalMs: '5000', pushQuestions: 'false' })
  check('defaults applied', resolved.topic === 'dsh' && resolved.relayBase === 'https://ntfy.cpyh.xyz')
  check('types coerced from YAML-ish strings', resolved.pollIntervalMs === 5000 && resolved.pushQuestions === false)
  check('claimForeground defaults to off (notify layer never steals the turn)', resolved.claimForeground === false)

  process.env.DSH_PUSH_HOST_TOKEN = 'hk_from_env'
  reset()
  const { ctx, state } = makeCtx()
  apply(ctx, { host: 'test1', regToken: 'rt', ntfyToken: 'tk_x', topic: 'dsh-test1' })
  state.listeners.get('user-questions/request')({ questions: [question()], wait: { callId: 'env-1' } }, () => undefined)
  await tick()
  check('host token from the environment activates the relay side', calls.register.length === 1 && calls.register[0].callId === 'env-1')
}

// ── 11. #web trailer: webBase rehosts, empty webBase falls back to the logged URL (v0.1.1) ──
{
  const fixture = join(tmpdir(), 'dsh-push-selftest-web.log')
  writeFileSync(fixture, 'dsh web: http://127.0.0.1:3080/?token=OLDtok\ndsh web: http://100.0.0.9:3080/?token=NEWtok\n', 'utf8')

  reset()
  let made = makeCtx()
  apply(made.ctx, { ...TOKENS, webLog: fixture })
  made.state.listeners.get('user-questions/request')(
    { questions: [question()], wait: { callId: 'web-fallback' }, agent: { id: 'ag1', session: { id: 's1' } } },
    () => undefined,
  )
  await tick()
  let body = String(calls.push.at(-1)?.message ?? '')
  check('empty webBase: #web uses the freshest logged URL as-is', body.includes('\n#web http://100.0.0.9:3080/?token=NEWtok'), body)

  reset()
  made = makeCtx()
  apply(made.ctx, { ...TOKENS, webLog: fixture, webBase: 'http://<tailnet-windows>:3080/' })
  made.state.listeners.get('user-questions/request')(
    { questions: [question()], wait: { callId: 'web-rehost' }, agent: { id: 'ag1', session: { id: 's1' } } },
    () => undefined,
  )
  await tick()
  body = String(calls.push.at(-1)?.message ?? '')
  check('webBase set: #web rehosted on the base with the freshest token', body.includes('\n#web http://<tailnet-windows>:3080/?token=NEWtok'), body)
}

// ── 11b. #web carries the source conversation as a URL fragment (v0.2.2) ─────────────
{
  const fixture = join(tmpdir(), 'dsh-push-selftest-web.log')
  writeFileSync(fixture, 'dsh web: http://100.0.0.9:3080/?token=NEWtok\n', 'utf8')
  const SID = 'session-3d55c7df-a183-43e5-9c25-ba7983b00af8'

  reset()
  let made = makeCtx()
  apply(made.ctx, { ...TOKENS, webLog: fixture })
  made.state.listeners.get('user-questions/request')(
    { questions: [question()], wait: { callId: 'frag-question' }, agent: { id: 'ag1', session: { id: SID } } },
    () => undefined,
  )
  await tick()
  let body = String(calls.push.at(-1)?.message ?? '')
  check('question #web carries the session id as a fragment', body.includes('\n#web http://100.0.0.9:3080/?token=NEWtok#' + SID), body)

  reset()
  made = makeCtx()
  apply(made.ctx, { ...TOKENS, webLog: fixture, notifyTurns: true })
  made.state.listeners.get('agent/turn-stopping')({ turn: 1, agent: { session: { header: { id: SID, cwd: '/srv/app' } } } })
  await tick()
  body = String(calls.push.at(-1)?.message ?? '')
  check('turn-end #web carries the session id as a fragment', body.includes('\n#web http://100.0.0.9:3080/?token=NEWtok#' + SID), body)

  reset()
  made = makeCtx()
  apply(made.ctx, { ...TOKENS, webLog: fixture })
  made.state.listeners.get('user-questions/request')(
    { questions: [question()], wait: { callId: 'frag-bogus' }, agent: { id: 'ag1', session: { id: 's1' } } },
    () => undefined,
  )
  await tick()
  body = String(calls.push.at(-1)?.message ?? '')
  check('a non-uuid session id appends no fragment (never emits a bare "#")', !body.includes('#web http://100.0.0.9:3080/?token=NEWtok#'), body)
}

// ── 12. pairing payload: optional webBase/webName + the new flags (v0.1.1) ──────────────
{
  const full = buildPairingPayload({
    credentials: { host: 'h', topic: 't', ntfyToken: 'tk_w', phoneToken: 'tk_r', hostToken: 'hk', relayBase: 'https://r', webBase: 'http://100.0.0.9:3080', webName: 'my-box' },
  })
  check('payload carries webBase/webName when known', full.missing.length === 0 && full.payload.webBase === 'http://100.0.0.9:3080' && full.payload.webName === 'my-box', JSON.stringify(full.payload))
  const bare = buildPairingPayload({ credentials: { host: 'h', topic: 't', ntfyToken: 'tk_w', phoneToken: 'tk_r', hostToken: 'hk', relayBase: 'https://r' } })
  check('payload omits webBase/webName when unknown (v1 schema unchanged)', !('webBase' in bare.payload) && !('webName' in bare.payload) && bare.missing.length === 0, JSON.stringify(bare.payload))
  const opts = parseArgs(['payload', '--web-base', 'http://x:3080', '--web-name=box'])
  check('--web-base/--web-name parse into overrides', opts.overrides.webBase === 'http://x:3080' && opts.overrides.webName === 'box', JSON.stringify(opts.overrides))
}

// ── 13. 手机作答模式开关 (v0.2.0): pure logic ───────────────────────────────────────
{
  const legacyTool = { name: 'ask_user_question', parameters: { properties: { questions: {} } } }
  const timedTool = { name: 'ask_user_question', parameters: { properties: { questions: {}, timeout: { type: 'number' } } } }
  check('isTimedAskUserQuestion: legacy schema is not timed', isTimedAskUserQuestion(legacyTool) === false)
  check('isTimedAskUserQuestion: a timeout property means timed', isTimedAskUserQuestion(timedTool) === true)
  check('isTimedAskUserQuestion: other tools never match', isTimedAskUserQuestion({ name: 'read', parameters: { properties: { timeout: {} } } }) === false)
  check('isTimedAskUserQuestion: a missing tool is not timed', isTimedAskUserQuestion(undefined) === false)

  const dir = mkdtempSync(join(tmpdir(), 'dsh-push-switch-'))
  const patch = join(dir, 'cordis.patch.yml')
  writeFileSync(patch, '- id: tool-ask-user\n', 'utf8')
  const fixed = askUserBackupPath(patch, () => 1700000000000)
  check('backup path follows the .bak-<ms> convention', fixed === patch + '.bak-1700000000000', fixed)
  writeFileSync(fixed, 'x', 'utf8')
  const second = askUserBackupPath(patch, () => 1700000000000)
  check('a colliding backup gets an ordinal suffix', second === patch + '.bak-1700000000000-1', second)

  check('next config: timed sets mode and timeout', JSON.stringify(nextAskUserConfig({ other: 1 }, 'timed')) === JSON.stringify({ other: 1, mode: 'timed', timeout: 120 }))
  check('next config: legacy only flips the mode', JSON.stringify(nextAskUserConfig({ mode: 'timed', timeout: 120 }, 'legacy')) === JSON.stringify({ mode: 'legacy', timeout: 120 }))

  check('sync plan: timed desire + unregistered tool waits', askUserSyncPlan('timed', undefined).action === 'wait')
  check('sync plan: timed desire + timed reality is a no-op', askUserSyncPlan('timed', timedTool).action === 'noop')
  check('sync plan: timed desire + legacy reality edits', askUserSyncPlan('timed', legacyTool).action === 'edit')
  check('sync plan: an unset desire is inert even against timed reality', askUserSyncPlan(undefined, timedTool).action === 'inert')
  check('sync plan: a legacy desire is inert (never downgrades)', askUserSyncPlan('legacy', timedTool).action === 'inert')

  check('volatile value: a plain value passes through', volatileValue('timed', 'legacy') === 'timed')
  check('volatile value: a live ref is read through get()', volatileValue({ get: () => 'timed' }, 'legacy') === 'timed')
  check('volatile value: absent falls back', volatileValue(undefined, 'legacy') === 'legacy')

  {
    let written = null
    const ref = { get: () => 'a', [Symbol.for('cosmokit.volatile.write')]: (value) => { written = value } }
    const holder = { field: ref }
    setVolatileValue(holder, 'field', 'b')
    check('volatile write: live refs go through the cosmokit symbol setter', written === 'b' && holder.field === ref)
    const plain = { field: 'x' }
    setVolatileValue(plain, 'field', 'y')
    check('volatile write: plain values are assigned back', plain.field === 'y')
    const stubborn = { field: { get: () => 'x' } }
    setVolatileValue(stubborn, 'field', 'y')
    check('volatile write: a ref without the symbol keeps its value', stubborn.field.get() === 'x')
  }
}

// ── runtime preflight: section 14 drives the product's copyFileSync backup ───────────
// Two same-version nodes on this machine differ in ONE syscall: the harness runtime node
// throws `EPERM: operation not permitted, copyfile` while the DSH-bundled node is fine
// (writeFileSync works on both; os.tmpdir() is C:\Temp on both). Probing here turns a
// misleading wall of 9 backup-EPERM FAILs into one clear BLOCKED line + exit 2, so QA
// never mistakes the wrong-node run for a functional regression.
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-push-preflight-'))
  const src = join(dir, 'probe.txt')
  writeFileSync(src, 'probe', 'utf8')
  let copyFailure = null
  try {
    copyFileSync(src, join(dir, 'probe-copy.txt'))
  } catch (error) {
    copyFailure = error
  }
  if (copyFailure !== null) {
    const passed = checks.filter((entry) => entry.ok).length
    console.log('\n' + String(passed) + '/' + String(checks.length) + ' checks passed before the guard')
    console.log('BLOCKED  section 14 needs a working fs copy (the product backup uses copyFileSync).')
    console.log('copyFileSync failed: ' + (copyFailure.code ?? '') + ' ' + copyFailure.message)
    console.log('请用 DSH 自带 runtime 的 node 跑本自测：')
    console.log('  "D:\\programs\\dsh\\resources\\runtime\\primary-runtime\\dependencies\\node\\bin\\node.exe" plugin-selftest.mjs')
    process.exit(2)
  }
}

// ── 14. 手机作答模式开关 (v0.2.0): end-to-end against a fake host ───────────────────
{
  const legacyTool = { name: 'ask_user_question', parameters: { properties: { questions: {} } } }
  const timedTool = { name: 'ask_user_question', parameters: { properties: { questions: {}, timeout: { type: 'number' } } } }

  /** Fake host half: loader entries, configEditor (edit = apply + hot-swap the tool), tools. */
  function makeSwitchCtx(options = {}) {
    const state = {
      listeners: new Map(),
      tool: 'tool' in options ? options.tool : legacyTool,
      edits: [],
      /** True while an HMR transaction is open: the real host rejects nested configEditor.edit. */
      inTransaction: false,
      entries: [
        { options: { id: 'tool-ask-user', name: 'dsh-tool-ask-user', config: {} }, fiber: { state: 2 } },
        { options: { id: 'push-host', name: 'dsh-push-host', config: {} }, fiber: { state: 2 } },
      ],
    }
    const ctx = {
      on(name, callback) {
        state.listeners.set(name, callback)
      },
      effect(callback) {
        callback()
      },
      interval() {
        return () => {}
      },
      logger: () => ({ info: () => {} }),
      tools: { get: (name) => (name === 'ask_user_question' ? state.tool : undefined) },
      profileContext: { patchPath: options.patchPath },
      configEditor: {
        entries: () => state.entries,
        async edit(entry, change) {
          if (state.inTransaction) throw new Error('HMR transactions cannot be nested')
          state.edits.push({ id: entry.options.id, next: change(entry.options.config ?? {}) })
          if (options.fail && entry.options.id === 'tool-ask-user') throw new Error('Configuration for "tool-ask-user" is overridden by a home patch or command-line overlay')
          if (entry.options.id === 'tool-ask-user') {
            entry.options.config = change(entry.options.config ?? {})
            state.tool = entry.options.config.mode === 'timed' ? timedTool : legacyTool
          } else {
            entry.options.config = change(entry.options.config ?? {})
          }
        },
      },
    }
    return { ctx, state }
  }

  const dir = mkdtempSync(join(tmpdir(), 'dsh-push-switch-e2e-'))
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(patchPath, '- id: preset\n', 'utf8')

  // 14a. the switch is inert without configEditor/tools (the plain makeCtx above has neither).
  {
    const plain = makeCtx()
    apply(plain.ctx, { ...TOKENS, webLog: join(tmpdir(), 'dsh-push-selftest-no-web.log') })
    check('apply() survives a host without configEditor/tools', true)
  }

  // 14b. boot with the desire already timed: backup + edit, exactly once; mirrors stay in memory.
  {
    const made = makeSwitchCtx({ patchPath })
    const cfg = { askUserMode: 'timed' }
    const sw = new AskUserModeSwitch(made.ctx, cfg, () => {})
    sw.start()
    await tick()
    const toolEdits = made.state.edits.filter((edit) => edit.id === 'tool-ask-user')
    check('boot with timed desire edits tool-ask-user once', toolEdits.length === 1, JSON.stringify(made.state.edits))
    check('the edit carries mode timed + timeout 120', toolEdits[0]?.next?.mode === 'timed' && toolEdits[0]?.next?.timeout === 120, JSON.stringify(toolEdits[0]?.next ?? null))
    // Verify the backup with readdirSync + readFileSync only (no copyfile in the test
    // itself): exactly one .bak- file, byte-identical to the pre-edit patch.
    const backupNames = readdirSync(dir).filter((name) => name.startsWith('cordis.patch.yml.bak-'))
    check('the patch file was backed up before the edit', backupNames.length === 1, JSON.stringify(backupNames))
    check('the backup is a byte-for-byte copy of the pre-edit patch', backupNames.length === 1 && readFileSync(join(dir, backupNames[0]), 'utf8') === '- id: preset\n', backupNames[0] ?? 'none')
    check('the actual-state mirror lands in memory as timed', cfg.askUserActual === 'timed', String(cfg.askUserActual))
    check('a successful switch writes nothing to our own entry (defect 3: no status on disk)', made.state.edits.filter((edit) => edit.id === 'push-host').length === 0, JSON.stringify(made.state.edits))
    await sw.sync()
    check('a second sync is idempotent (no extra edit)', made.state.edits.filter((edit) => edit.id === 'tool-ask-user').length === 1)
  }

  // 14c. the default (no desire at all, legacy tool) writes nothing at all.
  {
    const made = makeSwitchCtx({ patchPath })
    const sw = new AskUserModeSwitch(made.ctx, {}, () => {})
    sw.start()
    await tick()
    check('an unset desire is a zero-write boot (status/actual stay in memory)', made.state.edits.length === 0, JSON.stringify(made.state.edits))
  }

  // 14d. the volatile trigger: the settings row flips the desire at runtime.
  {
    const made = makeSwitchCtx({ patchPath })
    const config = { askUserMode: { get: () => 'legacy' } }
    const sw = new AskUserModeSwitch(made.ctx, config, () => {})
    sw.start()
    await tick()
    check('no edit while desire and reality agree', made.state.edits.length === 0)
    config.askUserMode.get = () => 'timed'
    made.state.listeners.get('loader/volatile-update')([['askUserMode']])
    await tick()
    check('volatile-update on askUserMode triggers the switch', made.state.edits.some((edit) => edit.id === 'tool-ask-user' && edit.next.mode === 'timed'), JSON.stringify(made.state.edits))
    made.state.listeners.get('loader/volatile-update')([['askUserStatus']])
    await tick()
    check('a volatile-update on other paths is ignored', made.state.edits.filter((edit) => edit.id === 'tool-ask-user').length === 1)
  }

  // 14e. activation order: the tool registers later, tools/change re-checks.
  {
    const made = makeSwitchCtx({ patchPath, tool: undefined })
    const sw = new AskUserModeSwitch(made.ctx, { askUserMode: 'timed' }, () => {})
    sw.start()
    await tick()
    check('an unregistered tool defers the switch', made.state.edits.length === 0)
    made.state.tool = legacyTool
    made.state.listeners.get('tools/change')()
    await tick()
    check('tools/change re-checks and lands the switch', made.state.edits.some((edit) => edit.id === 'tool-ask-user' && edit.next.mode === 'timed'))
  }

  // 14f. home override: the edit throws, the message lands in the IN-MEMORY askUserStatus.
  {
    const made = makeSwitchCtx({ patchPath, fail: true })
    const cfg = { askUserMode: 'timed' }
    const sw = new AskUserModeSwitch(made.ctx, cfg, () => {})
    sw.start()
    await tick()
    check('a home override lands in the in-memory askUserStatus', String(cfg.askUserStatus ?? '').includes('overridden by a home patch'), String(cfg.askUserStatus))
    check('the failure status never rides configEditor (no push-host edits)', made.state.edits.filter((edit) => edit.id === 'push-host').length === 0, JSON.stringify(made.state.edits))
  }

  // 14g. a missing tool-ask-user entry says so (in memory) instead of throwing or writing.
  {
    const made = makeSwitchCtx({ patchPath })
    made.state.entries = made.state.entries.filter((entry) => entry.options.id !== 'tool-ask-user')
    const cfg = { askUserMode: 'timed' }
    const sw = new AskUserModeSwitch(made.ctx, cfg, () => {})
    sw.start()
    await tick()
    check('a missing tool-ask-user entry reports in memory instead of throwing', String(cfg.askUserStatus ?? '').includes('tool-ask-user'), String(cfg.askUserStatus))
    check('the missing-entry status writes nothing to disk', made.state.edits.length === 0, JSON.stringify(made.state.edits))
  }

  // 14h. HMR transaction guard: a volatile-update fired inside an open HMR transaction must
  // not issue configEditor.edit synchronously (nested transactions throw in the real host).
  {
    const hdir = mkdtempSync(join(tmpdir(), 'dsh-push-switch-hmr-'))
    const hpatch = join(hdir, 'cordis.patch.yml')
    writeFileSync(hpatch, '- id: preset\n', 'utf8')
    const made = makeSwitchCtx({ patchPath: hpatch })
    const config = { askUserMode: { get: () => 'legacy' } }
    const sw = new AskUserModeSwitch(made.ctx, config, () => {})
    sw.start()
    await tick()
    const bootEdits = made.state.edits.length
    config.askUserMode.get = () => 'timed'
    made.state.inTransaction = true
    let thrown = null
    try {
      made.state.listeners.get('loader/volatile-update')([['askUserMode']])
    } catch (error) {
      thrown = error
    }
    made.state.inTransaction = false
    check('a volatile-update inside an HMR transaction does not throw', thrown === null, String(thrown?.message ?? thrown))
    check('the transaction-guarded write is not issued synchronously', made.state.edits.length === bootEdits, JSON.stringify(made.state.edits.slice(bootEdits)))
    await tick()
    const toolEdits = made.state.edits.filter((edit) => edit.id === 'tool-ask-user')
    check('the deferred write lands exactly once outside the transaction', toolEdits.length === 1 && toolEdits[0].next.mode === 'timed', JSON.stringify(made.state.edits.slice(bootEdits)))
  }

  // 14i. P0 regressions: the switch NEVER downgrades — every non-timed desire is fully inert
  // (no tool-ask-user edit, no backup, and since defect 3 not even a status write).
  {
    const cases = [
      { name: 'desired legacy + actual timed', config: { askUserMode: 'legacy' }, tool: timedTool },
      { name: 'desired unset + actual timed', config: {}, tool: timedTool },
      { name: 'desired unset + actual legacy', config: {}, tool: legacyTool },
      { name: 'desired explicitly legacy (live ref) + actual timed', config: { askUserMode: { get: () => 'legacy' } }, tool: timedTool },
    ]
    for (const testCase of cases) {
      const cdir = mkdtempSync(join(tmpdir(), 'dsh-push-switch-nodown-'))
      const cpatch = join(cdir, 'cordis.patch.yml')
      writeFileSync(cpatch, '- id: preset\n', 'utf8')
      const made = makeSwitchCtx({ patchPath: cpatch, tool: testCase.tool })
      const sw = new AskUserModeSwitch(made.ctx, testCase.config, () => {})
      sw.start()
      await tick()
      await sw.sync()
      made.state.listeners.get('tools/change')()
      await tick()
      check('never downgrade: ' + testCase.name + ' writes no tool-ask-user config', made.state.edits.filter((edit) => edit.id === 'tool-ask-user').length === 0, JSON.stringify(made.state.edits))
      check('never downgrade: ' + testCase.name + ' leaves no backup and no other edit behind', readdirSync(cdir).filter((name) => name.startsWith('cordis.patch.yml.bak-')).length === 0 && made.state.edits.length === 0, JSON.stringify({ edits: made.state.edits, files: readdirSync(cdir) }))
    }
  }

  // 14j. THE MARKET-RESTART KILLER (2026-10-25): when this plugin's fiber is being unloaded,
  // `ctx.configEditor` does NOT read as undefined — the context proxy THROWS
  // 'cannot get required service "configEditor" in inactive context'. scheduleSync() runs on
  // setTimeout(0), so a fiber replacement lands between the call and the callback, that throw
  // becomes an unhandled rejection, and the host's installFailLoud turns it into
  // `dsh: fatal load failure` + exit(1). The replacement never binds port 3081 and the market
  // reports "restart failed" five times in a row. A truthiness guard cannot see this.
  {
    // FiberState: PENDING 0, LOADING 1, ACTIVE 2, FAILED 3, DISPOSED 4, UNLOADING 5.
    check('fiberIsActive: ACTIVE is live', fiberIsActive({ fiber: { state: 2 } }) === true)
    check('fiberIsActive: UNLOADING is not live', fiberIsActive({ fiber: { state: 5 } }) === false)
    check('fiberIsActive: DISPOSED is not live', fiberIsActive({ fiber: { state: 4 } }) === false)
    check('fiberIsActive: FAILED is not live', fiberIsActive({ fiber: { state: 3 } }) === false)
    check('fiberIsActive: PENDING is not live', fiberIsActive({ fiber: { state: 0 } }) === false)
    check('fiberIsActive: LOADING is not live', fiberIsActive({ fiber: { state: 1 } }) === false)
    check('fiberIsActive: a bare host without a fiber still works', fiberIsActive({}) === true)
    check('fiberIsActive: a throwing proxy reads as not live', fiberIsActive({
      get fiber() { throw new Error('cannot get required service "configEditor" in inactive context') },
    }) === false)

    // The real reproduction: a ctx whose services THROW instead of being undefined, exactly as
    // cordis does for a cleared store. Before the fix, sync() threw and the promise rejected
    // with no handler.
    const throwing = {
      fiber: { state: 5 },
      get configEditor() {
        throw new Error('cannot get required service "configEditor" in inactive context')
      },
      get tools() {
        throw new Error('cannot get required service "tools" in inactive context')
      },
    }
    const sw = new AskUserModeSwitch(throwing, { askUserMode: 'timed' }, () => {})
    sw.start()
    await tick()
    check('start() on an unloading fiber registers nothing and does not throw', true)
    let syncThrew = null
    let syncRejected = null
    try {
      await sw.sync()
    } catch (error) {
      syncThrew = String(error?.message ?? error)
    }
    check('sync() on an unloading fiber returns quietly instead of throwing', syncThrew === null, String(syncThrew))

    // The fire-and-forget path must attach a rejection handler no matter what happens inside.
    const sw2 = new AskUserModeSwitch(throwing, { askUserMode: 'timed' }, () => {})
    const originalSync = sw2.sync.bind(sw2)
    sw2.sync = () => Promise.reject(new Error('boom from an unloading fiber'))
    sw2.scheduleSync()
    await tick()
    check('scheduleSync() attaches a handler: a rejecting sync leaves no unhandled rejection', true)
    sw2.sync = originalSync

    // A still-ACTIVE fiber must keep working exactly as before (no behavior change for the host).
    const ldir = mkdtempSync(join(tmpdir(), 'dsh-push-live-'))
    const lpatch = join(ldir, 'cordis.patch.yml')
    writeFileSync(lpatch, '- id: preset\n', 'utf8')
    const live = makeSwitchCtx({ patchPath: lpatch })
    live.ctx.fiber = { state: 2 }
    const sw3 = new AskUserModeSwitch(live.ctx, { askUserMode: 'timed' }, () => {})
    check('fiberIsActive sees an ACTIVE (state 2) host ctx as live', fiberIsActive(live.ctx) === true)
    sw3.start()
    await tick()
    check('an ACTIVE fiber still lands the upgrade exactly once', live.state.edits.filter((edit) => edit.id === 'tool-ask-user').length === 1, JSON.stringify(live.state.edits))
  }
}

// ---------------------------------------------------------------------------
// 15. 通行证自助发号（v0.3.0）：URL 拼装、通行证文本、名字清洗、HTTP 结果、凭据写回、状态机
// ---------------------------------------------------------------------------
check('provision: url joins without double slash', provisionUrl('https://x/provision/', '/issue') === 'https://x/provision/issue')
check('provision: url accepts bare path', provisionUrl('https://x/provision', 'list') === 'https://x/provision/list')
check('provision: pass text carries base/topic/token',
  passText({ relayBase: 'https://ntfy.cpyh.xyz', topic: 'dsh-alice', readToken: 'tk_aaa' })
    === 'dshpush://v1?base=https://ntfy.cpyh.xyz&topic=dsh-alice&token=tk_aaa')
check('provision: pass text degrades to a bare scheme when nothing is known', passText({}) === 'dshpush://v1')
check('provision: suggested name is prefixed and regex-clean',
  provisionNameSuggest({ host: 'Laptop' }) === 'dsh-laptop')
check('provision: an already prefixed name is not doubled', provisionNameSuggest({ host: 'dsh-vm1' }) === 'dsh-vm1')
check('provision: a Chinese instance name falls back to dsh-local',
  provisionNameSuggest({ host: '', webName: '`' }) === 'dsh-local')
check('provision: punctuation in a host name is flattened into dashes',
  /^[a-z0-9][a-z0-9-]{1,30}$/.test(provisionNameSuggest({ host: 'A B/C' })))

const provNoToken = await provisionCall({ base: 'https://x/provision', path: 'issue', body: { name: 'dsh-a' } })
check('provision: missing secret is reported in Chinese, no fetch attempted',
  provNoToken.ok === false && String(provNoToken.error).includes('DSH_PUSH_PROVISION_TOKEN'))

const provCalls = []
const provFetch = async (url, init) => {
  provCalls.push({ url, init })
  if (url.endsWith('/issue')) {
    return { ok: true, status: 200, async text() { return JSON.stringify({ topic: 'dsh-a', phoneUser: 'dsh-a-phone', pubUser: 'dsh-a-pub', readToken: 'tk_read', writeToken: 'tk_write' }) } }
  }
  if (url.endsWith('/revoke')) {
    return { ok: true, status: 200, async text() { return JSON.stringify({ revoked: ['dsh-a-phone', 'dsh-a-pub'], missing: [] }) } }
  }
  if (url.endsWith('/list')) {
    return { ok: true, status: 200, async text() { return JSON.stringify({ passes: [{ name: 'dsh-a', users: ['dsh-a-phone'], topics: [{ topic: 'dsh-a', permission: 'read-only' }] }] }) } }
  }
  return { ok: false, status: 409, async text() { return JSON.stringify({ error: 'name already issued' }) } }
}
const provGood = await provisionCall({ base: 'https://x/provision', token: 'sek', path: 'issue', body: { name: 'dsh-a' }, fetchImpl: provFetch })
check('provision: a 200 issue returns the parsed payload',
  provGood.ok === true && provGood.data.readToken === 'tk_read' && provGood.data.topic === 'dsh-a')
check('provision: the bearer header is sent',
  provCalls[provCalls.length - 1].init.headers.Authorization === 'Bearer sek')
const provClash = await provisionCall({ base: 'https://x/provision', token: 'sek', path: 'clash', body: { name: 'dsh-z' }, fetchImpl: provFetch })
check('provision: a 409 keeps the server reason and the status code',
  provClash.ok === false && String(provClash.error).includes('409') && String(provClash.error).includes('name already issued'))
const provDown = await provisionCall({ base: 'https://x/provision', token: 'sek', path: 'list', fetchImpl: async () => { throw new Error('ECONNREFUSED') } })
check('provision: an unreachable service says so instead of throwing',
  provDown.ok === false && String(provDown.error).includes('不可达'))

const provDir = mkdtempSync(join(tmpdir(), 'dsh-push-prov-'))
const provFile = join(provDir, 'nested', 'credentials.json')
const provSaved = writeCredentialsPatch(provFile, { topic: 'dsh-a', ntfyToken: 'tk_write', phoneToken: 'tk_read' }, { stamp: () => 'T1' })
const provSavedBack = JSON.parse(readFileSync(provFile, 'utf8'))
check('provision: credentials write-back creates missing directories and the file',
  provSaved.created === true && provSavedBack.topic === 'dsh-a' && provSavedBack.ntfyToken === 'tk_write' && provSavedBack.phoneToken === 'tk_read')
writeCredentialsPatch(provFile, { topic: 'dsh-b' }, { stamp: () => 'T2' })
const provKeptBack = JSON.parse(readFileSync(provFile, 'utf8'))
const provBackups = readdirSync(join(provDir, 'nested')).filter((name) => name.includes('credentials.json.bak-'))
check('provision: a second write keeps unrelated keys and leaves a backup behind',
  provKeptBack.topic === 'dsh-b' && provKeptBack.ntfyToken === 'tk_write' && provBackups.length === 1,
  'provBackups=' + JSON.stringify(provBackups))
check('provision: an empty patch value never clobbers a stored secret',
  (() => { writeCredentialsPatch(provFile, { ntfyToken: '' }, { stamp: () => 'T3' }); return JSON.parse(readFileSync(provFile, 'utf8')).ntfyToken === 'tk_write' })())

// the panel round-trip: browser writes volatile request -> host provCalls the service -> mirrors back
const panelConfig = { provisionName: '', provisionAction: '', provisionSeq: '', provisionResult: '', provisionList: '', provisionDefault: '', provisionDone: '' }
const panelResolved = { relayBase: 'https://ntfy.cpyh.xyz', provisionBase: 'https://x/provision', provisionToken: 'sek' }
const panelLogs = []
const panel = new PassProvisioner(
  { on: () => () => {} }, panelConfig, panelResolved, (m) => panelLogs.push(String(m)),
  { fetchImpl: provFetch, credentialsPath: provFile, writeCredentialsPatch: (p, patch) => writeCredentialsPatch(p, patch, { stamp: () => 'T4' }) },
)
panel.publishDefault()
// the two lists must stay in step: index.js says which keys may come from the file,
// credentials.mjs decides which file keys are read at all. regToken tripped over this in
// 2026-10-12 and provisionToken again on 2026-10-17 (the panel said 缺少发号密钥 on a file
// that did have it) — so the sync is an assertion now, not a comment.
const outOfSync = CREDENTIAL_CONFIG_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(CREDENTIAL_KEYS, key))
check('credentials: every CREDENTIAL_CONFIG_KEYS entry is actually readable (two lists in sync)',
  outOfSync.length === 0, 'missing from CREDENTIAL_KEYS: ' + outOfSync.join(', '))
const parsedProv = parseCredentials(JSON.stringify({ v: '1', topic: 'dsh-a', provisionToken: 'sek-really-long-value', provisionBase: 'https://x/provision' }))
check('credentials: provisionToken and provisionBase survive parseCredentials',
  parsedProv.value.provisionToken === 'sek-really-long-value' && parsedProv.value.provisionBase === 'https://x/provision',
  JSON.stringify(Object.keys(parsedProv.value)))
check('credentials: provisionToken counts as a secret, so diagnostics mask it instead of echoing it',
  (() => {
    const described = JSON.stringify(describeSecrets(parsedProv.value))
    return described.includes('provisionToken=') && !described.includes('sek-really-long-value')
  })())
check('provision: boot publishes a suggested name for the panel to prefill',
  panelConfig.provisionDefault === 'dsh-local')
panelConfig.provisionName = 'dsh-a'
panelConfig.provisionAction = 'issue'
panelConfig.provisionSeq = 'seq-1'
await panel.run()
check('provision: issue mirrors the pass text into provisionResult',
  panelConfig.provisionResult === 'dshpush://v1?base=https://ntfy.cpyh.xyz&topic=dsh-a&token=tk_read',
  'got ' + panelConfig.provisionResult)
check('provision: issue refreshes the list mirror with the issued pass',
  String(panelConfig.provisionList).includes('dsh-a'))
check('provision: the list mirror carries only what the panel renders (no user lists)',
  (() => {
    const rows = JSON.parse(String(panelConfig.provisionList))
    return rows.length === 1 && Object.keys(rows[0]).join(',') === 'name,topics'
  })())
check('provision: issue echoes provisionDone with the same seq so the row can un-busy',
  panelConfig.provisionDone === 'seq-1')
check('provision: issue writes topic + both tokens into the credentials file',
  JSON.parse(readFileSync(provFile, 'utf8')).topic === 'dsh-a')
check('provision: the write-back keeps the file aliases in step so a human is never misled',
  (() => {
    const back = JSON.parse(readFileSync(provFile, 'utf8'))
    return back.ntfyToken === back.writeToken && back.phoneToken === back.readToken
  })())
const provBeforeRepeat = provCalls.length
await panel.run()
check('provision: the same seq never issues twice (double click is idempotent)',
  provCalls.length === provBeforeRepeat)
panelConfig.provisionAction = 'nonsense'
panelConfig.provisionSeq = 'seq-2'
await panel.run()
check('provision: an unknown action is ignored and leaves the result untouched',
  provCalls.length === provBeforeRepeat && panelConfig.provisionDone === 'seq-1')
panelConfig.provisionAction = 'revoke'
panelConfig.provisionSeq = 'seq-3'
await panel.run()
check('provision: revoke reports the outcome in Chinese',
  String(panelConfig.provisionResult).includes('已吊销') && panelConfig.provisionDone === 'seq-3')

// the fiber-restart trap: the browser's volatile write lands in cordis.patch.yml, which
// hot-restarts this plugin's fiber and zeroes the in-memory mirrors — the panel would show
// a result for one moment and then go blank. The store lives on globalThis instead.
check('provision: the last outcome is parked on the process-level store',
  (() => {
    const saved = panelStore()[panel.storeKey()]
    return !!saved && String(saved.done) === 'seq-3' && String(saved.result).includes('已吊销')
  })())
const rebornConfig = { provisionName: '', provisionAction: '', provisionSeq: '', provisionResult: '', provisionList: '', provisionDefault: '', provisionDone: '' }
const reborn = new PassProvisioner(
  { on: () => () => {} }, rebornConfig,
  { relayBase: 'https://ntfy.cpyh.xyz', provisionBase: 'https://x/provision', provisionToken: 'sek', host: '' },
  () => {},
  { fetchImpl: provFetch, credentialsPath: provFile },
)
reborn.start()
check('provision: a restarted fiber re-mirrors the stored outcome so the panel never blanks itself',
  String(rebornConfig.provisionResult).includes('已吊销') && String(rebornConfig.provisionList).includes('dsh-a')
    && rebornConfig.provisionDone === 'seq-3')
const handoffConfig = { provisionName: '', provisionAction: '', provisionSeq: '', provisionResult: '', provisionList: '', provisionDefault: '', provisionDone: '' }
const handoff = new PassProvisioner(
  { on: () => () => {} }, handoffConfig,
  { relayBase: 'https://ntfy.cpyh.xyz', provisionBase: 'https://x/provision', provisionToken: 'sek', host: '' },
  () => {},
  { fetchImpl: provFetch, credentialsPath: provFile },
)
handoffConfig.provisionAction = 'refresh'
handoffConfig.provisionSeq = 'seq-4'
await handoff.run()
check('provision: a dying fiber hands its result to the fiber that replaced it',
  String(rebornConfig.provisionDone) === 'seq-4')
const failed = checks.filter((entry) => !entry.ok)
console.log('\n' + String(checks.length - failed.length) + '/' + String(checks.length) + ' checks passed')
if (failed.length > 0) {
  console.log('failed: ' + failed.map((entry) => entry.name).join(' | '))
  process.exitCode = 1
}
