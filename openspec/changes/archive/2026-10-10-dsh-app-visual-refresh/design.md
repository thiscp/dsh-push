# Design

## 1. 配色（小清新 · DSH 蓝）

| 用途 | 色值 | 说明 |
|---|---|---|
| 页面底色 | `#F2F8FB` | 近白带蓝，壁纸之下 |
| 卡片底 | `#FFFFFF` | 圆角 16dp，描边 `#DCE9F0`，浅阴影 |
| 主色（按钮/强调/通知着色） | `#4A7FB5` | DSH 蓝，饱和度克制 |
| 主色按下态 | `#3A6A9C` | |
| 辅助浅蓝 | `#AECED0` | 鸭蛋蓝，状态点/分隔 |
| 辅助婴儿蓝 | `#E2EEFF` | 快答选项底、启动图标背景 |
| 辅助薄荷 | `#DDFFFC` | 成功反馈底 |
| 主文字 | `#2C3E50` | |
| 次文字/时间戳 | `#7A8B99` | |
| 警示（断线/失效） | `#C96A6A` | 柔和红，不用纯红 |

App 强制浅色主题（`Theme.Material.Light.NoActionBar`），不做深色模式（壁纸与插画都是浅底，收益低）。

## 2. 素材清单与落点

来源：`yunxiiQwQ/dsh-maid-whale-UI`（BSD 3-Clause © yunxi），已存 `android-app/assets-src/`（含 LICENSE/NOTICE）。构建时拷入 `res/`：

| 源文件 | 落点 | 用途 |
|---|---|---|
| `bg-cloud-whale-maid.webp` (1280×720) | `drawable-nodpi/bg_whale.webp` | 主界面背景，`ImageView` CENTER_CROP 顶对齐，上 60% 可见，下接底色 |
| `pet-16-sleeping.png` | `drawable-nodpi/pet_sleeping.png` | 空状态插画（列表为空时居中显示） |
| `pet-18-please.png` | `drawable-nodpi/pet_please.png` | 快答界面头图；"等你选择"通知大图标 |
| `pet-08-success.png` | `drawable-nodpi/pet_success.png` | "任务结束"通知大图标 |
| `pet-01-idle.png` | `drawable-nodpi/pet_idle.png` | 主界面顶栏小头像（连接状态旁） |
| `pet-02-happy.png` | 经 pillow 缩放 | 启动图标前景（自适应 432×432 透明画布居中 + 各密度 legacy mipmap） |

WebP 直接放 `res/drawable`（minSdk 26 原生支持），不转码。Q 版立绘 238×260 放大到 432 做自适应图标前景（LANCZOS，可接受的轻微软化）。

**通知小图标**：手绘鲸鱼剪影 `drawable/ic_stat_whale.xml`（VectorDrawable，24dp，纯 alpha 掩码，符合 Android 单色剪影规则）。

## 3. 通知提示音（合成，无外部素材）

测试VM1 上用 `python3` 标准库（`wave`+`math`+`struct`，不依赖 numpy）合成 16bit 44.1kHz 单声道 wav：

- `res/raw/notify_done.wav`（≈0.9s）：C6-E6-G6 上行琶音，正弦+0.3 二次泛音，每音 0.18s 首尾 30ms 淡入淡出，尾音 G6 延长 0.35s 指数衰减——轻快"叮叮咚"
- `res/raw/notify_question.wav`（≈1.1s）：E6-G6-C7 三连上行 ×2 遍（间隔 0.12s），三角波偏柔（正弦+0.5 三次泛音），稍急促但不刺耳——"叮叮咚·叮叮咚"

峰值归一到 -3dBFS，防削波。

## 4. 渠道迁移（关键坑）

Android 通知渠道**创建后声音/颜色不可改**。v1.5 新建渠道：

- `dsh2`（IMPORTANCE_DEFAULT，声音 `notify_done`，着色 `#4A7FB5`）
- `dsh_urgent2`（IMPORTANCE_HIGH，声音 `notify_question`，着色 `#4A7FB5`）

旧渠道 `dsh`/`dsh_urgent` 在代码里删除（`deleteNotificationChannel`），避免设置页出现四个渠道让用户困惑。用户此前对旧渠道的权限设置（横幅/声音开关）会重置一次——升级说明里写明。前台服务常驻通知挂**独立低优先级渠道 `dsh_svc`**（`IMPORTANCE_LOW` + `setSound(null)`，天然静音不弹横幅；`android.app.Notification.Builder` 没有公开的 `setSilent`/`EXTRA_SILENT`，实测编译不过）。

## 5. 文案梗（鲸鱼娘 ↔ 鱼片）

| 位置 | 文案 |
|---|---|
| 空状态 | 鱼片，暂时没有消息 |
| 主界面顶栏副题 | 鲸鱼娘替你盯着 DSH |
| 快答界面标题 | 帮鱼片拿个主意？ |
| 已提交 Toast | 已交给 DSH，鱼片继续等下一条 🐋 |
| 底部署名 | 立绘 © yunxi（BSD-3）· 形象源自 DeepSeek 鲸鱼娘二创 |

## 6. 版本与分发

`versionCode 6 / versionName "1.5"`；`APP_VER="1.5"` 继续显示在状态行（识别旧包缓存）。APK 推 `/var/www/certbot/dl/`，分享链接带 `?v=15` 防缓存。

## 7. 风险

- vivo 对渠道声音的自定义：若系统仍播默认音，验收时让用户在 设置→通知渠道 里确认 `dsh2` 声音已选中（代码已 setSound，属系统行为兜底说明）
- 壁纸在全面屏上的裁切：CENTER_CROP 顶对齐，关键元素（鲸鱼娘脸）在画面上半部，任何裁切安全
- 立绘放大做图标的软化：启动图标尺寸小，肉眼可接受；不满意可换 `pet-02-happy` 或后续换高清源
