# 内置浏览器适配 DSH 0.2.2 侧栏改版（v1.34.12 待发布）

## Why

用户真机反馈：DSH 升到 0.2.2 后，「工作区」这一栏在收起侧边栏后仍浮在正文上；左侧插件栏出现重复图标。
CDP 取证（裸 Edge 基线 vs App WebView 现场，360x698 dpr4）定位到两个独立根因：

- **浮空「工作区」是我们自己注入的 CSS 造成的**。0.2.2 把侧栏收起改成「列 translateX(-280) + visibility:hidden」，
  而 bw-narrow-fix 里那条 transform:none!important（e67e56b / v1.32.4 为绕开 backdrop-filter 裁剪加的）把位移杀掉，
  列停在 x=0；列内 GAkraW_sectionLabel GAkraW_wide、GAkraW_iconButton 的 computed visibility 又被 DSH 自己的
  *_wide 规则穿透成 visible ⇒ 标题加三个图标浮在正文上。裸 Edge 不注入时列在 -280 屏外，所以只有 App 里看得见；
  同一条规则里真正修 backdrop-filter 的是 backdrop-filter:none / filter:none，transform:none 对该 bug 冗余、对 0.2.2 有害。
- **重复图标是 DSH 0.2.2 挪 DOM 造成的**。行内 svg 从 button 直接子挪进 span.wtg9ga_panelGlyph > div[data-slot] 后，
  DSH 核心「[data-dsh-market-nav-icon] > svg{display:none}」与插件 @michengai/dsh-agency-agents 1.2.26
  「[data-aag-nav-icon] > svg{display:none!important}」两条直接子选择器同时失配，而 ::before 自绘图标照常画 ⇒
  「插件市场」（DSH 核心画的）与「专家」（插件画的）各多出一个图标。桌面 1280 宽不打标，故只有手机抽屉里出现。
- 顺带发现两处注入 JS 在 0.2.2 已空转：鲸鱼钮 bwFabOpen() 只量面板盒宽（0.2.2 收起态盒宽仍是 280）⇒ 恒判展开；
  观察器锚点 _2H3hWW_root 随 CSS-module 命名空间换掉 ⇒ 观察器从不挂载。

## What Changes

- 删掉 transform:none!important，保留 backdrop-filter:none / filter:none（v1.32.4 那个 bug 仍被修住）。
- 追加后代选择器「[data-dsh-market-nav-icon] svg, [data-aag-nav-icon] svg{display:none!important}」，
  新旧两种 DOM 结构都能命中，把原生 svg 关掉只留自绘图标。
- bwFabOpen() 改几何判据：r.width>0 && r.right>1（收起态面板在屏外，right<=1）。
- 观察器目标加兜底：找不到 _2H3hWW_root 时退到 "[class*='_sidebarCol'] [class*='_root']"。
- 版本号三处同步留到发布时做（versionCode 172 / versionName 1.34.12 / APP_VER 1.34.12）。

## Impact

- 影响面：仅 android-app/app/src/main/java/xyz/cpyh/dshpush/WebActivity.kt 的注入段（4 处），
  注入样式实测 2307 B → 2360 B。
- 不影响：推送语法、问题卡、配对与通行证、宿主插件。
- 验收（emulator-5554 装本包 + 本机 DSH 0.2.2，CDP 实测）：收起态侧栏列 x=-280、
  tf=matrix(1,0,0,1,-280,0)、vis=hidden、屏内浮空元素 9 → 0，鲸鱼钮 left 由 +6px 变 -22px（正确半隐）；
  展开态列 x=0、面板正常、5 条导航行各 1 个图标。双图标修复在裸 Edge 360 宽实测（原生 svg 变 0w0HIDDEN、
  只剩自绘图标）；模拟器那个 DSH 会话只有 5 条导航行、没有「插件市场/专家」，故 App 侧未复现该项。
