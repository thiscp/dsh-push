## MODIFIED Requirements

### Requirement: 访问令牌鉴权
App SHALL 不在 APK 中内置 ntfy 账号密码，MUST 使用服务器签发的只读访问令牌（`tk_` 前缀）以 `Authorization: Bearer <token>` 鉴权；令牌由用户在应用内输入并存于应用私有偏好。通行证输入 SHALL 同时接受**完整通行证文本** `dshpush://v1?base=…&topic=…&token=…`：SHALL 解析出 `topic`（与可选 `base`）并持久化，订阅地址 SHALL 按 topic 派生为 `wss://<host>/<topic>/ws`；只粘一串 `tk_…` 时 SHALL 保持旧行为（topic 默认 `dsh`、base 用内置中继），使已配好的手机不被破坏。状态行 SHALL 显示当前 topic。

#### Scenario: 首启输入通行证
- **WHEN** 首次启动（令牌为空）打开主界面
- **THEN** 显示"通行证"输入卡片（粘贴框+保存按钮），前台服务保持运行且状态为"等待通行证"，不连接、不重连

#### Scenario: 保存后连接
- **WHEN** 用户粘贴有效只读令牌并点保存
- **THEN** 卡片隐藏，服务带新令牌即时重连，状态行显示"已连接"

#### Scenario: 令牌被拒
- **WHEN** 服务器对握手返回 401/403（令牌错或权限不符）
- **THEN** 状态行显示"通行证被拒(40x)"，按指数退避（上限 60 秒）继续重连，不崩溃

#### Scenario: 更换令牌
- **WHEN** 用户长按顶栏头像
- **THEN** 令牌清空、输入卡片重现、服务回到"等待通行证"状态

#### Scenario: APK 外流
- **WHEN** 未配置令牌的他人安装同一 APK
- **THEN** 无有效令牌既看不到推送也发不了假通知，作答因无 callId 不可用

#### Scenario: 粘贴完整通行证
- **WHEN** 用户粘贴 `dshpush://v1?base=https://ntfy.cpyh.xyz&topic=dsh-alice&token=tk_…` 并保存
- **THEN** 服务订阅 `wss://ntfy.cpyh.xyz/dsh-alice/ws` 并显示"已连接"，状态行显示 topic `dsh-alice`

#### Scenario: 只粘令牌时保持旧行为
- **WHEN** 用户只粘贴一串 `tk_…`（不带 `dshpush://` 前缀）
- **THEN** topic 取默认 `dsh`、base 取内置中继，行为与 v1.32.36 一致

#### Scenario: 通行证看不懂时明确拒绝
- **WHEN** 粘贴的内容既不是 `dshpush://` 链接也不是 `tk_` 开头，或链接里没有 token、topic 名字不合法、base 不带 http(s) 前缀
- **THEN** 用中文说明原因并**不写入任何偏好**、不打断当前连接（原 topic 继续工作）

#### Scenario: 状态卡片跟随连接状态自刷
- **WHEN** 用户停在主界面不动，而服务的连接状态在这之后才变化（保存通行证发的 reload 是异步意图，通常晚 1~2 秒）
- **THEN** 状态卡片每 2 秒自行刷成新状态（如从「等待通行证」变「已连接」），无需退出重进或冷启动；离开界面即停表，不留后台定时器
