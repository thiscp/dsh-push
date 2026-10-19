# 六套主题各配一张不同的鲸鱼娘立绘壁纸

## Why

现状六套主题里四套（日间/樱花/抹茶/焦糖）共用同一张 `bg_whale` 壁纸，深夜/星空是无人物的程序化矢量夜空——"换主题"视觉差异只剩卡片配色，壁纸毫无变化。用户要求：**每张背景都不一样，都是不同的鲸鱼娘立绘**。

## What Changes

- 从网上引入 5 张高清（935×1682 透明全身）鲸鱼娘立绘：来源 [JAdpp/dsh-whale-galgame](https://github.com/JAdpp/dsh-whale-galgame) `assets/default/whale-*.webp`，**CC BY-NC-SA 4.0**（署名：上善=原始形象，ZipZipPipe=女仆二创；本 APP 非商用，符合 NC），NOTICE 补署名与许可证副本
- 主题↔立绘按气质配对（日间保留现有全景图，天然不同）：
  | 主题 | 场景层 | 立绘 |
  |---|---|---|
  | 日间·晴海 | 现有 bg_whale 全景 | （图内含） |
  | 深夜·深海夜光 | 现有矢量深海 | whale-serious（右下） |
  | 樱花·樱瓣飘浮 | 新矢量樱瓣 | whale-shy（左下） |
  | 抹茶·抹茶布丁 | 新矢量抹茶 | whale-confused（右下） |
  | 星空·银河入梦 | 现有矢量银河 | whale-starry（左下） |
  | 焦糖·焦糖布丁 | 新矢量焦糖 | whale-cheerful（右下） |
- 壁纸资源改 layer-list：场景矢量 + 立绘 bitmap（bottom|start/end 交替构图，300×540dp），`dshWallpaper` 指向新 layer-list
- 版本 1.22.0（versionCode 51）

## Impact

- 受影响 spec：`companion-app`（应用内主题切换——补"每主题独立立绘壁纸"要求与场景）
- APK 体积 +约 1.5MB（5 张 webp）
- 素材许可新增 CC BY-NC-SA 4.0 条目（assets-src/NOTICE + 许可证副本）
