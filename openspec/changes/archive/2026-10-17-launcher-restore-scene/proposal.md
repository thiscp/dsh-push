# 桌面图标启动回到上次的现场

## Why

用户 2026-10-17 反馈：「我在 app 里面进入了 dsh 网页，如果这时候我把 app 切到后台，进入手机桌面，然后我在桌面点我们 app 的图标进入 app，
这时候进入的是 app 主页而不是我们之前进入的 dsh 网页，我们需要点图标进入 app 时回到的是上次的现场」。

实测机制（`dumpsys activity activities`，非推测）：

- `MainActivity` 原先是 `launchMode="singleTask"`，而它既是任务根又是 LAUNCHER 目标 ⇒ 桌面图标启动会把任务栈**清到根 Activity**，
  内置网页窗口（`WebActivity`）被销毁，于是只剩主页。
- 去掉 singleTask 后再量：**启动器图标也不是「恢复原栈顶」，而是往栈上叠一个新的 MainActivity**——
  `#0 Main → #1 Web → #2 Main新`。网页其实还在下面，只是被新主页盖住。

## What Changes

- `MainActivity` MUST NOT 声明 `launchMode="singleTask"`，并 SHALL 声明 `alwaysRetainTaskState="true"`。
- `MainActivity` 收到**光秃秃的启动器意图**（`ACTION_MAIN` + `CATEGORY_LAUNCHER` 且零 extra）且自身不是任务根时，
  SHALL 在 `setContentView` 之前 `finish()`，让下层 Activity 成为前台。
- 通知/服务入口语义不变：它们是显式组件意图（action 为空）或带 extra，且自带 `CLEAR_TOP|SINGLE_TOP`。

## Impact

- 能力 `companion-app`：新增 1 条需求（桌面图标启动回到上次的现场），4 个场景。
- 代码：`AndroidManifest.xml`、`MainActivity.kt`（v1.32.35 / versionCode 101）。
- 已知边界：**进程被系统杀掉**后任务由启动器意图重建，仍进主页；要连那种也回网页需持久化最后一次的 web 链接（未做）。
