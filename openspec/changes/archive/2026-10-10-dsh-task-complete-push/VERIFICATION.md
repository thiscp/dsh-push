# 验收报告（2026-10-10，对照 spec 全部场景）

证据链：ntfy 主题历史（`GET /dsh/json?poll=1`）、aliyun journal（answer-relay/edge access）、工作机 journal（dsh-answer-bridge）、用户 iQOO 13 实机截图与口头确认。

## dsh-turn-notify
- 正常完成 ✅ 多次「DSH 任务结束 [sess8]」见主题历史（16:41 起数十条）
- ntfy 不可达 ✅ 脚本恒 exit 0、失败仅记 error.log，不阻塞任务（headless 实测 + 代码审查）
- 钩子重复触发 ✅ 去重按 session 生效（19:26 段实测：窗口内被吞、窗口外全发；窗口后调至 3s 并模拟 5s 双 Stop 双发验证）

## dsh-question-notify
- 选择题提问 ✅ 「DSH 等你选择」priority 4 多条（17:09/17:32/19:04/19:13/19:30）
- 计划审批 ✅ hooks.json matcher `ask_user_question|exit_plan_mode` 覆盖（exit_plan_mode 场景未单独实测，机制同路径）
- 注册成功 ✅ journal `register 200`（17:59:42）
- 字段缺失 ✅ 全 `.get()` 带默认值，兜底文案「DSH 正在等你选择」（代码审查）
- 钩子重复触发 ✅ 按 tool_use_id 去重

## push-relay-server
- 健康检查 ✅ /health 200；证书续期 ✅ certbot webroot 自动续（dry-run 通过）
- 匿名写入被拒 ✅ auth-default-access deny → 403；token 写入成功 ✅ dshbot Basic 全部 200
- 机器重启 ⏸ 延至下次计划内重启（tasks 1.7 已注明）；内存受约束 ✅ 容器限额运行至今无 OOM
## answer-relay
- 提问即注册 ✅；未注册即访问 ✅ 404「问题不存在或已过期」
- 手机点推送链接作答 ✅ 真实用户 17:59:42-53 全链 200
- 端到端 ✅ submit → 桥接 → `$events/result` → 任务继续（用户确认 + journal）
- 桥接不可达 ✅ 连接拒绝时 relay 透传错误（实测）；无对应事件 ✅ 演练注册透传「no pending event」
- 重复点击提交 ✅ 成功即 `expires=now`，再提交 404（代码级）
- v1 注册兼容 ✅ v1 nonce+url 字段保留（代码级）

## companion-app（v1.4）
- 提问事件 ✅ 高优先级震动通知 + 「📱 快答」（用户截图）；轮次事件 ✅ 普通通知（截图 18:49）
- 作答成功 ✅ App 内选项 → submit → 任务继续（用户确认「app应该是没什么问题了」）；nonce 已失效 ✅ Toast「问题已过期或不存在」
- 服务存活 ✅ 状态「已连接」+ 连发 3/3 全收；冻结后补推 ✅ 重连 `since=<裸ts>` 补收（连发测试与重连实测；vivo 冻结场景由补推机制覆盖）
- 无 GMS 依赖 ✅ iQOO 13（Android 16 无 GMS）直装直用

## 偏差记录（见 design.md「决策修订」）
- 推送载荷保持人类可读文本+作答链接（未引入结构化 JSON 事件），App 经 `/answer/<callId>/json` 原生渲染
- 作答契约 v2 用 `{callId, answers}`（替代 nonce/choice）；Stop 去重窗口 3s（防重复触发本为秒级）
