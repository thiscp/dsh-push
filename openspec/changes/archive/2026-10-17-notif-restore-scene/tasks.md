# 任务

- [x] 1. 定位两处 contentIntent：常驻服务通知（`PushService.kt:251`）与消息事件通知（`:496`）
- [x] 2. 新增 `restoreSceneIntent()`（ACTION_MAIN + CATEGORY_LAUNCHER + NEW_TASK，零 extra）与独立请求码 `RC_RESTORE_SCENE`
- [x] 3. 常驻通知 contentIntent 换成它；消息通知一行不动（代码级核对：255 行走新逻辑、518 行仍是 activityIntent）
- [x] 4. **真点通知验收**（不是模拟 am start）：展开抽屉 → `uiautomator dump` → 按码点关键词「监听中」找正文节点 →
      `input tap` 正文中心 → `topResumedActivity = WebActivity` **PASS**；动画缩放先设 0、跑完复原 1
- [x] 5. 发版 v1.32.36 / versionCode 102：核心断言 8/8（`geom-matrix` 本轮 240s 超时，属环境抖动）
