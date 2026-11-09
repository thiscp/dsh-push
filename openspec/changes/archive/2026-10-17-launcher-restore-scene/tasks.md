# 任务

- [x] 1. 读 manifest 与启动点：确认 `MainActivity` 是 singleTask + 任务根 + LAUNCHER；通知/服务路径已显式带 `CLEAR_TOP|SINGLE_TOP`
- [x] 2. 第一版只改 manifest（去 singleTask + 加 `alwaysRetainTaskState`）⇒ 模拟器五步验收 **STEP4 仍 FAIL**，`dumpsys` 量到「新实例叠在栈上」
- [x] 3. 补 `MainActivity.onCreate` 守卫：光启动器意图 + `!isTaskRoot` ⇒ 在 `setContentView` 之前 `finish()`；助手 `isBareLauncherIntent()`
- [x] 4. 五步验收（`C:\Temp\scene-test.ps1`）：STEP4 `topResumedActivity = WebActivity` **PASS**；STEP5 通知式意图 `MainActivity` **PASS**（无回归）
- [x] 5. 发版 v1.32.35 / versionCode 101：`SUMMARY: 10/10`（含四态几何矩阵），APK 上线 `?v=101`，更新通知 payload 核对为干净 UTF-8
- [x] 6. 用户真机安装验收通过（2026-10-17）
