# 任务清单

- [x] 1. `attrs.xml`：14 个主题属性（12 色 + 壁纸 reference + 纱色）
- [x] 2. `themes.xml`：四主题（parent DeviceDefault.Light，各填属性 + `forceDarkAllowed=false` + `windowLightStatusBar` + `alertDialogTheme`）；`colors.xml` 保留为日间色板
- [x] 3. `ThemePrefs.kt`：prefs key `theme` 持久化 + `themeRes()` 映射；MainActivity / QuickAnswerActivity 应用主题
- [x] 4. `MainActivity.kt`：`c()` 改主题属性解析；壁纸经 `dshWallpaper` + 纱层；状态栏色/图标明暗随主题；新增"换主题"按钮与选择对话框（选中 → 持久化 → recreate → 服务 reload）
- [x] 5. `QuickAnswerActivity.kt`：去掉 `0xFF2C3E50` 硬编码，文字/对话框走主题属性
- [x] 6. `bg_card.xml` / `bg_pill.xml`：内联十六进制改 `?attr/` 引用
- [x] 7. `PushService.kt`：通知 `setColor` 与渠道色经 `ContextThemeWrapper` 解析 `dshNotif`；reload 时重建渠道色
- [x] 8. `bg_whale_night.xml`：深夜专属矢量夜空（渐变 + 星点 + 气泡 + 淡鲸剪影）
- [x] 9. 版本 1.7.0 / versionCode 13；vm1 构建；scp 回 Windows；上架 aliyun
- [x] 10. 验收：四主题逐屏截图，无纯黑纯红、文字两级可读（用户深夜/樱花真机截图确认）
- [x] 11. 验收：切换即时生效、杀进程重启仍保持所选主题、切换不闪默认主题
- [x] 12. 验收：系统深色 + 强制适配开启时日间主题不被反色（iQOO 13 真机）
- [x] 13. 验收：换主题后新通知跟随；快答对话框跟随主题
- [x] 14. 修复列车 v1.7.1–1.7.8：独立进程摔跤报告页（崩溃堆栈一键复制）；setTheme 时机修正（Android 16 上 `Activity.setTheme` 依赖 window，`attachBaseContext` 必 NPE）；摔跤报告 seen-once；通知染色排查（诊断行实证解析正确，OriginOS 无视 colorized → 改 largeIcon 主题色徽章方案）；常驻通知徽章；诊断行下线。终版 1.7.8 / versionCode 21 / ?v=30，用户确认"效果完美"
