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
import http from 'node:http'

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

// ── 8. v0.7.12：fiber 热重启后新实例必须**继承**旧引擎（地址不变、不留僵尸进程）────
{
  const built = []
  const makeFake = (tag) => (options) => {
    built.push(tag)
    return {
      url: '',
      disposed: false,
      secret: '',
      setSecret(secret) { this.secret = secret },
      async start() {
        this.url = 'https://keep-me.trycloudflare.com'
        options.onUrl(this.url)
        return { running: true, url: this.url, error: '' }
      },
      dispose() { this.disposed = true },
    }
  }
  const make = (tag) => {
    const config = {}
    const acc = new RemoteAccessor(
      { fiber: { state: 2 }, on() {} },
      config,
      { host: 'probehost', remoteEnabled: 'on', remoteSecret: 's'.repeat(32) },
      { log() {} },
      () => {},
      { makeEngine: makeFake(tag) },
    )
    acc.saveStore = () => {}
    return { acc, config }
  }

  const a = make('first')
  a.acc.start()
  await tick(60)
  check(a.config.remoteUrl === 'https://keep-me.trycloudflare.com',
    '8 第一个实例拿到公网地址', String(a.config.remoteUrl))

  const firstEngine = a.acc.engine
  clearTimeout(a.acc.watchTimer)
  a.acc.watchTimer = null

  const b = make('second')
  b.acc.start()
  await tick(60)
  check(built.length === 1, '8 新实例继承旧引擎、不另起一个', JSON.stringify(built))
  check(b.acc.engine === firstEngine, '8 两个实例指向同一个引擎对象')
  check(a.acc.engine === null, '8 旧实例交出引擎（不会再抢着写设置行）')
  check(firstEngine.disposed === false, '8 继承时不会把还在跑的隧道掐掉')
  check(b.config.remoteUrl === 'https://keep-me.trycloudflare.com',
    '8 新实例的设置行立刻有地址（不用再等一次隧道）', String(b.config.remoteUrl))
  clearTimeout(b.acc.watchTimer)
  b.acc.watchTimer = null
}

// ── 9. v0.7.12：无超时的 await 必须被 withDeadline 兜住 ────────────────────────
{
  const ra = new RemoteAccess({ log: () => {}, secret: 'x'.repeat(43) })
  const began = Date.now()
  let message = ''
  await ra.withDeadline(new Promise(() => {}), 120, '取 cookie').catch((error) => { message = String(error?.message ?? error) })
  const spent = Date.now() - began
  check(message.includes('超时'), '9 卡死的 await 会以「超时」结束', message || '(没有报错)')
  check(message.includes('取 cookie'), '9 报错里带上是哪一步', message)
  check(spent >= 100 && spent < 2000, '9 到点就返回，不会真的等下去', String(spent) + 'ms')
  ra.dispose()
}

// ── 10. v0.7.14：上游端口要「验证过」才用，连不上要给可读的一页 ────────────────
{
  const ra = new RemoteAccess({ log: () => {}, secret: 'x'.repeat(43) })

  // 没有验证过的端口时，targetPort 退回日志里的第一个（这里没有日志 → 3081 兜底）
  check(ra.upstreamPort === 0, '10 起步时没有任何验证过的上游端口', String(ra.upstreamPort))

  // 验证过的端口优先于日志推断
  ra.upstreamPort = 5555
  check(ra.targetPort() === 5555, '10 验证过的端口优先', String(ra.targetPort()))

  // 探活：本机一定有人在听的端口（用刚起的一个 http server）应返回 true，空端口 false
  const srv = http.createServer((_req, res) => res.end('ok'))
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const live = srv.address().port
  check(await ra.probePort(live), '10 探活能认出在听的端口', String(live))
  await new Promise((resolve) => srv.close(resolve))
  check(!(await ra.probePort(live, 300)), '10 探活能认出已经关掉的端口', String(live))

  // 上游连不上时不该无声挂着：forward 立刻回一页，页里带上端口与判定
  ra.upstreamPort = 1 // 几乎不可能有人在听
  ra.upstreamNote = '测试用'
  const served = await new Promise((resolve) => {
    const host = http.createServer((req, res) => ra.forward(req, res, () => false))
    host.listen(0, '127.0.0.1', async () => {
      const port = host.address().port
      const body = await new Promise((done) => {
        const r = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET' }, (res) => {
          let text = ''
          res.on('data', (chunk) => { text += chunk })
          res.on('end', () => done({ status: res.statusCode, text }))
        })
        r.on('error', () => done({ status: 0, text: '' }))
        r.end()
      })
      host.close()
      resolve(body)
    })
  })
  check(served.status === 502, '10 上游连不上时回 502 而不是挂着', String(served.status))
  check(served.text.includes('127.0.0.1:1'), '10 错误页写明转发到哪个端口', served.text.slice(0, 120))
  check(served.text.includes('测试用'), '10 错误页带上上游判定', '')
  ra.dispose()
}

// ── 11. 上游端口认错（v0.7.17）：401 空正文的邻居服务不能被当成 DSH ─────────────
{
  const ra = new RemoteAccess({ log: () => {}, secret: 'x'.repeat(43), webLog: join(tmpdir(), 'nope-web.log') })
  // 邻居：401 + 空正文（实测工作台式机 51512/51513 就是这种）
  const neighbour = http.createServer((req, res) => { res.writeHead(401); res.end('') })
  // 真 DSH 网页：401 + 那句英文
  const real = http.createServer((req, res) => {
    res.writeHead(401, { 'content-type': 'text/plain' })
    res.end('dsh web authentication required; reopen the URL printed by dsh web.')
  })
  await new Promise((done) => neighbour.listen(0, '127.0.0.1', done))
  await new Promise((done) => real.listen(0, '127.0.0.1', done))
  const neighbourPort = neighbour.address().port
  const realPort = real.address().port
  // 故意把邻居排在前面：旧实现会挑中它
  ra.listeningPorts = () => [neighbourPort, realPort]
  ra.logWebEntries = () => []
  const picked = await ra.discoverUpstream()
  check(picked === realPort, '11 邻居服务排在前面也不会被认成 DSH 网页', String(picked) + ' vs ' + String(realPort))
  check(ra.upstreamPort === realPort, '11 upstreamPort 落在真 DSH 上', String(ra.upstreamPort))

  // 换顺序（真 DSH 在前）仍然只能是它
  ra.upstreamPort = 0
  ra.listeningPorts = () => [realPort, neighbourPort]
  check(await ra.discoverUpstream() === realPort, '11 顺序反过来也认对', '')
  neighbour.close()
  real.close()

  // 只有一个弱候选时允许选中，但判定里必须写明它是弱指纹（排障要看得出）
  const lone = http.createServer((req, res) => { res.writeHead(401); res.end('') })
  await new Promise((done) => lone.listen(0, '127.0.0.1', done))
  const lonePort = lone.address().port
  ra.upstreamPort = 0
  ra.dshCookie = ''
  ra.listeningPorts = () => [lonePort]
  const gotLone = await ra.discoverUpstream()
  check(gotLone === lonePort, '11 只剩弱候选时仍能选出端口（不让隧道彻底空转）', String(gotLone))
  check(/weak/.test(ra.upstreamNote), '11 弱指纹写进上游判定里', ra.upstreamNote)
  lone.close()
  ra.dispose()
}

console.log('')
console.log('remote-status: ' + String(pass) + ' passed, ' + String(fail) + ' failed')
process.exit(fail === 0 ? 0 : 1)
