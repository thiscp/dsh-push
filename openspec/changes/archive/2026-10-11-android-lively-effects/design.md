# 设计：人设动效反馈

## 原则

盯梢工具，屏幕前停留只有几秒：反馈类动效一次 ≤1s、循环氛围类必须可暂停（onPause 停、onResume 续）、全部框架 API 零依赖。vivo 系统动画缩放被用户设置影响，代码不假设时长。

## 各项实现

| 动效 | 实现 | 生命周期 |
|---|---|---|
| 快答 loading | 不可取消的迷你 AlertDialog（pet_idle 56dp + 文案），scaleX/Y 呼吸循环；问题到达 dismiss 换正式对话框 | 对话框自带 |
| 提交成功 | 全屏 Dialog：薄荷底 `#DDFFFC` + pet_success `OvershootInterpolator` scale 0→1 弹入，postDelayed 900ms dismiss + finish | 自动 |
| 顶栏呼吸 | `ObjectAnimator.ofFloat(pet, "scaleX", 1f, 1.05f)` + scaleY 同步，duration 1250，`ReverseInterpolator` + `INFINITE` | onPause cancel / onResume 重启 |
| 新消息入场 | refresh() 记录上次最大 ts；ts 更大的卡片 `alpha 0→1 + translationY dp(24)→0` 250ms Decelerate，按序 stagger 60ms | 一次性 |
| 换主题淡入 | onCreate 末尾 `root.alpha 0→1` 300ms；仅 recreate 后（savedInstanceState==null 且距上次 recreate <2s 不好判——直接每次进入都淡入，无害） | 一次性 |
| 深夜星闪 | 新增 `bg_stars.xml`（仅星点矢量），仅当 `dshWallpaper` 解析为夜空时叠一层 ImageView，alpha 0.35↔1.0，1600ms Reverse INFINITE | onPause cancel / onResume 重启 |

## 风险

- 动画泄漏：所有循环动画持有引用，onPause 必 cancel（Activity 销毁自动 GC 兜底）
- 提交成功动画期间用户按返回：Dialog setCancelable(false)，900ms 后统一 finish
- 低端机掉帧：仅属性动画（硬件层），无布局重排
