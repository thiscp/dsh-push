# Tasks: android-keepalive-checkup

- [x] 1. `MainActivity`：保活体检对话框（自动检测两项 + vivo 手动四项 + 跳转兜底链）；入口胶囊（按钮行拆两行）
  - 集成注：dshOk/dshBad 未立项——运行时 getIdentifier 兜底（退强调色/警示色），日后加 attr 自动生效；跳转不用 resolveActivity 预筛（targetSdk 34 包可见性误判），直接 try/catch startActivity 链
- [x] 2. 版本 1.14.0 / versionCode 38；Lead 构建部署 aliyun `?v=46`（06:48:51 APK）
- [x] 3. 用户醒来真机验收（体检状态与实际一致；vivo 跳转至少落应用详情页）后归档
