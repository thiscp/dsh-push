# 浮层/菜单背景可读性（v1.32.11）

## Why

用户真机反馈（附截图）：「**选择传文件的控件背景透明度是否太低了点**」——
输入框上方 `/` 弹出的 **slash 指令菜单浮层**（添加文件 / 目标 goal / 计划 plan / 反馈 feedback /
指令 / 写入 / 压缩 compact / 权限 / 模型 / 下载日志）背景太透，**立绘与底层聊天文字直接透上来，
菜单项文字发花**。

## What Changes

`WebActivity.kt` 的「网页玻璃化」注入（`onPageFinished` 内第二段 `evaluateJavascript`）此前把
**所有**非透明背景元素统一压到 `rgba(r,g,b,0.45)`，只对「窄屏 + 展开态侧栏」走 `skipBg` 例外
（`bwPanelBg()` 提到 0.92）。**浮层/菜单/popover/对话框没有任何例外**，于是和普通卡片一样被
降到 0.45 —— 这就是发花的直接原因。

本次给浮层加例外：命中即用 **0.92**（与展开态侧栏同档），且不附加 `backdrop-filter`。

### ⚠ 实测纠正：真实菜单"根本没被注入"（第一版修复踩空）

第一版只加了「有非透明背景的浮层 → 0.92」分支。**实测发现对真实菜单无效**：

真机（笔电 emulator-5554）CDP 实测 `/` 指令菜单的真实 DOM：
```
div.Z9Jnlq_viewport[role=listbox][aria-label="Trigger suggestions"]   257x172
  bg = rgba(0, 0, 0, 0)   ← 全透明！position:static  z:auto
  外层 div._surface_ri079_1.Z9Jnlq_menu  bg = rgba(0,0,0,0)  position:absolute z-index:100
  菜单项 button.Z9Jnlq_item[role=option]
```
两层表层的 calculated background **都是全透明**，而原注入在处理前会
`if(!m) continue;` / `if(alpha<1) continue;` ⇒ **菜单被直接跳过，从未被写过任何背景**。

⇒ 所以「菜单太透、文字发花」的机制是 **它压根没被玻璃化**（底色来自样式表/伪元素），
不是「被压到 0.45」。

**最终修法**：把「无背景色跳过」「已半透明跳过」两条幂等闸门改为**只对非浮层生效**，
浮层若无可用色相则回退到**与页面文字亮度同判据的纱色**（浅色页 `rgba(255,255,255,0.92)`、
深色页 `rgba(18,24,40,0.92)`，与 `#dsh-theme-veil` 一致）；浮层若本来有色相则保留色相升到 0.92。

### 判定方式（稳健优先，不硬编码 CSS-module 哈希）

按**结构/角色**特征判定，上游改哈希不失效（v1.32.5 的教训）：

1. `role` ∈ {`menu`, `listbox`, `dialog`, `alertdialog`, `tooltip`} → 命中；
2. 否则要求同时满足：`position` 为 `fixed|absolute` **且** `z-index !== auto` 且 `z-index >= 10`
   **且** 宽 ≤ 90% 视口、高 ≤ 90% 视口 **且** 至少 3 个可交互子项
   （`button,a,li,[role=menuitem],[role=option],[tabindex]`）。

排除项（避免误伤既有行为）：
- `BynINW_*`（App 自身锚点：frame/centerCol/sidebarCol）不参与浮层判定；
- `_2H3hWW_root`（侧栏根）不参与 —— 它归 `bwPanelBg()` 管（展开态 0.92 / 收起态 0.45）。

### 红线守卫（三条既有行为必须原样保留）

1. **大容器 `transparent` 分支仍在前且互斥**（v1.32.6 教训：丢了 else 会让
   frame/中心列/包裹层每层 45% 白叠成约 91% 白，**壁纸整层消失**）。浮层判定位于
   `else if` 之后，不可能覆盖大容器。
2. **展开态侧栏仍 0.92**（v1.32.5 的 `bwPanelBg()` 一字未动）。
3. **收起态侧栏仍 0.45**。

## Impact

- 受影响 capability：`companion-app`（MODIFIED「浏览器网页全界面玻璃化」+ ADDED「网页浮层可读性」）。
- 版本：1.32.10 / code 76 → **1.32.11 / code 77**（三处同步）。
- 不改任何其它注入分支，不做重构。
