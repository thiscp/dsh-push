# 任务清单

- [x] 1. `QuickAnswerActivity`：呼�?loading 对话框（pet_idle + "大肥鱼正在取问题�?），到达即换正式对话框，失败路径同样 dismiss
- [x] 2. `QuickAnswerActivity`：提交成功动画对话框（薄荷底 + pet_success overshoot 弹入�?00ms 自动�?+ finish），失败仍走 toast
- [x] 3. `MainActivity`：顶�?pet_idle 呼吸循环（scaleX/Y 1.0�?.05），onPause cancel / onResume 重启
- [x] 4. `MainActivity.refresh()`：按上次最�?ts 判定新卡片，淡入+上滑入场�?50ms，stagger 60ms），旧卡片不�?- [x] 5. `MainActivity`：进入界�?root alpha 0�? 300ms（换主题转场�?- [x] 6. `bg_stars.xml` 星点矢量 + 深夜主题叠加�?alpha 闪烁循环，onPause �?- [x] 7. 版本 1.8.0 / versionCode 22；vm1 构建；上�?aliyun ?v=31
- [x] 8. 验收：真机逐项流畅不阻塞；离开界面后循环动画停止（无发�?耗电异常�?- [x] 9. 验收：快答成功动画期间返回键不误关流�?