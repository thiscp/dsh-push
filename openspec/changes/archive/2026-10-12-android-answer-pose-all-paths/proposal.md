# Proposal: android-answer-pose-all-paths

## Why
v1.26.0 的摇摆立绘只挂在快答浮窗（QuickAnswerActivity）。但作答有三条路径：快答浮窗、主页消息卡片的自动生成选项 chips、通知栏直答按钮——后两条走 `AnswerReceiver` 后台提交，成功只有 toast，看不到鲸鱼娘。用户要求三条路径统一体验。

## What Changes
- 新增 `SuccessPoseActivity`：全屏透明悬浮窗（Translucent 主题、无 dim、不进最近任务），立绘弹跳入场 + 摇摆浮动，1.4s 自动关闭——与快答浮窗内嵌动画同款。
- `AnswerReceiver` 提交成功分支拉起 `SuccessPoseActivity`（`try/catch`：通知栏后台拉起可能被 OriginOS 弹窗管控拦截，toast 兜底零回归）。
- 快答浮窗保持内嵌动画不动（零回归）。

## Impact
- Affected specs: `companion-app`（MODIFIED：作答成功立绘动画扩展到全部三条提交路径）
- Affected code: `SuccessPoseActivity.kt`（新增）、`AnswerReceiver.kt`（成功分支 +startActivity）、`AndroidManifest.xml`（注册）
