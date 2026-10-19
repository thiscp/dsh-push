# Design: android-theme-pack-2

## 色板（全部走 14 个主题属性，禁硬编码散落）

### 星空 · 银河入梦（starry，深色）
| 属性 | 值 | 说明 |
|---|---|---|
| dshBgPage | #0D0B1E | 深空黑紫 |
| dshCardBg | #1F1A3A（约 B3 透明） | 星云卡片 |
| dshCardStroke | #3A3163 | |
| dshPillBg / dshPillStroke | #262048 / #4A3F7A | |
| dshPillRipple | #33A78BFA | |
| dshAccent / dshAccentPressed | #A78BFA / #8B6FE8 | 薰衣草紫 |
| dshTextPrimary / dshTextSecondary | #EDEAF8 / #A9A3C9 | |
| dshWarn | #F0B0B0 | |
| dshNotif | #7C6CF0 | 徽章底，白字可读 |
| dshScrim | 透明（矢量壁纸自带氛围） | |
| dshWallpaper | @drawable/bg_whale_starry | 新建：#0D0B1E→#241B45 渐变、15+ 星点、弯月、鲸鱼剪影 alpha 0.10 |
| 基座 | Theme.DeviceDefault（深色）；statusBar #0D0B1E；windowLightStatusBar=false | |

### 焦糖 · 焦糖布丁（caramel，浅色）
| 属性 | 值 | 说明 |
|---|---|---|
| dshBgPage | #FFF6EA | 奶油底 |
| dshCardBg | #CCFFFDF6（白透） | 布丁卡片 |
| dshCardStroke | #E8D5BC | |
| dshPillBg / dshPillStroke | #FFF7EC / #D9B98F | |
| dshPillRipple | #33C07A3C | |
| dshAccent / dshAccentPressed | #C07A3C / #A66428 | 焦糖棕 |
| dshTextPrimary / dshTextSecondary | #4A3626 / #8A6F55 | |
| dshWarn | #C05B4A | |
| dshNotif | #C07A3C | |
| dshScrim | #1AC07A3C | 暖橙纱覆鲸鱼娘图 |
| dshWallpaper | @drawable/bg_whale（复用） | |
| 基座 | Theme.DeviceDefault.Light；statusBar #FFF6EA；windowLightStatusBar=true | |

## 接入点
- `themes.xml`：`Theme.Dsh.Starry` / `Theme.Dsh.Starry.Dialog` / `Theme.Dsh.Caramel` / `Theme.Dsh.Caramel.Dialog`，结构照抄现有夜/日（forceDarkAllowed=false、alertDialogTheme 互指）。
- `ThemePrefs`：KEYS += "starry","caramel"；NAMES += "星空 · 银河入梦","焦糖 · 焦糖布丁"；ACT/DLG 数组同步 +2（顺序必须一致）。
- 星闪：MainActivity `starsView` 条件 night → night|starry（Lead 改）。
