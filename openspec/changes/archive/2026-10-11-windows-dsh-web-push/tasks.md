# 任务清单

- [x] 1. Windows 钩子脚本 `dsh-ntfy-push.py`（Stop/PreToolUse，Bearer 令牌，注册 + 📱 链接）
- [x] 2. Windows 回传桥 `dsh-answer-bridge.mjs`（$events 订阅、cookie 重连刷新、agentId 未命中转发工作机桥）+ 计划任务 DshAnswerBridge
- [x] 3. aliyun relay BRIDGE_URL 切 Windows tailnet IP，/health 正常
- [x] 4. profile patch 挂载桥插件（insert 语义）+ sandbox-policy danger-full-access
- [x] 5. run-dsh.cmd 固定 TEMP=C:\Temp（dsh-net.ps1 生成器）
- [x] 6. restart-once 假重启检测：端口持有者前后对比，未变则 taskkill 真凶 + 重新 start（cp_learn_win 1892f88）
- [x] 7. 验收：PreToolUse 推送手机收到（q-call_… dedup key 实证）
- [x] 8. 验收：Stop 推送触发（stop-session-… key 实证）
- [x] 9. 验收：手机作答 → relay → Windows 桥接 → `$events/result` 注入，对话框收到手机选项，pending 归零（用户确认"手机作答成功"）
- [x] 10. 验收：工作机链路无回归（用户确认工作机推送正常收到）
