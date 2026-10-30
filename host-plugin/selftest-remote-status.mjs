/**
 * v0.7.11 自测：「远程访问卡在隧道建立中…」必须变成一句能照做的说明。
 *
 * 用户报障（m128886 / m128888）：插件页永远显示 `状态：隧道建立中…`，而 cloudflared
 * 其实早就失败了 —— 失败原因只写进日志，从来没回到设置行。这份自测钉住四件事：
 *
 *   1. 引擎把错误交回来时（start() 的 state.error），面板必须显示，不能当成「还在建立」；
 *   2. 隧道层的异步失败（onError 回调）要实时落到 remoteStatus；
 *   3. 三者都不说话的静默卡死，75 秒后要有兜底文案（这里用 20ms 跑）；
 *   4. 连续失败 3 次就停手并说明「点重建隧道」，而不是永远重试。
 *
 *   node selftest-remote-status.mjs
 */
import { RemoteAccessor } from './lib/index.js'
import { RemoteAccess } from './lib/remote.js'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let pass = 0
let fail = 0
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log('PASS  ' + name) } else { fail += 1; console.log('FAIL  ' + name + (detail ? '  —— ' + detail : '')) }
}
function tick(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 最小的 accessor 宿主：volatile 就是普通对象，不落盘、不碰 fiber。 */
function makeAccessor(makeEngine) {
  const config = {}
  const acc = new RemoteAccessor({ fiber: { state: 2 } }, config, {}, { log: () => {} }, () => {}, { makeEngine })
  acc.saveStore = () => {} // storeKey 需要真实 agent，这里只验设置行
  return { acc, config }
}

// ── 1. 引擎把「找不到 cloudflared」交回来 → 必须显示 ────────────────────────────
{
  const { acc, config } = makeAccessor(() => ({
    start: async () => ({ running: true, url: '', error: '找不到 cloudflared，自动安装也失败：getaddrinfo ENOTFOUND api.github.com' }),
    dispose() {},
  }))
  await acc.up()
  check(config.remotePhase === '隧道未建立', '1 起不来时 phase 是「隧道未建立」', String(config.remotePhase))
  check(String(config.remoteStatus).includes('ENOTFOUND'), '1 原始错误显示在设置行', String(config.remoteStatus))
}

// ── 2. 网关本身没起来 → 「未运行」+ 原因 ───────────────────────────────────────
{
  const { acc, config } = makeAccessor(() => ({
    start: async () => ({ running: false, url: '', error: '网关监听失败：EADDRINUSE' }),
    dispose() {},
  }))
  await acc.up()
  check(config.remotePhase === '未运行', '2 网关失败时 phase 是「未运行」', String(config.remotePhase))
  check(String(config.remoteStatus).includes('EADDRINUSE'), '2 网关失败原因可见', String(config.remoteStatus))
}

// ── 3. 隧道层异步 onError → 实时落到 remoteStatus ──────────────────────────────
{
  let opts = null
  const { acc, config } = makeAccessor((options) => {
    opts = options
    return { start: async () => ({ running: true, url: '' }), dispose() {} }
  })
  await acc.up()
  check(config.remotePhase === '隧道建立中…', '3 没有错误时先显示中间态', String(config.remotePhase))
  opts.onError('隧道 60 秒没有建起来：failed to dial api.trycloudflare.com')
  check(config.remotePhase === '隧道未建立', '3 onError 后 phase 变「隧道未建立」', String(config.remotePhase))
  check(String(config.remoteStatus).includes('failed to dial'), '3 onError 文案落到设置行', String(config.remoteStatus))
  opts.onError('') // 清空不该覆盖
  check(String(config.remoteStatus).includes('failed to dial'), '3 空回调不清掉已有原因')
  acc.dispose?.()
}

// ── 4. 静默卡死：看门狗 75 秒兜底（这里 20ms）─────────────────────────────────
{
  const { acc, config } = makeAccessor(() => ({
    start: async () => ({ running: true, url: '' }),
    dispose() {},
  }))
  await acc.up()
  acc.watchUrl(20) // 替换 up() 里那个 75s 定时器，避免测试进程等 75 秒
  await tick(60)
  check(config.remotePhase === '隧道未建立', '4 超时后 phase 是「隧道未建立」', String(config.remotePhase))
  check(String(config.remoteStatus).includes('重建隧道'), '4 兜底文案给出可操作动作', String(config.remoteStatus))
}

// ── 5. 拿到地址时不能残留失败文案 ──────────────────────────────────────────────
{
  const { acc, config } = makeAccessor(() => ({
    start: async () => ({ running: true, url: 'https://ok.trycloudflare.com' }),
    dispose() {},
  }))
  await acc.up()
  check(config.remotePhase !== '隧道未建立', '5 有地址时不写失败态', String(config.remotePhase))
  check(String(config.remoteStatus) === '', '5 有地址时没有错误文案', String(config.remoteStatus))
}

// ── 6. RemoteAccess 自身：reportError 会回调、canRetry 有上限 ──────────────────
{
  const seen = []
  const ra = new RemoteAccess({
    log: () => {},
    secret: 'x'.repeat(43),
    webLog: join(tmpdir(), 'nope-web.log'),
    binPath: '/definitely/not/here/cloudflared',
    onError: (m) => seen.push(m),
  })
  check(ra.canRetry() === true, '6 初始可以重试')
  ra.reportError('boom')
  check(seen.length === 1 && seen[0] === 'boom', '6 reportError 会回调 onError', JSON.stringify(seen))
  check(typeof ra.logTail() === 'string', '6 logTail 读不到日志也不抛异常')

  ra.failStreak = 3
  check(ra.canRetry() === false, '6 连败 3 次后 canRetry 为 false')
  const before = seen.length
  ra.lastError = '起不了 cloudflared'
  ra.scheduleRestart()
  check(seen.length === before + 1 && String(seen[seen.length - 1]).includes('停止自动重试'),
    '6 连败后停手并说明原因', String(seen[seen.length - 1]))
  check(ra.restartTimer === null, '6 停手时不留下重试定时器')
  ra.dispose()
}

// ── 7. 真实 spawn 一个不存在的 cloudflared → 错误文案带路径 ────────────────────
{
  const seen = []
  const ra = new RemoteAccess({
    log: () => {},
    secret: 'x'.repeat(43),
    webLog: join(tmpdir(), 'nope-web.log'),
    binPath: '/definitely/not/here/cloudflared',
    onError: (m) => seen.push(m),
  })
  await ra.spawnTunnel()
  await tick(400)
  const text = seen.join(' | ')
  check(seen.length > 0 && /cloudflared/.test(text), '7 spawn 失败会上报', text || '(没有任何回调)')
  check(ra.failStreak > 0, '7 spawn 失败会累加失败计数', String(ra.failStreak))
  ra.dispose()
}

console.log('')
console.log('remote-status: ' + String(pass) + ' passed, ' + String(fail) + ' failed')
process.exit(fail === 0 ? 0 : 1)
