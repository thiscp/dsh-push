# 内置浏览器提问卡窄屏防塌陷（App 侧 CSS 补丁）

## Why

用户真机（OriginOS 手机，1380×3036）在 APP 内置浏览器（WebActivity）里打开 DSH Web 的**待答提问卡**时，卡内问题文字被排成"一列一字"的竖排，卡片几乎不可读。

App 自 v1.9.8 起把 WebView 的 UA 里 `" Mobile"` 去掉，强制 DSH Web 走桌面版渲染；手机物理屏幕只有 412 CSS px 视口，于是：

- DSH Web 提问卡头部 `.mAtvLq_header` 是单行 flex（`justify-content:space-between`），右侧 `.mAtvLq_headerActions`（等待倒计时"11 秒后继续工作" + "慢慢回答" + 最小化/关闭两个图标按钮）是 `flex-shrink:0`，且倒计时和按钮都 `white-space:nowrap`；
- 左侧 `.mAtvLq_headingBlock`（问题文字）是唯一可收缩的项（`min-width:0`）。

一行放不下时，**文字块被压成 `width:0`**，汉字只能一列一字排下去（实测 App WebView 里标题宽 0.0px、高 210px）；侧栏展开时中心列只剩 132px，整张卡都被压成 61px。

这不是 UA 或注入玻璃化 JS 引起的：模拟器自带 Chrome 用**手机 UA**打开同一页面同样复现（同一 URL、同一 500px 视口下卡片 149px、文字块 0px），所以根因在 DSH Web 的窄宽度 CSS + App 强制桌面版这一组合，修在 App 侧最小侵入。

## What Changes

v1.32.2 先做了头部/文字块两条修补；v1.32.3 把侧栏从"钉成 56px 轨道"改成"窄屏浮层"，并把全部规则收进窄屏媒体查询（桌面宽度零改动）。

- `WebActivity.onPageFinished` 注入一段**幂等**的窄屏补丁（id `bw-narrow-fix`，注入前先查重；监听器另有 `window.__bwPanelClose` 标记，`onPageFinished` 多次触发不会重复挂），全部规则装在 `@media (max-width:1023px)` 内：
  - `[class*='mAtvLq_header']{flex-wrap:wrap!important}` —— 一行放不下时右侧按钮组落到下一行，文字块保住整行；
  - `[class*='mAtvLq_headingBlock']{flex:1 1 100%!important;min-width:0}` —— 文字块占满整行；
  - `[class*='BynINW_frame']{grid-template-columns:56px minmax(0,1fr) minmax(0,0px)!important}` —— 窄屏中心列恒为「视口 − 56px 图标轨道」，侧栏不再挤压内容；
  - `[class*='_2H3hWW_root']:not([class*='_2H3hWW_collapsed']){position:fixed;left:0;top:0;bottom:0;width:280px;max-width:280px;z-index:60;overflow-y:auto;overflow-x:hidden;box-shadow:0 8px 32px rgba(0,0,0,.28)!important}` —— 展开的会话侧栏以**浮层**盖在内容上（自身可滚动），关闭（collapsed 类）时回到 DSH 自己的 56px 图标轨道；
  - 一段 `pointerdown` 监听：窄屏且侧栏展开时，点内容区（`clientX > 280`）自动点"收起侧边栏"按钮关闭浮层。
  - 选择器用属性包含匹配 + CSS-module 哈希类名双写，不硬编码完整哈希（DSH 升级换哈希后属性匹配仍生效）；同源扩展的样式表是运行时创建的，故用 `!important` 保证覆盖。
- 三条 `MutationObserver` 补玻璃化的既有逻辑、UA 策略、其他行为全部不变。
- 版本号三处同步：`build.gradle.kts` 的 `versionCode 69 / versionName 1.32.3` 与 `PushService.APP_VER 1.32.3`。

## Impact

- 影响面：仅 WebActivity 内的 DSH Web 页面样式与一个事件监听（不改 DOM 结构、不改 DSH 自己的 JS），对未出现提问卡的页面零影响（选择器匹配不到元素）。
- 不影响：relay 作答页、通知、消息列表、上传下载、玻璃化、主题壁纸。
- 回归面：≥1024px 时全部规则都不生效（含头部不换行、侧栏宽度与展开态、网格列宽），桌面/平板/横屏视觉与 v1.32.1 一致。
- 已知取舍：≤1023px 时侧栏不再是"永远打不开"，而是浮层；浮层挡住部分内容属预期，点内容区或点收起按钮即可关闭。
