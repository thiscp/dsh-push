// 扫码配对（v0.6.0）
//
// 一条 QR 就把「手机要的全部信息」带过去，用户不用再粘通行证、也不用手填网页地址：
//
//   dshpush://v1?base=<中继>&topic=<频道>&token=<只读 token>&web=<该台 DSH 网页>&name=<实例名>
//
// - base / topic / token 三项与 v0.3.0 的通行证同义（`passText()` 的词汇），旧 App 只认这三项，
//   多出来的 web/name 会被忽略 ⇒ 扫了也不会坏。
// - `web` 是**这台机器此刻的手机可达入口**：tailnet 模式下是 `webUrl()`（web.log 里带 token 的链接、
//   或 webBase 重写后的地址）；公网隧道模式下是 `remoteUrl + '/?k=' + 口令`（30 天免登录那条）。
//   两种模式都只是把「该给手机的地址」算出来，前端不需要知道区别。
// - 只有 `web` 与 `name` 做 percent-encoding：它们的值里可能带 `?`/`&`/`=`；base/topic/token 的取值
//   集合里不会出现分隔符，保持与 v0.3.0 的原文一致，旧的解析器才能照旧读。
//
// QR 由宿主侧生成，但**不把 SVG/图片塞进 volatile**：volatile 写入会落到 profile 的
// cordis.patch.yml（0.3.0 实测过），几十 KB 的 data URL 会把补丁文件撑起来。
// 所以只传「点阵」——`pairQrMatrix()` 返回 base64 打包的位图（一份 ~340 字符），
// 浏览器半自己用 canvas 画出来。
import qrcode from 'qrcode-generator'

/** 拼扫码载荷。缺项就跳过（只给 web 也行，比如用户只想把网页入口带过去）。 */
export function pairPayload({ relayBase, topic, readToken, web, name } = {}) {
  const parts = []
  if (relayBase) parts.push('base=' + String(relayBase))
  if (topic) parts.push('topic=' + String(topic).replace(/[^A-Za-z0-9_-]/g, '-'))
  if (readToken) parts.push('token=' + String(readToken))
  if (web) parts.push('web=' + encodeURIComponent(String(web)))
  if (name) parts.push('name=' + encodeURIComponent(String(name)))
  return 'dshpush://v1' + (parts.length ? '?' + parts.join('&') : '')
}

/** 底层：直接给 qrcode-generator 的实例，其余导出都基于它。 */
function makeQr(payload, ec) {
  const text = String(payload ?? '')
  if (text.length === 0) return null
  // 纠错等级 M（15%）：手机屏上反光/指纹常见，L 太小、Q/H 会把点阵撑大反而难扫。
  const qr = qrcode(0, ec || 'M')
  qr.addData(text)
  qr.make()
  return qr
}

/** 点阵尺寸（每边几个模块，不含静区）。0 表示没有内容。 */
export function pairQrCount(payload, options = {}) {
  const qr = makeQr(payload, options.ec)
  return qr ? qr.getModuleCount() : 0
}

/**
 * 点阵本体：`{ count, bits }`，`bits` 是 base64 打包的行优先位图（左上起、逐行、深色=1）。
 * 浏览器半解出后直接 putImageData，不必再实现一遍编码器。
 */
export function pairQrMatrix(payload, options = {}) {
  const qr = makeQr(payload, options.ec)
  if (!qr) return { count: 0, bits: '' }
  const count = qr.getModuleCount()
  const bytes = new Uint8Array(Math.ceil((count * count) / 8))
  let n = 0
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) bytes[n >> 3] |= 0x80 >> (n & 7)
      n++
    }
  }
  return { count, bits: Buffer.from(bytes).toString('base64') }
}

/** SVG 文本。`scalable: true` 让它按容器自适应大小——设置页窄屏（345css）与宽屏都能完整显示。 */
export function pairQrSvg(payload, options = {}) {
  const qr = makeQr(payload, options.ec)
  if (!qr) return ''
  return qr.createSvgTag({
    cellSize: options.cellSize || 4,
    margin: options.margin === undefined ? 2 : options.margin,
    scalable: true,
  })
}

/** `<img src>` 能直接吃的 data URL（base64 而不是百分号编码：SVG 里的 `#` 会截断 URL 片段）。 */
export function pairQrDataUrl(payload, options = {}) {
  const svg = pairQrSvg(payload, options)
  if (svg.length === 0) return ''
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64')
}

/** 载荷里 web 的长度上限：超长地址多半是配置写坏了，宁可显示原文让用户看清。 */
export const PAIR_WEB_MAX = 512
