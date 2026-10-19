# Proposal: android-web-tab-reuse

## Why

网页直达每次点击都新开窗口。v1.9.7 先试 Chrome 系 `SINGLE_TOP` 标签页复用——真机实测 vivo 自带浏览器无视该 flag，仍然每次新开（无 GMS 机型也没有 Chrome 可借力）。窗口越积越多，且 token 轮换后旧窗口全是死页。

## What Changes

- 新增 **`WebActivity`**：App 内置网页窗口（WebView，JS+DOM 存储，去 Mobile UA 标记按桌面版渲染，主题跟随 dshBgPage/文字色，顶部"DSH 网页 · 关闭"条）。
- **单实例复用**：`launchMode=singleTask` + `onNewIntent` 直接在同一窗口加载新链接——重复点击不叠窗，token 换新时原窗口自动导航到新链接。
- 三处入口（常驻通知按钮、事件通知补位、卡片胶囊）全部改落 WebActivity；manifest 加 `usesCleartextTraffic`（DSH Web 是 http）。
- 版本 1.9.8 / versionCode 32。

## Impact

- 新增 `WebActivity.kt`；`AndroidManifest.xml`（activity + cleartext）；`PushService.kt`（webAction 落点 + APP_VER）；`MainActivity.kt`（openWebUrl 落点）
- 能力：companion-app（MODIFIED 网页直达按钮）
