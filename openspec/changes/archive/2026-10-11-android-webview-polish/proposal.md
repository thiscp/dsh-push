# Proposal: android-webview-polish

## Why

调研 P1（docs/research-2026-10-11.md §6）：内置 WebActivity 裸 WebView——DSH Web 是 http 明页，深夜主题下白屏刺眼；工作机休眠/断链时打开是系统裸错误页，没有重试；网络恢复也不会自动重连。全部可用框架 API 解决，不引 androidx.webkit。

## What Changes

- **深色适配（三档）**：API 33+ `setAlgorithmicDarkeningAllowed(true)`；29–32 反射/直调 `setForceDark(FORCE_DARK_ON)`（废弃但可用）；26–28 跳过。仅当所选主题为深色（night/starry）时开启——浅色主题保持亮页。
- **错误页**：`onReceivedError`（仅 main frame）→ 内置人设错误页（睡觉鲸鱼 + "连不上 <host>" + "重试"胶囊），点击 reload；`onReceivedHttpError` main frame 5xx 同样处理。
- **断网自动 reload**：`ConnectivityManager.NetworkCallback` 注册默认网络；错误页显示期间网络恢复 → 自动重试；onDestroy 反注册。需 manifest 加 `ACCESS_NETWORK_STATE`（Lead 加）。
- 版本 1.12.0 / versionCode 36。

## Impact

- `WebActivity.kt`（唯一 App 改动文件）；`AndroidManifest.xml` 一行权限（Lead）
- 能力：companion-app（MODIFIED 网页直达按钮：内置窗口深色适配与离线兜底）
