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

// ── 7. missing credentials → refuse, explain, never draw a fake QR ──────────────
{
  const config = makeConfig({})
  const host = makeHost('')
  const box = new PairBox(makeCtx(), config, {}, host, host.log, { credentialsPath: 'C:/creds.json' })
  box.refresh()
  check('missing creds: module count stays zero', config.pairCount === 0, String(config.pairCount))
  check('missing creds: no bit-map', (config.pairBits ?? '') === '', String(config.pairBits))
  check('missing creds: status explains what is missing', String(config.pairStatus).includes('凭据不完整'), String(config.pairStatus))
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
  const first = new PairBox(makeCtx(), config, { host: 'fail-host' }, host, host.log, deps)
  first.refresh()
  check('failure: status explains what is missing', String(config.pairStatus).includes('凭据不完整'), String(config.pairStatus))
  const fresh = makeConfig({})
  const second = new PairBox(makeCtx(), fresh, { host: 'fail-host' }, host, host.log, deps)
  second.applyStore()
  // 失败结果以前只写 volatile、不落 store ⇒ 热重启后提示消失，页面变成「什么都没发生」。
  check('failure: the reason survives a fiber restart', String(fresh.pairStatus).includes('凭据不完整'), String(fresh.pairStatus))
  pairStore()[first.storeKey()] = undefined
}

console.log('')
console.log(String(passed) + '/' + String(passed + failed) + ' checks passed')
if (failed > 0) process.exitCode = 1
