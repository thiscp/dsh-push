# Tasks: android-web-tab-reuse

- [x] 1. v1.9.7 `SINGLE_TOP` 浏览器复用——真机实测 vivo 浏览器无视，废弃
- [x] 2. 新增 `WebActivity`（WebView 单实例、onNewIntent 换链接、去 Mobile UA、主题化、关闭条）；manifest 注册 + `usesCleartextTraffic`
- [x] 3. 三处入口改落 WebActivity；版本 1.9.8 / versionCode 32
- [x] 4. vm1 构建 → 部署 aliyun `?v=41` → 真机验收：重复点击复用同一窗口；token 换新后原窗口导航新链接；页面按桌面版可用
  - 实测注：2026-10-11 用户真机验收通过（v1.9.8，页面正常显示 DSH 会话、重复点击切回原窗口不叠窗）。线上 v1.9.8 / ?v=41。
- [x] 5. 验收后归档、同步 Gitee/vm1
