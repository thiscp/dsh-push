# companion-app delta

## MODIFIED Requirements

### Requirement: 网页直达按钮
App SHALL 解析推送中的 `\n#web <url>` 机器行（从正文剥离不展示）并把最近一次 URL 持久化；常驻服务通知 SHALL 在已存有 URL 时提供"打开 DSH"按钮；事件通知 SHALL 在 action 名额有空位时（任务结束、或提问无 2 个及以上直答选项按钮）追加同一按钮；主界面每条消息卡片 SHALL 自带"DSH 网页"胶囊、打开该条消息自身携带的链接（无链接的条目不显示）；常驻通知按钮 SHALL 随新消息携带的新 URL 自动更新。全部网页直达入口 SHALL 落入 App 内置的**单实例网页窗口**（WebView，跟随所选主题）：窗口已存在时 SHALL 复用并在其中加载新链接（token 轮换亦然），MUST 不叠加新窗口。

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

#### Scenario: 窗口复用
- **WHEN** 网页窗口已打开，用户再次点击任意网页直达入口（同链接或 token 轮换后的新链接）
- **THEN** 复用同一窗口并在其中加载新链接，不叠加新窗口

#### Scenario: 无链接降级
- **WHEN** 推送不含 `#web` 行（服务端未配置或取不到 token）
- **THEN** 通知照常弹出、无网页按钮，不崩溃
