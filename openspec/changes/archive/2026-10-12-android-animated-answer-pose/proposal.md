# Proposal: android-animated-answer-pose

## Why
提交作答后的成功页目前是一只 130dp 的鲸鱼团子（pet_success）弹跳 0.95s——六套主题的全身立绘只在主界面和浏览器出现，"答完题"这个最有情绪价值的时刻反而看不到鲸鱼娘本人。用户要求：这里换成会动的立绘。

## What Changes
- 成功页改用**当前主题的全身立绘**（与主界面/浏览器同一 pose 映射），高度 230dp，底色从写死薄荷绿改为主题 `dshCardBg`（深色主题不再穿帮）。
- 动画三段式（纯运行时 ObjectAnimator，无需动图素材，全 API 兼容）：
  1. 0.45s Overshoot 弹跳入场（保留现有手感）
  2. 入场落定后循环**摇摆**：以脚底为轴 ±2.5° 缓入缓出摆动 + 轻微上下浮动，像原地开心晃
  3. 停留至 1.4s 自动关闭（摇摆至少可见一轮）
- `ThemePrefs` 新增 `poseRes(ctx)`/`poseGravity(ctx)` 统一 pose 映射（消除三处重复的 when 表）。

## Impact
- Affected specs: `companion-app`（MODIFIED：快答成功反馈——立绘 + 运行时动画）
- Affected code: `QuickAnswerActivity.kt`（showSuccessThenFinish）、`ThemePrefs.kt`（pose 助手）
- 不加素材不升 minSdk；loading 页（取问题呼吸团子）与通知 largeIcon 保持原样。
