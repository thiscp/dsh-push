# Proposal: android-answer-live-pose

## Why
作答成功页的"动"是运行时把**静态**立绘整体旋转±2.5°+平移晃动（v1.26 方案，当时明确"不动图素材"）——立绘本体始终是死的，用户指出这不是真动画，希望像 GIF 那样人物自己动（发丝、裙摆、尾巴飘起来）。

## What Changes
- **素材离线合成**：新增 `tools/gen_pose_anim.py`（Python+Pillow+numpy，入库可复现），从 6 张静态立绘生成"活立绘"动画 WebP——横向波动（越靠下摆幅越大、相位自上而下滞后，头部几乎不动）+ 胸口呼吸起伏，10 帧 110ms 无缝循环，缩到 760px 高、约 0.5MB/张，落 `res/raw/pose_anim_*.webp`。
- **播放**：API 28+ 用系统 `ImageDecoder.decodeDrawable` → `AnimatedImageDrawable`（Android 9 起官方内置 GIF/动画 WebP 支持，零第三方依赖）循环播放；弹跳入场保留，停留从 1.4s 延长到约 2.6s 让动画至少完整可见一轮多。
- **回退**：API<28 或解码失败 → 维持 v1.26 运行时摇摆（静图+属性动画）与 1.4s 停留，行为零回归。
- 三条提交路径（快答浮窗、主页选项、通知直答）统一换装。

## Impact
- Affected specs: `companion-app`（MODIFIED：快答成功页主题立绘动画——动画 WebP 素材 + API 分档回退）
- Affected code: 新增 `tools/gen_pose_anim.py`、`res/raw/pose_anim_*.webp` ×6；`ThemePrefs.kt`（`poseAnimRes`）；`QuickAnswerActivity.kt`、`SuccessPoseActivity.kt`；版本 1.31.0 / versionCode 65
