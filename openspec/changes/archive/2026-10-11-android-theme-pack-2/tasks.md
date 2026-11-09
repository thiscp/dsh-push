# Tasks: android-theme-pack-2

- [x] 1. 新建 `res/drawable/bg_whale_starry.xml`（矢量 360x780：aapt 渐变 #0D0B1E→#241B45、15+ 星点、弯月、鲸鱼剪影 alpha 0.10，结构照 bg_whale_night.xml）
- [x] 2. `themes.xml` 加 4 个 style（Starry/Starry.Dialog/Caramel/Caramel.Dialog，色板见 design.md）
- [x] 3. `ThemePrefs.kt` KEYS/NAMES/ACT/DLG 各 +2（顺序一致）
- [x] 4. Lead 集成：MainActivity 星闪条件扩 starry；版本 1.10.0 / versionCode 34；构建部署 aliyun `?v=42`
- [x] 5. 用户醒来真机验收（两套新主题全界面走查）后归档
