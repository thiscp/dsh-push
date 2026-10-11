# Windows DSH Web 推送接入

## Why

推送体系此前只挂在 Linux 工作机的 DSH Web 上。用户要求把同一套"任务结束推送 + 手机作答回传"装到 Windows 本机的 DSH Web（承载日常会话的实例）。落地时暴露出两个规格空白：回传链路只描述了"单一工作机桥接"，没有多主机路由；也没有任何需求描述"一台新 DSH Web 主机要满足什么条件钩子才会触发"——后者导致本机调试一夜 6 轮测试全部白费（假重启吞了两次正确修复）。

## What Changes

- answer-relay：`答案转发到桥接` 扩展为多主机路由——relay 的 BRIDGE_URL 指向最近接入主机（现为 Windows）的桥接，桥接按 agentId 本地命中，未命中转发上游（工作机）桥接。
- 新能力 dsh-host-integration：一台 DSH Web 主机接入推送的生效条件（桥插件 insert 挂载、Windows 服务下钩子命令需部署级 danger-full-access、ACL runner 的 temp-in-workspace 约束、重启真实性以端口持有权变更为准 + dump-config 验证）。

## Impact

- aliyun answer-relay.py：BRIDGE_URL 已切 `http://<tailnet-windows>:2588/answer`（Windows tailnet IP）。
- Windows 新增：`C:\Users\<user>\bin\dsh-ntfy-push.py`、`dsh-answer-bridge.mjs`（计划任务 DshAnswerBridge）、profile patch 两条（hooks insert + sandbox-policy）。
- dsh-net.ps1 / dsh-net-restart-once.ps1：TEMP 固定与假重启检测（cp_learn_win 1892f88）。
- 无 APK 变更、无 ntfy 服务端变更（复用 dshpub/dshphone 令牌）。
