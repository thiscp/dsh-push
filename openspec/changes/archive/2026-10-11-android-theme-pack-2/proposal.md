# Proposal: android-theme-pack-2

## Why

四套主题已用一周，用户希望扩充皮肤库。补两套差异明显的：深夜系再加一套**星空·银河入梦**（靛紫银河+更密星点+弯月，与深夜·深海夜光的蓝黑拉开色相），日间系补一套**焦糖·焦糖布丁**（奶油暖棕，与晴海的冷蓝、抹茶的绿互补）。

## What Changes

- 新增主题 **星空·银河入梦**（starry）：专属矢量壁纸（深紫渐变+密星+弯月+鲸鱼剪影）、强调色薰衣草紫、通知色同系；星点闪烁层复用现有机制（night 与 starry 都启用）。
- 新增主题 **焦糖·焦糖布丁**（caramel）：复用鲸鱼娘壁纸+暖橙纱、奶油卡片、焦糖棕强调色。
- `ThemePrefs` KEYS/NAMES/样式数组各 +2；`themes.xml` 新增 4 个 style（两套 × 全屏/Dialog）。
- 版本 1.10.0 / versionCode 34。

## Impact

- `res/values/themes.xml`、`ThemePrefs.kt`、新 drawable（`bg_whale_starry.xml`）
- `MainActivity.kt` 星闪条件一行（night → night|starry）由 **Lead 集成时改**，themes 实现者不动 MainActivity
- 能力：companion-app（MODIFIED 应用内主题切换：四套→六套）
