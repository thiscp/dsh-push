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
import { spawn, execFileSync } from 'node:child_process'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, statSync, appendFileSync,
  chmodSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { connect } from 'node:net'
import { ensureCloudflared } from './cloudflared.mjs'

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
    this.sink = options.log ?? (() => {})
    // v0.7.12：插件自己的日志以前只进 DSH 的 logger，用户那边（和我在另一台机器上）都看不到，
    // 「卡在正在连接…」就完全没法定位（2026-10-30 笔电复现）。现在同时落一份文件：
    // 谁都能 tail 它，出问题时不用再猜。
    this.log = (message) => {
      try { this.sink(message) } catch { /* host logger 挂了不该拖累隧道 */ }
      this.fileLog(message)
    }
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
    /** 自动装好的 cloudflared 路径（v0.5.0；空 = 还没找过）。 */
    this.resolvedBin = ''
    /** 下载阶段的文案（设置行显示「正在下载 cloudflared 12.3/40.3 MB」）。 */
    this.downloadPhase = ''
    /** 阶段回调（RemoteAccessor 用它把文案镜像到设置行）。 */
    this.onPhase = options.onPhase ?? (() => {})
    /**
     * 失败回调（v0.7.11）。隧道层的失败以前**只写日志、不回设置行**：用户看到的是
     * 「隧道建立中…」永远转下去（m128886 报障）。传空串代表「已恢复」。
     */
    this.onError = options.onError ?? (() => {})
    /** 连续失败次数（拿到地址就清零）；到上限就停手，别让用户盯着一个无限转的圈。 */
    this.failStreak = 0
    /** DSH 自己的登录 cookie 缓存：`dsh-auth-xxx=v1.…`。 */
    this.dshCookie = ''
    this.dshCookieAt = 0
    /**
     * 已经**验证过能连上**的上游端口（v0.7.14）。
     *
     * 病根：`targetPort()` 以前只是「从日志里挑第一个带端口的 URL」，一个都没扫到就默认 3081。
     * 桌面版 DSH 的 web 端口每次启动都换，访问链接只打在它自己的 stdout 日志里；扫不到时
     * 网关就会去连一个没人听（或者听了但不回应）的端口 —— 浏览器那头看到的是 Cloudflare 的
     * 502，插件这边一声不响（工作台式机 DESKTOP-MCSEJ9H 的报障就是这个）。
     * 现在只有在 cookie 交换里**真的刷通**的那个端口才算数；换不到就逐个 TCP 探活。
     */
    this.upstreamPort = 0
    /** 上游是怎么定下来的（进 /__dshpush/status，排障用，不含秘密）。 */
    this.upstreamNote = '未探测'
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
      // v0.7.14：排障口。工作台式机的 502 只能靠公网 /status 远程诊断，日志拿不到。
      upstream: {
        port: this.targetPort(),
        note: this.upstreamNote,
        candidates: this.webUrls().length,
      },
    }
  }

  /** 找 cloudflared：显式配置 > ~/.dsh/bin > 自动下载结果 > PATH。
   *
   *  v0.5.0 起 `prepareBin()` 会把东西真的装上，并把路径记在 `this.resolvedBin`；
   *  这里只负责「按优先级读」，不再假设文件已经存在（老的 existsSync 分支保留给
   *  「用户手动放了一份」的情况，避免联网）。
   */
  resolveBin() {
    if (this.binPath) return this.binPath
    if (this.resolvedBin) return this.resolvedBin
    const local = join(homedir(), '.dsh', 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
    if (existsSync(local)) return local
    return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  }

  /**
   * 确保本机有 cloudflared（用户 m16379：只想装插件+App 就能用，不想再装别的东西）。
   *
   * 只在真的找不到时才联网，顺序落在 lib/cloudflared.mjs 里：
   * 显式配置 → ~/.dsh/bin 已有一份 → PATH 上已有 → 自动下载并按 GitHub API 的
   * size + sha256 校验。**已装好的机器永远不联网**，老用户行为完全不变。
   */
  async prepareBin() {
    if (this.binPath) { this.resolvedBin = this.binPath; return this.resolvedBin }
    try {
      const got = await ensureCloudflared({
        log: this.log,
        onProgress: (done, total) => {
          const mb = (n) => (n / 1048576).toFixed(1)
          const phase = total > 0
            ? '正在下载 cloudflared ' + mb(done) + '/' + mb(total) + ' MB'
            : '正在下载 cloudflared ' + mb(done) + ' MB'
          this.downloadPhase = phase
          try { this.onPhase?.(phase) } catch { /* caller's problem */ }
        },
      })
      if (got.error || !got.path) {
        this.lastError = '找不到 cloudflared，自动安装也失败：' + String(got.error || '未知原因')
        this.log(this.lastError)
        this.downloadPhase = ''
        return ''
      }
      this.resolvedBin = got.path
      this.downloadPhase = ''
      if (got.source === 'download') this.log('cloudflared 自动安装完成（' + String(got.tag ?? '') + '）：' + got.path)
      return got.path
    } catch (error) {
      this.lastError = 'cloudflared 自动安装异常：' + String(error?.message ?? error)
      this.log(this.lastError)
      this.downloadPhase = ''
      return ''
    }
  }

  /** 起网关 + 隧道。重复调用安全（已起就返回）。 */
  async start() {
    if (this.disposed) return this.state()
    if (this.secret.length === 0) {
      this.lastError = '未设置远程口令'
      return this.state()
    }
    if (this.server) return this.state()

    const began = Date.now()
    this.log('start(): 取 DSH 登录 cookie …')
    // 先把 DSH 的 cookie 拿到，网关一起来就能直接放行；拿不到不算致命（请求时会再试）。
    // v0.7.12：加硬上界。这里没有超时的 fetch 曾经能让整个 start() 永不返回，界面就停在
    // 「正在连接…」，而且连 75 秒兜底都轮不到（那时候兜底还没被挂上）。
    await this.withDeadline(this.refreshDshCookie(), 20000, '取 DSH cookie')
      .catch(() => {})
    this.log('start(): cookie 阶段结束（' + String(Date.now() - began) + 'ms）')
    // cookie 一个都没换出来时，至少把「哪个端口真在听」探出来；否则转发会打到一个空端口上，
    // 浏览器只看到 Cloudflare 的 502（v0.7.14）。
    if (this.upstreamPort === 0) {
      await this.withDeadline(this.resolveUpstream(), 8000, '探测上游端口').catch(() => {})
      this.log('start(): 上游端口 = ' + String(this.targetPort()) + '（' + this.upstreamNote + '）')
    }

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

    // v0.5.0（用户 m16379）：真要起隧道之前才确保 cloudflared 在本机。
    // 已经装好的机器走缓存分支，不联网也不变慢；只有真缺的时候才下载。
    this.log('start(): 准备 cloudflared …')
    const bin = await this.withDeadline(this.prepareBin(), 240000, '准备 cloudflared').catch((error) => {
      this.reportError('准备 cloudflared 失败：' + String(error?.message ?? error))
      return ''
    })
    if (this.disposed) return this.state()
    if (!bin) {
      if (!this.lastError) this.lastError = '找不到 cloudflared，自动安装也没成功'
      return this.state()
    }

    this.log('start(): 起隧道（' + bin + '）')
    this.spawnTunnel()
    return this.state()
  }

  /**
   * 给任意 promise 加硬上界（v0.7.12）。
   *
   * 病根：`refreshDshCookie()` 与 `prepareBin()` 里的 fetch / 下载都没有超时，
   * 一旦对端不回应，`start()` 就永不 resolve —— 面板停在「正在连接…」，
   * 而 0.7.11 的 75 秒兜底看门狗排在 `await start()` **之后**，根本轮不到执行。
   */
  withDeadline(promise, ms, label) {
    let timer = null
    const guard = new Promise((_, reject) => {
      // 这里**不能** unref：解绑之后，如果此刻事件循环里只剩下这个 await（比如自测进程），
      // 定时器永远不会触发，进程会带着 unsettled await 直接退出（实测踩到）。
      // 正常路径在 finally 里 clearTimeout，不会白占一个 240 秒的定时器。
      timer = setTimeout(() => reject(new Error(label + '超时（' + String(Math.round(ms / 1000)) + ' 秒）')), ms)
    })
    return Promise.race([promise, guard]).finally(() => {
      if (timer !== null) clearTimeout(timer)
    })
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
    // 「到了自己的网关」与「Cloudflare 边缘认识这条隧道」不是同一件事：
    // 刚建好隧道时各边缘节点学习路由有先后，同一域名可能一会儿 404（还没路由）
    // 一会儿 401（我们网关的登录门）。2026-10-28 在 work VM 上就撞到过
    // waitPublic 报就绪、紧接着首页 404 —— 用户点开就是一个空白的 404。
    // 判据改成：连续两次（换路径 + 间隔）都拿到 401/200 才算通。
    let streak = 0
    const paths = ['/__dshpush/status', '/']
    let turn = 0
    while (Date.now() < deadline) {
      if (this.disposed) return false
      const path = paths[turn % paths.length]
      turn += 1
      let ok = false
      try {
        // v0.7.12：这里也没有超时。边缘还没路由时连接可能既不回 530 也不 RST，
        // 一次 fetch 挂住就把整个 60 秒预算拖过了头 —— 设置行于是永远停在「隧道建立中…」。
        const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(8000) : undefined
        const res = await fetch(url + path, { redirect: 'manual', signal })
        // 401 = 我们网关的登录门；200 = 已经能出内容。404/530 都是边缘还没路由。
        ok = res.status === 401 || res.status === 200
      } catch {
        ok = false
      }
      if (ok) {
        streak += 1
        if (streak >= 2) {
          this.log('公网链路已就绪（连续 ' + String(streak) + ' 次命中网关）')
          return true
        }
      } else {
        streak = 0
      }
      await new Promise((resolve) => setTimeout(resolve, 700))
    }
    this.log('公网链路 ' + String(Math.round(timeoutMs / 1000)) + ' 秒内未就绪（链接可能点开会先看到 Cloudflare 的 530 或 404）')
    return false
  }

  /** 记一次失败：写 lastError + 通知设置行（v0.7.11）。 */
  /**
   * 把一行日志追加到 `~/.dsh/logs/dsh-push-remote.log`（v0.7.12）。
   *
   * 为什么需要它：0.7.11 把隧道失败上报到了设置行，但**如果流程自己卡住**（某个 await 不返回），
   * 设置行只会停在「正在连接…」，既没有错误也没有线索。文件日志能把「走到哪一步」留下来。
   * 超过 2MB 直接重开（这份日志只用于排障，不做审计）。
   */
  fileLog(message) {
    try {
      const dir = join(homedir(), '.dsh', 'logs')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'dsh-push-remote.log')
      try {
        if (statSync(file).size > 2 * 1024 * 1024) renameSync(file, file + '.1')
      } catch { /* 文件还不存在 */ }
      appendFileSync(file, new Date().toISOString() + ' ' + String(message) + '\n')
    } catch { /* 落盘失败不影响隧道 */ }
  }

  reportError(message) {
    this.lastError = String(message || '隧道建立失败')
    this.log(this.lastError)
    try { this.onError(this.lastError) } catch { /* caller's problem */ }
  }

  /** 从 cloudflared 自己的日志里挑一行最像原因的（给用户看的必须是原文，不是「失败」两个字）。 */
  logTail(lines = 24) {
    try {
      const text = readFileSync(join(homedir(), '.dsh', 'logs', 'cloudflared-remote.log'), 'utf8')
      const all = text.split(/\r?\n/).filter((line) => line.trim() !== '')
      const recent = all.slice(-Math.max(4, lines))
      const pick = recent.filter((line) => /(ERR|WRN|error|failed|Unable|refused|forbidden|403|429|dial)/i.test(line))
      const chosen = pick.length > 0 ? pick[pick.length - 1] : recent[recent.length - 1]
      if (!chosen) return ''
      // 去掉时间戳前缀，只留人话；太长就截断。
      const body = chosen.replace(/^\S+\s+\S+\s+/, '').trim()
      return body.length > 180 ? body.slice(0, 180) + '…' : body
    } catch {
      return ''
    }
  }

  /** 连续失败太多次就停手：无限转圈比明确报错更糟。 */
  canRetry() {
    return this.failStreak < 3
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
      this.failStreak += 1
      this.reportError('起不了 cloudflared（' + bin + '）：' + String(error?.message ?? error))
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
      this.failStreak = 0
      this.log('公网地址：' + this.url)
      try { this.onError('') } catch { /* caller's problem */ }
      try { this.onUrl(this.url) } catch { /* caller's problem */ }
    }

    const timer = setInterval(tail, 400)
    // 60 秒还没拿到地址就判失败（实测正常 3~6 秒内就有）。
    const giveUp = setTimeout(() => {
      if (settled) return
      settled = true
      this.failStreak += 1
      const why = this.logTail()
      this.reportError('隧道 60 秒没有建起来' + (why ? '：' + why : '（cloudflared 没给出公网地址）'))
    }, 60000)

    child.on('exit', (code) => {
      clearInterval(timer)
      clearTimeout(giveUp)
      if (this.child === child) this.child = null
      if (this.disposed) return
      this.url = ''
      if (!settled) {
        // 一次都没建起来就退出：这才是「起不来」的证据，必须让用户看见原文。
        this.failStreak += 1
        const why = this.logTail()
        this.reportError('cloudflared 退出（code=' + String(code) + '）' + (why ? '：' + why : ''))
      } else {
        this.log('cloudflared 退出 code=' + String(code) + '，准备重连')
      }
      this.scheduleRestart()
    })
    child.on('error', (error) => {
      clearInterval(timer)
      clearTimeout(giveUp)
      this.failStreak += 1
      this.reportError('cloudflared 启动失败：' + String(error?.message ?? error))
      this.scheduleRestart()
    })
  }

  /** 隧道断了就退避重连（10s → 20s → 40s，封顶 60s）；地址变了会重新推送。 */
  scheduleRestart() {
    if (this.disposed || this.restartTimer !== null) return
    // v0.7.11：连续 3 次都没建起来就停手并说明原因。以前这里会一直重试，用户看到的是
    // 「隧道建立中…」永远转下去（m128886），既不知道该等还是该动手。
    if (!this.canRetry()) {
      this.reportError(this.lastError + '（已连续失败 ' + String(this.failStreak) + ' 次，停止自动重试；点「重建隧道」再来一次）')
      return
    }
    const delay = Math.min(60000, 10000 * Math.pow(2, Math.min(3, this.tunnelStarts - 1)))
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawnTunnel()
    }, delay)
  }

  /**
   * 候选日志文件（按修改时间从新到旧）。
   *
   * 为什么不能只读 web.log：DSH 不一定由 `dsh web` 直接拉起。实测 VM1 上它被
   * 「市场重启」脚本派生，stdout 被重定向到 /tmp/dsh-market-restart-*.out.log，
   * 于是 ~/.dsh/web.log 停在几小时前再没更新 —— 只读它就会拿到**上一轮的旧 token**，
   * 兑换 cookie 恒 401，用户侧表现是「手机打开链接一直要求重新登录」。
   * 所以把 ~/.dsh 与系统临时目录里名字像 dsh/web 的 .log 全当候选，逐个试到能换出 cookie 为止。
   */
  webLogCandidates() {
    const list = []
    const push = (p) => { if (p && !list.includes(p) && existsSync(p)) list.push(p) }
    push(this.webLog)
    // v0.7.14：桌面版 DSH 把 `dsh web: http://127.0.0.1:<随机端口>/?token=…` 打在自己进程的
    // stdout 日志里，位置随安装方式而变（安装目录 / 用户数据目录 / 当前工作目录都有可能）。
    // 只认 ~/.dsh 与 tmp 太窄了，扫不到就退化成默认 3081 —— 那正是 502 的来源。
    const extraDirs = [
      join(homedir(), '.dsh'),
      join(homedir(), '.dsh', 'logs'),
      // ★ v0.7.16：桌面版 DSH 把 `dsh web: http://127.0.0.1:<随机端口>/?token=…` 写在
      // `~/.dsh/web/dsh-desktop-stdout.log`（证据：本机现成的 DshWebForward 就是读这个文件）。
      // 少扫这一层，就换不出登录 cookie —— 工作台式机升级到 0.7.15 后隧道通了、却被 DSH 自己
      // 拦下：「dsh web authentication required; reopen the URL printed by dsh web.」
      join(homedir(), '.dsh', 'web'),
      tmpdir(),
      (() => { try { return dirname(process.execPath) } catch { return '' } })(),
      (() => { try { return process.cwd() } catch { return '' } })(),
      String(process.env.LOCALAPPDATA ?? ''),
      String(process.env.APPDATA ?? ''),
      String(process.env.TMP ?? ''),
    ]
    for (const dir of extraDirs) {
      if (!dir) continue
      let names = []
      try {
        names = readdirSync(dir)
      } catch {
        continue
      }
      for (const name of names) {
        if (!/\.log$/i.test(name)) continue
        if (!/dsh|web|stdout|out/i.test(name)) continue
        push(join(dir, name))
      }
    }
    const stamp = (p) => {
      try {
        return statSync(p).mtimeMs
      } catch {
        return 0
      }
    }
    return list.sort((a, b) => stamp(b) - stamp(a))
  }

  /** 候选日志里出现过的 DSH 访问链接，去重后按「日志越新越靠前」。 */
  webUrls() {
    const seen = new Set()
    const out = []
    for (const file of this.webLogCandidates()) {
      let text = ''
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      const lines = [...text.matchAll(new RegExp(WEB_URL_RE, 'g'))]
      for (let i = lines.length - 1; i >= 0; i--) {
        const url = lines[i][1]
        if (seen.has(url)) continue
        seen.add(url)
        out.push(url)
      }
    }
    return out
  }

  /**
   * 日志里出现过的「DSH 访问链接 + token」，新的在前（v0.7.16）。
   *
   * 为什么要把 token 和端口拆开：桌面版的端口**每次启动都换**，而 stdout 日志里同时留着历史行。
   * 旧实现只会按「日志里的那条 URL」原样去换 cookie —— 端口一过期就整条失败，最后退化成
   * 「没有 cookie 直接转发」，被 DSH 自己拦下（工作台式机 m129601 的报障）。
   */
  logWebEntries() {
    const out = []
    const seen = new Set()
    for (const file of this.webLogCandidates()) {
      let text = ''
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      const lines = text.match(new RegExp(WEB_URL_RE, 'g')) ?? []
      for (let i = lines.length - 1; i >= 0; i--) {
        const raw = lines[i].replace(/^dsh web: /, '')
        if (seen.has(raw)) continue
        seen.add(raw)
        let token = ''
        try {
          token = new URL(raw).searchParams.get('token') ?? ''
        } catch {
          continue
        }
        out.push({ url: raw, token })
      }
    }
    return out
  }

  /** 从候选日志里取当前 token，换成 DSH 自己的登录 cookie。 */
  async refreshDshCookie() {
    const entries = this.logWebEntries()
    if (entries.length === 0) {
      this.log('找不到 DSH 访问链接（web.log / ~/.dsh/web/*.log 里都没有）；远程访问需要它来取 token')
      return this.dshCookie
    }
    // 端口集合：日志里出现过的 + 本进程正在听的（桌面版可能刚换过端口，日志还没刷）。
    const ports = []
    const addPort = (port) => {
      const value = Number(port)
      if (value > 0 && !ports.includes(value)) ports.push(value)
    }
    for (const entry of entries) {
      try { addPort(new URL(entry.url).port) } catch { /* continue */ }
    }
    for (const port of this.listeningPorts()) addPort(port)

    // 目标列表：先按日志原样试（端口对得上时最快），再把 token 套到每个端口上试。
    const targets = []
    const seenTarget = new Set()
    const addTarget = (url) => {
      if (seenTarget.has(url)) return
      seenTarget.add(url)
      targets.push(url)
    }
    for (const entry of entries) {
      try {
        const u = new URL(entry.url)
        u.hostname = '127.0.0.1'
        addTarget(u.toString())
      } catch { /* continue */ }
    }
    const tokens = [...new Set(entries.map((e) => e.token).filter(Boolean))].slice(0, 4)
    for (const token of tokens) {
      for (const port of ports.slice(0, 8)) {
        addTarget('http://127.0.0.1:' + String(port) + '/?token=' + encodeURIComponent(token))
      }
    }

    let attempt = 0
    for (const target of targets) {
      attempt += 1
      if (attempt > 24) {
        this.log('换取 DSH cookie 的尝试已达上限（' + String(targets.length) + ' 个候选）')
        break
      }
      let res
      try {
        if (attempt <= 3 || attempt % 6 === 0) this.log('换 cookie 尝试 #' + String(attempt) + '：' + target.replace(/token=[^&]+/, 'token=***'))
        const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(4000) : undefined
        res = await fetch(target, { redirect: 'manual', headers: { 'cache-control': 'no-store' }, signal })
      } catch (error) {
        this.log('候选 #' + String(attempt) + ' 取 cookie 失败：' + String(error?.message ?? error))
        continue
      }
      const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
      const auth = list.find((line) => line.startsWith('dsh-auth-'))
      let port = 0
      try { port = Number(new URL(target).port) } catch { /* continue */ }
      if (!auth) {
        if (port > 0 && this.upstreamPort === 0) {
          this.upstreamPort = port
          this.upstreamNote = '候选 #' + String(attempt) + ' 可连通但未换出 cookie（127.0.0.1:' + String(port) + '）'
        }
        continue
      }
      this.dshCookie = auth.split(';')[0].trim()
      this.dshCookieAt = Date.now()
      if (port > 0) {
        this.upstreamPort = port
        this.upstreamNote = 'cookie 交换成功：候选 #' + String(attempt) + ' → 127.0.0.1:' + String(port)
      }
      this.log('已取得 DSH 登录 cookie（候选 #' + String(attempt) + ' → 127.0.0.1:' + String(port) + '，会自动刷新）')
      return this.dshCookie
    }
    this.log('候选日志里没有能换出 cookie 的 DSH token（共 ' + String(targets.length) + ' 个候选）')
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

  /** 从日志里现取目标端口（DSH 可能换端口、也可能不写 web.log，每次现读更稳）。 */
  targetPort() {
    // v0.7.14：优先用「真连通验证过」的那个端口；没有才退回日志里的第一个。
    if (this.upstreamPort > 0) return this.upstreamPort
    const urls = this.webUrls()
    for (const raw of urls) {
      try {
        const port = Number(new URL(raw).port)
        if (port > 0) return port
      } catch { /* continue */ }
    }
    return 3081
  }

  /**
   * 本进程正在听的 TCP 端口（v0.7.15）。
   *
   * 桌面版的 DSH 把访问链接打在**它自己进程的 stdout** 里，位置无法预知；但插件就跑在同一个
   * 进程里，所以「我自己的监听端口」比任何日志都可靠 —— DSH 网页那个端口一定在其中。
   */
  listeningPorts() {
    const pid = process.pid
    const isWin = process.platform === 'win32'
    let out = ''
    try {
      out = isWin
        ? execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', timeout: 5000, windowsHide: true })
        : execFileSync('sh', ['-c', 'ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null'], { encoding: 'utf8', timeout: 5000 })
    } catch {
      return []
    }
    const ports = []
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTEN/i.test(line)) continue
      const m = line.match(/127\.0\.0\.1:(\d+)/) ?? line.match(/\[::1\]:(\d+)/) ?? line.match(/\*:(\d+)/)
      if (!m) continue
      const port = Number(m[1])
      if (!(port > 0)) continue
      if (isWin) {
        const owner = Number(line.trim().split(/\s+/).pop())
        if (owner !== pid) continue
      } else {
        const owner = Number((line.match(/pid=(\d+)/) ?? [])[1] ?? 0)
        if (owner > 0 && owner !== pid) continue
      }
      if (!ports.includes(port)) ports.push(port)
    }
    return ports
  }

  /**
   * 对某个端口要一次 `/`，判断它是不是 DSH 网页（v0.7.17 重写）。
   *
   * 为什么不能只看状态码：桌面版 DSH 同一个进程里还会绑别的回环服务（实测工作台式机
   * 51512 / 51513 都是 401、正文为空），旧实现把这些也当成上游候选，排到前面就把隧道
   * 指错了服务 —— 用户看到的是 Cloudflare 的 502（m129762 报障）。
   *
   * DSH 网页的两条独有指纹：
   *   ① 没带 cookie 时正文是 `dsh web authentication required; reopen the URL printed by dsh web.`
   *   ② 带对了 `?token=` 时回 303 并种下 `dsh-auth-*` cookie
   * 另外把自己的网关页（`<title>DSH 远程访问</title>`）单独标成 gateway，绝不选它。
   */
  async probeWeb(port, tries = 3) {
    for (let i = 0; i < tries; i += 1) {
      const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(2500) : undefined
      try {
        const res = await fetch('http://127.0.0.1:' + String(port) + '/', { redirect: 'manual', signal })
        const status = res.status
        const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
        const auth = cookies.find((line) => line.startsWith('dsh-auth-'))
        if (auth) return { port, kind: 'dsh-auth', cookie: auth.split(';')[0].trim(), status }
        let text = ''
        try { text = (await res.text()).slice(0, 4096) } catch { /* ignore */ }
        if (/DSH\s*远程访问/.test(text)) return { port, kind: 'gateway', status }
        if (/dsh web authentication required/i.test(text)) return { port, kind: 'dsh-login', status }
        if (/dsh-auth-|<title>\s*DSH/i.test(text)) return { port, kind: 'dsh-html', status }
        if (status === 200 || status === 302 || status === 401 || status === 403) {
          return { port, kind: 'weak', status }
        }
        return null
      } catch {
        // 端口刚绑上时首个连接可能被拒（实测 DSH 启动瞬间会这样），再给两次机会。
        if (i + 1 < tries) await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
    return null
  }

  /**
   * 日志里没有可用 token 时的兜底：认出「本进程的哪个监听端口才是 DSH 网页」（v0.7.17 重写）。
   *
   * 候选顺序：日志里 `dsh web:` 行亲口说过的端口 → 本进程正在听的端口（`netstat`/`ss`）。
   * 每个候选都探一次，按指纹打分挑最强的；
   *   dsh-auth（种了 cookie）> dsh-login（401 + 那句英文）> dsh-html > weak（任意 401/403）
   * 只有在没有任何强指纹时才用 weak，并且**选完立刻回头重探**（DSH 启动瞬间可能还没把
   * 404/401 那页准备好，或端口刚绑上）。
   */
  async discoverUpstream() {
    if (this.upstreamPort > 0) return this.upstreamPort
    const seen = new Set()
    const candidates = []
    const push = (port, from) => {
      const value = Number(port)
      if (!(value > 0)) return
      if (this.listenPort > 0 && value === this.listenPort) return
      if (seen.has(value)) return
      seen.add(value)
      candidates.push({ port: value, from })
    }
    for (const entry of this.logWebEntries().slice(0, 16)) {
      try { push(new URL(entry.url).port, 'log') } catch { /* continue */ }
    }
    for (const port of this.listeningPorts()) push(port, 'listen')
    if (candidates.length === 0) {
      this.upstreamNote = '本进程没有可识别的监听端口'
      return this.targetPort()
    }
    this.log('认上游：候选 ' + candidates.map((it) => String(it.port) + '(' + it.from + ')').join(', '))
    const weight = { 'dsh-auth': 5, 'dsh-login': 4, 'dsh-html': 3, weak: 2 }
    let best = null
    for (const item of candidates) {
      const hit = await this.probeWeb(item.port)
      if (!hit || hit.kind === 'gateway') continue
      const score = (weight[hit.kind] ?? 0) + (item.from === 'log' ? 1 : 0)
      if (!best || score > best.score) best = { hit, score }
    }
    if (!best) {
      this.upstreamNote = '本进程监听端口里没有像 DSH 网页的（' + candidates.map((it) => it.port).join(',') + '）'
      return this.targetPort()
    }
    const hit = best.hit
    this.upstreamPort = hit.port
    if (hit.kind === 'dsh-auth' && hit.cookie) {
      this.dshCookie = hit.cookie
      this.dshCookieAt = Date.now()
      this.upstreamNote = '本进程监听端口认出 DSH 网页（127.0.0.1:' + String(hit.port) + '，带登录 cookie）'
    } else {
      this.upstreamNote = '本进程监听端口认出 DSH 网页（127.0.0.1:' + String(hit.port) + '，' + hit.kind + '/' + String(hit.status) + '）'
    }
    this.log('上游端口=self ' + String(hit.port) + '（' + hit.kind + '）')
    // 还没拿到 cookie 就趁热按这个端口再换一次 token（DSH 的启动日志可能刚刷出来）。
    if (this.dshCookie.length === 0) {
      await this.refreshDshCookie().catch(() => {})
      if (this.dshCookie.length > 0 && this.upstreamPort > 0) {
        this.upstreamNote = 'cookie 交换成功 → 127.0.0.1:' + String(this.upstreamPort)
      }
    }
    return this.upstreamPort
  }

  /** TCP 探活（不吃 HTTP 协议层，快且不依赖对方回包）。返回 true = 有人在听。 */
  probePort(port, ms = 600) {
    return new Promise((resolve) => {
      let done = false
      const finish = (ok) => {
        if (done) return
        done = true
        try { socket.destroy() } catch { /* gone */ }
        resolve(ok)
      }
      const socket = connect({ host: '127.0.0.1', port }, () => finish(true))
      socket.setTimeout(ms, () => finish(false))
      socket.on('error', () => finish(false))
    })
  }

  /**
   * 在没有 cookie 线索时，把日志里所有候选端口逐个探活，挑第一个真在听的（v0.7.14）。
   * 只在自愈路径上用，正常情况 refreshDshCookie() 已经把 upstreamPort 定好了。
   */
  async resolveUpstream() {
    if (this.upstreamPort > 0) return this.upstreamPort
    const ports = []
    for (const raw of this.webUrls()) {
      try {
        const port = Number(new URL(raw).port)
        if (port > 0 && !ports.includes(port)) ports.push(port)
      } catch { /* continue */ }
    }
    for (const port of ports) {
      if (await this.probePort(port)) {
        this.upstreamPort = port
        this.upstreamNote = 'TCP 探活选中 127.0.0.1:' + String(port)
        this.log('上游端口探活命中：' + String(port))
        return port
      }
    }
    this.upstreamNote = '日志候选探活未命中（候选 ' + String(ports.length) + ' 个）'
    // v0.7.15：日志里根本没有线索时，改问操作系统「本进程在听哪些端口」。
    return this.discoverUpstream()
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
    // v0.7.14：上游不回应时不能再「无声地挂着」——那样 cloudflared 会超时，浏览器只看到
    // Cloudflare 的 502，谁也不道为什么。给 12 秒硬上界，超时就自己回一页可读的诊断信息。
    const fail = (error) => {
      const message = String(error?.message ?? error)
      this.lastError = '转发到 127.0.0.1:' + String(this.targetPort()) + ' 失败：' + message
      this.log('forward 失败：' + this.lastError + '（' + this.upstreamNote + '）')
      // 自愈：端口可能刚被 DSH 换掉。下一个请求之前重新认一次上游。
      if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|无响应/.test(message)) {
        this.upstreamPort = 0
        void this.discoverUpstream().catch(() => {})
      }
      try {
        res.writeHead(502, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      } catch { /* 头已发出 */ }
      try { res.end(this.upstreamErrorPage(message)) } catch { /* gone */ }
    }
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
        this.recover()
          .then(() => this.forward(req, res, retryOn, true))
          .catch(() => fail(new Error('DSH 认证失败且刷新 cookie 也失败')))
        return
      }
      // v0.7.16：刷新 cookie 重试之后**仍然** 401/403 —— 说明本机 DSH 的 token 没换到，
      // 别把它的英文一句话（dsh web authentication required…）丢给用户，给一页能照做的说明。
      if (isRetry && (status === 401 || status === 403)) {
        upRes.resume()
        try {
          res.writeHead(502, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        } catch { /* 头已发出 */ }
        try {
          res.end(this.upstreamErrorPage('本机 DSH 拒绝登录 cookie：没能从日志里换到 token（' + this.upstreamNote + '）'))
        } catch { /* gone */ }
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
    up.setTimeout(12000, () => {
      up.destroy(new Error('上游 127.0.0.1:' + String(this.targetPort()) + ' 12 秒无响应'))
    })
    up.on('error', fail)
    req.pipe(up)
  }

  /**
   * 上游回 401/403 时的自救（v0.7.17）。
   *
   * 顺序很重要：先重换 cookie —— 换成功时会顺带把 `upstreamPort` 校正成**真正吐出
   * `dsh-auth-*` 的那个端口**（比任何启发式都硬）；换不到才推翻整个上游判定重认一次。
   * 工作台式机 m129762 的病根就是「上游指到了 51512（另一个 401 的空服务），token 却是
   * 好的」—— 这种情形必须在第一次 401 就纠正，而不是把 Cloudflare 502 丢给用户。
   */
  async recover() {
    await this.refreshDshCookie().catch(() => {})
    if (this.dshCookie.length > 0) return
    const before = this.upstreamPort
    this.upstreamPort = 0
    await this.discoverUpstream().catch(() => {})
    this.log('认证自救：上游 ' + String(before) + ' → ' + String(this.upstreamPort) + '（' + this.upstreamNote + '）')
  }

  /** 上游连不上时给用户看的一页（而不是 Cloudflare 那张只有错误码的 502）。 */
  upstreamErrorPage(message) {
    const candidates = this.webUrls().length
    return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>DSH 远程访问：连不上本机 DSH</title>' +
      '<style>body{font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:32px;background:#14161a;color:#e6e8eb}' +
      'code{background:#22262d;padding:2px 6px;border-radius:4px}h1{font-size:18px}li{margin:4px 0}</style>' +
      '<h1>隧道是通的，但网关连不上本机的 DSH 网页</h1>' +
      '<ul>' +
      '<li>尝试转发到：<code>127.0.0.1:' + String(this.targetPort()) + '</code></li>' +
      '<li>上游判定：' + String(this.upstreamNote) + '</li>' +
      '<li>日志候选链接数：' + String(candidates) + '</li>' +
      '<li>错误：<code>' + String(message).replace(/[<>&]/g, '') + '</code></li>' +
      '</ul>' +
      '<p>把这一页截图给维护者即可定位。通常是 DSH 换了端口、或者访问链接只打在它自己的 stdout 日志里没被扫到。</p>'
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
