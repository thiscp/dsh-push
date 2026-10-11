# Tasks

## 1. 阿里云：传输与转发（aliyun-relay）

- [x] 1.1 DNS 增加 A 记录 `ntfy.cpyh.xyz → 47.109.50.167`，`getent` 验证生效
- [x] 1.2 创建 ntfy 容器：`binwiederhier/ntfy serve`，卷持久化 db，绑定 `127.0.0.1:2586`，`mem_limit=128M`，`restart=unless-stopped`
- [x] 1.3 边缘 nginx 新增 `ntfy.cpyh.xyz` SNI server block：`/` 反代 ntfy（透传 WebSocket Upgrade 头），`/answer*` 反代 answer-relay，reload
- [x] 1.4 certbot 为 `ntfy.cpyh.xyz` 签发证书（webroot HTTP-01），确认续期列表包含它
- [x] 1.5 创建 ntfy 账号与 access token，关闭匿名写；`/healthserver` 与带 token POST 验收
- [x] 1.6 answer-relay 容器：`POST /answer/register`（nonce→目标会话/回调）与 `POST /answer`（校验 nonce→经 Tailscale 转发到工作机 `<tailnet-work>:3080`），nonce 一次性，`mem_limit=64M`
- [ ] 1.7 重启 aliyun-relay，确认两个容器与 nginx 自愈、HTTPS 链路仍通

## 2. DSH Web 应答 API 实证（前置，依赖工作机开机）

- [x] 2.1 抓包 web 前端对 `ask_user_question` 的应答请求（方法/路径/鉴权/字段）
- [x] 2.2 从外部 `curl` 直调 `http://<tailnet-work>:3080` 完成一次应答，确认任务继续（实证：WS $events 拿 eventId → POST /api/$events/result → agent 继续 → Stop 推送；见 design.md 附录 A 第 4 条）
- [x] 2.3 固化应答契约（写入 design.md 附录）——无需回退讨论，外部可编程作答已实证

## 3. 工作机 VM：钩子与推送脚本（依赖工作机开机）

- [x] 3.1 DSH Web profile 挂载 `@deepseek-ai/dsh-hooks-claude-code`，`configPath` 指向 `~/.dsh/hooks.json`（坑：net.patch.yml 里裸 `- name:` 条目会被 app-boot 以 "id is required for non-insert patches" 跳过，必须写成 `- insert:` + 带 `id` 的条目；用 `--dump-config | grep hooks` 验证挂载）
- [x] 3.2 编写 `/usr/local/bin/dsh-ntfy-push`：stdin 读 hook JSON → 组装结构化 JSON 载荷（event/session/cwd/question/options/tool_use_id/nonce/web_url），`curl -m 5` POST ntfy；提问事件另调 `/answer/register` 注册 nonce；任何路径 exit 0
- [x] 3.3 `hooks.json` 配 `Stop` 钩子；重启 DSH Web（走 dsh-net.sh）
- [x] 3.4 抓一次 PreToolUse 真实载荷（字段与假设一致：questions[].id/question/options[].label/multi_select；tool_use_id 形如 `call_xx|uuid`，即 callId），确认 `ask_user_question`/`exit_plan_mode` 字段名，固化提取（缺字段用兜底文案）
- [x] 3.5 `hooks.json` 增加 `PreToolUse` 钩子（matcher `ask_user_question|exit_plan_mode`）
- [x] 3.6 验收：轮次结束手机收推送、中途提问手机收问题推送；断网/token 错误时任务不受影响（2026-10-10 18:00 真人验收：多轮任务结束推送 ✅、提问推送+手机点链接作答 ✅（relay 200 → 桥接 $events/result → agent 继续 → 结束推送），脚本任何路径 exit 0）
- [x] 3.7 （新增）工作机 `dsh-answer-bridge` systemd 服务：常驻 `$events` 事件流（WS remote.mux），登记 callId→eventId，本地 2588 收 relay 转发并注入应答；cookie 过期自动重签、WS 断线自动重连

## 4. 自研 App（iQOO 13 / Android 16，Kotlin）

- [x] 4.1 项目骨架：Kotlin + OkHttp WebSocket，最小依赖（仅 okhttp），APK 直装（免上架）。测试VM1 已建全构建环境（JDK17+SDK34+Gradle8.7，代理 7897），`android-app/` 入仓库，产物 `app-debug.apk` 1.3MB 发布于 https://ntfy.cpyh.xyz/dl/dsh-push.apk
- [x] 4.2 订阅与保活：前台服务（常驻通知）、WS ping 25s、指数退避重连（封顶 60s）、`since=@lastTs` 断线补推、开机自启 Receiver
- [x] 4.3 渲染（v1 实现形态微调）：推送载荷保持人类可读 title/message（不引入结构化 JSON 事件）；App 从消息体提取作答链接得 callId，priority≥4 走高优先级渠道并附「📱 快答」action → 应用内选项对话框（题目经 `GET /answer/<callId>/json` 获取）
- [x] 4.4 一键作答：应用内选完 `POST /answer/submit {callId, answers}`（v2 契约，替代 nonce 方案），Toast 成功/失败反馈；问题过期提示改在浏览器作答
- [x] 4.5 保活引导（v1 简化）：主界面状态页 + 一键跳转电池优化设置；自启动需在 iQOO i 管家手动允许；服务器/账号按私有 App 硬编码，未做配置页
- [ ] 4.6 实测（待用户）：安装 APK → 通知权限 → 电池白名单 → i 管家自启动 → 前台服务存活时推送 5 秒到达 → 通知栏「快答」作答任务继续 → 杀进程重开补推

## 5. 收尾

- [x] 5.1 对照 spec 场景逐条验收（v1.14.1 无 verify 子命令，人工对照完成，见 VERIFICATION.md；仅 push-relay-server「机器重启」场景延至下次计划内重启）
- [x] 5.2 skill 已更新并推送 Gitee：aliyun-relay-ops §7.9（作答链路 v2 + /dl 分发 + ntfy WS 参数规则）、vm-dsh-web-ops §10-12（patch 语义/answer-bridge/ntfy-push 去重）、vm-ssh-ops §1.3（Android 构建环境）
- [x] 5.3 规格、App、deploy/ 快照全部入库；openspec archive 已归档
