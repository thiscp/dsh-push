# 点常驻「监听中」通知也回到上次的现场

## Why

用户 2026-10-17：「下一版可以把点击通知栏的监听中的图标也进入主页改为也进入之前的现场」，并确认「被杀掉的话进主页可以接受」。

实测：常驻服务通知的 contentIntent 原先是 `activityIntent(MainActivity::class.java, null)`，它自带
`FLAG_ACTIVITY_CLEAR_TOP|FLAG_ACTIVITY_SINGLE_TOP` ⇒ 一点就把栈清到根、内置网页窗口被清掉，只剩主页。

## What Changes

- 常驻服务通知（「监听中…」）的内容意图 SHALL 改为**与桌面图标同一条路**：`ACTION_MAIN` + `CATEGORY_LAUNCHER` +
  `NEW_TASK`、零 extra ⇒ 复用 v1.32.35 的「光启动器意图 + `!isTaskRoot` ⇒ `finish()`」守卫，下层网页露出来。
- 消息事件通知 MUST NOT 走这条路（点消息要看到消息），继续用带 `CLEAR_TOP|SINGLE_TOP` 的显式组件意图。
- 两条通知的 PendingIntent 请求码 SHALL 错开（新增 `RC_RESTORE_SCENE = 0x51E57`），否则 `FLAG_UPDATE_CURRENT`
  会互相覆盖 extras。

## Impact

- 能力 `companion-app`：修改 1 条需求（桌面图标启动回到上次的现场），场景 4 → 5；顺手把正文压到 500 字内（消掉上一轮的 WARNING）。
- 代码：`PushService.kt`（v1.32.36 / versionCode 102）。
- 已知边界不变：进程被系统杀掉后仍进主页（用户已确认可接受）。
