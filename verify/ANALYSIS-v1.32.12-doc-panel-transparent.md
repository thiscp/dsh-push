# ANALYSIS v1.32.12 —— 文档预览面板透明：侦察记录与判据（lead 侧，边写边补）

> **对象**：用户反馈「**对话生成的文档，我打开后背景也是透明的**」（2026-10-15 01:17 真机截图）。
> **性质**：与 v1.32.11（slash 菜单浮层）**同属一类**（玻璃化注入的可读性），但**具体元素与修法必须重新侦察**。
> **维护**：lead。developer 的侦察原始输出与结论**回填到 §2**；lead 的裁定写 §3/§4。

---

## 1. 现象与对象钉死（先别猜错对象）

| 项 | 内容 |
|---|---|
| 用户原话 | 「对话生成的文档，我打开后**背景也是透明的**」（"也" = 承接上一轮 slash 菜单那个问题）|
| 截图 | `F:\work\work_dsh\tmp\shots\qa\v1.32.12-before-user-doc-transparent.jpg`（524,038 B）|
| 截图抬头 | `F:\work\work_dsh\story_meizijiu.md` + `Markdown` + 刷新按钮 + **`+5 -5` 变更计数** |
| ⇒ 对象 | **文件预览 / 差异（diff）查看面板** —— 即对话里生成文档后点开看到的那个阅读面板 |
| 症状 | 面板**整体无实底**：底层页签栏（`第2轮改动 询问模…`）、聊天正文、**以及文档自身多段文字**互相叠印 ⇒ 长文阅读**严重发花** |

**被测文档**：`F:\work\work_dsh\story_meizijiu.md`（7,493 B，真实存在于对话工作目录）。

---

## 2. developer 侦察结果（**已回填，2026-10-15 01:2x**）

> 侦察探针：`tmp/doc-reveal.mjs`、`tmp/doc-population.mjs`、`tmp/doc-discriminator.mjs`
> （**全程逐层临时移除内联后原样还原，`restoreAllOk=true` 已断言**）。
> 原始输出：`tmp/overlay/rev.json`（剥内联看原生）｜`pop.json`（**57 个大容器**枚举）｜`disc.json`（判据求值）。
> 截图：`tmp/overlay/recon-panel.png`（面板已打开、复现症状）、`tmp/overlay/doc-panel2.png`。

### 2.1 对象与几何（必答 1/4）

**被注入的那一层**：`SECTION._tabHost_6nhg2_162 _pane…` = **`360x671`（100%×100%）**。

**算术**（视口 `vw=360 vh=671` ⇒ 阈值 `180 / 335.5`）：
`360 > 180` ✓ **且** `671 > 335.5` ✓ ⇒ **`bigContainerBranch = true`** ✅
⇒ **首要嫌疑成立；次要嫌疑（0.45 太薄）排除** —— 本屏 `injected045 = 0`，面板**不是 0.45，是 `alpha=0`**。

**祖先链**（自 `Markdown` 徽标向上，实测）：
```
BUTTON.TdjKvG_tool.TdjKvG_viewerTool   68x28
SPAN._root_4ub78_1                     68x28
DIV.TdjKvG_header                      360x38      ← 抬头（文件名 + Markdown + 刷新 + ±）
DIV.TdjKvG_preview                     360x633     99.9% × 94.3%
DIV.OUqwTW_tabBody                     360x633
DIV._tabHostBody_6nhg2_181 _paneBody…  360x633     ovfY=auto（内层滚动容器）
SECTION._tabHost_6nhg2_162 _pane…      360x671     100% × 100%   ← ★ 被注入的层
DIV._tabCell_6nhg2_142                 360x671     z=40
DIV._tabLayout_6nhg2_134               360x671
DIV._surface_6nhg2_125                 360x671
DIV.OUqwTW_panelBody                   360x671
DIV.OUqwTW_panel  position:absolute     360x671     ← 全屏覆盖面板（定位上下文）
```
> 其余同尺寸层（`_tabCell`/`_tabLayout`/`_surface`/`_panelBody`/`_panel`）**只有 `_tabHost` 被写了内联**。

### 2.2 computed vs 内联（必答 2，决定性）

```
SECTION._tabHost_6nhg2_162   inline = transparent !important    ← 被注入
                             computed = rgba(0,0,0,0)  alpha=0
```
**整条祖先链只有这一层有内联背景**，其余各层 `inlineBg` 均为空（未被碰）
⇒ **面板"无实底"的唯一原因就是这一层被写成 `transparent`**。

### 2.3 ★ 剥掉内联看**原生**背景（决定性交叉验证）

对链上每层**临时移除**内联 `background-color` 再读 computed（读完逐层还原，`restoreAllOk=true`）：
```
SECTION._tabHost_6nhg2_162   NATIVE_bg = rgb(255,255,255)   nativeAlpha = 1   ← 应用自己的不透明阅读底
其余 13 层                    NATIVE_bg = rgba(0,0,0,0) 或本就透明
```
⇒ **`_tabHost` 原生是纯白不透明**（应用设计就是纯白阅读页），**被我们的注入抹成全透明** —— 这就是用户看到的症状。

**必答 3 的其余项**：整条链 `background-image` **全为 `none`**；`::before/::after` 的 `content` 均为
`none`/空、`background-color` 均 `rgba(0,0,0,0)` ⇒ **没有渐变底/伪元素底，就是一层纯色被抹掉**。
（"只读 `backgroundColor` 会漏渐变底"这个坑确实真实存在，只是**本例不涉及**；已按要求两项都量。）

### 2.4 ⚠️ 陷阱：**不能用"原生不透明"作判据**（会让修法踩回 v1.32.6）

同屏**所有大容器**（**57 个**）做同样的"剥内联看原生"枚举：
```
cls                              尺寸      pctW/pctH   内联            原生              锚点?
BynINW_frame                     360x671   100/100     transparent     rgb(255,255,255)  ★锚点
Dc7zOa_root                      304x671   84.4/100    transparent     rgb(255,255,255)  （聊天根）
_tabHost_6nhg2_162               360x671   100/100     transparent     rgb(255,255,255)  ← 就是 bug
_block_7gxqk_4 md-code-block     331x524   91.8/78.1   transparent     rgb(249,250,251)  （大代码块）
```
**`BynINW_frame` 原生也是 `rgb(255,255,255)`** —— 与坏掉的面板**一模一样**。
⇒ 任何"原生不透明 ⇒ 给回不透明"的判据**会同时把 `BynINW_frame` 变不透明 ⇒ 多层白叠 ⇒ 壁纸整层消失
= 直接复现 v1.32.6**。**这就是必须用结构判据、不能用颜色判据的原因。**

### 2.5 可区分判据（必答 5）——**实测已验证安全**

**判据 `isFullScreenPanel(e)`**：自身 `position ∈ {absolute, fixed}`，**或**祖先 **8 层内**存在
`position ∈ {absolute, fixed}` **且**覆盖 **≥90%×90% 视口**的元素。

**理由**：文档阅读面板是**绝对定位的全屏覆盖层**（`OUqwTW_panel` = `absolute` 100%）；
而壁纸通道（`BynINW_frame`/`centerCol`/`Dc7zOa_root`）是 **static/relative 的常规布局**。

**实测求值**（同屏全部大容器）：
```
panelFlagged = 10 个（面板链各层 + BynINW_overlayLayer）
wouldChange  =  1 个   ← 恰好且仅有 _tabHost_6nhg2_162（就是 bug 那一层）
BynINW_frame      panelFlag = False   ← 壁纸通道安全
BynINW_centerCol  panelFlag = False   ← 安全
Dc7zOa_root       panelFlag = False   ← 安全
```
唯一被误标的 app 锚点是 `BynINW_overlayLayer`（自身 `absolute` 100%），由**两条独立护栏**挡住：
① 判据显式排除 `BynINW_*`；② 它原生 `alpha=0`（本就没有底色）⇒ 即便误标也不改变行为。

### 2.6 差异视图 vs 阅读视图；固定高 vs 随内容增高（必答 6）

- **同一容器**：`+5 -5` 抬头在 `TdjKvG_header`、正文在 `TdjKvG_preview`，两者同属 `_tabHost`
  ⇒ **差异视图与普通阅读视图共用同一层，一处修好两者都好**。
- **固定高 + 内层滚动**：`_tabHost` `360x671`（100%×100%，`overflow:hidden`，钉死视口），
  内层 `_tabHostBody` `overflow-y:auto`。**关键区别**：面板**关闭时该层是 `0x0`**
  ⇒ 它**只在有标签页打开时才撑满视口**，这是它与"常驻大容器"的重要差异。

### 2.7 改前红线基线（实测，作为对照）

```
frame=rgba(0,0,0,0)   centerCol=rgba(0,0,0,0)   html=rgba(0,0,0,0)   body=rgba(0,0,0,0)
veil=rgba(255,255,255,0.45)    card(RlGAzG_card)=rgba(255,255,255,0.45)
sidebar(_2H3hWW_root, 收起态)=rgba(249,250,251,0.45)
```

### 2.8 已知未覆盖：聊天里的**大代码块**

`_block_7gxqk_4 md-code-block`（`331x524`，`91.8% × 78.1%`）**同样被大容器分支抹成透明**、
**同样影响可读性**，但它**不是**全屏定位面板 ⇒ **新判据不覆盖它**。
**lead 裁定：本轮不修**（不夹带扩大改动面；要修需另立判据、风险更高），但要求
**在验证探针里加常驻断言**（打出它的 computed/native）并**作为已知遗留登记**（见 §3.4）。

---

### 2.9 developer 落地结果（0.96 版，装机后复测）

**APK**：sha256 `01e24af7271cb94cac1ba159ddbdeb38c8966f5de220e64e706686ca720c7722`（10,992,948 B）；
`dumpsys` → **`versionCode=78` / `versionName=1.32.12`**；三处同步 ✅；
档位 `emu-gpu-verdict.ps1` **exit 0**（真 GPU）。

**关键 diff（+47 行，只动这段注入）**：
```js
"var big=(w>vw*0.5&&h>vh*0.5);"
"var isAnchor=cn.indexOf('BynINW_')>=0||cn.indexOf('_2H3hWW_root')>=0;"
"var isPanel=false;"
"if(big&&!isAnchor&&e.id!=='dsh-theme-veil'){"        // ③ veil 按 id 排除
  // 自身 absolute|fixed ⇒ 命中；否则上溯 ≤8 层找"absolute|fixed 且 ≥90%×90% 视口"的祖先
"}"
"var a0=(m[4]!==undefined?parseFloat(m[4]):1);"
"if(!isOv&&!(big&&isPanel)&&a0<1)continue;"           // ★ 幂等闸门必须给面板放行（否则一次性固化）
"var pm=(a0>=1?m:null);"
"if(big&&isPanel&&a0<1){ /* 临时摘内联读原生色相 nx，nx 有底则用，否则还原 */ }"
"if(isOv&&(ovRole||!(w>vw*0.5&&h>vh*0.5))){ ...浮层 0.96，一字不动... }"
"else if(big&&isPanel&&pm){ setBg('rgba('+pm[1]+','+pm[2]+','+pm[3]+',0.96)'); }"  // ★ 新增
"else if(w>vw*0.5&&h>vh*0.5){ setBg('transparent'); }"                            // 通道仍全透
"else if(!skipBg){ ...0.45... }"
```
**两个非显然但必需的细节**（developer 自己发现，值得记）：
1. **幂等闸门必须给面板放行**：面板上一轮已被写成 `transparent`（`a0=0`），若沿用原闸门
   `if(!isOv && a0<1) continue` 会**直接跳过** ⇒ **一次性固化**永远修不回来；
2. **必须取"原生"色相**：`m`（computed）已是 `rgba(0,0,0,0)`，拿它当色相会写出**透明色** ⇒
   需**临时摘掉内联读原生**（读到 `rgb(255,255,255)`）再还原（`restoreOk=True`）。

**CDP 实测（`doc-final.mjs`，装机后重新起页）**：
```
PANEL _tabHost_6nhg2_162  360x671  pctW=100 pctH=100
      bg=rgba(255,255,255,0.96) alpha=0.96  inline !important
      NATIVE=rgb(255,255,255) nativeAlpha=1  restoreOk=True
      arith: wGt=true hGt=true        ← 仍在"大容器"区间，靠 isPanel 救回
红线  frame/centerCol/Dc7zOa_root/html/body = rgba(0,0,0,0)  ← 壁纸通道未误伤（其原生同为 rgb(255,255,255)!）
      veil=rgba(255,255,255,0.45)  card=rgba(255,255,255,0.45)  侧栏 收起0.45 / 展开0.92
常驻断言 codeBlock: alpha=0 inline=transparent NATIVE=rgb(249,250,251) 331x524   ← 本轮不修
checks = 10/10
```
**截图**：`tmp/overlay/v13212-panel.png`（739 KB）。

### 2.10 本轮新踩的两个**探针陷阱**（已进 `GLASS-OVERLAY.md` §8.4）

1. **`[class*='_tabHost']` 有 6 个匹配**（含 `0x0` 占位）⇒ `querySelector` 会拿到 `0x0` 那个，
   把"**面板其实开着**"误报成"**没打开**"。**必须扫全部匹配取最高**（与 v1.32.5 侧栏同类陷阱）。
2. **截图路径不能当第 3 个 argv 传**：`overlay-run.ps1` 只传 `(outJson, tag)`，第 3 个参数恒空
   ⇒ 截图**被静默跳过**，却会得出"截不到图"的错误结论（v1.32.11 已这样误报过一次）。**路径必须硬编码。**

---

### 2.11 ✅ 冻结 build 三方对齐（lead 独立实测，2026-10-15 01:4x）

**commit 源码 ↔ 构建产物 ↔ 设备 `pm path`** 三者一致：

| 来源 | sha256 | 备注 |
|---|---|---|
| **vm1 构建产物** `app-debug.apk` | **`0acc7f35…`** | mtime `01:42:35` |
| **笔电 `G:\Android\dsh-push.apk`** | **`0ACC7F35…`** | `10,992,932 B` |
| **设备 `pm path` → `sha256sum base.apk`** | **`0acc7f35…`** | `versionCode=78` / `versionName=1.32.12` |

**⇒ 三方逐字节一致 ✅**（这是 v1.32.11 血泪纪律要求的对齐）。

**决定性 DEX 校验**（lead 独立跑，比看哈希更硬）：
```
isPanel&&pm in DEX    : 1     ← 1.0 版面板分支确实在字节码里
BynINW_ in DEX        : 2     ← 护栏2（锚点排除）在
dsh-theme-veil in DEX : 1     ← 护栏3（veil 按 id 排除）在
```
源码侧同行亦确认 **`rgb('+pm[1]+','+pm[2]+','+pm[3]+')'`（无 alpha 后缀 ⇒ 即 `1.0`）**。

> **注意**：developer 上一份报告里的 `01e24af7…`（10,992,948 B）是 **0.96 版**，**不是**冻结目标；
> 本轮的冻结哈希是 **`0acc7f357edce617fac751f807733b9b217bc0b398815488973c085fa24fa756`**。
> **⇒ 这正是 §2.10 与 `README` 里"哈希必须与采样同刻、别用旧报的哈希"那条纪律的又一处现场。**

---

## 3. lead 裁定（2026-10-15 01:3x–01:4x）

### 3.5 ★ 升级裁定：**0.96 → 1.0**（触发我自定的升级规则）

**我亲自 `read_image` 看了** `tmp/overlay/v13212-panel.png`（0.96 版整页图）：
- ✅ 面板**已是实底**，标题/正文清晰；用户投诉的"**三层层叠**"已消失；
- ⚠️ **但也能辨认出底层淡影**：面板空白处可见底层聊天正文的
  `判据 + 一条命令 + 自测夹具 + 事故复盘`、`四件现在都在 skill 里了；下次任…` 等淡字。

⇒ 按 §3.2 我预先定下的规则（**"整页肉眼判若有任何可辨识透字 ⇒ 直接升 1.0"**），**升级成立**。

**理由（不只是"更不透明"）**：
1. **应用原生就是 `rgb(255,255,255)` 不透明纯白阅读页** ⇒ `1.0` 是**还原原生设计**，而 0.96 是**我们叠加的近似**；
2. **这是整页长文阅读面板，不是菜单/浮层** —— 阅读面板的唯一职责是**长时间舒适阅读**；
   浮层是"短暂浮在内容上、需要一点空间线索"，两者诉求不同 ⇒ **不必与浮层同档**；
3. 三道护栏（`isPanel` 结构判据 ＋ `nativeOpaque` 前置 ＋ veil/锚点显式排除）与 alpha 取值**正交**
   ⇒ 升 1.0 **不改变任何安全性质**，红线仍由判据保证。


### 3.1 修法：**批准** developer 的结构判据方案

```
var big      = (w>vw*0.5 && h>vh*0.5);
var isAnchor = cn.indexOf('BynINW_')>=0 || cn.indexOf('_2H3hWW_root')>=0;
var isPanel  = 自身 absolute|fixed，或祖先 8 层内有 absolute|fixed 且 ≥90%×90% 视口;
var nativeOpaque = 原生 alpha >= 1;              // ← 必须保留：无底色者不许凭空加底
var isVeil   = e.id === 'dsh-theme-veil';        // ← 显式排除（第三道保险）

if (isOv && (ovRole || !big))                    -> 浮层 0.96        // v1.32.11，一字不动
else if (big && isPanel && nativeOpaque && !isAnchor && !isVeil) -> 面板 0.96   // ★ 新增
else if (big)                                    -> transparent      // ★ 通道仍全透
else if (!skipBg)                                -> 0.45
```

### 3.2 逐条回答 developer 的三个请示

| # | 请示 | 裁定 | 理由 |
|---|---|---|---|
| ① | 用"全屏定位面板"结构特征做判据？ | **批准** | 面板是 `absolute` 全屏覆盖层，通道是 static/relative；实测 **`wouldChange = 1`**（改动面=1） |
| ② | `#dsh-theme-veil` 是否显式排除？ | **批准（按 id 排除）** | veil 是 `fixed` + 100%×100% ⇒ 会被 `isPanel` 命中。**当前**因它由另一段注入自己写死内联而安全，但**不能依赖"另一个注入恰好先写"这种隐式顺序**；将来谁动优先级就会炸 ⇒ **必须显式排除**。`_2H3hWW_root` 一并留在排除里 |
| ③ | alpha `0.96` 还是 `1.0`？ | **先 `0.96`**，**附升级规则** | 0.92 实测"仍能辨出淡影"，而 **0.96 在 v1.32.11 已被实测证明肉眼不再有可辨识叠印**（Part B，7/7）⇒ 0.96 是**有证据的档位**。**但本轮是整页长文阅读面板**，比菜单更吃这个 ⇒ **tester 整页肉眼判若有任何可辨识透字/叠印 ⇒ 直接升 `1.0`**（阅读面板本就该实底，应用原生就是不透明纯白）|

### 3.3 红线（修法为何不碰它们）

| 红线 | 为何安全 |
|---|---|
| **v1.32.6 壁纸通道** | `big && !isPanel` 仍走 `transparent`；实测 `BynINW_frame`/`centerCol`/`Dc7zOa_root` 的 `isPanel` **全为 `False`** ⇒ **行为逐字节不变**（改完仍须实测这四层 + 整页壁纸）。`isAnchor` 是**第二道保险** |
| **v1.32.5 侧栏** | `_2H3hWW_root` 被 `isAnchor` 排除，且它**不是 big 容器**（`56x671`，宽不过阈值）⇒ 仍归 `bwPanelBg()` 管（展开 0.92 / 收起 0.45 **不变**）|
| **v1.32.11 浮层** | 浮层分支**保持在前**、role 豁免逻辑**一字未动**；新分支在其**后** |
| **veil 仍 0.45** | **显式按 id 排除**（不依赖隐式顺序）|

### 3.4 已知遗留（**登记，不在本轮修**）

| 项 | 内容 | 处置 |
|---|---|---|
| **聊天里的大代码块** | `_block_7gxqk_4 md-code-block`（`331x524`）同样被抹成透明、同样伤可读性，但**不是全屏定位面板** | **本轮不修**（不夹带扩大改动面）；① 探针加**常驻断言**；② 交接登记为已知遗留；③ **在给用户的汇报里显式点出**，由他决定下一轮是否处理 |
| 4px rim（v1.32.11 遗留） | `_surface_*` 每边外扩 4px，仍 `transparent`，整页不可见 | 保持不动（P3）|


---

## 4. 红线段（改这块必读；都是本仓事故换来的）

| 版本 | 事故 | 必须保住 |
|---|---|---|
| **v1.32.6** | 大容器丢互斥 ⇒ 每层 45% 白叠成 ~91% ⇒ **壁纸整层消失**（**只看面板截图看不出来**，必须整页图）| `BynINW_frame` / `BynINW_centerCol` / `html` / `body` **仍 `rgba(0,0,0,0)`**、**整页**壁纸仍透出 |
| **v1.32.5** | 侧栏浮层化后背后文字透上来 | `bwPanelBg()` 展开态 **0.92**、收起态 **0.45** |
| **v1.32.11** | 浮层被大容器分支抢先吞掉（alpha=0，且**间歇**）| 浮层 **0.96** + `role` 命中者**豁免几何判定** |
| **v1.32.11** | `#dsh-theme-veil` 若被判成浮层会盖住整张壁纸 | veil **仍 0.45**（靠 `z-index≥10` 与 **面积≤90%** 两道门槛护着）|

**⇒ 严禁"把大容器一律变不透明"** —— 那**直接触发 v1.32.6**。
**⇒ 若修法涉及放宽几何门槛，必须同时证明 veil 与 `BynINW_*` 都不受影响。**

---

## 5. alpha 档位（v1.32.11 定型；本轮在其上扩展）

| 元素 | alpha |
|---|---|
| 浮层（菜单/dialog/tooltip；`role` 命中者豁免几何判定） | **0.96** |
| 展开态侧栏（`bwPanelBg()`） | **0.92** |
| 普通面板 / 卡片 / 输入卡 | **0.45** |
| 大容器（壁纸通道：`BynINW_frame`/`centerCol`/`html`/`body`） | **`transparent`** |
| `#dsh-theme-veil`（全屏纱罩） | **0.45** |
| **文档预览面板（本轮目标）** | **待定（§2 实测后定档）** |

---

## 6. 验收判据（给 QA / task-11）

| 项 | 目标 | 谁来验 |
|---|---|---|
| 文档预览面板（差异视图 + 阅读视图） | alpha 达定档值 **＋ 肉眼不再叠印** | `QA-ROUND-v1.32.12.md` |
| `BynINW_frame`/`centerCol`/`html`/`body` | **仍 `rgba(0,0,0,0)`**；**整页**壁纸仍透出（**开面板时与关闭后都测**）| 同上 |
| `#dsh-theme-veil` | **仍 0.45** | 同上 |
| 浮层（真菜单） | **仍 0.96** | 同上 |
| 输入卡 `RlGAzG_card` | **仍 0.45**（零误伤）| 同上 |
| 侧栏两档 | 展开 **0.92** / 收起 **0.45** | 同上 |
| 版本 | **1.32.12 / code 78**（三处同步）| lead |
| openspec | 检查器 **exit 0**（MODIFIED 逐字保留既有场景）| lead |

**版本指纹纪律（v1.32.11 血的教训，本轮强制）**：APK 哈希**夹逼读**（采样前后各一次且同刻）、
**≥5 次采样**、**阈值两侧都测**。详见 `verify/README.md`「版本指纹与竞态纪律」六条。

---

## 7. ✅ 用户真机回执（2026-10-15，**最终验收**）

**用户原话：「已经安装最新版，验证通过」**（真机 iQOO 13）。

⇒ **v1.32.12 文档预览面板透明修复在真实设备上确认有效** —— 这是本轮的**最终验收判据**
（模拟器 QA 只是过程判据；**真机用户回执才是终点**）。

**本轮验收链完整闭环**：
| 环节 | 结果 |
|---|---|
| 真机反馈（改前） | 「对话生成的文档，我打开后背景也是透明的」+ 截图 |
| 侦察 | `_tabHost` 落进大容器 `transparent` 分支、**原生 `rgb(255,255,255)`** 被抹成全透明 |
| 实现 | `isPanel` 结构判据 + 三道护栏 ⇒ 面板 `1.0`（`adc086c`）|
| QA（模拟器） | **PASS**：`alpha=1.0` 5/5 恒定、肉眼无叠印、红线三态 ×5 全绿、新对抗 `QA-A30` PASS |
| 发布 | **`SUMMARY: 9/9 passed`**；线上 `?v=78` http=200 / 10,992,932 B |
| **真机回执** | ✅ **「已经安装最新版，验证通过」** |

**上一轮同样闭环**：v1.32.11（slash 菜单浮层 0.96）用户亦已回执**「验证通过」**。

> **⇒ 两条"用户可感知"的可读性缺陷（slash 菜单浮层 / 文档预览面板）本轮全部关闭。**

---

## 8. 发布前检查单（同 v1.32.11 §7，本轮复用）

1. QA 无 P0/P1；2. 版本三处 `1.32.12/78`；3. 工作树只剩在飞项；
4. `-Deploy` → 期望 `SUMMARY: 9/9`；5. 线上 `?v=78` 可达；
6. `export-public.ps1`（**最后做**：文档全提交完再导镜像，避免镜像落后重导）；
7. `HANDOVER.md` §1/§3 登记 + skill 沉淀。

> ⚠️ 发布脚本两条陷阱（勿重踩）：① **不加 `-Deploy` 也会推生产 topic `dsh`**（§3.12）；
> ② 它内部自己拉起模拟器，且已改用加固自愈 `emu-selfheal`（不再用被禁的 `dsh-emu-sw`）。
