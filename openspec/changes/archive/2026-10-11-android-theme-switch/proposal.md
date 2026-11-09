# 提案：应用内主题切换（鲸鱼娘多皮肤）

## Why

App 目前是单一固定浅蓝配色，且颜色散落在三处硬编码（`bg_pill.xml` 内联十六进制、`PushService` 两处 `0xFF4A7FB5`、`QuickAnswerActivity` 一处 `0xFF2C3E50`）。深夜收到 DSH 通知后点开 App，浅色页面刺眼；用户明确要求做主题切换——现有配色保留为"日间主题"，其余主题自行规划，基线统一为鲸鱼娘可爱风。

## What Changes

- 颜色体系从 `R.color.*` 直取改为**主题属性（`?attr/`）驱动**：定义 `dshBgPage / dshCardBg / dshCardStroke / dshPillBg / dshPillStroke / dshPillRipple / dshAccent / dshAccentPressed / dshTextPrimary / dshTextSecondary / dshWarn / dshNotif / dshWallpaper / dshScrim` 属性，四个主题各填一套值
- 新增四套主题（均为鲸鱼娘可爱风，延续"无纯黑纯红、文字深浅两级、半透明圆角卡片"约束）：
  - **日间 · 晴海**（现配色原样保留，默认）
  - **深夜 · 深海夜光**（深海藏蓝底 + 月光蓝强调色，配专属矢量夜空背景）
  - **樱花 · 樱瓣飘浮**（暖粉底 + 樱粉强调色，鲸鱼娘壁纸加粉纱）
  - **抹茶 · 抹茶布丁**（浅绿底 + 抹茶绿强调色，鲸鱼娘壁纸加绿纱）
- 主界面新增"换主题"入口：选择后立即全界面换色（recreate），选择持久化，进程重启仍生效
- 通知强调色、通知渠道色、状态栏颜色/图标明暗随主题联动
- 四个主题全部声明 `android:forceDarkAllowed=false`，避免 vivo OriginOS"第三方应用强制深色"把自选主题二次反色
- 鲸鱼娘立绘（idle/sleeping/please/success）与"大肥鱼"文案、胶囊卡片布局**不动**——只换配色与背景处理
- 版本 1.7.0（versionCode 13），vm1 构建，上架 aliyun 下载（?v=22）

## Impact

- 受影响的 capability：`companion-app`（MODIFIED 小清新视觉主题、ADDED 应用内主题切换）
- 受影响的文件：
  - 新增 `res/values/attrs.xml`、`res/values/themes.xml`、`res/drawable/bg_whale_night.xml`、`ThemePrefs.kt`
  - 修改 `res/values/colors.xml`（保留为日间色板）、`res/drawable/bg_card.xml`、`bg_pill.xml`（改 `?attr/` 引用）、`MainActivity.kt`、`QuickAnswerActivity.kt`、`PushService.kt`、`build.gradle.kts`
- 无服务端改动、无新权限、无新依赖（继续不引 AppCompat，纯框架主题）
