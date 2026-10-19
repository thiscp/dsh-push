# Tasks: android-msg-list-management

- [x] 1. `PushService.handleMessage`：新消息条目写 `read:false`；msgs 保留上限 10 → 30
- [x] 2. `MainActivity`：未读卡片标题前强调色圆点（SpannableString）；状态卡片上方"N 条未读"行（0 条时隐藏）；onResume 渲染后 1.2s 全部标 `read:true` 落盘（不重渲染）
- [x] 3. `MainActivity` 底部按钮行加"清空消息"胶囊：确认对话框 → 清空 msgs → 列表与空状态刷新
- [x] 4. 版本 1.10.0 / versionCode 34（并入主题包同批）；Lead 构建部署 aliyun `?v=42`
- [x] 5. 用户醒来真机验收后归档
