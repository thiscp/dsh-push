# 内置浏览器「网页玻璃化」注入：浮层例外与判定依据（v1.32.11）

> 实现位置：`android-app/app/src/main/java/xyz/cpyh/dshpush/WebActivity.kt`
> `onPageFinished` 内**第二段** `evaluateJavascript`（网页玻璃化）。本文件只记录这段注入的
> **浮层例外**与其判定依据，供后续改动/QA 复用。

## 1. 这段注入原本做什么

遍历 `div,main,section,header,aside,nav,button,textarea,input,ul,li`，按计算背景色分流：

```
if (w > vw*0.5 && h > vh*0.5)   -> background-color: transparent  (!important)   ← 大容器，壁纸唯一通道
else if (!skipBg)               -> rgba(r,g,b,0.45) + backdrop-filter:blur(12px) ← 其余全部
```

`skipBg` 只豁免**窄屏 + 展开态侧栏**（`_2H3hWW_root` 非 `collapsed`，`vw<=1023`），
其不透明度由同页的 `bwPanelBg()` 单独设为 **0.92**（v1.32.5）。

**缺陷（v1.32.11 修）**：浮层/菜单/popover/对话框没有任何例外，被一律压到 **0.45** ——
立绘与底层聊天文字透上来，菜单项文字发花。用户真机反馈原话：
「选择传文件的控件背景透明度是否太低了点」（`/` 唤起的 slash 指令菜单）。

## 1.5 真机实测的真实菜单结构（2026-10-14，v1.32.11 期间）

`/` 唤起的指令菜单，**真实 DOM（笔电 emulator-5554 实测）**：

| 元素 | 类 | 角色 | 关键计算样式 |
|---|---|---|---|
| 菜单表层 | `Z9Jnlq_viewport` | `role=listbox` `aria-label="Trigger suggestions"` | **`background-color: rgba(0,0,0,0)`（全透明！）** `position:static` `z:auto` 257×172 |
| 菜单外框 | `_surface_ri079_1 Z9Jnlq_menu` | — | `position:absolute` `z-index:100` 265×180，**computed bg 也是 transparent** |
| 菜单项 | `Z9Jnlq_item` / `Z9Jnlq_active` | `role=option` | 单个 251×34 |
| 输入卡 | `RlGAzG_card` | — | 0.45（**修复后仍应是 0.45**，作对照） |
| "+"控件 | `RlGAzG_add` | `aria-label="Add files or run commands"` | 用户截图里指的就是它 |

### ⚠ 关键机制（第一版修复踩空的原因，务必记住）

原注入在处理前先做：
```js
var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(e).backgroundColor);
if (!m) continue;                                   // transparent → 直接跳过
if (m[4] !== undefined && parseFloat(m[4]) < 1) continue;   // 半透明 → 跳过
```
**真实菜单表层两层的 computed background 都是 `rgba(0,0,0,0)`** ⇒ 命中 `!m` 或 alpha<1
⇒ **被 `continue` 跳过，根本没被碰过**。

⇒ 所以「浮层太透」的机制**不是**「被压到 0.45」，而是**它压根没被注入**：
底色来自样式表/伪元素，注入没接管；立绘与聊天文字从它背后透上来。
（我第一版只加了 `else if (isOv) → 0.92` 分支，对**已经有非透明背景**的浮层有效，
对**真实菜单无效** —— 是实测把它抓出来的。）

**修法（v1.32.11 最终版）**：
1. 把 `if(!m)continue` 与「alpha<1 跳过」两条**幂等闸门改为只对非浮层生效**：
   `if(!isOv && m[4]!==undefined && parseFloat(m[4])<1) continue;`，且 `if(!m)continue;` 移到
   浮层判定**之后**；
2. 浮层若自身没有可用色相（`alpha<1` 或无色），**回退到按页面文字亮度选深浅纱**：
   `ovFallback = blum>0.5 ? 'rgba(18,24,40,0.96)' : 'rgba(255,255,255,0.96)'`
   （与 `#dsh-theme-veil` 同判据 → 浅色页白纱、深色页深纱）；
3. 浮层若本来就有不透明色相，则**保留原色相**升到 0.96。

## 1.6 ★ P1 复修：分支顺序反了（QA 判 FAIL，2026-10-14）

**症状**：真机 `/` 菜单表层 alpha = **0**（内联被写成 `transparent !important`），正文与立绘照旧叠印。

**根因（精确到一行）**：v1.32.11 第一版把浮层分支放在了**大容器分支之后**：
```js
if (w>vw*0.5 && h>vh*0.5) { …'transparent'… }   // ← 无条件，先判
else if (isOv)            { …0.92… }            // ← 永远轮不到
```
**算术**：视口 `360x671` ⇒ 阈值 `180x335.5`；真实菜单变高后是 **257x392**
⇒ `257>180` ✓ 且 `392>335.5` ✓ ⇒ **落进大容器分支被写成 transparent**。
⇒ 不是"没命中"，是"命中了却被前面的分支抢走"。

**为什么第一版会误判为已修好（重要教训）**：当时的探针只造了**矮浮层** `257x172`
（`172 < 335.5`，未过阈值 ⇒ 正确走 0.92）⇒ **假 PASS**。
⇒ **凡涉及阈值判定的改动，必须测阈值两侧**（`overlay-ab2.mjs` 现在两侧都测）。

**最终修法**（互斥 + role 豁免几何）：
```js
var isOv=false, ovRole=false;          // ovRole = 由 role 命中
… if (role∈{menu,listbox,dialog,alertdialog,tooltip}) {isOv=true; ovRole=true;} else {…几何…}
if (!m) continue;
if (!isOv && alpha<1) continue;                                   // 幂等闸门只约束非浮层
if ( isOv && (ovRole || !(w>vw*0.5 && h>vh*0.5)) ) { …0.92 / ovFallback… }  // ★ 浮层先判
else if (w>vw*0.5 && h>vh*0.5)                     { …'transparent'… }       // 大容器仍存在
else if (!skipBg)                                  { …0.45… }
```
`ovRole` 的意义：**role 命中的浮层豁免全部几何判定**（含大容器分支）——
真实菜单正是靠 `role=listbox` 命中，而面积阈值反会把它误判成"大容器"废掉。

**⚠ 未决遗留（task-8 报告已上报 lead，暂未修）**：**无 role 且高过阈值**的浮层仍被大容器分支吞成
`transparent`（实测 `TALL NO-role 257x392 → transparent`）。本轮**故意不动**，因为真实页面上
「既是大容器又是几何浮层形」的元素实测只有 1 个（`_surface_ri079_1 Z9Jnlq_menu`，其 computed bg 本就是
`rgba(0,0,0,0)`）⇒ 扩大豁免的收益有限、而触碰大容器红线的风险实在。role 豁免已覆盖真实菜单。

## 2. 浮层判定（v1.32.11 新增）

**不硬编码 CSS-module 哈希**（上游改哈希即失效 —— v1.32.5 的教训）。按结构/角色特征：

```js
var isOv = false, ovRole = false;
if (cn.indexOf('BynINW_') < 0 && cn.indexOf('_2H3hWW_root') < 0) {
  var role = (e.getAttribute && e.getAttribute('role') || '').toLowerCase();
  if (role === 'menu' || role === 'listbox' || role === 'dialog'
      || role === 'alertdialog' || role === 'tooltip') {
    isOv = true; ovRole = true;                     // ① 语义 role 直接命中（并豁免几何判定）
  } else {
    var cs = getComputedStyle(e);
    if ((cs.position === 'fixed' || cs.position === 'absolute')
        && cs.zIndex !== 'auto' && parseInt(cs.zIndex, 10) >= 10
        && w <= vw * 0.9 && h <= vh * 0.9
        && e.querySelectorAll("button,a,li,[role='menuitem'],[role='option'],[tabindex]").length >= 3) {
      isOv = true;                                  // ② 几何+层叠+子项数特征（仍受大容器互斥约束）
    }
  }
}
```

命中后：`background-color: rgba(r,g,b,0.96) !important`，**保留原色相（只改 alpha）**，
且**不加 `backdrop-filter`**（0.96 已足够；`backdrop-filter` 会让元素成为 fixed 后代的包含块，
v1.32.4 曾因此把窄屏侧栏浮层锚死在被裁剪的网格列里）。

**为什么是 0.96 而不是 0.92**：0.92 下实测**仍能隐约看到底层聊天正文叠印**（8% 透光），
而用户投诉的正是"太透"。0.96 只留 4% 透光，肉眼不再有可辨识的叠印；同时**不改成全不透明**，
保留一点玻璃质感与"面板档"风格一致。**注意侧栏仍是 0.92（`bwPanelBg()` 未动）**，两处不同档是有意的。

### 排除项（为什么）
| 排除 | 原因 |
|---|---|
| `BynINW_*`（frame / centerCol / sidebarCol） | App 自身锚点，由 v1.32.4/v1.32.5 的窄屏修补单独管；纳入浮层判定会与网格修补打架 |
| `_2H3hWW_root`（侧栏根） | 归 `bwPanelBg()` 管：窄屏展开态 0.92 / 收起态与桌面宽度 0.45。若被浮层分支命中，展开态虽仍 0.92，但**收起态会被误提到 0.92**，破坏 v1.32.5 行为 |
| `button/input/textarea` 等叶子控件 | 面积小、子项数为 0，天然不满足 ② |

## 3. 三条红线（改这段注入必须复核）

1. **大容器 `transparent` 分支必须仍然存在，且与浮层/45% 互斥。**
   ⚠ **v1.32.11 第一版就是在这里翻车的**：它把大容器写成**无条件先判**，浮层分支排在其后，
   于是高过阈值的菜单（257x392 > 180x335.5）被大容器分支抢走并设成 `transparent`（P1，QA FAIL）。
   v1.32.6 的原始教训则是另一个方向：`skipBg` 重构时**丢了 `else`**，大容器先 `transparent`
   再被 45% 覆盖 → frame/中心列/包裹层每层各 45% 白，叠成约 **91% 白，壁纸整层消失**
   （真机+模拟器都复现过，**只看面板截图看不出来**，必须看设备截图）。
   ⇒ 正确写法：`if(isOv&&(ovRole||!(big))){…0.96…} else if(big){…transparent…} else if(!skipBg){…0.45…}`。
   ⇒ 浮层判定已提到大容器**之前**且两者互斥（v1.32.11 第一版的 bug 是顺序反了）。

2. **窄屏展开态侧栏仍 0.92**（`bwPanelBg()` 一字未动）。
3. **窄屏收起态侧栏仍 0.45**。

## 4. 验证方法（可直接复用）

注入是**内联 `!important`**（页面 CSP 拦动态 `style` 标签），所以**加样式表压不住**，
必须读计算样式或内联样式。

### 4.1 免开菜单的 A/B 判定法（推荐，快）
玻璃化注入挂了 `MutationObserver(document.body,{childList:true,subtree:true})`，
**任何 childList 变化后约 400ms 会重跑 `apply()`**。因此可以往页面里**插入合成浮层**，
让**真实注入代码**处理它，再读计算样式 —— 不必与 React 输入框搏斗。

合成探针（`overlay-ab2.mjs`，阈值两侧都测）：
- `role=listbox` + 高 **超过**阈值（257x392 > 180x335.5）→ 期望 **0.96**（★ 上轮 FAIL 的几何）
- `role=listbox` + 高 **低于**阈值（257x172）→ 期望 **0.96**
- `role=listbox` + 宽高均超 80% 视口（role 豁免几何）→ 期望 **0.96**
- 无 role 的大容器 → 期望 **transparent**（红色线）
- 真实侧栏：点 `Open sidebar` 后 → **0.92**；收起 → **0.45**

### 4.2 真机/模拟器设备截图
壁纸是**原生层，CDP 看不到** ⇒ 必须用 `adb exec-out screencap -p` 或 `screencap`+`pull` 出图，
用 `read_image` 自己看「壁纸是否仍全程可见」。

## 5. CDP 驱动该输入框的实测要点（下一轮直接照抄，别再踩）

**起页三件套**：
1. `adb root` **必须先做**（H-1：非 root 时 `am start .WebActivity` 报 SecurityException，
   因为 Activity 未导出）；**root 会清空 forward ⇒ 顺序必须是「先 root 再建 forward」**。
2. `adb shell am start -n xyz.cpyh.dshpush/.WebActivity --es url "<URL>"`
3. `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>`，
   pid 取 `adb shell pidof xyz.cpyh.dshpush`（`/proc/net/unix` 里的名字会截断）。

**输入框（`RlGAzG_input`，React 受控 `contenteditable`）的实测行为**：

| 手段 | 结果 |
|---|---|
| **`el.focus()`（页面 JS，不点击）+ `Input.insertText`** | **成功插入** ✅ 推荐（tester 实测） |
| 先合成 CDP 鼠标点击再输入 | **插不进** —— 点击把焦点抢到 tab 容器（`activeElement` 跑了） |
| `Input.dispatchKeyEvent` keyDown+char+keyUp | 插入 **2 个字符**（重复） |
| `adb shell input text "/"`（设备 IME） | 曾成功插 1 个字符；另一轮实测插不进（不稳定） |
| 清空 | CDP `Ctrl+A`(`modifiers:2, commands:["selectAll"]`) → `Backspace` ✅ 有效；`value=''` 无效 |

⚠ **上一版我把归因写反了**（曾说"`insertText` 插 0 字符、要用设备 IME"）。真相是：
**坏的是"先点击"这个前置动作**，不是 `insertText`；正解 = `el.focus()` + `Input.insertText`，全程不点击。

**草稿跨 reload 持久化** ⇒ 反复尝试会累积成 `////`，而菜单只在**干净的单 `/`** 时出现。
建议每轮先 `Ctrl+A`→`Backspace` 清干净，再用 `adb shell input text "/"` 输入。

**判定菜单是否出现（免哈希、免语言）**：
`document.querySelector("[role='listbox'][aria-label*='suggestion' i]")` 或
`[role='menu']` / `[role='listbox']`；本项目实测真实选择器为
`div.Z9Jnlq_viewport[role=listbox]`（外面包 `div._surface_ri079_1.Z9Jnlq_menu`）。
**不要**用"包含菜单文案"去反查容器：聊天正文里也常出现这些词，会误命中 transcript（我踩过）。

**壁纸是原生层，CDP 看不到** ⇒ 必须 `adb exec-out screencap -p` 出图，用 `read_image` 自己看。

## 6. v1.32.5 的 `bwPanelBg()` 与本次浮层例外互不影响

`bwPanelBg()` 独立负责侧栏根 `_2H3hWW_root`：窄屏展开态 0.92 / 收起态与桌面宽度 0.45。
本次浮层判定**显式排除** `_2H3hWW_root`，避免把收起态误提到 0.92。
若将来要统一两处，注意别把收起态一起提亮。

## 7. v1.32.11 收口（已发布 2026-10-15 01:08）

**最终决策树**（`49a0ebd` 0.96 + `f5e4a6b` 分支顺序，版本 1.32.11 / code 77）：

```js
if(!m) continue;                                     // 取不到 computed bg 就跳过
if(!isOv && alpha<1) continue;                       // 幂等闸门：只约束非浮层
if(isOv && (ovRole || !(w>vw*0.5 && h>vh*0.5))) {    // ★ 浮层判定在前，与大容器互斥
  setBg(oa<1 ? ovFallback : 'rgba(r,g,b,0.96)');     // ovRole 命中者豁免全部几何判定
} else if(w>vw*0.5 && h>vh*0.5) {
  setBg('transparent');                              // v1.32.6 红线，保留
} else if(!skipBg) {
  setBg('rgba(r,g,b,0.45)'); + backdrop-filter       // 普通面板
}
```

**alpha 档位**：浮层 **0.96** ｜ 展开态侧栏 **0.92**（`bwPanelBg()`）｜ 普通面板/卡片/输入卡 **0.45** ｜
大容器 **transparent** ｜ `#dsh-theme-veil` **0.45**。

**两条"改了数值就必须同步"的地方**：`ovFallback`（`WebActivity.kt` `L357-358`）与"有色相"分支（`L407`）。
⚠️ `L643` 另有一处 `rgba(18,24,40,0.92)` 是**短提示条**（非本浮层）——**别顺手改**。

**发布证据**：`SUMMARY: 9/9 passed`；线上 `?v=77` → http=200 / 10,992,560 B。
QA：Part A（0.92）PASS-with-findings、Part B（0.96）PASS（7/7 恒 0.96、哈希 bracket `stable=true`、肉眼淡影已消除）。

**下轮改这段注入前，先读**：
`verify/ANALYSIS-v1.32.11-overlay-opacity.md` §2（决策树两条闸门）、§3（veil 雷区）、
§6.5/§6.6（**分支顺序 + 间歇竞态**）；以及 `verify/README.md` 的「版本指纹与竞态纪律」六条。

