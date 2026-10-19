# 设计：应用内主题切换

## 调研结论（网上方案对比）

| 方案 | 适用性 | 结论 |
|---|---|---|
| DayNight（`values-night/` + `setDefaultNightMode`/`UiModeManager.setApplicationNightMode`） | 只解决"亮/暗"二值，跟系统开关绑定 | ✗ 我们要的是四套自选皮肤，且不能跟系统开关走 |
| Material3 Dynamic Color（壁纸取色） | Android 12+ 从壁纸自动取色 | ✗ 取色结果不可控，会破坏鲸鱼娘固定人设色 |
| **自定义主题属性 + `setTheme()` + `recreate()`** | 多品牌皮肤的标准做法：属性化颜色 → 每主题一套值 → 持久化选择 → 应用前于内容绘制 | ✓ 采用。官方也明确要求"用主题属性替代硬编码颜色"（[Implement dark theme](https://developer.android.com/develop/ui/views/theming/darktheme)、[dynamic theme switcher](https://reintech.io/blog/create-android-app-dynamic-theme-switcher)） |

关键坑（已查证）：

- **vivo OriginOS"第三方应用强制适配深色"**：系统用算法把未适配深色的应用整体反色（[网易：开关位置说明](https://www.163.com/dy/article/KUT6165G0552S03P.html)）。我们的 Light 主题会被它二次反色。对策：主题里声明 `<item name="android:forceDarkAllowed">false</item>`——[小米深色适配文档](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1595)证实该声明一旦为 false 则"无论如何都不会生效"，AOSP Force Dark 同源机制（API 29+，低版本忽略无害）。
- **主题闪烁**：窗口初始背景取自 manifest 主题，`onCreate` 里才 `setTheme` 会先闪一下默认色。对策：在 `onCreate` 的 `super.onCreate()` **之前** `setTheme`（manifest 保持日间主题为默认）。**实测教训（v1.7.0 闪退）**：网上推荐的 `attachBaseContext` 里 setTheme 在 Android 16 上必炸——`Activity.setTheme` 内部调 `getWindow().setTheme()`，而 window 要到 `attach()` 后半程才创建，`attachBaseContext` 阶段 `getWindow()` 为 null → NPE。
- **recreate 与 singleTask**：v1.6.1 的 singleTask 不影响 `recreate()`，返回栈语义不变。

## 架构

```
attrs.xml ── 14 个自定义属性（颜色 12 + 壁纸 reference + 纱色）
themes.xml ── Theme.Dsh.Day / .Night / .Sakura / .Matcha
              （parent Theme.DeviceDefault.Light.NoActionBar，各填属性
                + forceDarkAllowed=false + windowLightStatusBar + alertDialogTheme）
ThemePrefs.kt ── SharedPreferences key "theme"（day|night|sakura|matcha）
              ── themeRes(ctx) 映射；两个 Activity 在 attachBaseContext 应用
代码层 ── MainActivity.c(id) 从 resources.getColor(R.color.x) 改为
          theme.resolveAttribute(R.attr.dshX) 取值；QuickAnswer 去掉硬编码
XML 层 ── bg_card.xml / bg_pill.xml 内联十六进制改 ?attr/（代码已带 theme 取 drawable）
通知层 ── PushService 用 ContextThemeWrapper(this, ThemePrefs.themeRes(this))
          解析 dshNotif；换主题时服务收 reload 重建渠道色
```

## 四套色板（鲸鱼娘可爱风基线，全部无纯黑纯红）

| 属性 | 日间·晴海（现状） | 深夜·深海夜光 | 樱花·樱瓣飘浮 | 抹茶·抹茶布丁 |
|---|---|---|---|---|
| bg_page | `#F2F8FB` | `#0F1726` | `#FDF2F4` | `#F2F7EC` |
| card_bg | `#CCFFFFFF` | `#CC1D2B44` | `#CCFFFFFF` | `#CCFFFFFF` |
| card_stroke | `#DCE9F0` | `#33455F` | `#F0D5DC` | `#DCE7CF` |
| pill_bg / stroke | `#E6F2FA` / `#C9DCF2` | `#1F3350` / `#3A5070` | `#FBE9EE` / `#F0CBD6` | `#EAF2E0` / `#CFE0BE` |
| pill_ripple | `#334A7FB5` | `#338FB8E8` | `#33C97B94` | `#336F9E6B` |
| accent / pressed | `#4A7FB5` / `#3A6A9C` | `#8FB8E8` / `#6E97C9` | `#C97B94` / `#AE657C` | `#6F9E6B` / `#587F55` |
| text_primary / secondary | `#2C3E50` / `#7A8B99` | `#E8EFF8` / `#9FB0C6` | `#4A3540` / `#9C8790` | `#37432F` / `#8A9682` |
| warn | `#C96A6A` | `#E0918F` | `#C96A6A` | `#C97A5A` |
| notif | `#4A7FB5` | `#8FB8E8` | `#C97B94` | `#6F9E6B` |
| 状态栏 | 同底色，深色图标 | 同底色，浅色图标 | 同底色，深色图标 | 同底色，深色图标 |
| 壁纸 | `bg_whale.webp` 原图 | 专属矢量夜空（渐变+星点+气泡+淡鲸剪影） | 原图 + 粉纱 `#26C97B94` | 原图 + 绿纱 `#266F9E6B` |

- 鲸鱼娘立绘四主题共用（白色形象在深夜底反而更醒目），人设恒定
- 深夜主题不用照片级壁纸而用矢量夜空：避免"浅色插画压暗底"的脏色，且零新增美术资产
- 启动器图标保持浅蓝自适应不变（换桌面图标需 activity-alias 切换，超出本期范围）

## 换主题交互

主界面按钮行加"换主题"胶囊按钮 → 主题化 `AlertDialog` 列出四套主题名（带人设味命名）→ 选中即：写 prefs → `recreate()`（singleTask 下干净重建）→ `startForegroundService(reload)` 让服务刷新通知/渠道色。QuickAnswerActivity 下次进入自然带新主题（其对话框经 `android:alertDialogTheme` 跟随）。

## 风险与对策

| 风险 | 对策 |
|---|---|
| vivo 强制深色二次反色 | 四主题 `forceDarkAllowed=false`；真机开系统深色验收 |
| 切换闪烁 | `onCreate` 的 `super.onCreate()` 前 `setTheme`（Android 16 上 `attachBaseContext` 会 NPE，见上）；manifest 默认日间 |
| 通知渠道色不更新 | 渠道同 id 重新 `createNotificationChannel`（light color 可更新） |
| 深夜主题文字对比不足 | 文字 `#E8EFF8` 压 `#CC1D2B44` 卡片，对比 > 10:1；验收逐屏截图 |
| 对话框不跟主题 | 每主题声明 `android:alertDialogTheme` 为对应 Dialog 主题 |
