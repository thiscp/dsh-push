# Tasks: android-explicit-read

- [x] 1. `PushService`：markRead 助手（mid 主键、ts 兜底）、msgs 存 mid、readAction、webAction 带 mmid/mts/mnid（request code 分离防 extras 互覆）
- [x] 2. `AnswerReceiver` act=read 分支；`WebActivity` markMsgRead（onCreate+onNewIntent）；`MainActivity` 删 1.2s 自动已读与 markAllRead、卡片加「已读」按钮、网页按钮同标已读
- [x] 3. v1.18.0（42）构建上架 `?v=50`；真机验收主页按钮/通知已读按钮通过
- [x] 4. v1.18.1（43）补丁：「打开 DSH」按钮同时撤通知（setAutoCancel 只管本体）；上架 `?v=51`，真机验收"通知成功消失"
- [x] 5. 用户真机验收（三条入口全过）后归档
