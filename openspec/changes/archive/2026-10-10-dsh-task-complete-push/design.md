# Design

## Context

- DSH Web 跑在工作机 VM（NAT 内，Tailscale 可达，出站走 Clash Verge 代理），无公网入站；推送必须经公网服务器中转
- aliyun-relay（SAS，2 GiB 内存，余量紧张）已有 Docker + host 网络的边缘 nginx，按 SNI 在 443 分流（`cpyh.xyz` 归 nginx，DERP 挪到 127.0.0.1:4430），certbot webroot HTTP-01 自动续期已就绪
- DSH 自带 `@deepseek-ai/dsh-hooks-claude-code` 桥接插件：挂载后指向 `hooks.json`，`Stop` 事件在每轮 agent 停止时执行 command 钩子（只有 command 钩子会运行；Stop 钩子非零退出可阻塞 stop）
- 手机为 Android

## Goals / Non-Goals

**Goals:**
- 任务轮次结束后手机在秒级收到推送（含会话标识与工作目录）
- 推送链路任何一环失败都不影响 DSH 任务本身
- 复用现有阿里云设施（nginx SNI、certbot），新增运维面最小

**Non-Goals:**
- 不做推送的回执/双向交互（手机点通知直接打开 DSH Web 即可）
- 不做任务失败/需要人工介入等细分事件的第一期推送（钩子结构预留即可）
- 不管 Windows 本机 DSH 的推送（仅 DSH Web）

## Decisions

1. **通道选自建 ntfy**（对比 Server酱/PushPlus：无第三方依赖与频率限制；对比 Bark：Android 支持更好；对比 Telegram：不依赖 TG 可达性）。ntfy 是单 Go 二进制，空闲内存约 30–50 MB，容器设 `mem_limit=128M` 防挤爆 2 GiB 机器
2. **暴露方式：边缘 nginx 按 SNI 新增 `ntfy.cpyh.xyz` server block → `127.0.0.1:2586`**，与现有 cpyh.xyz 分流模式一致；证书走现有 certbot webroot 流程；DNS 加一条 A 记录
3. **鉴权：关闭匿名发布，DSH 侧用 access token**（存工作机 `~/.config/dsh-ntfy/token`，0600，不进 git）；topic 名 `dsh`
4. **触发点：`Stop` 钩子**（每轮结束），不用轮询日志。脚本从 stdin JSON 取 session/turn 字段；**脚本任何路径都 exit 0**，避免 Stop 钩子非零退出阻塞 stop 的语义
5. **防刷屏**：按 turn id 去重（同轮只推一次）；连续 goal 轮次每轮都推（用户要的就是每轮结束的确认），但正文短、可静音

## Risks / Trade-offs

- **2 GiB 内存余量**：ntfy 容器必须设 limit 并观察 OOM 记录；OOM killer 在这台机器上"会挑错人杀"
- **Stop 钩子语义**：桥接实现里 Stop 钩子可阻塞 stop——脚本 exit 0 纪律 + 超时（`curl -m 5`）兜底
- **工作机节假日关机**：工作机侧任务只能在开机时执行
- **Android 省电杀后台**：ntfy 需前台服务 + 电池优化豁免，否则"即时推送"退化为打开 App 才收
- **certbot 新子域**：HTTP-01 需要 nginx 先有该 server block 且 DNS 生效，顺序不能反

6. **提问待答推送用 `PreToolUse` 钩子**（matcher `ask_user_question|exit_plan_mode`）：提问本质是一次工具调用，PreToolUse 在其执行前触发，stdin JSON 携带工具入参（问题文本与选项）。推送正文含问题摘要+选项列表，附 ntfy **view action**（`Click URL` = DSH Web 会话链接），手机点开即在浏览器里作答。对比"通知栏按钮直接作答"（ntfy http action 回调）：回调需公网入口再穿回 NAT 内的工作机，链路长且依赖 DSH Web 对外 API，列为二期 spike
7. **手机作答入口的前提是手机装 Tailscale**（直达 `http://<tailnet-work>:3080`）；若日后要公网访问 DSH Web，再走"阿里云反代 + cpyh.xyz"的独立变更，不在本期

## 新增风险（提问推送相关）

- **hook payload 字段名未实证**：PreToolUse stdin JSON 里问题/选项的确切字段需先抓一次真实载荷再定提取逻辑（任务 3.6），脚本对缺字段要容错（推"DSH 正在等你选择"兜底文案）
- **点链作答依赖手机 Tailscale 与工作机在线**：链接失效时推送本身仍到达，作答退回"回到电脑前处理"

## 决策修订（一步到位自研 App，2026-10-10 用户拍板）

8. **自研 App 只做客户端，不重造传输层**：服务端仍是 ntfy（开放协议：HTTP + WebSocket + 消息保留），App 用 OkHttp WS 订阅。对比"完全自建服务端推送协议"：省掉消息持久化、离线补推、WS 鉴权的全部脏活；App 失败可退回任意 ntfy 客户端，无损
9. **推送载荷改为 JSON**：ntfy 消息体直接 POST JSON（`event`、`session`、`cwd`、`question`、`options[]`、`tool_use_id`、`nonce`、`web_url`）。自研 App 按 `event` 原生渲染；代价是 ntfy 官方 App 看消息是生 JSON——反正不用它
10. **作答回传：App → `https://ntfy.cpyh.xyz/answer`（nginx → answer-relay 容器）→ Tailscale → 工作机 DSH Web 应答 API**。每次提问生成一次性 nonce（推送脚本注册到 answer-relay，含目标会话与回调地址），防重放、防伪造。手机无需 Tailscale
11. **iQOO 13 / Android 16 保活策略**：前台服务（常驻通知）+ WS 心跳 + 指数退避重连 + vivo 自启动白名单与电池优化豁免（首次启动引导页）。**不接 vivo Push**（需厂商账号与 SDK，列为后续可选）；无 GMS 环境，FCM/Web Push 均不可用
12. **应答 API 是第一验证项**：DSH Web 前端作答必然经过一个 HTTP/WS 接口——先抓包实证（任务组 2），App 作答功能与 answer-relay 转发目标都在其上定契约。若实证发现应答接口不可外部调用，回退方案是"通知点链开浏览器作答"（原一期方案）

## 新增风险（自研 App 相关）

- **vivo 后台管控**：前台服务仍可能被"i 管家"冻结，到达 SLA 从"5 秒"放宽为"前台服务存活时 5 秒；被冻结后打开 App 即补推（ntfy 消息保留）"
- **应答 API 未实证**：整个一键作答链路的地基，排期上最先做
- **App 开发/维护成本**：单人 Kotlin 项目，功能面必须克制（订阅+渲染+作答，不做会话历史列表等锦上添花）

## 附录 A：DSH Web 应答机制实证（2026-10-10，工作机 0.2.0-rc.2 源码）

来源：`~/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/`（`dsh-user-questions`、`dsh-client-ui-user-questions`、`dsh-api-session-controller`、`dsh-api-gateway`）。

1. **作答 = 注入一条带特殊 source 的用户消息**：`source = { kind: "user-question-reply", callId: <ask_user_question 的工具调用 id>, outcome: "answered" }`，content 是答案批（按 question id 配对）。host 侧 `agent/inbox/claimed` 按 `callId` 认领并唤醒等待的工具调用。
2. **通道 = API Gateway 的一次性 RPC**：`connection.rpc.call('/api', <endpoint>, { args })`——HTTP POST 到 `/api`（Typert RPC，端点描述符是字符串，如 `session-controller.client.control`；session remote 命名空间含 `prompt` 方法）。**不需要常驻 WebSocket**。
3. **鉴权**：401 Unauthorized / Forbidden（浏览器信任判定）；启动参数带 `--trusted-host <tailnet-work>/192.168.12.18/192.168.149.128/28.0.0.1`——**answer-relay 从 Tailscale 侧发起、源 IP 为 <tailnet-relay>（不在 trusted-host 里），需带 web token 或把阿里云 tailscale IP 加进 trusted-host**（二选一，实测定）。
4. **已实证（任务 2.2，2026-10-10 17:45，tcpdump 抓包 + curl/Node 复现全通过）**：

   **鉴权**：`GET /?token=<tok>` → 303 + `Set-Cookie: dsh-auth-<...>`（签名、绑 Host）；此后所有 `/api/*` 带该 cookie。curl 用 `-c/-b jar` 即可。Host 头必须与签发时一致（走 3080 代理时 Host 天然保留）。

   **RPC 信封**（一次性，无需 WS）：`POST /api/<namespace>/<method>`，body
   `{"type":"client-request","rpcId":"<uuid>","method":"<namespace>/<method>","payload":{"args":{...}}}`；
   响应 `{"type":"server-response","rpcId":"<同>","result":{"ok":true,"value":...}}`。

   **建会话**：`session/create` args `{"request":{}}` → `{sessionId, agentPreset}`。
   **发任务**：`session/prompt` args `{"request":{"requestId":"<uuid>","sessionId":...,"mode":"queue","content":[{"type":"text","text":...}],"clientTimeZone":"Asia/Shanghai"}}` → `{accepted:true}`。

   **提问事件**（关键发现）：`ask_user_question` 挂起时网关把问题作为 **Remote 事件**广播给所有挂着 `$events` 流的客户端（WS `/api/remote.mux`，帧 `{type:"item",streamId,value:{type:"waterfall",event:"user-questions/request",eventId,agentId,request:{questions:[...]}}}`；首帧 `{type:"ready",clientId,host}`）。**新连接的客户端会补收所有 pending 事件**——桥接进程随时上线都能拿到未答问题。

   **作答（open 状态）**：`POST /api/$events/result` args `{"clientId":"<ready帧的>","eventId":"<事件帧的>","outcome":{"kind":"result","value":{"answers":[{"id":"<问题id>","selected":["<选项label>"]}]}}}`。clientId 必须是收到过该事件的那个流连接。

   **作答（continued 状态，工具超时后）**：`POST /api/userQuestions/answer` args `{"agentId":"<sessionId>","callId":"<tool_use_id>","answer":{"answers":[...]}}`（open 状态调用返回 `value:false`，无副作用）。

   **状态机**：问题 `open`（前台等待）→ 工具返回 pending 结果后 `continued`；`user-question-reply` 用户消息被 agent 认领后结算。
5. **`callId` 的来源**：PreToolUse 钩子 stdin JSON 里的工具调用 id 即 `callId`（与推送载荷 `tool_use_id` 同值），answer-relay 转发时原样带回。

## 决策修订（App v1 实现形态，2026-10-10 实施时定）

推送载荷**不引入结构化 JSON 事件**（原设计 `turn`/`question` 事件字段）：保持人类可读 title/message，提问推送在正文尾部附作答链接 `https://ntfy.cpyh.xyz/answer/<urlenc(callId)>`。自研 App 用正则提取 callId，经 `GET /answer/<callId>/json`（answer-relay 新端点）拉题目渲染快答对话框，提交 `POST /answer/submit {callId, answers}`。好处：ntfy 官方 App 无需任何改造即可当查看器用（链接直接点开网页作答），自研 App 只是把两步压成一步；载荷对人和机器都自解释。
