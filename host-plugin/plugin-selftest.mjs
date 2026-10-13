/**
 * Offline self-test for the host plugin: drives `apply()` against a fake Cordis context and a
 * fake relay, so both layers can be checked without a running DSH host.
 *
 *   node plugin-selftest.mjs
 *
 * It imports the real `lib/index.js`; a local `node_modules/@deepseek-ai/schemastery` junction
 * is enough, the host provides that peer with its own closure at runtime.
 */
import { apply, resolveConfig } from './lib/index.js'

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
  apply(ctx, { ...TOKENS, webName: 'win-test' })
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
  check('no #web trailer without webBase', !body.includes('#web'), body)
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
  apply(ctx, { ...TOKENS, webName: 'win-test' })
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

const failed = checks.filter((entry) => !entry.ok)
console.log('\n' + String(checks.length - failed.length) + '/' + String(checks.length) + ' checks passed')
if (failed.length > 0) {
  console.log('failed: ' + failed.map((entry) => entry.name).join(' | '))
  process.exitCode = 1
}
