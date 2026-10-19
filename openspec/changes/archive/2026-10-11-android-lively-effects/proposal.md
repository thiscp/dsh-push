# 提案：人设动效反馈（v1.8.0「大肥鱼活了」）

## Why

App 全静态：快答拉取问题期间白屏干等、提交成功只有一行 toast、立绘纹丝不动。软件定位是"深夜盯梢工具"，动效原则是**先服务核心动作（快答反馈），再服务人设情感（活着的感觉），绝不炫技**：全部零依赖（ObjectAnimator/帧切换/矢量 alpha），单次反馈类动效 ≤1 秒，不阻塞操作。

## What Changes

- **快答 loading**：进入快答到问题到达之间，显示呼吸鲸鱼娘等待动画 + "大肥鱼正在取问题…"，不再白屏
- **提交成功动画**：pet_success 立绘 overshoot 弹跳入场 + 薄荷色底，约 0.9 秒自动关闭，替代纯 toast
- **顶栏呼吸**：pet_idle 头像缓慢缩放脉动（1.0↔1.05，2.5s 循环），离开界面即停
- **新消息入场**：主页打开期间新到的消息卡片淡入+上滑（250ms），旧卡片不跳
- **换主题转场**：recreate 后新主题界面 300ms 淡入，不硬切
- **深夜星闪**：星点独立图层缓慢明暗闪烁（仅深夜主题、仅界面可见时）

## Impact

- 受影响的 capability：`companion-app`（ADDED 人设动效反馈）
- 受影响的文件：`MainActivity.kt`、`QuickAnswerActivity.kt`、新增 `res/drawable/bg_stars.xml`
- 无新依赖、无服务端改动；版本 1.8.0 / versionCode 22
