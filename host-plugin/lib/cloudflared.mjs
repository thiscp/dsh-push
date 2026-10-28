/**
 * cloudflared.mjs — 把 cloudflared 自动装到本机（v0.5.0）。
 *
 * 为什么需要它（用户 m16379）：
 *   「目标是用户只需要安装插件和我们的app就能正常使用，不需要额外下载安装tailscale」
 *   —— v0.4.x 要求用户自己把 cloudflared 放进 ~/.dsh/bin 或 PATH，这一步对普通用户
 *   来说就是「装不上」。所以插件自己下载。
 *
 * 校验是硬要求，不是锦上添花（2026-10-28 实测）：
 *   - cloudflared 的 Release **没有** 独立的 `.sha256` 资产（`…linux-amd64.sha256` 实测 404），
 *     但 GitHub API 的 asset 对象里有 `digest: "sha256:…"` —— 这是唯一可信的校验来源；
 *   - 从 VM 直连 GitHub 下载**会间歇性截断**（实测拿到过 2,150,400 B 的残包，
 *     真包 40,263,303 B），`chmod +x` 之后报「权限不够」。只看 curl 退出码会把它当成成功。
 *   ⇒ 必须 **既校 size 又校 sha256**，任一不符就当这次下载失败，换下一个源。
 *
 * 镜像：各家在不同机器上表现差异很大（见 MIRRORS 注释里的实测表）；直连优先，失败才退镜像。
 *
 * 慢网必须能续传（2026-10-28 VM1 实测）：那台机器直连 GitHub 只有 ~37 KB/s，40 MB 要 18 分钟，
 * 单次请求不到 5 分钟就会被掐断、只拿到 22 MB。所以下载走 `Range: bytes=<已有>-` 断点续传，
 * 判失败用「连续 90 秒没有新字节」而不是总时长 —— 慢但在动的连接不该被杀。
 *
 * @module dsh-push-host/cloudflared
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 发布页与 API。 */
const RELEASE_API = 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest'
const RELEASE_DL = 'https://github.com/cloudflare/cloudflared/releases/download'
/**
 * 镜像前缀（只作直连失败后的兜底，**默认仍然先直连**：不把第三方写进默认信任链）。
 *
 * 2026-10-28 在本机（笔电）与 VM1 上分别实测过各家，结论不同，所以排序取「两边都试过、
 * 至少一边能通且速度可接受」的：
 *   - 直连        ：笔电快；VM1 只有 ~37 KB/s（40MB 要 18 分钟，靠断点续传能完成）
 *   - gh.llkk.cc  ：VM1 实测 40 KB/s、能下完（最稳的一个）
 *   - ghproxy.net / ghfast.top / ghfile.geekertao.top：都能 206，速度 6~40 KB/s
 *   - gh-proxy.com：笔电可用，**VM1 上连不通（curl 000）** ⇒ 不再放第一位
 *   - gh.ddlc.top ：429 限流
 */
const MIRRORS = [
  'https://gh.llkk.cc/',
  'https://ghproxy.net/',
  'https://ghfast.top/',
  'https://ghfile.geekertao.top/',
  'https://gh-proxy.com/',
]

/** 一个「够大」的阈值：真包 37~56 MB，残包通常几百 KB~2 MB。 */
const MIN_BYTES = 20 * 1024 * 1024

/** 本机该用哪个资产名（与 Release 里的命名一一对应）。 */
export function assetName(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') {
    if (arch === 'x64') return 'cloudflared-windows-amd64.exe'
    if (arch === 'ia32') return 'cloudflared-windows-386.exe'
    return ''
  }
  if (platform === 'linux') {
    if (arch === 'x64') return 'cloudflared-linux-amd64'
    if (arch === 'arm64') return 'cloudflared-linux-arm64'
    if (arch === 'arm') return 'cloudflared-linux-arm'
    if (arch === 'ia32') return 'cloudflared-linux-386'
    return ''
  }
  if (platform === 'darwin') {
    // macOS 只发 .tgz，解包要额外的 tar；这里不支持，留空让上层报「请手动安装」。
    return ''
  }
  return ''
}

/** 可执行文件名（Windows 带 .exe）。 */
export function binName(platform = process.platform) {
  return platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
}

/** 默认安装目录：~/.dsh/bin（与 v0.4.x 的查找路径一致，老用户无缝）。 */
export function defaultDir() {
  return join(homedir(), '.dsh', 'bin')
}

/** 文件看着能用吗：存在、够大、（非 Windows）可执行。不做 sha 校验，避免每次启动都重算 40MB。 */
export function looksUsable(file) {
  try {
    const st = statSync(file)
    if (!st.isFile() || st.size < MIN_BYTES) return false
    if (process.platform !== 'win32' && (st.mode & 0o111) === 0) return false
    return true
  } catch {
    return false
  }
}

/** PATH 上有没有现成的 cloudflared（有就不下载；尊重用户自己装的那份）。 */
export function onPath(platform = process.platform) {
  const name = binName(platform)
  try {
    const probe = spawnSync(name, ['--version'], { timeout: 8000, windowsHide: true, encoding: 'utf8' })
    if (probe.error) return ''
    if (probe.status !== 0) return ''
    return name
  } catch {
    return ''
  }
}

/** sha256 摘要（大文件分块读，避免一次性 40MB 进内存）。 */
export function sha256File(file) {
  const hash = createHash('sha256')
  const buf = readFileSync(file)
  hash.update(buf)
  return hash.digest('hex')
}

/** 取最新 Release 的资产清单（含 size 与 digest）。 */
export async function fetchAssets({ fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(RELEASE_API, {
      signal: ctrl.signal,
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'dsh-push-host',
      },
    })
    if (!res.ok) throw new Error('GitHub API HTTP ' + String(res.status))
    const json = await res.json()
    const tag = String(json?.tag_name ?? '')
    const assets = Array.isArray(json?.assets) ? json.assets : []
    return {
      tag,
      assets: assets.map((a) => ({
        name: String(a?.name ?? ''),
        size: Number(a?.size ?? 0),
        digest: String(a?.digest ?? ''),
        url: String(a?.browser_download_url ?? ''),
      })),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 流式下载到 `tmp`，**支持断点续传**。
 *
 * 为什么要续传（2026-10-28 VM1 实测）：这台机器到 GitHub 只有 ~37 KB/s，
 * 40 MB 的包要 18 分钟；一次 5 分钟的请求只会拿到 22 MB 就被 abort。
 * 每次从头再来永远不会成功 —— 必须用 `Range: bytes=<已有字节>-` 接着下。
 *
 * 判失败的依据是**连续 90 秒没有任何新字节**（idle timeout），不是总时长：
 * 慢但仍在动的连接不该被杀。
 *
 * @returns {Promise<number>} 最终文件字节数。
 */
async function downloadToFile(url, tmp, { fetchImpl = fetch, expectSize = 0, onProgress, idleMs = 90000, maxRounds = 40 } = {}) {
  let have = 0
  try { have = statSync(tmp).size } catch { have = 0 }
  if (expectSize > 0 && have >= expectSize) return have

  for (let round = 1; round <= maxRounds; round += 1) {
    if (expectSize > 0 && have >= expectSize) break
    const headers = { 'user-agent': 'dsh-push-host' }
    if (have > 0) headers.range = 'bytes=' + String(have) + '-'
    const ctrl = new AbortController()
    let idle = setTimeout(() => ctrl.abort(), idleMs)
    const bump = () => { clearTimeout(idle); idle = setTimeout(() => ctrl.abort(), idleMs) }
    let res
    try {
      res = await fetchImpl(url, { signal: ctrl.signal, redirect: 'follow', headers })
    } catch (error) {
      clearTimeout(idle)
      if (have > 0) continue            // 已经下过一段：再来一轮接着下
      throw error
    }
    if (res.status === 416 && have > 0) { clearTimeout(idle); break }   // 已经下完
    if (!res.ok && res.status !== 206) { clearTimeout(idle); throw new Error('HTTP ' + String(res.status)) }
    if (have > 0 && res.status !== 206) {
      // 服务器无视 Range（回了 200 全量）⇒ 只能从头写，别把两段拼成坏文件。
      have = 0
      writeFileSync(tmp, Buffer.alloc(0))
    }
    const total = (() => {
      const cr = String(res.headers.get('content-range') ?? '')
      const m = /\/(\d+)$/.exec(cr)
      if (m) return Number(m[1])
      return expectSize
    })()
    if (!res.body) { clearTimeout(idle); throw new Error('响应没有 body') }
    const fd = openSync(tmp, 'a')
    try {
      for await (const chunk of res.body) {
        const buf = Buffer.from(chunk)
        writeSync(fd, buf)
        have += buf.length
        bump()
        onProgress?.(have, total || expectSize || have)
        if (expectSize > 0 && have >= expectSize) break
      }
    } catch (error) {
      // 中途断了：已经写进去的字节保留，下一轮续传。
      clearTimeout(idle)
      if (expectSize > 0 && have >= expectSize) break
      if (round === maxRounds) throw error
      continue
    } finally {
      clearTimeout(idle)
      try { closeSync(fd) } catch { /* 已关 */ }
    }
  }
  return have
}

/**
 * 确保本机有一份可用的 cloudflared。
 *
 * 顺序（每一级都为了「不打扰已有用户」）：
 *   1. 显式配置的路径（用户自己指定）
 *   2. ~/.dsh/bin 里已经有一份 → 直接用，不联网
 *   3. PATH 上已有 → 用用户的，不下载
 *   4. 都没 → 从 GitHub Release 下载并按 API 的 digest 校验
 *
 * @param {object} options
 * @param {string} [options.binPath] 显式配置的路径。
 * @param {string} [options.dir] 安装目录（默认 ~/.dsh/bin）。
 * @param {(m:string)=>void} [options.log] 日志出口。
 * @param {(got:number,total:number)=>void} [options.onProgress] 下载进度（字节）。
 * @param {typeof fetch} [options.fetchImpl] 测试注入。
 * @param {number} [options.timeoutMs] 单次 HTTP 超时。
 * @returns {Promise<{path:string, source:'config'|'cached'|'path'|'download', tag?:string, error?:string}>}
 */
export async function ensureCloudflared(options = {}) {
  const log = options.log ?? (() => {})
  const platform = options.platform ?? process.platform
  const dir = options.dir ?? defaultDir()

  if (options.binPath) return { path: options.binPath, source: 'config' }

  const name = binName(platform)
  const target = join(dir, name)
  if (looksUsable(target)) return { path: target, source: 'cached' }

  const fromPath = onPath(platform)
  if (fromPath) {
    log('PATH 上已有 cloudflared（' + fromPath + '），不下载')
    return { path: fromPath, source: 'path' }
  }

  const asset = assetName(platform, options.arch ?? process.arch)
  if (!asset) {
    return {
      path: '',
      source: 'download',
      error: '这个平台（' + platform + '/' + String(options.arch ?? process.arch) + '）没有自动下载，请手动安装 cloudflared',
    }
  }

  try {
    log('本机没有 cloudflared，开始自动下载（' + asset + '）')
    const release = await fetchAssets({ fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs ?? 20000 })
    const meta = release.assets.find((a) => a.name === asset)
    if (!meta) throw new Error('Release ' + release.tag + ' 里没有 ' + asset)

    const wantSha = /^sha256:([0-9a-f]{64})$/i.exec(meta.digest)?.[1]?.toLowerCase() ?? ''
    const urls = [
      meta.url || (RELEASE_DL + '/' + release.tag + '/' + asset),
      ...MIRRORS.map((m) => m + (RELEASE_DL + '/' + release.tag + '/' + asset)),
    ]

    mkdirSync(dir, { recursive: true })
    const tmp = target + '.part'
    let lastError = ''
    for (const url of urls) {
      try {
        log('下载中：' + url)
        const size = await downloadToFile(url, tmp, {
          fetchImpl: options.fetchImpl,
          expectSize: meta.size,
          onProgress: options.onProgress,
          idleMs: options.idleMs ?? 90000,
        })
        // ① size：截断的残包在这里就被挡下（实测过 2,150,400 B 的残包）。
        if (meta.size > 0 && size !== meta.size) {
          throw new Error('大小不符（拿到 ' + String(size) + '，应为 ' + String(meta.size) + '）')
        }
        if (size < MIN_BYTES) throw new Error('文件太小（' + String(size) + ' 字节），像截断')
        // ② sha256：API 给的 digest 是唯一可信来源（没有独立 .sha256 资产）。
        if (wantSha) {
          const got = createHash('sha256').update(readFileSync(tmp)).digest('hex')
          if (got !== wantSha) throw new Error('sha256 不符（拿到 ' + got.slice(0, 16) + '…）')
        } else {
          log('注意：Release 没有提供 digest，本次只校验了大小')
        }
        // ③ 落到最终路径：先 chmod 再改名，避免半截文件被下次启动当成「已装好」。
        if (platform !== 'win32') {
          try { chmodSync(tmp, 0o755) } catch { /* filesystem 不支持权限位时忽略 */ }
        }
        try { unlinkSync(target) } catch { /* 还没有 */ }
        renameSync(tmp, target)
        log('cloudflared 已装好：' + target + '（' + String(size) + ' 字节，' + release.tag + '）')
        return { path: target, source: 'download', tag: release.tag }
      } catch (error) {
        lastError = String(error?.message ?? error)
        log('这个源失败：' + lastError)
        // 校验失败 ⇒ .part 是坏的，删掉；断流失败 ⇒ 保留，下一轮/下一个源可以续传。
        if (/sha256|大小不符|太小/.test(lastError)) {
          try { unlinkSync(tmp) } catch { /* 没有 */ }
        }
      }
    }
    return { path: '', source: 'download', error: lastError || '所有下载源都失败' }
  } catch (error) {
    return { path: '', source: 'download', error: String(error?.message ?? error) }
  }
}
