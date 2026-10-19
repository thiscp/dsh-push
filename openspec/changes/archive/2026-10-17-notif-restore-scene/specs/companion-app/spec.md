## MODIFIED Requirements

### Requirement: 桌面图标启动回到上次的现场

App 的主界面 Activity（`MainActivity`）SHALL NOT 声明 `launchMode="singleTask"`（它既是任务根又是 LAUNCHER 目标，
singleTask 会把任务栈清到根、销毁在用的内置网页窗口），并 SHALL 声明 `alwaysRetainTaskState="true"`。当
`MainActivity` 收到**光秃秃的启动器意图**（`ACTION_MAIN` + `CATEGORY_LAUNCHER` 且不含任何 extra）且自身
**不是任务根**时，SHALL 在 `setContentView` 之前直接 `finish()`，让栈下层 Activity（通常是内置网页窗口）成为
前台，即回到上次的现场。常驻服务通知（「监听中…」）的内容意图 SHALL 就是这条启动器意图，点它与点桌面图标
等效（v1.32.36）。消息事件通知 MUST NOT 走这条路，SHALL 继续用带 `CLEAR_TOP|SINGLE_TOP` 的显式组件意图
（点消息进主页看消息）；两者 PendingIntent 请求码 SHALL 错开。

#### Scenario: 网页在用时点图标回到网页

- **WHEN** 用户已从消息卡片进入内置网页窗口，按 Home 退到桌面，再点桌面图标启动 App
- **THEN** 前台仍是那个网页窗口（`topResumedActivity` 为 `WebActivity`），网页未被销毁、无需重新加载

#### Scenario: 点常驻监听中通知回到网页

- **WHEN** 用户停在内置网页窗口，拉下通知栏点常驻「监听中…」通知的正文
- **THEN** 前台仍是该网页窗口（实测 `topResumedActivity` 为 `WebActivity`），与点桌面图标等效

#### Scenario: 通知入口语义不变

- **WHEN** 用户点消息通知（显式组件意图 + `CLEAR_TOP|SINGLE_TOP`）进入 App
- **THEN** 复用根 `MainActivity` 并清掉其上的 Activity，返回一次即回桌面（与 v1.32.34 一致）

#### Scenario: 冷启动正常

- **WHEN** 任务不存在（首次启动或进程已被系统杀掉）时点桌面图标
- **THEN** `MainActivity` 作为任务根正常创建并显示主页，不发生 `finish()`

#### Scenario: 主页在最上层时点图标

- **WHEN** 用户本就停在主页，退到桌面后再点图标
- **THEN** 新叠的 `MainActivity` 自行结束，露出原主页实例，界面内容不变
