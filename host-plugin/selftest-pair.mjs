/**
 * Offline self-test for the pairing QR box (v0.6.0): drives `PairBox` against fake config /
 * accessor / host objects, so the payload shape and the volatile mirroring can be checked
 * without a running DSH host.
 *
 *   node selftest-pair.mjs
 *
 * What it locks down (each one is a defect that would silently ship a useless QR):
 *   - the payload keeps base/topic/token verbatim (old Apps parse them) and percent-encodes web;
 *   - `web` prefers the tunnel address + `?k=` secret, and falls back to the local web.log URL;
 *   - no credentials → no QR, and the row explains why instead of drawing an empty square;
 *   - the matrix travels as a base64 bit-map that decodes back to the same modules;
 *   - a repeated pairSeq must NOT regenerate (the browser writes it, volatile writes restart us);
 *   - a restarted fiber replays the previous result instead of blanking the row.
 */
import { PairBox, pairStore } from './lib/index.js'
import { pairPayload, pairQrMatrix } from './lib/pairqr.mjs'

let passed = 0
let failed = 0

function check(name, ok, detail) {
  if (ok) {
    passed += 1
    console.log('PASS  ' + name)
  } else {
    failed += 1
    console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail))
  }
}

function makeConfig(values = {}) {
  return { ...values }
}

/** Minimal cordis-ish ctx: records listeners so the test can fire volatile-update. */
function makeCtx() {
  const listeners = new Map()
  return {
    fiber: { state: 2 },
    listeners,
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, handler)
    },
  }
}

function makeHost(webUrlValue = '') {
  const lines = []
  return {
    lines,
    log(message) { lines.push(String(message)) },
    webUrl() { return webUrlValue },
  }
}

function makeAccessor({ mode = '', url = '', secret = '' } = {}) {
  return {
    read(key) {
      if (key === 'remoteUrl') return url
      if (key === 'remoteSecret') return secret
      return ''
    },
    readAny(key) {
      if (key === 'linkMode') return mode
      if (key === 'remoteSecret') return secret
      return ''
    },
  }
}

function decodeBits(bits, count) {
  const raw = Buffer.from(bits, 'base64')
  const out = new Uint8Array(count * count)
  for (let i = 0; i < count * count; i++) out[i] = (raw[i >> 3] & (128 >> (i & 7))) ? 1 : 0
  return out
}

// ── 1. payload shape ────────────────────────────────────────────────────────────
{
  const base = 'https://ntfy.example.test'
  const topic = 'dsh-alice'
  const token = 'tk_abc123'
  const web = 'https://tunnel.example.test/?k=s3cret'
  const text = pairPayload({ relayBase: base, topic, readToken: token, web, name: 'alice-host' })
  check('payload: starts with the v1 scheme', text.startsWith('dshpush://v1?'), text)
  check('payload: base stays verbatim', text.includes('base=' + base), text)
  check('payload: topic stays verbatim', text.includes('topic=' + topic), text)
  check('payload: token stays verbatim', text.includes('token=' + token), text)
  check('payload: web is percent-encoded', text.includes('web=' + encodeURIComponent(web)), text)
  check('payload: name travels along', text.includes('name=alice-host'), text)
  const bare = pairPayload({ relayBase: base, topic, readToken: token })
  check('payload: no web / name keys when absent', !bare.includes('web=') && !bare.includes('name='), bare)
}

// ── 2. matrix → bits round-trip ──────────────────────────────────────────────────
{
  const text = pairPayload({ relayBase: 'https://ntfy.example.test', topic: 'dsh-a', readToken: 'tk_a' })
  const matrix = pairQrMatrix(text)
  const back = decodeBits(matrix.bits, matrix.count)
  let dark = 0
  for (const bit of back) dark += bit
  check('matrix: count is a sane QR size', matrix.count >= 21 && matrix.count <= 177, String(matrix.count))
  check('matrix: bits decode to count×count modules', back.length === matrix.count * matrix.count)
  check('matrix: has a plausible dark ratio', dark > back.length * 0.2 && dark < back.length * 0.8, dark + '/' + back.length)
  check('matrix: bits payload stays small', matrix.bits.length < 1024, matrix.bits.length + ' chars')
}

// ── 3. tunnel mode: web = public url + secret ───────────────────────────────────
{
  const config = makeConfig({ relayBase: 'https://ntfy.example.test', topic: 'dsh-a', phoneToken: 'tk_a' })
  const host = makeHost('http://127.0.0.1:3081/?token=LOCAL')
  const box = new PairBox(makeCtx(), config, { host: 'alice-host' }, host, host.log, {
    credentialsPath: 'C:/creds.json',
    accessor: makeAccessor({ mode: 'tunnel', url: 'https://tunnel.example.test/', secret: 'k-1' }),
  })
  const web = box.webEntry()
  check('webEntry: tunnel mode adds the secret', web === 'https://tunnel.example.test/?k=k-1', web)
  const text = box.payload()
  check('payload: carries the tunnel entry', text.includes('web=' + encodeURIComponent(web)), text)
}

// ── 4. tailnet mode falls back to the local web.log URL ─────────────────────────
{
  const config = makeConfig({ relayBase: 'https://ntfy.example.test', topic: 'dsh-a', phoneToken: 'tk_a' })
  const host = makeHost('http://100.64.0.7:3081/?token=LOCAL')
  const box = new PairBox(makeCtx(), config, { host: 'alice-host' }, host, host.log, {
    credentialsPath: 'C:/creds.json',
    accessor: makeAccessor({ mode: 'tailnet', url: 'https://tunnel.example.test/', secret: 'k-1' }),
  })
  check('webEntry: tailnet mode ignores the tunnel', box.webEntry() === 'http://100.64.0.7:3081/?token=LOCAL', box.webEntry())
}

// ── 5. no web entry at all → payload still pair-able ────────────────────────────
{
  const config = makeConfig({ relayBase: 'https://ntfy.example.test', topic: 'dsh-a', phoneToken: 'tk_a' })
  const host = makeHost('')
  const box = new PairBox(makeCtx(), config, {}, host, host.log, { credentialsPath: 'C:/creds.json' })
  check('payload: no web key when the host has no web.log', !box.payload().includes('web='), box.payload())
}

// ── 6. refresh mirrors every volatile field ─────────────────────────────────────
{
  const config = makeConfig({ relayBase: 'https://ntfy.example.test', topic: 'dsh-a', phoneToken: 'tk_a' })
  const host = makeHost('http://100.64.0.7:3081/?token=LOCAL')
  const box = new PairBox(makeCtx(), config, { host: 'alice-host' }, host, host.log, { credentialsPath: 'C:/creds.json' })
  box.refresh()
  check('refresh: carries the module count', typeof config.pairCount === 'number' && config.pairCount >= 21, String(config.pairCount))
  check('refresh: carries the bit-map', typeof config.pairBits === 'string' && config.pairBits.length > 100, String(config.pairBits).length)
  check('refresh: carries the payload text', typeof config.pairText === 'string' && config.pairText.startsWith('dshpush://v1?'), config.pairText)
  check('refresh: status mentions the QR is ready', String(config.pairStatus).includes('已生成'), String(config.pairStatus))
  check('refresh: stamps a done marker', String(config.pairDone).length > 0, String(config.pairDone))
  check('refresh: leaves a log line', host.lines.some((line) => line.includes('配对二维码已生成')), JSON.stringify(host.lines))
}

// ── 7. v0.7.6: missing credentials → auto-enroll, never draw a fake QR ────────
// 二维码存在的意义就是「不用手工配」。所以缺凭据时不再报「请先配 relay/topic/readToken」，
// 而是当场走一次免密钥 /enroll；开通失败才把原因写进 pairStatus。
{
  const config = makeConfig({})
  const host = makeHost('')
  const calls = []
  const box = new PairBox(makeCtx(), config, {}, host, host.log, {
    credentialsPath: 'C:/creds.json',
    enrollCall: async (opts) => { calls.push(opts); return { ok: false, error: 'quota exceeded' } },
  })
  box.refresh()
  box.refresh()   // 同一请求号不得重复开通，否则连点会把日配额烧光
  check('missing creds: module count stays zero', config.pairCount === 0, String(config.pairCount))
  check('missing creds: no bit-map', (config.pairBits ?? '') === '', String(config.pairBits))
  check('missing creds: auto-enroll fires exactly once', calls.length === 1, JSON.stringify(calls.length))
  await new Promise((r) => setTimeout(r, 30))
  check('missing creds: failure is explained in status', String(config.pairStatus).includes('自助开通失败'), String(config.pairStatus))
}

// ── 7b. v0.7.6: auto-enroll success feeds the QR in one shot ───────────────────
{
  const config = makeConfig({ pairSeq: 'seq-auto-1' })
  const host = makeHost('http://100.64.0.7:3081/?token=LOCAL')
  const resolved = { host: 'auto-host' }
  const written = []
  const box = new PairBox(makeCtx(), config, resolved, host, host.log, {
    credentialsPath: '',
    enrollCall: async () => ({ ok: true, data: { topic: 'dsh-auto', readToken: 'tk_read', writeToken: 'tk_write', relayBase: 'https://ntfy.example.test' } }),
    writeCredentialsPatch: (path, patch) => { written.push(patch); return { path } },
  })
  box.refresh()
  await new Promise((r) => setTimeout(r, 60))
  check('auto-enroll: memory resolved gets the new topic', resolved.topic === 'dsh-auto', String(resolved.topic))
  check('auto-enroll: the QR is produced without a second click', typeof config.pairCount === 'number' && config.pairCount >= 21, String(config.pairCount))
  check('auto-enroll: payload carries the fresh token', String(config.pairText).includes('token=tk_read'), String(config.pairText))
  check('auto-enroll: done echoes the seq that triggered it', String(config.pairDone) === 'seq-auto-1', String(config.pairDone))
}

// ── 8. pairSeq drives exactly one refresh ──────────────────────────────────────
{
  const config = makeConfig({ relayBase: 'https://ntfy.example.test', topic: 'dsh-a', phoneToken: 'tk_a' })
  const host = makeHost('http://100.64.0.7:3081/?token=LOCAL')
  const ctx = makeCtx()
  const box = new PairBox(ctx, config, { host: 'alice-host' }, host, host.log, { credentialsPath: 'C:/creds.json' })
  box.start()
  const fire = ctx.listeners.get('loader/volatile-update')
  check('start: listens for volatile updates', typeof fire === 'function')
  config.pairSeq = 'seq-1'
  fire([['pairSeq']])
  await new Promise((resolve) => setTimeout(resolve, 20))
  check('pairSeq: a new seq generates', config.pairCount >= 21, String(config.pairCount))
  const firstDone = config.pairDone
  const firstBits = config.pairBits
  fire([['pairSeq']])
  await new Promise((resolve) => setTimeout(resolve, 20))
  check('pairSeq: the same seq does not regenerate', config.pairDone === firstDone && config.pairBits === firstBits, String(config.pairDone) + ' vs ' + firstDone)
  fire([['pairOthers']])
  await new Promise((resolve) => setTimeout(resolve, 20))
  check('pairSeq: unrelated keys are ignored', config.pairDone === firstDone, String(config.pairDone))
  config.pairSeq = 'seq-2'
  fire([['pairSeq']])
  await new Promise((resolve) => setTimeout(resolve, 20))
  check('pairSeq: a newer seq regenerates', config.pairDone !== firstDone, String(config.pairDone))
}

// ── 9. a restarted fiber replays the stored result ─────────────────────────────
{
  const config = makeConfig({ relayBase: 'https://ntfy.example.test', topic: 'dsh-a', phoneToken: 'tk_a' })
  const host = makeHost('http://100.64.0.7:3081/?token=LOCAL')
  const deps = { credentialsPath: 'C:/creds.json' }
  const first = new PairBox(makeCtx(), config, { host: 'alice-host' }, host, host.log, deps)
  first.refresh()
  const want = { count: config.pairCount, bits: config.pairBits, text: config.pairText }
  const fresh = makeConfig({})
  const second = new PairBox(makeCtx(), fresh, { host: 'alice-host' }, host, host.log, deps)
  second.applyStore()
  check('store: module count survives a fiber restart', fresh.pairCount === want.count, String(fresh.pairCount) + ' vs ' + want.count)
  check('store: bit-map survives a fiber restart', fresh.pairBits === want.bits)
  check('store: payload survives a fiber restart', fresh.pairText === want.text)
  check('store: the key is per host+credentials', second.storeKey() === first.storeKey(), second.storeKey())
  pairStore()[first.storeKey()] = undefined
}

// ── 10. web entry length guard ────────────────────────────────────────────────
{
  const config = makeConfig({ relayBase: 'https://ntfy.example.test', topic: 'dsh-a', phoneToken: 'tk_a' })
  const long = 'https://example.test/?k=' + 'x'.repeat(600)
  const host = makeHost('')
  const box = new PairBox(makeCtx(), config, { host: 'alice-host' }, host, host.log, {
    credentialsPath: 'C:/creds.json',
    accessor: makeAccessor({ mode: 'tunnel', url: long, secret: 'x' }),
  })
  box.refresh()
  check('guard: an absurd web entry refuses instead of making an unscannable code', config.pairCount === 0 && String(config.pairStatus).includes('过长'), String(config.pairStatus).slice(0, 80))
}

// ── 11. v0.7.3: the done marker must echo the seq (that is what un-busies the button) ──
{
  const config = makeConfig({ relayBase: 'https://ntfy.example.test', topic: 'dsh-a', phoneToken: 'tk_a', pairSeq: 'seq-abc_1' })
  const host = makeHost('http://100.64.0.7:3081/?token=LOCAL')
  const box = new PairBox(makeCtx(), config, { host: 'alice-host' }, host, host.log, { credentialsPath: 'C:/creds.json' })
  box.refresh()
  // 页面靠 `done === seq` 解锁按钮。以前 done 是 Date.now()，这个等式永远不成立，
  // 只能干等 30s 硬超时 —— 用户看到的就是「点了转很久」。
  check('done marker: echoes the pairSeq so the button un-busies', String(config.pairDone) === 'seq-abc_1', String(config.pairDone))
}

// ── 12. v0.7.3: a failed refresh must also survive the fiber restart ───────────
{
  const deps = { credentialsPath: 'C:/creds-fail.json' }
  const config = makeConfig({ relayBase: '', topic: '', phoneToken: '' })
  const host = makeHost('')
  const first = new PairBox(makeCtx(), config, { host: 'fail-host' }, host, host.log, {
    ...deps,
    enrollCall: async () => ({ ok: false, error: 'offline' }),
  })
  first.refresh()
  await new Promise((r) => setTimeout(r, 30))
  check('failure: status explains what is missing', String(config.pairStatus).includes('自助开通失败'), String(config.pairStatus))
  const fresh = makeConfig({})
  const second = new PairBox(makeCtx(), fresh, { host: 'fail-host' }, host, host.log, deps)
  second.applyStore()
  // 失败结果以前只写 volatile、不落 store ⇒ 热重启后提示消失，页面变成「什么都没发生」。
  check('failure: the reason survives a fiber restart', String(fresh.pairStatus).includes('自助开通失败'), String(fresh.pairStatus))
  pairStore()[first.storeKey()] = undefined
}

// ── 13. v0.7.4: a fresh fiber must self-heal when pairSeq outlived the fiber that wrote it ──
// 用户 m20942 报障的复现：浏览器写 pairSeq → 落盘 cordis.patch.yml → 本插件 fiber 热重启，
// 触发 refresh() 的老 fiber 在重启中被打掉，点阵写进了即将丢弃的旧 config；新 fiber 起来时
// store 还是空的，而那条 volatile-update 早已派发完毕 ⇒ 页面永远等不到 pairCount/pairBits。
{
  const deps = { credentialsPath: 'C:/creds-restart.json' }
  const host = makeHost('http://100.64.0.7:3081/?token=LOCAL')
  // 模拟「重启后」：persisted pairSeq 有值，但 store 是空的（老 fiber 的结果丢了）。
  const fresh = makeConfig({
    relayBase: 'https://ntfy.example.test', topic: 'dsh-a', phoneToken: 'tk_a',
    pairSeq: 'seq-restart-1',
  })
  delete pairStore()['pair|alice-host|C:/creds-restart.json']
  const box = new PairBox(makeCtx(), fresh, { host: 'alice-host' }, host, host.log, deps)
  box.start()
  check('restart: a pending pairSeq schedules a catch-up refresh', box.scheduled === true || fresh.pairCount > 0,
    'scheduled=' + String(box.scheduled) + ' count=' + String(fresh.pairCount))
  await new Promise((resolve) => setTimeout(resolve, 40))
  check('restart: the catch-up actually fills the bit-map', fresh.pairCount > 0 && String(fresh.pairBits).length > 16,
    'count=' + String(fresh.pairCount))
  check('restart: the catch-up marks the seq done (no restart loop)', String(fresh.pairDone) === 'seq-restart-1',
    String(fresh.pairDone))
  // 再起一个 fiber（done === seq 已对账）⇒ 不能重复算，否则每次热重启都白跑一遍。
  const again = new PairBox(makeCtx(), makeConfig({
    relayBase: 'https://ntfy.example.test', topic: 'dsh-a', phoneToken: 'tk_a', pairSeq: 'seq-restart-1',
  }), { host: 'alice-host' }, host, host.log, deps)
  again.start()
  check('restart: an already-finished seq does not recompute', again.scheduled === false, 'scheduled=' + String(again.scheduled))
  pairStore()[box.storeKey()] = undefined
}

// ── 14. v0.7.4: start() must wire up even while the fiber is still LOADING ────
// 用户 m20942 的真因：`apply()` 执行期间 fiber.state 是 LOADING(1) 而不是 ACTIVE(2)，
// 而 start() 原来第一行就是 `if (!fiberIsActive(ctx)) return` ⇒ 监听器一个都没注册、
// 冷启动补算也没跑，表现就是「点按钮转 12 秒自己恢复，码和提示都不出现」。
// 假 ctx 必须用 state=1，否则这条永远测不出来（原来所有用例都用 2，正好把它盖住了）。
{
  const deps = { credentialsPath: 'C:/creds-loading.json' }
  const host = makeHost('http://100.64.0.7:3081/?token=LOCAL')
  const loadingCtx = { fiber: { state: 1 }, listeners: new Map(), on(e, h) { if (!this.listeners.has(e)) this.listeners.set(e, h) } }
  const config = makeConfig({
    relayBase: 'https://ntfy.example.test', topic: 'dsh-a', phoneToken: 'tk_a',
    pairSeq: 'seq-loading-1',
  })
  delete pairStore()['pair|alice-host|C:/creds-loading.json']
  const box = new PairBox(loadingCtx, config, { host: 'alice-host' }, host, host.log, deps)
  box.start()
  check('loading: start() still subscribes while the fiber is LOADING',
    loadingCtx.listeners.has('loader/volatile-update'), 'listeners=' + String(loadingCtx.listeners.size))
  // 真实宿主在下一个宏任务时已经 ACTIVE —— schedule() 里的守卫正是留给这个时刻判断的。
  loadingCtx.fiber.state = 2
  await new Promise((resolve) => setTimeout(resolve, 40))
  check('loading: the catch-up runs while the fiber is LOADING',
    config.pairCount > 0 && String(config.pairBits).length > 16, 'count=' + String(config.pairCount))
  pairStore()[box.storeKey()] = undefined
}

console.log('')
console.log(String(passed) + '/' + String(passed + failed) + ' checks passed')
if (failed > 0) process.exitCode = 1
