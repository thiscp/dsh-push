# Tasks: android-notify-free-reply

- [x] 1. 两端 hook 加 `#qid <首问id>` trailer（位于 #web 前），repo 副本同步；模拟推送验证（#qid qa / #qid qw 均已落 ntfy）
- [x] 2. `PushService`：解析 #qid；quickAction 改挂 RemoteInput（choices=前3选项、allowFreeInput）+ FLAG_MUTABLE reply PendingIntent（extras: callId/qid/nid/replySlot）
  - 集成注：`setRemoteInputs` 是隐藏方法、`setAllowFreeInput` 首构建未过——改公开 `addRemoteInput`，allowFreeInput 有 choices 时默认 true，行为不变
- [x] 3. `AnswerReceiver`：replySlot 分支——取 RemoteInput 结果；空→拉 QuickAnswerActivity 降级；非空→custom 提交 + 撤通知 + markAnswered + toast
- [x] 4. 版本 1.11.0 / versionCode 35；Lead 构建部署 aliyun `?v=43`
- [x] 5. 用户醒来真机验收（vivo 横幅/展开通知是否弹输入框）后归档
- [x] 6. v1.15.0 蹦床修正：回复 PendingIntent 由广播改 **activity 直达 QuickAnswerActivity**（Android 14+ 禁止通知→广播→拉活动蹦床，Android 16 上广播降级会被静默拦）；RemoteInput 结果随 activity intent 提交，无结果走正常快答流程。AnswerReceiver replySlot 分支保留为防御
- [x] 7. v1.16.0 修复"手机答完通知不消失"：RemoteInput 提交后系统会把通知**重贴**回栏显示内联回复，晚于回声撤除（~0.5s）即复活（11:33 实测）——QuickAnswerActivity 提交成功当场本地 cancel(nid)；HTTP 404/409/410 同样撤通知并入 __expired
