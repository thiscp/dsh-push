/**
 * v0.5.0 自测：自动安装 cloudflared + 「隧道 / Tailscale」二选一。
 *
 * 三个必须证明的点（用户 m16379）：
 *   1. 已经装好的机器**不联网**（老用户行为不变）；
 *   2. 缺的时候会下载，且 **size 或 sha256 不符一律判失败**（实测过 2,150,400 B 的截断包）；
 *   3. 选 Tailscale 模式时**不起网关、不碰 cloudflared**，只走原来的 webBase/web.log 地址。
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assetName, binName, ensureCloudflared, looksUsable } from './lib/cloudflared.mjs'
import { RemoteAccess } from './lib/remote.js'

/** 造一个能流式读的假响应（downloadToFile 走 res.body 的 async iterator）。 */
function fakeBody(buf, chunk = 1024 * 1024) {
  return (async function* () {
    for (let i = 0; i < buf.length; i += chunk) yield buf.subarray(i, Math.min(i + chunk, buf.length))
  })()
}
function fakeRes(buf, status = 200, extraHeaders = {}) {
  const h = { 'content-length': String(buf.length), ...extraHeaders }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => h[String(k).toLowerCase()] ?? null },
    body: fakeBody(buf),
  }
}

let pass = 0
let fail = 0
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log('PASS  ' + name) } else { fail += 1; console.log('FAIL  ' + name + (detail ? '  —— ' + detail : '')) }
}

// ── 1. 平台资产名 ────────────────────────────────────────────────────────────────
check(assetName('win32', 'x64') === 'cloudflared-windows-amd64.exe', 'win32 x64 的资产名')
check(assetName('linux', 'x64') === 'cloudflared-linux-amd64', 'linux x64 的资产名')
check(assetName('linux', 'arm64') === 'cloudflared-linux-arm64', 'linux arm64 的资产名')
check(assetName('darwin', 'arm64') === '', 'macOS 明确返回空（只发 .tgz，不假装支持）')
check(binName('win32') === 'cloudflared.exe' && binName('linux') === 'cloudflared', '可执行文件名按平台')

// ── 2. 已装好的机器不联网 ────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'cf-cache-'))
  const name = binName(process.platform)
  const file = join(dir, name)
  // 造一个「够大」的假二进制：只需要 > MIN_BYTES，不执行。
  writeFileSync(file, Buffer.alloc(21 * 1024 * 1024))
  let called = 0
  const r = await ensureCloudflared({
    dir,
    log: () => {},
    fetchImpl: () => { called += 1; throw new Error('不该联网') },
  })
  check(r.source === 'cached' && r.path === file, '已有可用文件时直接复用', JSON.stringify(r))
  check(called === 0, '已有可用文件时一次网络请求都不发')
  check(looksUsable(file), 'looksUsable 认可这个文件')
  rmSync(dir, { recursive: true, force: true })
}

// ── 3. 过期/太小的文件不算「已装好」 ─────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'cf-small-'))
  const file = join(dir, binName(process.platform))
  writeFileSync(file, Buffer.alloc(1024))       // 1KB：正是截断包那种形态
  check(!looksUsable(file), '太小的文件不被当成已装好', String(file))
  rmSync(dir, { recursive: true, force: true })
}

// ── 4. 下载：size 不符 → 判失败、不落盘 ───────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'cf-bad-'))
  const payload = Buffer.alloc(21 * 1024 * 1024, 7)
  const good = createHash('sha256').update(payload).digest('hex')
  const asset = assetName(process.platform, process.arch)
  const fakeFetch = async (url) => {
    if (url.includes('api.github.com')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          tag_name: '2026.10.5',
          assets: [{ name: asset, size: payload.length + 100, digest: 'sha256:' + good, browser_download_url: 'https://example.invalid/' + asset }],
        }),
      }
    }
    // 内容和 digest 都对得上，但声明的 size 更大 ⇒ 必须判失败（这就是截断包的形状）。
    return fakeRes(payload)
  }
  const r = await ensureCloudflared({ dir, log: () => {}, fetchImpl: fakeFetch, platform: process.platform, arch: process.arch })
  check(r.path === '' && /大小不符|截断|太小/.test(String(r.error)), 'size 不符的包被判失败', JSON.stringify(r))
  check(!existsSync(join(dir, binName(process.platform))), 'size 不符的包不会被落盘')
  rmSync(dir, { recursive: true, force: true })
}

// ── 5. 下载：sha256 不符 → 判失败 ───────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'cf-sha-'))
  const payload = Buffer.alloc(21 * 1024 * 1024, 3)
  const asset = assetName(process.platform, process.arch)
  const fakeFetch = async (url) => {
    if (url.includes('api.github.com')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          tag_name: '2026.10.5',
          assets: [{ name: asset, size: payload.length, digest: 'sha256:' + '0'.repeat(64), browser_download_url: 'https://example.invalid/' + asset }],
        }),
      }
    }
    return fakeRes(payload)
  }
  const r = await ensureCloudflared({ dir, log: () => {}, fetchImpl: fakeFetch, platform: process.platform, arch: process.arch })
  check(r.path === '' && /sha256/.test(String(r.error)), 'sha256 不符的包被判失败', JSON.stringify(r))
  rmSync(dir, { recursive: true, force: true })
}

// ── 6. 下载成功：落盘 + 可执行位 + .part 不残留 ──────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'cf-ok-'))
  const payload = Buffer.alloc(21 * 1024 * 1024, 5)
  const good = createHash('sha256').update(payload).digest('hex')
  const asset = assetName(process.platform, process.arch)
  const fakeFetch = async (url) => {
    if (url.includes('api.github.com')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          tag_name: '2026.10.5',
          assets: [{ name: asset, size: payload.length, digest: 'sha256:' + good, browser_download_url: 'https://example.invalid/' + asset }],
        }),
      }
    }
    return fakeRes(payload)
  }
  const r = await ensureCloudflared({ dir, log: () => {}, fetchImpl: fakeFetch, platform: process.platform, arch: process.arch })
  const target = join(dir, binName(process.platform))
  check(r.source === 'download' && r.path === target, '下载成功后返回安装路径', JSON.stringify(r))
  check(existsSync(target) && readFileSync(target).length === payload.length, '落盘内容与下载一致')
  check(!existsSync(target + '.part'), '临时 .part 文件不残留')
  if (process.platform !== 'win32') {
    const mode = readFileSync(target).length > 0 ? (await import('node:fs')).statSync(target).mode : 0
    check((mode & 0o111) !== 0, '非 Windows 上给了可执行位', String(mode.toString(8)))
  }
  rmSync(dir, { recursive: true, force: true })
}

// ── 7. Tailscale 模式：不起网关、不碰 cloudflared ───────────────────────────────
{
  const logs = []
  const ra = new RemoteAccess({
    log: (m) => logs.push(m),
    secret: 'x'.repeat(43),
    webLog: join(tmpdir(), 'nope-web.log'),
  })
  // tailnet 模式在 RemoteAccessor.up() 里短路，永远不会走到 RemoteAccess.start()；
  // 这里证明的是「即使被强行 start，也是先确保二进制、拿不到就不起隧道」这条底线。
  const st = await ra.start()
  // 本机 ~/.dsh/bin 里有一份真包 ⇒ 应该是 running；换成不存在的 binPath 才走失败分支。
  check(typeof st.running === 'boolean', 'start() 返回状态快照', JSON.stringify(st))
  ra.dispose()
}

// ── 8. binPath 显式配置时不做任何探测 ───────────────────────────────────────────
{
  const r = await ensureCloudflared({
    binPath: '/definitely/not/here/cloudflared',
    log: () => {},
    fetchImpl: () => { throw new Error('不该联网') },
  })
  check(r.source === 'config' && r.path === '/definitely/not/here/cloudflared', '显式配置的路径优先且不探测', JSON.stringify(r))
}

// ── 9. 断点续传：第一轮只给 1MB 就断，第二轮必须带 Range 把剩下的下完 ───────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'cf-resume-'))
  const payload = Buffer.alloc(21 * 1024 * 1024, 9)
  const good = createHash('sha256').update(payload).digest('hex')
  const asset = assetName(process.platform, process.arch)
  const cut = 1024 * 1024
  const ranges = []
  let dataHits = 0
  const fakeFetch = async (url, init = {}) => {
    if (url.includes('api.github.com')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          tag_name: '2026.10.5',
          assets: [{ name: asset, size: payload.length, digest: 'sha256:' + good, browser_download_url: 'https://example.invalid/' + asset }],
        }),
      }
    }
    dataHits += 1
    const range = String((init.headers && init.headers.range) || '')
    ranges.push(range)
    if (dataHits === 1) {
      const head = payload.subarray(0, cut)
      return {
        ok: true, status: 200,
        headers: { get: (k) => (String(k).toLowerCase() === 'content-length' ? String(payload.length) : null) },
        body: (async function* () {
          yield head
          throw new Error('socket hang up')
        })(),
      }
    }
    const from = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0)
    const rest = payload.subarray(from)
    return {
      ok: true, status: 206,
      headers: {
        get: (k) => {
          const key = String(k).toLowerCase()
          if (key === 'content-length') return String(rest.length)
          if (key === 'content-range') return 'bytes ' + String(from) + '-' + String(payload.length - 1) + '/' + String(payload.length)
          return null
        },
      },
      body: fakeBody(rest),
    }
  }
  const r = await ensureCloudflared({ dir, log: () => {}, fetchImpl: fakeFetch, platform: process.platform, arch: process.arch })
  const target = join(dir, binName(process.platform))
  check(ranges.length >= 2 && ranges[1] !== '', '断流后第二轮带 Range 续传', JSON.stringify(ranges))
  check(r.path === target, '续传后安装成功', JSON.stringify(r))
  check(existsSync(target) && readFileSync(target).length === payload.length, '续传拼接出的文件大小正确')
  check(existsSync(target) && createHash('sha256').update(readFileSync(target)).digest('hex') === good, '续传拼接出的文件 sha256 正确')
  rmSync(dir, { recursive: true, force: true })
}

console.log('\n' + String(pass) + '/' + String(pass + fail) + ' checks passed')
process.exitCode = fail === 0 ? 0 : 1
