# Proposal: android-browser-theme-wallpaper

## Why
应用内浏览器（WebActivity，打开 DSH Web 的窗口）目前是全不透明的纯色页背景（dshBgPage），换任何主题它都一个样——和主界面六套场景立绘的沉浸感断层。用户要求：浏览器也用对应主题的背景，进入 DSH 后也能看见鲸鱼娘。

## What Changes
- WebActivity 底层铺主题壁纸：场景矢量（dshWallpaper，CENTER_CROP）+ 52% 屏高全身立绘（与主界面同一套规则、同左右朝向），顶部标题栏与网页区全部透明化叠在其上。
- WebView 背景改透明；页面加载完成后注入一段 style 把 DSH Web 的 html/body 背景设为 transparent，让主题壁纸从网页空隙透出；若实测可读性不足，注入同主题色调的半透明纱罩层（固定定位 rgba 遮罩）平衡文字可读性——透明度以模拟器截图实测为准。
- 深色主题（night/starry）保持现有算法暗化策略不变；浅色主题保持亮页。
- 错误页（睡觉鲸鱼 + 重试）保持不透明底，不受影响。

## Impact
- Affected specs: `companion-app`（MODIFIED：小清新视觉主题——浏览器窗口纳入主题壁纸范围）
- Affected code: `WebActivity.kt`（布局根改 FrameLayout + 壁纸/立绘叠放、WebView 透明、onPageFinished 注入 CSS）
- 风险：DSH Web 自身 DOM 背景层级未知，注入选择器按实测调整；网页文字在壁纸上的可读性用截图验收。
