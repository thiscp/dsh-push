# 侧栏展开面板底色调实（v1.32.5）

## Why

v1.32.4 把窄屏侧栏浮层从"包含块 + 裁剪"陷阱里救了出来，代价是承载它的 `BynINW_sidebarCol` / `BynINW_frame` 不能再有 `backdrop-filter`（那会让 fixed 后代被关进 56px 包含块）。失去毛玻璃模糊后，**展开态面板只剩玻璃化的 45% 半透明底，背后的聊天文字透上来和侧栏条目混在一起**（用户真机截图里很清楚）。

## What Changes

- 窄屏补丁里新增 `bwPanelBg()`：按**当前 computed 背景色相**把侧栏根节点的 `background-color` 内联 `!important` 设为
  - **窄屏 + 展开态：alpha 0.92**（88~92% 不透明目标区间内），背后文字不再串上来；
  - 收起态（图标轨道）与桌面宽度：**alpha 0.45**（保持原来的毛玻璃透明度，轨道该透出壁纸）。
  - 色相取自运行时计算的背景色，因此亮/暗主题各自协调，不硬编码颜色。
  - 触发点：注入时 + `setTimeout(300/1200)` + 侧栏 class 的 `MutationObserver`（attributes: class）+ window resize。
- 展开态面板的 `box-shadow` 从 `rgba(0,0,0,.28)` 加深到 `rgba(0,0,0,.35)`，给浮层一点层次；收起态无阴影（窄屏规则只作用于 `:not([class*='_2H3hWW_collapsed'])`）。
- **玻璃化注入必须让开这层面板**：它写的是**内联** `!important`，优先级高于样式表，光靠 CSS 压不住。因此玻璃化那一步新增 `skipBg`（窄屏且侧栏展开时）——既不写那 45% 底色，也不给它加 `backdrop-filter`。收起态/桌面宽度行为不变（仍走原来的玻璃化路径）。
- 没有把 `backdrop-filter`/`filter`/`transform`/`contain` 加回祖先链（v1.32.4 的修复保持）。
- 「点浮层之外才收起」（按浮层矩形判断）、桌面宽度零改动（全部规则仍在 `@media (max-width:1023px)` 内）、注入幂等（样式按 id 查重、监听器/observer 各有标记）三条均未改动。
- 版本号三处同步：`versionCode 71 / versionName 1.32.5` 与 `PushService.APP_VER 1.32.5`。
- **v1.32.6 回归修复（本变更引入的副作用）**：v1.32.5 重构玻璃化那一步时把 `if(大容器) transparent; else {45%+模糊}` 的 **`else` 丢了**，大容器先被置 transparent 又被 45% 白覆盖——frame/中心列/包裹层每层 45% 白叠成约 91% 白，**主题壁纸整个消失**（真机与模拟器都复现；当时的验收只看面板、没看整页，漏掉了）。修复：恢复互斥分支（`if(大容器){transparent} else if(!skipBg){45%+模糊}`），`skipBg` 语义不变；并把「大容器必须全透、壁纸才能透出」写进规格场景，验收截图从此**同时看整页壁纸**（`adb screencap`，CDP 截图看不到原生壁纸层）。版本号三处同步：`versionCode 72 / versionName 1.32.6` 与 `PushService.APP_VER 1.32.6`。

## Impact

- 影响面：WebActivity 内 DSH Web 的样式与一段面板底色逻辑；不改 DOM 结构，不改 DSH 自己的 JS。
- 不影响：桌面宽度布局、收起态图标轨道透明度、玻璃化在其他元素上的表现、提问卡排版修复、relay 作答页/通知/上传下载/主题壁纸。
- 验收纪律（沿用 2026-10-13 教训）：**打包 APK → 真点击展开 → `adb screencap` → 自己 `read_image` 看"底够实、不混字、标题完整"**，并在截图同一时刻用 CDP 复核 DOM 状态；computed style 单独通过不算数。
