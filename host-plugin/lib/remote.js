/**
 * remote.js — 「不带 Tailscale 也能远程访问」的宿主侧实现（v0.4.0）。
 *
 * 目标：让**没装 Tailscale、没有公网 IP** 的人也能在手机/异地浏览器里打开这台机器的 DSH Web，
 * 而且**不用重新登录/扫码**（凭据约 30 天有效）。
 *
 * 链路（全部进程内，不需要用户改 DSH 配置、不需要重启 DSH）：
 *
 *   手机 ──https──▶ Cloudflare 快速隧道 ──▶ 本模块的【网关】(127.0.0.1:<port>)
 *                                              │ ① 自己的 30 天口令门
 *                                              │ ② 自动注入 DSH 的登录 cookie
 *                                              │ ③ Host/Origin/Referer 改写成回环
 *                                              ▼
 *                                        DSH Web (127.0.0.1:3081)
 *
 * 为什么必须有 ① 和 ②（2026-10-28 实测，缺一条都不行）：
 *   - DSH 有两道栅栏：Host 不在白名单 → 403 `host-not-trusted`；Origin 不在白名单 →
 *     403 `origin-not-trusted`。所以**光起隧道不行**，Host 和 Origin 都得改写成回环；
 *   - 但把 Host 改成回环以后，DSH 认的是它自己发的 `dsh-auth-<hash>` cookie，而那个 cookie
 *     的签发 token 每次 `dsh web` 重启都会换（用户说的「不希望重启后还得再扫码」就是它）。
 *     所以本模块**在内部**用 web.log 里的 token 自取 cookie 并随请求注入，对外只发自己的
 *     长期口令 —— 会变的东西被藏在网关后面，用户手里的链接不用变。
 *
 * 为什么口令放在**链接里**（`?k=`）而不是只放 cookie：
 *   快速隧道的域名每次重启都会变（`https://xxx.trycloudflare.com`），而 cookie 是绑域名的，
 *   换域名就丢。把口令嵌进链接，域名怎么变都能一链直达；同时再种一个 30 天 cookie，
 *   之后在站内点来点去就不用带参数了。
 *
 * @module dsh-push-host/remote
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** cookie 名（本模块自己发的，与 DSH 的 dsh-auth-* 互不相干）。 */
const COOKIE = 'dshpush-remote'
/** 30 天：用户明确要求「重启后不用再扫码」。 */
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60
/** 逐跳头，不能转发。 */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])
/** 快速隧道地址出现在 cloudflared 日志里的形态。 */
const TUNNEL_URL_RE = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/
/** web.log 里 DSH 打印的访问链接。 */
const WEB_URL_RE = /dsh web: (https?:\/\/\S+)/

/** 定长比较，避免把口令比较写成可计时侧信道。 */
function safeEq(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

/** 从 cookie 头里取一个键（不引第三方依赖）。 */
function cookieValue(header, name) {
  if (typeof header !== 'string') return ''
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at < 0) continue
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return ''
}

/** 去掉指定的 cookie 键，其余原样保留（拼回 Cookie 头）。 */
function dropCookie(header, name) {
  if (typeof header !== 'string') return ''
  return header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith(name + '='))
    .join('; ')
}

/** 32 字节随机口令，base64url 之后 43 字符（够短可贴，够长不可猜）。 */
export function newRemoteSecret() {
  return randomBytes(32).toString('base64url')
}

/** cookie 里存的不是口令原文，而是它的 HMAC（cookie 泄露也不等于口令泄露）。 */
export function remoteCookieToken(secret) {
  return createHmac('sha256', String(secret)).update('dshpush-remote-cookie-v1').digest('base64url')
}

/**
 * 远程访问服务：管一条 cloudflared 子进程 + 一个改写网关。
 *
 * 生命周期由宿主插件的 fiber 管（unload 时 `dispose()`），失败不致命：
 * 任何一步起不来都只是 `state.lastError` 有值，推送/作答链路照常。
 */
export class RemoteAccess {
  /**
   * @param {object} options
   * @param {(message: string) => void} options.log 日志出口（宿主 logger）。
   * @param {string} options.secret 长期口令（空 = 未启用）。
   * @param {string} [options.binPath] cloudflared 可执行文件（空 = 按默认路径找）。
   * @param {string} [options.webLog] DSH 的 web.log 路径（取 token / 端口）。
   * @param {number} [options.port] 网关监听端口（0 = 随机挑一个空闲端口）。
   * @param {(url: string) => void} [options.onUrl] 公网地址变化时回调（用于推送手机）。
   */
  constructor(options) {
    this.log = options.log ?? (() => {})
    this.secret = String(options.secret ?? '')
    this.binPath = String(options.binPath ?? '')
    this.webLog = String(options.webLog ?? join(homedir(), '.dsh', 'web.log'))
    this.port = Number(options.port ?? 0) || 0
    this.onUrl = options.onUrl ?? (() => {})

    /** 网关实际端口（start 后才有值）。 */
    this.listenPort = 0
    /** 当前公网地址（空 = 还没起来）。 */
    this.url = ''
    /** 最近一次错误（'' = 正常）。 */
    this.lastError = ''
    this.startedAt = 0
    this.tunnelStarts = 0

    this.server = null
    this.child = null
    this.disposed = false
    this.restartTimer = null
    /** DSH 自己的登录 cookie 缓存：`dsh-auth-xxx=v1.…`。 */
    this.dshCookie = ''
    this.dshCookieAt = 0
  }

  /** 给设置行/诊断用的状态快照。 */
  state() {
    return {
      running: this.server !== null,
      url: this.url,
      port: this.listenPort,
      error: this.lastError,
      since: this.startedAt,
      restarts: this.tunnelStarts,
      hasSecret: this.secret.length > 0,
    }
  }

  /** 找 cloudflared：显式配置 > ~/.dsh/bin > PATH。 */
  resolveBin() {
    if (this.binPath) return this.binPath
    const local = join(homedir(), '.dsh', 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
    if (existsSync(local)) return local
    return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  }

  /** 起网关 + 隧道。重复调用安全（已起就返回）。 */
  async start() {
    if (this.disposed) return this.state()
    if (this.secret.length === 0) {
      this.lastError = '未设置远程口令'
      return this.state()
    }
    if (this.server) return this.state()

    // 先把 DSH 的 cookie 拿到，网关一起来就能直接放行；拿不到不算致命（请求时会再试）。
    await this.refreshDshCookie().catch(() => {})

    await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res).catch((error) => {
          try { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }) } catch { /* already sent */ }
          try { res.end('dsh-push remote: ' + String(error?.message ?? error)) } catch { /* gone */ }
        })
      })
      server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head))
      server.on('error', (error) => {
        this.lastError = '网关监听失败：' + String(error?.message ?? error)
        reject(error)
      })
      server.listen(this.port, '127.0.0.1', () => {
        this.server = server
        this.listenPort = server.address().port
        this.startedAt = Date.now()
        this.lastError = ''
        this.log('远程网关已监听 127.0.0.1:' + String(this.listenPort))
        resolve()
      })
    })

    this.spawnTunnel()
    return this.state()
  }

  /** 停网关 + 隧道（可重复调用）。 */
  dispose() {
    this.disposed = true
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.killTunnel()
    if (this.server) {
      try { this.server.close() } catch { /* already closed */ }
      this.server = null
    }
    this.url = ''
  }

  /** 换口令：清掉旧 cookie 缓存，网关不用重起。 */
  setSecret(secret) {
    this.secret = String(secret ?? '')
  }

  /**
   * 等公网地址真的可用再交出去（2026-10-28 实测：cloudflared 打印出域名后，Cloudflare 边缘
   * 还要 3~8 秒才把这个主机名挂上，这期间访问回 **530**）。如果这时就把链接推给手机，用户点
   * 进去看到的是 Cloudflare 的报错页，会以为功能坏了。所以推送前先自打一遍：
   * 只要不是 5xx 就算就绪（401 是口令门，说明链路已通）。
   * @param {number} [timeoutMs] 最多等多久（默认 60 秒）。
   * @returns {Promise<boolean>} 是否就绪。
   */
  async waitPublic(timeoutMs = 60000) {
    const url = this.url
    if (!url) return false
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.disposed) return false
      try {
        const res = await fetch(url + '/__dshpush/status', { redirect: 'manual' })
        if (res.status < 500) {
          this.log('公网链路已就绪（status=' + String(res.status) + '）')
          return true
        }
      } catch { /* 还没就绪，继续等 */ }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    this.log('公网链路 ' + String(Math.round(timeoutMs / 1000)) + ' 秒内未就绪（链接可能点开会先看到 Cloudflare 的 530）')
    return false
  }

  killTunnel() {
    if (!this.child) return
    const child = this.child
    this.child = null
    try { child.kill() } catch { /* already gone */ }
  }

  /** 起 cloudflared 快速隧道，从它自己的日志文件里读出公网地址。 */
  spawnTunnel() {
    if (this.disposed) return
    const bin = this.resolveBin()
    const logDir = join(homedir(), '.dsh', 'logs')
    try { mkdirSync(logDir, { recursive: true }) } catch { /* best effort */ }
    const logFile = join(logDir, 'cloudflared-remote.log')
    try { appendFileSync(logFile, '\n--- start ' + new Date().toISOString() + ' ---\n') } catch { /* best effort */ }

    // 每次起隧道前把日志读到末尾位置，只认本次新增的行，避免重启后误读上一轮那个已失效的域名。
    let offset = 0
    try { offset = readFileSync(logFile, 'utf8').length } catch { offset = 0 }
    let settled = false

    const args = [
      'tunnel',
      '--url', 'http://127.0.0.1:' + String(this.listenPort),
      '--no-autoupdate',
      '--logfile', logFile,
      '--loglevel', 'info',
      // 指标端口随机，避免和用户自己跑的 cloudflared 撞 20241。
      '--metrics', '127.0.0.1:0',
    ]
    let child
    try {
      child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      this.lastError = '起不了 cloudflared：' + String(error?.message ?? error)
      this.log(this.lastError)
      this.scheduleRestart()
      return
    }
    this.child = child
    this.tunnelStarts += 1
    this.log('cloudflared 已启动（第 ' + String(this.tunnelStarts) + ' 次）：' + bin)

    const tail = () => {
      if (settled) return
      let text = ''
      try {
        text = readFileSync(logFile, 'utf8').slice(offset)
      } catch {
        return
      }
      const hit = TUNNEL_URL_RE.exec(text)
      if (!hit) return
      settled = true
      this.url = hit[0]
      this.lastError = ''
      this.log('公网地址：' + this.url)
      try { this.onUrl(this.url) } catch { /* caller's problem */ }
    }

    const timer = setInterval(tail, 400)
    // 60 秒还没拿到地址就判失败（实测正常 3~6 秒内就有）。
    const giveUp = setTimeout(() => {
      if (settled) return
      settled = true
      this.lastError = 'cloudflared 60 秒内没有给出公网地址'
      this.log(this.lastError)
    }, 60000)

    child.on('exit', (code) => {
      clearInterval(timer)
      clearTimeout(giveUp)
      if (this.child === child) this.child = null
      if (this.disposed) return
      this.url = ''
      if (!settled) this.lastError = 'cloudflared 退出，code=' + String(code)
      this.log('cloudflared 退出 code=' + String(code) + '，准备重连')
      this.scheduleRestart()
    })
    child.on('error', (error) => {
      clearInterval(timer)
      clearTimeout(giveUp)
      this.lastError = 'cloudflared 启动失败：' + String(error?.message ?? error)
      this.log(this.lastError)
      this.scheduleRestart()
    })
  }

  /** 隧道断了就退避重连（10s → 20s → 40s，封顶 60s）；地址变了会重新推送。 */
  scheduleRestart() {
    if (this.disposed || this.restartTimer !== null) return
    const delay = Math.min(60000, 10000 * Math.pow(2, Math.min(3, this.tunnelStarts - 1)))
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawnTunnel()
    }, delay)
  }

  /** 从 web.log 取当前 token，换成 DSH 自己的登录 cookie。 */
  async refreshDshCookie() {
    let text = ''
    try {
      text = readFileSync(this.webLog, 'utf8')
    } catch {
      this.log('读不到 web.log：' + this.webLog + '（远程访问需要它来取 DSH token）')
      return ''
    }
    const matches = [...text.matchAll(new RegExp(WEB_URL_RE, 'g'))]
    if (matches.length === 0) return ''
    const url = matches[matches.length - 1][1]
    let target
    try {
      target = new URL(url)
    } catch {
      return ''
    }
    // 只在回环上取 cookie：绝不用隧道域名去自打（那会再撞一次 Host/Origin 栅栏）。
    target.hostname = '127.0.0.1'
    const res = await fetch(target.toString(), { redirect: 'manual', headers: { 'cache-control': 'no-store' } })
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    const auth = list.find((line) => line.startsWith('dsh-auth-'))
    if (!auth) {
      this.log('DSH 没有下发 dsh-auth-* cookie（status=' + String(res.status) + '）')
      return this.dshCookie
    }
    this.dshCookie = auth.split(';')[0].trim()
    this.dshCookieAt = Date.now()
    this.log('已取得 DSH 登录 cookie（有效期由 DSH 决定，本模块会自动刷新）')
    return this.dshCookie
  }

  /** 口令校验：链接里的 ?k= 或 30 天 cookie。 */
  authorize(req) {
    let query = ''
    try {
      query = new URL(req.url ?? '/', 'http://placeholder').searchParams.get('k') ?? ''
    } catch {
      query = ''
    }
    if (query.length > 0 && safeEq(query, this.secret)) return { ok: true, viaQuery: true }
    const cookie = cookieValue(req.headers.cookie, COOKIE)
    if (cookie.length > 0 && safeEq(cookie, remoteCookieToken(this.secret))) return { ok: true }
    return { ok: false }
  }

  /** 登录页（用户手输口令，或从设置行复制链接）。 */
  loginPage(message = '') {
    return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>DSH 远程访问</title>' +
      '<style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;' +
      'display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f6f7fb;color:#1d2430}' +
      'form{background:#fff;padding:28px 24px;border-radius:16px;box-shadow:0 8px 30px rgba(20,30,60,.12);width:min(92vw,380px)}' +
      'h1{font-size:18px;margin:0 0 6px}p{font-size:13px;opacity:.7;margin:0 0 18px}' +
      'input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #d8dce6;border-radius:10px;font-size:15px}' +
      'button{margin-top:14px;width:100%;padding:12px;border:0;border-radius:10px;background:#2f6df6;color:#fff;font-size:15px}' +
      '.err{margin-top:12px;color:#c0392b;font-size:13px}</style>' +
      '<form method="post" action="/__dshpush/login">' +
      '<h1>DSH 远程访问</h1><p>请输入这台机器的访问口令（在设置里生成，可用 30 天）。</p>' +
      '<input name="k" type="password" placeholder="访问口令" autofocus autocomplete="current-password">' +
      '<button type="submit">进入</button>' +
      (message ? '<div class="err">' + message + '</div>' : '') +
      '</form>'
  }

  /** 网关主处理：口令门 → 注入 DSH cookie → 改写 Host/Origin → 转发。 */
  async handle(req, res) {
    const path = (req.url ?? '/').split('?')[0]

    // 登录表单提交（POST /__dshpush/login，body 是 k=…）
    if (path === '/__dshpush/login' && req.method === 'POST') {
      const body = await readBody(req, 4096)
      const typed = new URLSearchParams(body).get('k') ?? ''
      if (!safeEq(typed, this.secret)) {
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' })
        res.end(this.loginPage('口令不对。'))
        return
      }
      res.writeHead(303, {
        location: '/',
        'set-cookie': COOKIE + '=' + remoteCookieToken(this.secret) + '; Max-Age=' + String(COOKIE_MAX_AGE) +
          '; Path=/; HttpOnly; SameSite=Lax' + (this.isHttps(req) ? '; Secure' : ''),
        'cache-control': 'no-store',
      })
      res.end()
      return
    }

    // 诊断口（要口令）：给设置行/排障看状态，不含任何秘密。
    if (path === '/__dshpush/status') {
      if (!this.authorize(req).ok) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, ...this.state() }))
      return
    }

    const auth = this.authorize(req)
    if (!auth.ok) {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(this.loginPage())
      return
    }
    // 链接里带口令进来的：立刻换成 cookie，并把 ?k= 从地址栏抹掉（避免被截图/转发泄露）。
    if (auth.viaQuery) {
      const query = new URL(req.url, 'http://placeholder')
      query.searchParams.delete('k')
      const rest = query.searchParams.toString()
      res.writeHead(303, {
        location: path + (rest ? '?' + rest : ''),
        'set-cookie': COOKIE + '=' + remoteCookieToken(this.secret) + '; Max-Age=' + String(COOKIE_MAX_AGE) +
          '; Path=/; HttpOnly; SameSite=Lax' + (this.isHttps(req) ? '; Secure' : ''),
        'cache-control': 'no-store',
      })
      res.end()
      return
    }

    this.forward(req, res, (status) => status === 401 || status === 403)
  }

  /** WebSocket 升级：同样先过口令门，再改写头转发。 */
  handleUpgrade(req, socket, head) {
    if (!this.authorize(req).ok) {
      try { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n') } catch { /* gone */ }
      try { socket.destroy() } catch { /* gone */ }
      return
    }
    const headers = this.upstreamHeaders(req)
    // ★ 2026-10-28 实测：`upstreamHeaders` 会剔掉逐跳头（含 Connection/Upgrade），这对普通请求是
    // 对的，但升级请求**必须**带这两个头，否则上游回的是普通响应、`upgrade` 事件永不触发——浏览器
    // 那头表现成「WebSocket 挂着不连，最后 closed before established」。这里补回来。
    headers.connection = 'Upgrade'
    headers.upgrade = String(req.headers.upgrade || 'websocket')
    const up = http.request({
      host: '127.0.0.1',
      port: this.targetPort(),
      method: req.method,
      path: req.url,
      headers,
    })
    up.on('upgrade', (upRes, upSocket, upHead) => {
      const lines = ['HTTP/1.1 101 Switching Protocols']
      for (let i = 0; i < upRes.rawHeaders.length; i += 2) {
        lines.push(upRes.rawHeaders[i] + ': ' + upRes.rawHeaders[i + 1])
      }
      try { socket.write(lines.join('\r\n') + '\r\n\r\n') } catch { /* gone */ }
      if (upHead && upHead.length > 0) socket.write(upHead)
      if (head && head.length > 0) upSocket.write(head)
      upSocket.pipe(socket)
      socket.pipe(upSocket)
    })
    up.on('error', () => {
      try { socket.destroy() } catch { /* gone */ }
    })
    up.end()
  }

  /** 从 web.log 现取目标端口（DSH 可能换端口，每次现读更稳）。 */
  targetPort() {
    try {
      const text = readFileSync(this.webLog, 'utf8')
      const matches = [...text.matchAll(new RegExp(WEB_URL_RE, 'g'))]
      if (matches.length > 0) return Number(new URL(matches[matches.length - 1][1]).port) || 3081
    } catch { /* fall through */ }
    return 3081
  }

  isHttps(req) {
    const proto = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase()
    if (proto === 'https') return true
    const host = String(req.headers.host ?? '')
    return !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host) && !host.startsWith('127.0.0.1:')
  }

  /** 转发用的头：抹掉逐跳头、抹掉自己的 cookie、注入 DSH cookie、改回环。 */
  upstreamHeaders(req) {
    const headers = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue
      headers[key] = value
    }
    const target = '127.0.0.1:' + String(this.targetPort())
    headers.host = target
    if (headers.origin) headers.origin = 'http://' + target
    if (headers.referer) {
      try {
        const ref = new URL(headers.referer)
        headers.referer = 'http://' + target + ref.pathname + ref.search
      } catch {
        headers.referer = 'http://' + target + '/'
      }
    }
    const kept = dropCookie(req.headers.cookie, COOKIE)
    headers.cookie = [kept, this.dshCookie].filter((part) => part.length > 0).join('; ')
    if (headers.cookie.length === 0) delete headers.cookie
    return headers
  }

  /**
   * 真正转发。`isRetry` 时先刷一次 DSH cookie（token 可能刚换过）再重发一次。
   */
  forward(req, res, retryOn, isRetry = false) {
    const up = http.request({
      host: '127.0.0.1',
      port: this.targetPort(),
      method: req.method,
      path: req.url,
      headers: this.upstreamHeaders(req),
    }, (upRes) => {
      const status = upRes.statusCode ?? 502
      if (!isRetry && retryOn(status)) {
        upRes.resume()
        this.refreshDshCookie()
          .then(() => this.forward(req, res, retryOn, true))
          .catch(() => {
            try { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }) } catch { /* sent */ }
            try { res.end('dsh-push remote: DSH 认证失败且刷新 cookie 也失败') } catch { /* gone */ }
          })
        return
      }
      const headers = {}
      for (const [key, value] of Object.entries(upRes.headers)) {
        if (HOP_BY_HOP.has(key.toLowerCase())) continue
        headers[key] = value
      }
      try { res.writeHead(status, headers) } catch { /* headers already sent */ }
      upRes.pipe(res)
    })
    up.on('error', (error) => {
      try { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }) } catch { /* sent */ }
      try { res.end('dsh-push remote: ' + String(error?.message ?? error)) } catch { /* gone */ }
    })
    req.pipe(up)
  }
}

/** 读一小段请求体（登录表单用），超过上限直接截断。 */
function readBody(req, limit) {
  return new Promise((resolve) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      if (data.length < limit) data += chunk
    })
    req.on('end', () => resolve(data.slice(0, limit)))
    req.on('error', () => resolve(data.slice(0, limit)))
  })
}

/** 拼一条给手机看的文本：地址 + 30 天口令链接。 */
export function remoteMessage(url, secret) {
  if (!url) return ''
  const link = url + '/?k=' + encodeURIComponent(secret)
  return link
}
