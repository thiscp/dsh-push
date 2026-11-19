# companion-app — 变更规格（webview-warm-reuse）

## ADDED Requirements

### Requirement: 内置浏览器网页窗口热复用与保温

App 的内置网页窗口 SHALL 让「再进同一台 DSH」不需要重新加载：判定 MUST 落在窗口收 URL 的那一层
（`onNewIntent`），使推送通知、消息卡片、实例选择器、设备卡**所有入口共用同一套判定**，MUST NOT 只给推送那条路开小灶。
判「是不是同一台」SHALL 依据窗口自己登记的入口链接与其 token（`loadedUrl` / `loadedToken`），
MUST NOT 用 `web.getUrl()` 或被重定向改写过的 `lastUrl` —— 入口的 `?token=` 会被 303 抹掉，
用它们判 token 轮换恒判不出，会在 DSH 重启后热挂一个 401 页面。
窗口 SHALL 提供显式的「刷新」入口，供用户主动要求重新加载。

#### Scenario: 同一台再进秒开

- **WHEN** 某台 DSH 的网页刚被打开过（窗口仍在任务栈内），用户再点该机的推送通知 / 设备卡 / 实例选择器
- **THEN** 页面不重新加载即刻可用，登录态、所在会话与滚动位置原样保住；logcat `dshwarm` 打 `reuse host=…`

#### Scenario: 换机走重载；token 差异交给鉴权守卫（1.34.14 改判）

- **WHEN** 目标与当前页面不是同一 `host:port`
- **THEN** 走完整重载路径（行为与改动前逐字一致）
- **AND** 只有 token 不同（同 host）MUST NOT 触发重载：先复用缓存画面，页面若显示要求重新鉴权（这台真重启了）
  才由守卫 `location.replace` 到来链。判据是 logcat `dshwarm` 打 `reuse … tokenChanged=true (skip reload)`

#### Scenario: 裸链入口按通配放行

- **WHEN** 入口链接不带 token（设备卡的 `d.web` 常为裸链）
- **THEN** 不因缺 token 退化为重载，按同 host 走热路，鉴权由页面自身的 Cookie 承担

#### Scenario: 手动刷新必重载

- **WHEN** 用户点顶栏「刷新」
- **THEN** 作废保温状态并重新加载当前地址，同时取消在飞重试、收起错误层与断网页

#### Scenario: 关闭后仍保温

- **WHEN** 用户点顶栏「关闭」回到 App 主页，随后再点同一台设备的入口
- **THEN** 网页窗口此前 SHALL NOT 被 `destroy()`（关闭 = 把窗口留在任务栈下层），再进仍是秒开；
  彻底关闭由用户在最近任务里划掉卡片完成

## MODIFIED Requirements

### Requirement: 网页直达按钮
App SHALL 解析推送中的 `\n#web <url>` 机器行（从正文剥离不展示）并把最近一次 URL 持久化；常驻服务通知 SHALL 在已存有 URL 时提供"打开 DSH"按钮，事件通知 SHALL 在 action 名额有空位时（任务结束、或提问无 2 个及以上直答选项按钮）追加同一按钮，主界面每条消息卡片 SHALL 自带"DSH 网页"胶囊、打开该条消息自身携带的链接（无链接的条目不显示），常驻通知按钮 SHALL 随新消息携带的新 URL 自动更新。全部网页直达入口 SHALL 落入 App 内置的**单实例网页窗口**（WebView，跟随所选主题），窗口已存在时 SHALL 复用它且 MUST NOT 叠加新窗口；复用时若与当前页面属同一台 DSH（`host:port` 相同且 token 未轮换）且页面健康，SHALL NOT 重新加载，只按链接里的 `#session-` 片段切换会话（换机、token 轮换、页面处于错误态或用户点顶栏「刷新」时才加载新链接）；加载失败 SHALL 显示带重试的人设错误页，网络恢复时 SHALL 自动重试。标题栏 SHALL 显示「DSH 网页 · <实例名>」并随链接加载与窗口复用换新链接同步刷新；最近任务卡片标签 SHALL 同样携带实例名。

#### Scenario: 实例名反查与退化

- **WHEN** 网页窗口标题栏需要显示实例名
- **THEN** 按当前链接的 `host:port` 反查实例清单（名称来自推送 `#name` 或用户改名），查不到时退化为 `host:port`

#### Scenario: 常驻一键直达
- **WHEN** 用户在下拉栏点常驻通知的"打开 DSH"按钮
- **THEN** App 内置网页窗口打开最近一次推送携带的 Tailscale 带 token DSH Web 链接

#### Scenario: 事件通知补位
- **WHEN** 收到任务结束或无直答选项的提问通知
- **THEN** 该通知附带"打开 DSH"按钮；而 2-3 选项直答通知不强塞该按钮，总数不超过 3 个 action

#### Scenario: token 换新
- **WHEN** DSH Web 重启后收到新推送
- **THEN** 常驻与事件通知的按钮链接即为新 token 链接，旧链接作废不影响新链接

#### Scenario: 卡片自带直达
- **WHEN** 主界面某条消息卡片带有网页链接（v1.9.4 起按条存储）
- **THEN** 该卡片提供"DSH 网页"胶囊，点击打开**这条消息自己那台机器**的 DSH Web 链接；旧消息无链接则无此胶囊

#### Scenario: 窗口复用 · 同一台不重载

- **WHEN** 网页窗口已停在某台 DSH，用户再点同一台的任意直达入口（同链接、token 已换过的链接、或不带 token 的裸链）
- **THEN** 复用同一窗口且**不重新加载**：登录态、当前会话与滚动位置原样保住，只按链接里的片段切到目标会话

#### Scenario: 窗口复用 · 只有换机才重载

- **WHEN** 网页窗口停在 A 机器时点 B 机器的入口
- **THEN** 仍在同一窗口内加载新链接（不叠加新窗口），标题栏与最近任务标签同步换成新实例名，不停留在 401 页面

#### Scenario: 深色页面适配
- **WHEN** 所选主题为深夜/星空等深色主题并打开网页窗口
- **THEN** 页面按深色渲染，不再白屏刺眼；浅色主题下页面保持亮色

#### Scenario: 离线兜底
- **WHEN** 目标主机不可达、断网或返回 5xx
- **THEN** 窗口显示人设错误页与"重试"按钮；网络恢复时自动重新加载

#### Scenario: 无链接降级
- **WHEN** 推送不含 `#web` 行（服务端未配置或取不到 token）
- **THEN** 通知照常弹出、无网页按钮，不崩溃

#### Scenario: 标题标识实例
- **WHEN** 用户从任意直达入口打开某台已登记实例（如"工作VM"或"台式机"）的网页窗口
- **THEN** 标题栏显示「DSH 网页 · <实例名>」，最近任务卡片显示「DSH · <实例名>」；未登记主机退化为 `host:port`

#### Scenario: 换机标题跟换
- **WHEN** 网页窗口已停在某台机器，用户再点另一台的直达入口
- **THEN** 同一窗口加载新链接，标题栏与最近任务标签同步换成新实例名
