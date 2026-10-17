## ADDED Requirements

### Requirement: 桌面图标启动回到上次的现场

App 的主界面 Activity（`MainActivity`）SHALL NOT 声明 `launchMode="singleTask"`——它既是任务根又是 LAUNCHER 目标，
singleTask 会让桌面图标启动把任务栈**清到根 Activity**，销毁用户正在使用的内置网页窗口。它 SHALL 同时声明
`alwaysRetainTaskState="true"`，避免系统闲置约 30 分钟后重置任务栈而丢现场。当 `MainActivity` 收到的启动意图是
**光秃秃的启动器意图**（`ACTION_MAIN` + `CATEGORY_LAUNCHER` 且不含任何 extra）且自身**不是任务根**时，SHALL 在
`setContentView` 之前直接 `finish()`，让栈下层的 Activity（通常是 DSH 内置网页窗口）成为前台，即回到上次的现场
（实测：standard 下桌面图标启动会把一个新的 `MainActivity` 叠在栈上，网页其实还在下面）。通知与服务入口
MUST NOT 被该判定误伤：它们是显式组件意图（action 为空）或带 extra，且自带 `FLAG_ACTIVITY_CLEAR_TOP|
FLAG_ACTIVITY_SINGLE_TOP`，仍复用根实例并清掉其上的 Activity。

#### Scenario: 网页在用时点图标回到网页

- **WHEN** 用户已从消息卡片进入内置网页窗口，按 Home 退到桌面，再点桌面图标启动 App
- **THEN** 前台仍是那个网页窗口（`topResumedActivity` 为 `WebActivity`），网页未被销毁、无需重新加载

#### Scenario: 通知入口语义不变

- **WHEN** 用户点消息通知（显式组件意图 + `CLEAR_TOP|SINGLE_TOP`）进入 App
- **THEN** 复用根 `MainActivity` 并清掉其上的 Activity，返回一次即回桌面（与 v1.32.34 一致）

#### Scenario: 冷启动正常

- **WHEN** 任务不存在（首次启动或进程已被系统杀掉）时点桌面图标
- **THEN** `MainActivity` 作为任务根正常创建并显示主页，不发生 `finish()`

#### Scenario: 主页在最上层时点图标

- **WHEN** 用户本就停在主页，退到桌面后再点图标
- **THEN** 新叠的 `MainActivity` 自行结束，露出原主页实例，界面内容不变
