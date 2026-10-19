# 窄屏命中区不重叠（v1.32.15）

## Why

QA 体验轮（v1.32.14）把 **QA-A14 判为 P1 FAIL**：窄屏展开侧栏后，头部
`收起侧边栏`（toggle）的命中框 **40px 宽** 与右邻 `用 文件资源管理器 打开` 的命中框
**横向重叠 23.0px**（与 `更多打开方式` 重叠 15.1px），`elementFromPoint` 在后者视觉中心
`(246.1, 25.5)` 拿到的是 **toggle** 而非它自己。

根因是 **App 侧 v1.32.7 的命中区放大越界**，不是上游单独的问题：

- 上游 `SidebarRoot.module.css` 里展开态 toggle 是 **28×28**；v1.32.7 为把它做成 40×40 触控目标，
  用「放大 + 等量负 margin」（`min-width:40px; min-height:40px; margin:-6px`）把命中框外扩到
  **234→274**（视觉盒仍是 240→268）。
- 窄屏（≤1023px）下侧栏被改成 280px 浮层，**中心列被压到 304px**，头部控件整体左移
  （实测 `智能体团队` 203.8→231.8、`Open-in` 234.6→257.6、`More-ways` 258.9→278.9）
  ⇒ toggle 的**自然盒（240→268）与它们本来就相交**，再叠加 6px 外扩就变成 23px 重叠。
- 这违反了 **v1.32.7 自己定下的规矩**——"命中框按相邻中心距封顶"（该规矩对
  Workspaces 三钮、Open-in/More-ways 分体钮、Agent Team 都执行了，唯独漏了 toggle 这一条，
  因为当时假设"面板 Collapse 钮与收起态轨道钮无同排邻居"，该假设在 CSS360 下不成立）。

**诚实边界（必须一并记录，别让下轮误读验收结论）**：展开态下 x≤280 的内容列控件
（`智能体团队` / `用 文件资源管理器 打开` / `更多打开方式`）**本来就被 280px 浮层
（`position:fixed; z-index:60`）盖住**，用户点不到它们；点浮层内任意位置本来就该落到浮层上。
⇒ 本笔**只消除"命中框越界"这一 App 侧缺陷**（即 QA-A14 的判据本身），
**不声称"消除了用户误触"**；"展开态下这些 header 控件不可点"是**上游浮层版面**问题，
不在本笔范围（QA-A14 的 `coveredByPanelExpected` 机制正是为该情形设计的豁免）。

## What Changes

- **`android-app/.../WebActivity.kt`** 窄屏补丁注入样式追加**一条展开态专属规则**：
  `[class*='_2H3hWW_root']:not([class*='_2H3hWW_collapsed']) [class*='_2H3hWW_toggle']{min-width:0!important;min-height:0!important;margin:0!important}`
  - 只命中**侧栏 toggle 自身**（`_2H3hWW_toggle` 只挂在 toggle 上），
    **不误伤** Workspaces 三钮 / Agent Team / Open-in 分体钮（它们的规则一字未动）。
  - **不写死尺寸**：`min-width/min-height:0 + margin:0` = 回到上游原生盒
    （展开态 28×28、收起态由上游 `width/height` 决定），上游改尺寸也不会静默失效。
  - **只作用于展开态**：收起态（56px 图标轨道）**无同排邻居**，40×40 一字不动。
- 版本号三处同步：`versionCode 81` / `versionName 1.32.15` / `PushService.APP_VER 1.32.15`。
- 其余注入（玻璃化决策树、`bwPanelBg()` 的 280/0.92/0.45、浮层判定）**一行未碰**。

## Impact

- 影响面：仅 `android-app/.../WebActivity.kt` 注入样式表（+1 条规则，+18 行含注释）。
- **实测（真实页面 + 真实注入 + CSS360，headless Chrome + CDP mobile emulation）**：

  | 项 | BEFORE | AFTER |
  |---|---|---|
  | 展开态 toggle 命中框 | 234→274（40×40）、margin -6px | **240→268（28×28）、margin 0** |
  | 与 `Open-in` 重叠 | **23.0px** | **17.6px**（残余来自上游版面，App 侧无法清零） |
  | 与 `More-ways` 重叠 | **15.1px** | **9.1px** |
  | 展开态 toggle 中心/左/右/上/下 自命中 | 全 OK | 全 OK |
  | 展开态 toggle 命中框右缘 | 274（比自然盒外扩 6px） | **268（= 自然盒右缘，不再外扩）** |
  | **收起态 toggle 命中框** | 40×40 | **40×40（不变）** |
  | **收起态轨道 6 钮 selfHit** | 6/6 | **6/6（不回归）** |

- 不影响：玻璃化/浮层/面板不透明度（五红线）、推送语法、relay 契约、宿主插件。
- 验收：tester 的改动验证轮（QA-A14 复测 + 收起态轨道回归 + 五红线）。
