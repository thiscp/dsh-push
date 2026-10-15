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

## 8. v1.32.12：全屏内容阅读面板（文档预览）保底

**用户反馈（2026-10-15 01:17）**：「对话生成的文档，我打开后背景也是透明的」——
文件预览/差异面板（抬头 `…story.md` + `Markdown` + 刷新 + `+5 -5`）整体无实底，
底层页签栏/聊天正文/文档文字互相叠印，长文发花。

### 8.1 根因（实测，非推断）

面板祖先链中**只有一层**被注入：
```
SECTION._tabHost_6nhg2_162 _pane_6nhg2_209   360x671  (100%x100%)
    inline   = transparent !important      ← 被"大容器"分支写成全透明
    computed = rgba(0,0,0,0)   alpha = 0
    NATIVE   = rgb(255, 255, 255)          ← 应用自己就是不透明的纯白阅读页
```
视口 `360x671` ⇒ 阈值 `180 / 335.5`；`360>180` 且 `671>335.5` ⇒ **落进大容器全透分支**。
其余各层内联为空、无 `background-image`、`::before/::after` 为空 ⇒ **不是渐变/伪元素底**，
就是一层纯色被抹掉。（首要嫌疑成立；"0.45 太薄"排除：该屏 `injected045 = 0`。）

### 8.2 ⚠ 为什么判据必须用**结构**、不能用颜色（本仓最容易踩的一个坑）

对当前屏全部 57 个大容器做"临时摘内联 → 读原生 → 逐层还原"枚举：

| 元素 | 内联 | **原生** |
|---|---|---|
| `BynINW_frame`（★壁纸通道） | `transparent` | **`rgb(255,255,255)`** |
| `Dc7zOa_root`（聊天根） | `transparent` | **`rgb(255,255,255)`** |
| `_tabHost_6nhg2_162`（本 bug） | `transparent` | **`rgb(255,255,255)`** |
| `_block_7gxqk_4 md-code-block` | `transparent` | `rgb(249,250,251)` |

**壁纸通道的原生色与坏掉的面板一模一样** ⇒ 任何"原生不透明就给回不透明"的颜色判据都会
把壁纸通道一并变不透明 ⇒ 每层白叠加 ⇒ **直接复现 v1.32.6「壁纸整层消失」**。

### 8.3 判据与分支（v1.32.12 落地）

**`isPanel`（结构判据）**：自身 `position ∈ {absolute, fixed}`，**或** 祖先 8 层内存在
`position ∈ {absolute, fixed}` 且覆盖 ≥90%×90% 视口的元素。
依据：阅读面板是绝对定位的全屏覆盖层（`OUqwTW_panel` = `absolute` 100%），
壁纸通道是 **static/relative 常规布局**。实测 `wouldChange` **恰好只有 `_tabHost` 一个**。

```
if (isOv && (ovRole || !big))          -> 浮层 0.96      （v1.32.11，一字不动）
else if (big && isPanel && pm)         -> 面板 alpha=1   ★ 用 pm=原生色相，不设 alpha（不透明）
else if (big)                          -> transparent    ★ 通道仍全透
else if (!skipBg)                      -> 0.45
```

**三道护栏（缺一不可）**：
1. **`pm` 前置条件 = 原生 `alpha >= 1`**：只有原生确实有不透明底的元素才走面板分支。
   由于上一轮可能已把它写成 `transparent`，实现上**临时摘掉内联读原生色相再还原**；
   原生无底的（`OUqwTW_panelBody`/`_surface_6nhg2_125`）**绝不凭空加底**，落回原分支。
2. **`!isAnchor`**：排除 `BynINW_*` 与 `_2H3hWW_root`（后者归 `bwPanelBg()`）。
3. **按 id 排除 `#dsh-theme-veil`**：它 `fixed` + `100%×100%` ⇒ 会被 `isPanel` 命中。
   哪怕它当前由另一段注入自己写死内联，也**不能依赖"另一段恰好先写"的隐式顺序**。

### 8.4 ⚠ 两个探针陷阱（都实际踩过，下轮直接避开）

1. **`[class*='_tabHost']` 有 6 个匹配**（含 `0x0` 占位）⇒ `querySelector` 拿到 `0x0` 那个，
   会把"面板其实开着"误报成"没打开"。**必须扫描全部匹配取最高**（与 v1.32.5 侧栏同类陷阱）。
2. **截图路径不能当第 3 个 argv 传给探针**：`overlay-run.ps1` 只传 `(outJson, tag)`，
   第 3 个参数恒为空 ⇒ 截图被**静默跳过**，却会得出"截不到图"的错误结论。**路径要硬编码。**

**已知遗留（本轮不修）**：`_block_7gxqk_4 md-code-block`（331x524，原生 `rgb(249,250,251)`）
同样被大容器分支抹成透明，但它**不是**全屏定位面板 ⇒ 本判据不覆盖。
验证探针 `doc-final.mjs` 已加**常驻断言**打印它的 alpha/native，任何一跑都可见。

### 8.5 v1.32.12 验收实测（2026-10-15 01:4x，装机后重新起页复测）

探针 `doc-final.mjs`（`-Restart` 重起页后跑，非旧 DOM）；10 项断言全绿：
```
PANEL  _tabHost_6nhg2_162 _pane_6nhg2_209   360x671  pctW=100 pctH=100
       bg=rgb(255,255,255)  alpha=1  inline=rgb(255,255,255)/important
       NATIVE=rgb(255,255,255) nA=1              ← 保留应用原生白色相，1.0（不设 alpha）= 不透明实底
红线   frame=rgba(0,0,0,0)  centerCol=rgba(0,0,0,0)  chatRoot(Dc7zOa_root)=rgba(0,0,0,0)
       html=rgba(0,0,0,0)  body=rgba(0,0,0,0)     ← 壁纸通道未被误伤（原生同为 rgb(255,255,255)！）
veil=rgba(255,255,255,0.45)   card(RlGAzG_card)=rgba(255,255,255,0.45)
sidebar 收起=rgba(249,250,251,0.45)  展开=rgba(249,250,251,0.92)
常驻断言 codeBlock: alpha=0 inline=transparent NATIVE=rgb(249,250,251) 331x524  ← 本轮不修的已知遗留
```
**肉眼（整页设备截图 `read_image` 自看，主判据）**：面板是**纯白不透明实底**，文档正文（黑体标题、
`1. 一句话结论`、代码块等）清晰；用户投诉的"三层层叠/文字互相压叠"已消失。
**1.0 实测淡影消失**：0.96 那张在标题与段落之间的空白处**仍可见**底层聊天正文淡影（约 4% 透光，
lead 亲自看图确认）⇒ 已按 lead 的升级规则（"肉眼有任何可辨识透字 ⇒ 升 1.0"）**升到 1.0**；
升后复拍复看，空白处淡影**已消失**。`else if(big&&isPanel&&pm)` 分支由 `rgba(...,0.96)` 改为
`rgb(...)`（不设 alpha）。

## 9. v1.32.13：聊天里的大代码块透明（侦察记录，2026-10-15）

### 9.1 现象与更正

目标：聊天正文里的**大代码块** `_block_7gxqk_4 md-code-block _card_7gxqk_107`。
任务档案记"面板打开时 alpha = 0.45 / 内联 `rgba(249,250,251,0.45)`"，
**但实测复现不出来**：该实例（`331x524`）实测 **`transparent`（alpha=0）、内联 `transparent !important`**。

**原因：同屏有 10 个 `md-code-block`，类名/宽度几乎相同，只有高度不同。**
按算术（视口 `360x671` ⇒ 阈值 `180 / 335.5`）逐条对照，**全部吻合设计**：

| 实例尺寸 | w>180 | h>335.5 | 实测 | 说明 |
|---|---|---|---|---|
| `233x182/163/125/144` | ✓ | ✗ | **0.45** | 走普通分支（正确） |
| **`331x524`（目标）** | ✓ | **✓** | **`transparent`** | 被大容器分支抹掉 ← 要修的就是它 |
| `331x182/87/296/144` | ✓ | ✗ | **0.45** | 走普通分支（正确） |

⇒ **是分支问题（被大容器 `transparent` 分支吞掉），不是"0.45 太薄"**。
（另一个**真实存在但本例未触发**的风险：幂等闸门 `a0<1 → continue` 会把"矮时被写成 0.45"的实例
**永久定格**；修法必须同时放行闸门，否则这类实例修不回来。）

### 9.2 ★ 判据：`innerBig <= 2`（实测 `wouldChange = 1`）

`innerBig` 定义：**该元素后代中"自身也超过 50%×50% 视口"的元素个数**（即"里面还套着几层大容器"）。

实测对照（面板打开态）：

| 元素 | 尺寸 | `innerBig` | 性质 |
|---|---|---|---|
| `BynINW_frame` | 360x671 | **70** | 布局容器（壁纸通道，红线） |
| `BynINW_centerCol` | 304x671 | **42** | 布局容器（红线） |
| `Dc7zOa_root` | 304x671 | **41** | 布局容器（红线） |
| `_block_7gxqk_4 md-code-block` | 331x524 | **2** | **内容块（目标）** |

⇒ "内容叶子"与"布局容器"在**嵌套大容器计数**上量级相差 20 倍以上，是干净的**结构**判据。
判据：**`big && !isAnchor && nativeOpaque && innerBig <= 2`** ⇒ **`wouldChange` 恰好 = 1**（只有目标），
锚点命中 **0**；面板**关闭**态该谓词命中 0 ⇒ **零行为变化**。

### 9.3 ⛔ 一个被实测否决的判据（务必别用）

**"后代含 `pre`/`code`"是坏判据**：`Dc7zOa_root`（**布局容器**）后代里**也有** `pre`/`code`
（整棵聊天树含代码块）⇒ 该判据把它一起命中 ⇒ **`wouldChange` 变 2 且包含 `Dc7zOa_root`**
⇒ 布局容器变不透明 ⇒ 多层白叠 ⇒ **直接复现 v1.32.6「壁纸整层消失」**。
**这正是"同色陷阱"的实证**：`BynINW_frame` 与目标的原生色**同为白系**，
不能靠"语义/颜色"区分，只能靠**结构嵌套**。

### 9.4 同屏"透明内容块"全集 = 只有目标一个

面板打开时"原生不透明但当前非不透明"的**全集只有 3 个**：`BynINW_frame`、`Dc7zOa_root`（两个都是红线锚点/布局容器）
与**目标 `_block_7gxqk_4`**。⇒ **没有别的表格/引用/图片容器也在透明**。

另：**8 个较小的 `md-code-block`（高度未过阈值）当前是 0.45**，按设计如此；
**本轮按 lead 裁定不动**（扩大改动面风险更高）。

---

## 10. v1.32.14：把布局容器**显式排除**出内容块判据（修 QA 抓到的瞬时露白）

### 10.1 v1.32.13 上线前 QA 抓到的缺陷（`QA-A32` / FINDING-1）

v1.32.13 的 QA（`verify/QA-ROUND-v1.32.13.md`）判 **PASS-with-findings**：主验收全绿
（大代码块 `1.0` 5/5、9 个矮块 `0.45` 未误改、五红线全保），但报出一条 **P2**：

> `Dc7zOa_root`（聊天根，`304x671`，**原生 `rgb(255,255,255)` 兜底白**）
> 存在 **≈2 秒的"原生白"窗口** ⇒ **壁纸被盖**，之后 `MutationObserver` 自愈。

实测时间线（tester `qa-dcroot-settle.mjs`）：

| 时刻 | `dcRoot.bg` | `inline` | 判读 |
|---|---|---|---|
| `2987 / 3498ms` | `rgb(255,255,255)` | **`rgb(255,255,255)`（带值）** | **注入写的白** |
| `4191ms` | `rgba(0,0,0,0)` | `transparent` | 首次正确注入 |
| `4712 – 6265ms` | `rgb(255,255,255)` | **`''`（空）** | **React 换节点抹掉内联 ⇒ 原生白** |
| `6773ms+` | `rgba(0,0,0,0)` | `transparent` | 自愈 |

### 10.2 🔴 根因（**属 v1.32.13 引入**）

`isCB` 依赖 **运行时量** `innerBig`（后代中 `>50%×50%` 视口的元素个数）：

**首屏 / 局部重渲染 / 流式生成中，后代尚未撑开 ⇒ `innerBig` 临时 ≤ 2**
⇒ `isCB` **误命中 `Dc7zOa_root`** ⇒ 按 `pm`（原生色相 `rgb(255,255,255)`）**写出不透明白**
⇒ **聊天根在 84%×100% 面积上变不透明白** ⇒ **壁纸被盖**（症状 = v1.32.6 的瞬时版）。

> **⚠️ 关键教训**：`innerBig <= 2` 在**稳定态**有 **20 倍余量**（目标 `2` vs 容器 `41/42/70`），
> `wouldChange=1` 也**基于稳定态测量** ⇒ **看起来非常安全**。
> **但"运行时量"在过渡态会失真 ⇒ 稳定态的安全余量不能推出动态态安全。**

### 10.3 修法（**一处改动同时封住两条路径**）

```js
"var isAnchor=cn.indexOf('BynINW_')>=0||" +
"cn.indexOf('_2H3hWW_root')>=0||" +
"cn.indexOf('Dc7zOa_root')>=0;" +        // ★ v1.32.14 新增
```

`isAnchor` 是**「取原生色相回写」与 `isCB` 的共用闸门** ⇒ 布局/滚动容器
（`BynINW_*`、`_2H3hWW_root`、**`Dc7zOa_root`**）**永远不会**被写不透明底。
**代价极小**：内容块（代码块）**不可能是聊天根** ⇒ 改动集仍应恰好是那一个代码块（`wouldChange` 仍 = 1）。

**遵本轮固化的纪律**：**判据失败方向要选安全侧 —— 宁可漏修（可再开一轮），不可误修（复现 v1.32.6）。**

### 10.4 版本与冻结

- 版本三处 → **`1.32.14` / code `80`**；
- openspec `app-content-block-opacity` 增补场景
  `布局容器 MUST NOT 被写入不透明底（v1.32.14 追补）`；检查器 **exit 0**；
- **冻结 sha256 `2850a0d3…`**（`10,993,088 B`）—— vm1 产物 / 台式机回传 / 笔电 / 设备 **四方一致**；
- **DEX**：`Dc7zOa_root`=1（新增排除确在字节码）、`isAnchor`=1、`innerBig`=1、`isCB`=1、`BynINW_`=2、veil=1。

### 10.5 本轮由此固化的 5 条注入类纪律（**这段注入的后续改动都要遵守**）

1. **语义特征 ≠ 结构特征**：判据用结构量（`innerBig`），**禁用**"含 `pre`/`code`"这类语义特征（§9.3）。
2. **判据失败方向选安全侧**：宁可漏修，不可误修。
3. **测"注入后的样式"必须锁定 settle 之后**：判据是 **`inline` 已被写入**；`inline=''` = 注入未生效。
4. **"settle" ≠ "读到正确值"**：必须**连续采样确认稳定**（`settledRepeats` 连续 5 次）。
5. **「稳定态测量」≠「动态态安全」**：凡判据依赖**运行时测量值**，必须另测**过渡态**，
   并对关键容器**加显式排除** —— **阈值余量不构成保护**。

---

## 11. v1.32.15：§10.3 那道闸门的**键**腐烂了 ⇒ 结构判据 + 单向写 + 迟滞

### 11.1 症状

用户反馈：App 连「**工作 VM / vm1 的 DSH Web**」时背景**一会儿透明能看见立绘、一会儿不透明**；
连「笔电自己的 DSH Web」正常。**同一 App、同一注入、不同宿主** ⇒ 变量在页面侧。

### 11.2 🔴 根因（lead 实测取证，本轮直接采用）

| # | 事实 | 判据 |
|---|---|---|
| 1 | 三台宿主的 bundle **逐字节相同**（4 个 asset 共 1,476,240 B） | 与构建差异无关 |
| 2 | `isAnchor` 的 5 个类名锚点（`BynINW_` / `_2H3hWW_root` / `Dc7zOa_root` / `Z9Jnlq_` / `RlGAzG_`）在现行 4 个 asset（1.47 MB，懒加载 chunk 已枚举）里 **0 命中** | 现行命名是 `_<局部名>_<哈希5>_<行号>`：`_tabHost_6nhg2_162`（JS 43 次 / CSS 151 次）、`_surface_6nhg2_125`、`_split_6nhg2_17`、`_label_4ub78_129`，66 个前缀，配套 `--dsh-dockkit-*` |
| 3 | 旧命名在旧版里确实存在（`E:\programs\dsh\resources\app.asar`，09-29 版，`findstr BynINW_` 命中） | ⇒ DSH 升级换了命名方案 ⇒ **`isAnchor` 对任何元素恒为 false**，§10.3 那道"显式排除"**等于零** |
| 4 | 于是 dockkit 的布局/滚动容器落进 `isPanel` / `isCB` 两条**运行时测量**分支；`innerBig` 过渡态失真已由 §10.1 实测证明（临时 ≤2） | ⇒ 中途写出 `rgb(255,255,255)`、下一轮 `MutationObserver` 又抹回 `transparent` ⇒ **翻面**；慢宿主撞窗口概率高、loopback 几乎不撞 ⇒ "只有连 VM 才犯" |
| 5 | 被翻的东西原生就不透明：`._tabHost_6nhg2_162:not(._float_6nhg2_156),._emptyTabHost_6nhg2_143{background:var(--dsw-alias-bg-base)}` | 不是"凭空加底"，是**把原生底又写回来** |

> **§10.5 第 5 条纪律（"对关键容器加显式排除"）被执行了，但排除用的是类名哈希 ——
> 纪律没写"这个键会随上游构建腐烂"。这是本轮真正的教训。**

### 11.3 修法 A / B / C

**A. `isAnchor`（类名）→ `isLayout`（纯结构）**

```js
isLayout = big && 自身 position ∈ {static, relative}
                   && 祖先链上不存在「position ∈ {absolute,fixed} 且 ≥90%×90% 视口」的覆盖层
```

与 `isPanel` **同源互补**（§7 的对立判据）。祖先遍历上界 `document.body`、层数 8 → **24**。
`isPanel` 复用同一次遍历结果 `ancBigPos`（不再自己走第二遍）。

**B. 单向写 + 分支顺序**

```
isOv && (ovRole || !big)   -> 浮层 0.96            （v1.32.11，不动）
isLayout                   -> transparent          ★ 新增，排在面板/内容块之前
big && isPanel && pm       -> 阅读面板 原生 1.0     （v1.32.12 红线）
big && isCB && pm          -> 内容块 原生 1.0       （v1.32.13，见 C）
big                        -> transparent          （v1.32.6 红线，一字未动）
!skipBg                    -> 0.45 + blur
```

配套三处收窄（都朝安全侧）：

- 「剥内联读原生」入口 `big && !isAnchor` → `big && !isLayout && (isPanel || isCB)`：
  布局链与侧栏根**连瞬时摘内联都不做**（"原生不透明就不还原"会把它们自己的档位底抹掉）；
- `isCB` 只在 `big && !isLayout && !isPanel && pm` 时计算（先廉价后昂贵）；
- 幂等闸门加 `&& !isLayout`：布局链放行后写回是**同值幂等**的 transparent。

**稳定态闸门**（B 的前提）：`isLayout` 只认「内联已被本注入写成 `transparent !important`」的元素
—— 即 §10.5 第 3 条纪律（`inline` 已被写入 = 注入已生效）**被搬进注入自身**当运行时信号。
否则过渡态里 `innerBig` 失真的容器会被 `isCB` 抢先写成白、下一轮再抹回 ⇒ 正是本次要消灭的翻转。
React 换节点后内联为空 ⇒ 闸门关闭、走保守路径（原生白瞬时露出 ≈400ms，属 §10.1 已登记的
`QA-A32` 既有行为，**不是翻转**；只要永不写不透明，下一轮必回 transparent）。

**C. `isCB` 迟滞：连续两轮成立才写不透明**

```js
if (innerBig <= 2) { isCB = (e.__cbOk === 1);        // ★ 单轮命中不落地
  if (!isCB) requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!e.isConnected) return;
    if (_cbn(e) <= 2) { e.__cbOk = 1; apply(); }     // 复核通过才写
  }));
} else { e.__cbOk = 0; }                              // 撑开就清标记，下次重新两轮
```

已确认过的元素不再排复核 ⇒ `apply()` 不自激；过渡态只要有一帧被后代撑开就不落地；
稳定态内容块两帧后仍是 2，代价只是多 ≈32ms。

### 11.4 修法 D（lead 裁定①，本轮追补）：内容叶子判据 `isCode`

B 的单向写把**聊天正文里的大代码块**也压成 `transparent` ⇒ v1.32.13 的修复被吃掉、既有断言
「聊天代码块 alpha=1」会 FAIL ⇒ 裁定本轮就修，且**不得用类名**（别再制造第二次腐烂）。

```js
isCode = (e.tagName === 'PRE') || 直接子节点里有 PRE      // 等价 :scope > pre
```

- 在 `isLayout` **之前**求值；命中 `isCode` ⇒ **不算布局链** ⇒ 走 `isCB`（带 C 的两轮迟滞）
  ⇒ 恢复原生不透明。
- ⛔ **深度边界就是判据本身**：当年被实测否决的是「**后代**含 `pre`/`code`」——聊天根的**深层**
  后代里也有 `pre`/`code`（整棵聊天树含代码块）⇒ 会把布局容器判成内容叶子 ⇒ 写不透明
  ⇒ 复现 v1.32.6（§9.3 实测 `wouldChange` 从 1 变 2 且含布局容器）。真机给了这条深度差：
  `_block_7gxqk_4 md-code-block` 的**直接子节点**就是 `pre`（331x524 里套 320x500），
  而聊天根里的 `pre` 在 ≥3 层深 ⇒ **MUST NOT 顺手改成 `querySelector('pre')`**。
- 实现用 `e.children` 手挑，不用 `querySelector(':scope > pre')`：语义完全等价，但不依赖选择器
  引擎 —— 老 WebView 遇到 `:scope` 抛 SyntaxError，而这段注入没有 try/catch，一处抛异常整段全废。
- **诚实登记**：主循环的选择器列表 `div,main,section,header,aside,nav,button,textarea,input,ul,li`
  **不含 `pre`/`code`** ⇒ `tagName==='PRE'` 那一臂当前是**防御性**的（`pre` 本身不会被访问到），
  真正起作用的是「直接子节点有 PRE」⇒ 命中的是代码块卡片 `_block_7gxqk_4`，正是 v1.32.13 的目标。

### 11.5 本轮二次返工修掉的两个**自身**缺陷（合成 DOM 实测出来的，不是推测）

1. **三方环形依赖死锁**：`isCB` 以 `pm` 非空为前提 + B 把「剥内联读原生」收窄成
   `(isPanel || isCB)` + 内容块第一轮被兜底分支写成 `transparent`
   ⇒ 第二轮起 `a0=0` ⇒ `pm=null` ⇒ `isCB=false` ⇒ 剥内联不解锁 ⇒ `pm` 永远填不上
   ⇒ **聊天代码块永久停在 transparent**（v1.32.13 回归）。
   修法：`isCB` **先算**且**不以 `pm` 为前提**（只要求 `big` 且不在布局链 / 定位面板 / 侧栏根 /
   veil），再由它解锁剥内联，`pm` 由原生色填充。v1.32.13 不暴露这个坑，是因为它的剥内联入口
   是宽的 `big && !isAnchor`。
2. **O(N²) 自激**：每个候选各排一对 rAF、复核通过各自重跑 `apply()` ⇒ 首屏稳定态闸门对所有大元素
   都是关的、候选可达数十个 ⇒ `apply()` 次数平方级（实测 41 个候选把合成 DOM 跑到 **heap OOM**，
   真机等于 ANR）。修法：**每轮一批**收集 `cand[]`，循环外只排**一对** rAF，复核通过的批量置
   `__cbOk=1` 后**只重跑一次** `apply()`；重跑那轮它们已是 `isCB=true` ⇒ 不再进 `cand` ⇒ 收敛。
   修后 8 场景 × 9 轮 **17ms** 跑完。
3. 顺带：`isCB` 必须**同时排除侧栏根与 veil**（此前靠 `pm` 非空间接挡住）。放开 `pm` 前提后，
   veil 会进候选 ⇒ 被兜底分支写 `transparent`（0.45 纱罩消失）；侧栏根会进候选 ⇒ 被剥内联
   ⇒ 0.92 被抹成原生 1.0。两处都已显式排除（S7 实证 0.92 / 0.45 保住）。

### 11.6 合成 DOM 对照实验（本轮实测，**非真机**；harness `glass-sim.mjs` + `glass-scen.mjs`）

视口 360x671。**过渡态**（`innerBig` 在 r3 前 = 0、r3 起挂上 30 行消息）：

| 元素（现行 bundle 类名） | v1.32.14 注入 | v1.32.15 注入 |
|---|---|---|
| `_frame_6nhg2_1` | `rgb(255,255,255)` → r3 抹回 `transparent`（**1 次翻转**） | 全程 `transparent`（**0 翻转**） |
| `_root_5aaaa_1` | 同上（1 次翻转） | 全程 `transparent` |
| `_tabHost_6nhg2_162` | 同上（1 次翻转） | 全程 `transparent` |

九个场景 9 轮，**r1 之后可见翻转全部为 0**（S9 修前除外，见该行）：

| 场景 | 关键结果 |
|---|---|
| S1 聊天稳态 | 布局链 `transparent`；**聊天大 PRE 卡片 `rgb(249,250,251)`**；小代码块 `0.45`；输入卡 `0.45`；veil 未被触碰 |
| S2 文档面板打开 | `panelTab rgb(255,255,255)`（v1.32.12）；面板内代码块 `rgb(249,250,251)`（v1.32.13）；底层布局链仍 `transparent` |
| S3 slash 菜单 | `role=listbox` 层 `rgba(255,255,255,0.96)`；无 role 的高浮层仍 transparent（§1.6 已登记遗留，未变） |
| S4 过渡态 | 三个容器 0 翻转；代码块仍收敛到 `rgb(249,250,251)` |
| S5 换节点（内联清空） | 0 翻转；代码块仍回到不透明 |
| S6 旧 bundle 类名 | `BynINW_frame` / `BynINW_centerCol` / `Dc7zOa_root` 仍 `transparent`；代码块不透明（老宿主不回归） |
| S7 窄屏侧栏 | 展开态 `0.92`、收起态 `0.45` 均保住 |
| S10 卡片经一层 `display:contents` 包裹层套 PRE（真机笔电形态） | **修前** `transparent`（复现真机 D1）；**修后**（isCode 按盒树判）`rgb(249,250,251)`、0 翻转 |
| S11 首帧矮（0.45）→ r3 长高 | 修前后都 `rgb(249,250,251)`、1 次收敛 ⇒ 与 S10 对照即「**首帧高度决定命运**」（修前：同一张卡片首帧 big→透明、首帧矮→不透明） |
| S12 红线探针：聊天根只有**一个**大后代行（innerBig≤2） | 修前后聊天根 / tabHost 均 `transparent`、0 翻转；**若连兜底分支的所有权标记一起去掉（C1 变体）则被写成 `rgb(255,255,255)`** ⇒ 触碰 v1.32.6 红线 |
| **S9 卡片每轮换节点（D1 回归）** | 模拟虚拟化列表回收：每轮把代码卡片换成全新 DOM 节点。**修前**（迟滞仍管 isCode）最终 `transparent`、1 次翻转 ⇒ **复现真机 D1**；**修后**（isCode 免迟滞）最终 `rgb(249,250,251)`、**0 翻转** |
| S8 PRE 直接挂在聊天根下 | 聊天根被判成内容卡片 ⇒ `rgb(255,255,255)`。**这是「只看直接子节点」的语义本身**，真机聊天根在 ≥3 层 ⇒ 不命中（S1/S6 实证） |

### 11.7 已登记风险与下一轮（lead 裁定）

| 条目 | 处置 |
|---|---|
| a) 阅读面板若改成 `position:relative` 全屏层 ⇒ `isLayout` 先命中 ⇒ v1.32.12 回归 | **接受**为已登记风险；注释写死「面板 = 定位覆盖层」是当前实测事实；tester 已把「文档预览面板不透明」列为红线断言 |
| d) 页面自己写 inline `transparent` ⇒ 永久锁透明 | **接受**；注释写明，`isCode` 是唯一出口 |
| e) 整棵聊天塞进全屏 absolute/fixed 壳 ⇒ 整棵子树判成面板 | **接受**；缓解在注释（那层壳自身也会被判 `isPanel` 并拿原生 1.0） |
| c) `position:sticky` 的布局容器不算布局链 ⇒ 可被写不透明 | **下一轮**（与 ② 同属侧栏那条线） |
| ② 窄屏侧栏 `_2H3hWW_root` 补丁**已腐烂**（现行 bundle 0 命中 ⇒ `bwPanelBg` 0.92 与 `skipBg` 空转） | **已腐烂、待下一轮换结构判据**（要真机窄屏才能测 `position`，本轮不扩面）；本轮代码未动 |
| 主循环选择器不含 `pre`/`code` | 登记：`isCode` 的 PRE 臂当前是防御性；若哪天把 `pre` 加进列表，0.45 档要重测 |
| **DOM 类名前缀按宿主不同**（v1.32.15 QA 实测，本轮未改代码）：笔电 DOM 里 `BynINW_`=6、`_2H3hWW_root`=1、`Dc7zOa_root`=1 **仍在**；vm1 DOM 里是 `hHd-Xa_` / `wSkVaW_` / `pI_x6G_` / `P3OORG_` / `_6nhg2_`，旧名 **0 命中**。**而两侧服务的静态 bundle 逐字节相同**（同名同哈希、1,476,240 B）⇒ 类名前缀**不是构建期固定的**，疑似按安装/启动生成 ⇒ 「绝不用类名哈希当决定性闸门」这条纪律比原先认定的更硬（同一份 bundle 在不同机器上渲染出不同类名） | **已登记**，纪律见 §11.8-6 |
| D2：vm1 上窄屏补丁整体空转——侧栏展开不是覆盖层而是**挤压布局**（中列 304→80px）、0.92→0.45、`skipBg` 空转。**新证据（本轮 QA）**：vm1 展开侧栏时代码块被压到 **9x4975（9px 宽）**、收起后恢复 233px ⇒ 这不是观感问题而是**功能性破坏**；QA 侧已改为「测大代码块前先收侧栏」 | **v1.32.16 议题**，本轮不动（与上面 `_2H3hWW_root` 腐烂同属一条线） |
| D3：`_emptyTabHost_6nhg2_143` 在 `visibility:hidden` 时被写不透明白 | 当前无视觉影响；上游一旦把它显示出来就会盖住壁纸 ⇒ 登记，改判据时要考虑 `visibility`/`content-visibility` |
| D4 / D5：QA 探针自身的问题（D4 已修） | 与注入无关，记录在 `verify/QA-ROUND-v1.32.15.md` |

### 11.8 纪律追加（接 §10.5，这段注入的后续改动都要遵守）

6. **类名哈希是"会腐烂的键"**：跨版本保证 MUST NOT 把 CSS-module 哈希当**决定性**闸门
   （换一次上游构建就静默失效，且失效方向不可预测）。类名只可用于**安全侧的显式排除**
   （失效方向=漏修），且 MUST 有结构判据兜底。
7. **对"必须永远透明"的元素，写操作必须单向**：只允许写 `transparent`，永不写回不透明。
   这样判据即使在过渡态误判，最坏也只是"晚一轮透明"，**不会翻转**。
8. **运行时测量必须迟滞**：单轮命中不落地，连续两轮成立才写（2x `requestAnimationFrame`
   或 ≥150 ms 复核）；且 MUST 在测量值回到安全侧时**清除复核标记**。
9. **改判据前先测"判据的键会不会变"**：本轮的键是类名（会变），上一轮的键是 `innerBig`
   （会变但方向已知）—— 只有**几何 + `position` + `role` + 标签父子结构**这几类是跨版本稳定的。
10. **判据之间 MUST NOT 互相以对方的输出为前提**（环形依赖会死锁）：本轮 `isCB` ↔ `pm`
    ↔「剥内联」就是三方环，症状是"修好了的判据静默不生效"，只有跑**多轮**才暴露。
11. **注入里任何"重跑 apply()"都要批处理**：N 个候选各自重跑 = O(N²)（实测 OOM）。一段注入只排一对 rAF、只重跑一次。
12. **迟滞只适用于「测量型」判据，结构型判据 MUST NOT 加迟滞**：`innerBig` 会失真 ⇒ 要两轮复核；
    `isCode`（自身 PRE / 直接子节点 PRE）是标签结构事实 ⇒ 当轮就该落地。给结构判据加迟滞会在
    **虚拟化列表换节点**下永久不落地（`__cbOk` 挂在 DOM 节点上，每轮都是新节点 ⇒ 永远攒不满
    「连续两轮」），真机 D1 就是这么来的（§11.9）。
13. **合成 DOM 的 `requestAnimationFrame` MUST 落在下一个帧边界**（不能在触发它的那一轮里顺手排空）：
    否则「两帧后复核」会在同一帧内完成，测不出「两帧之间节点已被换掉」这一整类缺陷（D1 一开始
    就是这么被 harness 掩盖的：修前也显示不透明）。
14. **判据要关于「渲染盒树」而不是 DOM 树**：DSH 的 DOM 里到处是 `display:contents` 包裹层
    （Blink 对它返回**空矩形**），盒树上的「直接子节点」在 DOM 里可能是孙节点。本轮 D1 笔电失败
    的直接原因就是 `isCode` 只看 `e.children`。但 MUST NOT 用「矩形 0x0」反推「这是 contents
    包裹层」——0x0 也可能是折叠容器；只读 `getComputedStyle(child).display === 'contents'`。
15. **合成 DOM 的结果一律标「合成」**，MUST NOT 写成「真机实测」。本轮 D1 多跑一轮的直接原因：
    上一轮把**合成 DOM** 的 331x524 套 320x500 写成「真机 _block_7gxqk_4 直接子节点就是 pre」，
    于是「只看直接子节点」这条边界被当成已被真机背书，没人去查真机的真实层级（233x410 套
    233x368、中间隔一层 display:contents）。写结论前先分清证据来源。

### 11.9 D1（真机 QA P1）：结构判据被迟滞卡住 ⇒ isCode 免两轮复核 + QA 探针

> ⚠ **本节「根因」已被下一轮真机取证推翻**（`verify/QA-ROUND-v1.32.15-D1.md` + `__qaCb` 读数：
> 两侧 `nodeSeq` 在稳定态恒定 ⇒ 没有换节点）。真根因见 **§11.10**。`isCode` 免迟滞与 `__qaCb`
> 探针两项改动**保留**（探针正是定案的关键证据），但「虚拟化换节点」这个解释**作废**。

**真机现象**（`verify/QA-ROUND-v1.32.15.md`）：`pre` 自身 `rgb(249,250,251)` 正常，但承载卡片底 +
头部条的容器 `_block_7gxqk_4 md-code-block`（233x410、原生 `rgb(249,250,251)`）被写成
**`transparent !important`**，8 次采样稳定、4 次独立运行复现。取证：该元素 `innerBig=1`（唯一大后代
是 233x368 的 `pre`）、`isCode=true`、`isLayout`/`isPanel`/`isOv` 全 false ⇒ 按判据应进候选、
两轮后写不透明，实测没发生。**合成 DOM 里同场景（innerBig=2）已恢复不透明，真机 innerBig=1 更宽松
却不落地 ⇒ 分歧不在阈值，在时序。**

**根因（tester 推断 + 合成 DOM 证实）**：`__cbOk` 挂在 **DOM 节点**上，而聊天列表是**虚拟化**的
（回收/重建节点）⇒ 每轮看到的都是新节点 ⇒ `__cbOk` 每轮归零 ⇒ **永远攒不满「连续两轮」**；
同时兜底分支当轮就把卡片写成 `transparent`、不透明写要晚一轮 ⇒ 长期停在 `transparent`。

**修法**：命中 `isCode` 的元素**免两轮迟滞**，当轮即允许原生不透明回写（`isCB=isCode||(__cbOk===1)`）。
为什么不会把 FINDING-1 放回来：

- FINDING-1 的失真面是「**布局容器**在渲染中途 `innerBig` 临时掉到 ≤2」；`isCode` 是**标签结构**事实、
  不是测量，且它排在 `isLayout` / `isPanel` 之后，两者已把布局容器与定位面板排除。
- 内容叶子被写的值是它**自己的原生色相**（只取决于自身 CSS，不随后代增减而变）⇒ 早一轮写与晚一轮写
  **同一个值**，不存在可翻转的第二值；FINDING-1 的翻面恰恰来自「先写白、下一轮判成布局链再抹回透明」。
- 仍有两道闸：`innerBig<=2`（防「直接子节点有 PRE 但里面还套着几层大容器」的容器）与
  「原生必须真的不透明」（`pm` 为空则不写）。

**QA 探针（只读、不参与判定）**：每轮把进入候选集的元素导出到 `window.__qaCb`，字段
`{cls, innerBig, cbOk, nodeSeq, isCode, isCB}`；`nodeSeq` 是注入侧给每个 DOM 节点发的**自增身份号**
（`window.__qaN` 计数），**换节点就换号** ⇒ 同一元素两次采样号不同即证明它被 React 换过
（`__cbOk` 与 `nodeSeq` 一起丢，正是 D1 的指纹）。复核通过时把对应记录的 `cbOk` 置 true。

**harness 忠实化（本轮一并修）**：`flushT()` 原先在结尾顺手排空 rAF ⇒ 「两帧后复核」在**同一帧**内
完成 ⇒ 修前也显示不透明 ⇒ D1 被掩盖。改成 rAF 只在**下一个帧边界**跑（下一轮 `round()` 的
`flushRaf()`，且发生在 `mutate()` 换节点之后）⇒ S9 修前 `transparent`（1 翻转，复现真机）、
修后 `rgb(249,250,251)`（0 翻转）。其余 8 个场景修前/修后**逐项相同、0 翻转** ⇒ 免迟滞没有副作用。

### 11.10 D1 真根因（真机取证定案）：isLayout **自锁** + isCode 在真机上不成立

**推翻的东西**（我上一轮的假设，被 `__qaCb` 读数直接否掉）：「聊天列表虚拟化换节点 ⇒ `__cbOk`
丢失 ⇒ 攒不满两轮」。实测两侧 `nodeSeq` 在稳定态**恒定**（笔电 20、vm1 23），`__qaN` 分别 48 / 41
⇒ 稳定态**没有换节点**。（流式 / 回收期可能仍存在，但测不到，不构成 D1 的成因。）

**真根因两条，缺一不可**：

1. **isLayout 自锁**（纪律 10 的又一次违反：判据读我们自己的输出）。卡片首轮 `a0=1`（原生不透明）
   ⇒ 幂等闸门 `a0<1` 不成立 ⇒ 不 continue ⇒ 落到**大容器兜底分支**当轮写 `transparent`；而
   `inline==='transparent'` 正是 isLayout 的进入条件 ⇒ 下一轮起 isLayout 恒真 ⇒ 再也进不了 isCB
   求值分支（它要求 `!isLayout`）⇒ **稳定停在错值**（笔电 8 次采样 0 翻转、6 次运行复现）。
   `__qaCb` 的指纹：卡片从第 1 轮起就**不再出现在候选集里**（合成 DOM 复现，见下表 V0 三行）。
2. **isCode 在真机上不成立**：卡片 DOM 直接子节点是 `_bannerWrap_7gxqk_`（233x42）+
   `_content_7gxqk_74`（**0x0**），PRE 在 `_content_` 里 = **孙节点**；0x0 是 Blink 对
   `display:contents` 返回的空矩形 ⇒ 盒树上 PRE 像直接子节点、DOM 上不是 ⇒ 只看 `e.children`
   必然 false ⇒ 没有东西绕开 isLayout ⇒ 锁形成。

**vm1 为什么 PASS**：首帧只有 ~220px（没过 `vh*0.5`=335.5）⇒ 走 0.45 分支 ⇒ inline 是
`rgba(…,0.45)` 而非 `transparent` ⇒ isLayout 闸门关着 ⇒ 长高后正常进 isCB ⇒ 候选 → 复核 →
`__cbOk=1` → 写 `rgb(249,250,251)`。**首帧高度决定命运**，与 FINDING-1 同一类：瞬态几何决定
永久状态。合成 DOM 用 S10 / S11 这一对场景把它复现了出来（同一张卡片，只差首帧高度）。

**修法（本轮）**：
- **A**：`isCode` 按**渲染盒树**判 —— 从直接子节点扫 PRE，遇 `display:contents` 包裹层就下钻，
  **上限 2 层**；整段扫描包在 `if(big)` 里（两个消费者都要 big）。MUST NOT 用 0x0 矩形反推。
- **B**：`isCode` 排在 `isLayout` 之前且 isLayout 带 `!isCode`（原有），修 A 后**首轮即命中**
  ⇒ 锁根本不形成。实测（合成 DOM，S10 第 1 轮探针）：`innerBig=2, isCode=true, isCB=true,
  cbOk=false` ⇒ 首轮就进候选并当轮落地（免迟滞，见 §11.9）。
- **C**：拆自锁 —— isLayout 进入条件从「inline 是我们写的 transparent」改为读注入自己的
  **所有权标记** `e.__dshGlass`（写 transparent 的两条分支置 1，写不透明 / 浮层 / 0.45 的分支置 0）。
  **保留**「兜底分支也打标记」⇒ 锁的语义（稳定态闸门，防过渡态被 isCB 抢先写白）不变，只是
  不再读页面可见的 inline。标记随换节点丢失，但 inline 同样会丢 ⇒ 不比现状差。
- **D**：合成 DOM 加 S10（`display:contents` 维度）+ S11（首帧高度）+ S12（红线探针）。

**四变体对照（合成 DOM 360x671，9 轮；非真机）**：

| 变体 | S10 卡片（笔电形态） | S11 卡片（vm1 形态） | S12 聊天根 / tabHost | S2 面板打开时 chatRoot/tabHost | S3 frame | S7 frame | S4 tabHost |
|---|---|---|---|---|---|---|---|
| V0 = 4a039ab（修前） | `transparent` ✗ | `rgb(249,250,251)` f1 | transparent | transparent | transparent | transparent | transparent |
| V1 = 只修 A | `rgb(249,250,251)` ✓ | `rgb(249,250,251)` f1 | transparent | transparent | transparent | transparent | transparent |
| V4 = 只修 C | `transparent` ✗ | `rgb(249,250,251)` f1 | transparent | transparent | transparent | transparent | transparent |
| **V2 = A + C（本轮采用）** | `rgb(249,250,251)` ✓ | `rgb(249,250,251)` f1 | transparent | transparent | transparent | transparent | transparent |
| V3 = A + C1（兜底**不**打标记） | `rgb(249,250,251)` ✓ | `rgb(249,250,251)` f1 | **`rgb(255,255,255)`** ✗ | **`rgb(255,255,255)`** ✗ | **`rgb(255,255,255)`** ✗ | **`rgb(255,255,255)`** ✗ | **1 次翻面** ✗ |

读法：
- **A 才是 D1 的解**（V1 / V2 修好 S10；V4「只修 C」修不好 ⇒ C 单独不解决 D1）。
- **C 在 12 个场景里与 V0 / V1 逐项相同、0 翻转** ⇒ 它是**行为中性**的重构，价值在于消掉
  「判据读自己的写入」这个自指（纪律 10）与「页面改写我们的 inline 就解锁」的耦合。
- **C1（连兜底标记一起去掉、彻底拆锁）会把 v1.32.6 红线放回来**：4 个场景里布局容器被写成
  不透明白（壁纸整层消失），并在 S4 放回 1 次过渡态翻面（FINDING-1 症状）。⇒ 本轮**不**采用 C1。
- 其余场景（S1 / S5 / S6 / S8 / S9）四个变体逐项相同，既有 4 条保护（面板 1.0 / 内容块 1.0 /
  浮层 0.96 / 小元素 0.45）与窄屏侧栏 0.92 / 0.45 均未动。
