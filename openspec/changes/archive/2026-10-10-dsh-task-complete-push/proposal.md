# Proposal

## Why

DSH Web（工作机 VM，`work@<tailnet-work>`，浏览器经 `0.0.0.0:3080` 代理访问）经常跑长任务。人离开电脑后只能反复刷新网页确认任务是否结束；任务中途 DSH 用 `ask_user_question` / `exit_plan_mode` 提问时还会**阻塞等待选择**。用户手机为 **iQOO 13（Android 16，无 GMS，vivo 后台管控严）**，决定一步到位自研 Android App：通知到达、问题原生渲染、**通知栏/应用内一键作答**，任务当场继续——通用推送 App（浏览器跳转作答）体验达不到这个定制度。

## What Changes

- 阿里云 aliyun-relay 新增自建 **ntfy** 服务（Docker，内存上限，边缘 nginx SNI 暴露 `https://ntfy.cpyh.xyz`，鉴权）——**仅作传输层**（开放 HTTP+WebSocket 协议，自研 App 直接订阅）
- 阿里云新增 **answer-relay** 转发容器：接收手机答案（公网 HTTPS + 一次性 nonce 鉴权）→ 经 Tailscale 转发到工作机 DSH Web 应答 API
- 工作机 VM 的 DSH Web 挂载 `@deepseek-ai/dsh-hooks-claude-code`：`Stop` 钩子（轮次结束）与 `PreToolUse` 钩子（`ask_user_question|exit_plan_mode`，提问待答）调用推送脚本；脚本 POST **JSON 结构化载荷**（事件类型、会话、问题、选项、tool_use_id、nonce）并向 answer-relay 注册 nonce
- **自研 Android App（Kotlin）**：订阅 ntfy WebSocket、前台服务保活（vivo 自启动白名单 + 电池豁免）、按事件类型原生渲染（轮次结束=普通通知；提问=问题+选项列表一键作答）、APK 直装免上架
- 手机**不需要装 Tailscale**：作答走公网 webhook；通知附带的 DSH Web 浏览器链接仅作兜底
- **前置验证**：DSH Web 的会话应答 API（web 前端作答用的接口）必须先抓包/查源码实证，App 的作答功能在其上构建

## Capabilities

### New Capabilities
- `push-relay-server`: 阿里云自建 ntfy——HTTPS 可达、写入鉴权、重启自愈
- `answer-relay`: 答案回传通道——nonce 注册/一次性校验、公网接收、Tailscale 转发到 DSH Web
- `dsh-turn-notify`: DSH 轮次结束钩子——正确时机推送、失败不阻塞、不刷屏
- `dsh-question-notify`: DSH 提问待答钩子——JSON 结构化载荷（问题+选项+nonce）、失败不阻塞、去重
- `companion-app`: 自研 Android App——原生渲染、一键作答、无 GMS 依赖、后台保活

### Modified Capabilities
（无——全新能力）

## Impact

- **aliyun-relay**：+2 个容器（ntfy `mem_limit=128M`、answer-relay `mem_limit=64M`；2 GiB 机器需评估余量）、nginx +1 条 SNI server block（`ntfy.cpyh.xyz` 反代 ntfy，`/answer*` 路径转 answer-relay）、certbot +1 证书、DNS +1 A 记录
- **工作机 VM**：hook 桥接插件 + `hooks.json`（Stop + PreToolUse）+ `dsh-ntfy-push` 脚本 + token/nonce 文件
- **新代码库**：Android App（Kotlin，最小依赖：OkHttp WS + 通知 API），APK 直装；规格仓库同侧开发（测试VM1 或本机）
- **不改 DSH 源码**（应答 API 复用 web 前端已有接口；若实证发现无对外应答接口，触发设计回退讨论）
