# 玻璃化注入的类名锚点腐烂：布局链单向写 + 内容块迟滞 + 内容叶子结构判据（v1.32.15）

> 只动 `android-app/app/src/main/java/xyz/cpyh/dshpush/WebActivity.kt` 的**网页玻璃化**注入段
> （`onPageFinished` 第二段 `evaluateJavascript`）。判定细节与踩坑见
> `android-app/GLASS-OVERLAY.md` §11。

## Why（症状）

用户反馈：App 连「工作 VM / vm1 的 DSH Web」时，背景**一会儿透明能看见立绘、一会儿不透明**；
连「笔电自己的 DSH Web」就正常。

## 根因（lead 已实测取证，本轮直接采用，未重新假设）

| # | 事实 | 判据 |
|---|---|---|
| 1 | 三台宿主服务的 DSH 前端 bundle **逐字节相同**（index-5SrrfWpU.js / vendor-CCJJTK99.js / vendor-BNsW4eBh.css / index-BPHePDI_.css，共 1,476,240 B） | ⇒ 与构建差异无关 |
| 2 | v1.32.14 的 `isAnchor` 只认 `BynINW_` / `_2H3hWW_root` / `Dc7zOa_root`（旧命名方案 `哈希5_局部名`）；把当前 bundle 全部 4 个 asset（1.47 MB，懒加载 chunk 已枚举）搜穿，这 5 个锚点（含 `Z9Jnlq_`、`RlGAzG_`）**0 命中** | ⇒ 现行命名是 `_<局部名>_<哈希5>_<行号>`（`_tabHost_6nhg2_162` JS 43 次 / CSS 151 次、`_surface_6nhg2_125`、`_split_6nhg2_17`、`_label_4ub78_129`，66 个前缀，配套 `--dsh-dockkit-*`） |
| 3 | 旧命名在旧版里确实存在：`E:\\programs\\dsh\\resources\\app.asar`（09-29 那版）`findstr BynINW_` 命中 | ⇒ DSH 升级换了命名方案 ⇒ **`isAnchor` 现在对任何元素恒为 false**，v1.32.14 加 `Dc7zOa_root` 那道显式排除等于零 |
| 4 | 后果：dockkit 的布局/滚动容器落进 `isPanel` / `isCB` 两条**运行时测量**分支。代码自己的注释（QA-ROUND-v1.32.13 FINDING-1）已证明 `innerBig` 在首屏/流式渲染中途会失真（临时 <=2） | ⇒ 中途把 `rgb(255,255,255)` 写进壁纸通道、下一次 MutationObserver 自愈又抹回 transparent ⇒ **背景反复翻面**；慢宿主（VM 走 tailscale、渲染节奏慢）撞窗口概率高、笔电 loopback 几乎不撞 ⇒ 正是「只有连 VM 才犯」 |
| 5 | 被翻的东西原生就是不透明的 | `._tabHost_6nhg2_162:not(._float_6nhg2_156),._emptyTabHost_6nhg2_143{background:var(--dsw-alias-bg-base)}` |

**一句话**：判据里唯一挡住布局容器的闸门是**类名哈希**，而类名哈希随上游构建而变 ⇒ 闸门静默失效
⇒ 运行时测量（`innerBig`）在过渡态失真 ⇒ 壁纸通道被写成不透明再被抹回 ⇒ 翻面。

## What Changes

### A. 换掉 `isAnchor`：类名锚点 → 纯结构判据 `isLayout`

**不再依赖任何类名哈希**（换一次 DSH 版本就不再烂）。布局/滚动链 =

```
big && 自身 position ∈ {static, relative}
    && 祖先链上不存在「position ∈ {absolute, fixed} 且 >=90%×90% 视口」的覆盖层
```

与 `isPanel` **同源互补**（v1.32.12 已写下对立判据：阅读面板 = 全屏定位覆盖层，
壁纸通道 = static/relative 常规布局）。祖先遍历上界取 `document.body`、层数从 8 放宽到 24
（html/body 由本注入无条件写 transparent，body 之上的 fixed 不属于页面布局；
新 dockkit 套层更深）。

### B. 单向写：布局链只允许 transparent，原生色回写只留给定位覆盖层

```
isOv 0.96 → isCode 豁免（★D，见下）→ isLayout transparent → 面板 1.0 → 内容块 1.0
         → 大容器 transparent → 0.45 + blur

if (isOv && (ovRole || !big))          -> 浮层 0.96            （v1.32.11，不动）
else if (isLayout)                     -> transparent          ★ 新增，且排在面板/内容块之前
else if (big && isPanel && pm)         -> 阅读面板 原生 1.0     （v1.32.12，保住）
else if (big && isCB && pm)            -> 内容块 原生 1.0       （v1.32.13，见 C）
else if (big)                          -> transparent          （v1.32.6 红线，一字未动）
else if (!skipBg)                      -> 0.45 + blur
```

配套三处收窄（都朝安全侧）：

- 「剥内联读原生」入口从 `big && !isAnchor` 收窄为 `big && !isLayout && (isPanel || isCB)`
  —— 布局链与侧栏根**连瞬时摘内联都不做**（既有语义「原生不透明就不还原」会把它们的底抹掉）；
- `isCB` 计算前置到取色之前，且只在 `!isLayout && !isPanel && !isSb && id!=='dsh-theme-veil'`
  时算；且 **MUST NOT 以 `pm` 非空为前提**（否则与 B 的收窄入口构成三方环形依赖死锁，见 E）；
- 幂等闸门加 `&& !isLayout`：布局链放行后写回是**同值幂等**的 transparent，不再产生可见翻转。

**`isLayout` 的稳定态闸门**：只有「上一轮确实被我们写成 `transparent !important`」的元素才算布局链。
否则首屏过渡态里 `innerBig` 失真的容器会被 `isCB` 抢先写成白、下一轮再抹回 transparent，
正是本次要消灭的翻转。React 换节点后内联为空 ⇒ 闸门关闭、走保守路径（原生白瞬时露出
≈400ms，属 v1.32.13 QA-A32 已登记的既有行为，不是翻转）。

### C. `isCB` 迟滞：连续两轮成立才允许写不透明（**批处理**；命中 `isCode` 的结构判据豁免，见 F）

`innerBig` 是运行时量 ⇒ **单轮命中一律不写**：首轮只把元素收进 `cand[]`，循环外只排**一对**
2x `requestAnimationFrame`（≈两帧）复核，仍 <=2 的批量置 `e.__cbOk=1` 后**只重跑一次** `apply()`
落地 = **连续两轮成立才写不透明**。过渡态只要有一帧被后代撑开就不落地；稳定态内容块两帧后仍是 2，
代价只是多 ≈32ms。`innerBig` 变回 >2 或元素退出候选集就清标记，下次必须重新连续两轮；
已确认过的不再进 `cand` ⇒ `apply()` 不自激。

### D. 裁定① 追补：内容叶子结构判据 `isCode`（**只用标签结构**）

> ⚠ 本节的「直接子节点」深度边界**已被 G 修正**：真机的 PRE 在 `display:contents` 包裹层里
> （DOM 孙节点、盒树直接子节点），判据现按**渲染盒树**判。本节里标「实测 331x524 套 320x500」
> 的数字是**合成 DOM**，当时误标为真机（见 G 末「措辞纪律」）。

B 的单向写把**聊天正文里的大代码块**也压成 `transparent` ⇒ v1.32.13 的修复被吃掉、既有断言
「聊天代码块 alpha=1」会 FAIL ⇒ 本轮就修，且**不得用类名**（别再制造第二次腐烂）：

```js
isCode = (e.tagName === 'PRE') || 直接子节点里有 PRE      // 等价 :scope > pre
```

在 `isLayout` **之前**求值；命中 `isCode` ⇒ **不算布局链** ⇒ 走 `isCB`（带 C 的两轮迟滞）
⇒ 恢复原生不透明。**深度边界就是判据本身**：当年被实测否决的是「**后代**含 `pre`/`code`」
（聊天根的深层后代里也有 `pre`，会把布局容器判成内容叶子 ⇒ 复现 v1.32.6 壁纸整层消失）；
真机 `_block_7gxqk_4 md-code-block` 的**直接子节点**就是 `pre`（331x524 套 320x500），
而聊天根里的 `pre` 在 ≥3 层深 ⇒ MUST NOT 顺手改成 `querySelector('pre')`。
实现用 `e.children` 手挑而非 `querySelector(':scope > pre')`：语义等价、不依赖选择器引擎
（老 WebView 遇 `:scope` 抛 SyntaxError，而这段注入没有 try/catch，一处抛异常整段全废）。

### E. 本轮二次返工修掉的两个**自身**缺陷（合成 DOM 实测出来的，不是推测）

1. **三方环形依赖死锁**：`isCB` 以 `pm` 非空为前提 + B 把「剥内联读原生」收窄成
   `(isPanel || isCB)` + 内容块第一轮被兜底分支写成 `transparent` ⇒ 第二轮起 `a0=0` ⇒
   `pm=null` ⇒ `isCB=false` ⇒ 剥内联不解锁 ⇒ `pm` 永远填不上 ⇒ **聊天代码块永久停在 transparent**。
   修法：`isCB` 先算且不以 `pm` 为前提，再由它解锁剥内联，`pm` 由原生色填充。
2. **O(N²) 自激**：每个候选各排一对 rAF、复核通过各自重跑 `apply()` ⇒ 首屏候选数十个时
   `apply()` 次数平方级（实测 41 个候选把合成 DOM 跑到 **heap OOM**，真机等于 ANR）。
   修法：每轮一批收集 `cand[]`，只排一对 rAF、只重跑一次 `apply()`。修后 8 场景 × 9 轮 **17ms**。

顺带：放开 `pm` 前提后 `isCB` 必须**显式排除侧栏根与 veil**（此前靠 `pm` 非空间接挡住）——
否则 veil 会被兜底分支写 transparent（0.45 纱罩消失）、侧栏根的 0.92 会被剥内联抹成原生 1.0。

### F. 真机 QA 红项 D1：`isCode` 免两轮迟滞 + QA 探针

真机（`verify/QA-ROUND-v1.32.15.md`）：`pre` 自身 `rgb(249,250,251)` 正常，但承载卡片底 + 头部条的
容器 `_block_7gxqk_4 md-code-block`（233x410、原生 `rgb(249,250,251)`）被写成 **`transparent`**，
8 次采样稳定、4 次运行复现；取证 `innerBig=1`、`isCode=true`、`isLayout`/`isPanel`/`isOv` 全 false。
**合成 DOM 里同场景（innerBig=2）已恢复不透明，真机 innerBig=1 更宽松却不落地 ⇒ 分歧不在阈值在时序。**

根因：`__cbOk` 挂在 **DOM 节点**上，聊天列表**虚拟化换节点** ⇒ 每轮都是新节点 ⇒ 永远攒不满
「连续两轮」；兜底分支当轮写 `transparent`、不透明要晚一轮 ⇒ 长期停在透明。

修法：`isCB = isCode || (e.__cbOk === 1)` —— 命中 `isCode` 的元素**当轮**即可回写原生 alpha = 1。
不会把 FINDING-1 放回来：FINDING-1 的失真面是「布局容器在渲染中途看起来很小」，而 `isCode` 是
标签结构事实（且排在 `isLayout`/`isPanel` 之后已被排除）；内容叶子被写的值是它**自己的原生色相**，
早一轮与晚一轮是**同一个值**、没有可翻转的第二值；`innerBig<=2` 与「原生真的不透明」两道闸仍在。

QA 探针（只读、不参与判定）：`window.__qaCb = [{cls, innerBig, cbOk, nodeSeq, isCode, isCB}]`，
`nodeSeq` 是注入侧自增的**节点身份号**（换节点即换号）⇒ QA 可区分「同一元素被换成新节点」。

顺带修掉 harness 的时序失真：`flushT()` 原先在结尾顺手排空 rAF ⇒ 「两帧后复核」在同一帧内完成 ⇒
D1 被掩盖（修前也显示不透明）。改成 rAF 只在下一个帧边界跑（且在换节点之后）。

### G. 定点复测定案：D1 真根因 = isLayout **自锁** + isCode 在真机上不成立（推翻 F 的假设）

F 里写的「`__cbOk` 挂在节点上 + 虚拟化换节点 ⇒ 攒不满两轮」**被真机取证推翻**：`__qaCb` 的
`nodeSeq` 在稳定态**恒定**（笔电 20、vm1 23；`__qaN` 48 / 41）⇒ 稳定态没有换节点。真根因两条：

1. **isLayout 自锁**（纪律 10「判据不得互相以对方输出为前提」的又一次违反）：卡片首轮 `a0=1`
   ⇒ 幂等闸门 `a0<1` 不拦 ⇒ 落到大容器兜底分支**当轮写 transparent**；而 `inline==='transparent'`
   正是 isLayout 的进入条件 ⇒ 次轮起 isLayout 恒真 ⇒ 再也进不了 isCB 求值分支 ⇒ 稳定停在错值。
2. **isCode 在真机上不成立**：卡片 DOM 直接子节点是 `_bannerWrap_7gxqk_`（233x42）+
   `_content_7gxqk_74`（**0x0** = Blink 对 `display:contents` 的空矩形），PRE 是**孙节点**
   ⇒ 只看 `e.children` 必然 false ⇒ 没有东西绕开 isLayout。

**vm1 逃过纯属运气**：首帧 ~220px 没过 `vh*0.5`=335.5 ⇒ 走 0.45 分支 ⇒ inline 不是 transparent
⇒ 闸门关着 ⇒ 长高后正常进 isCB ⇒ 写 `rgb(249,250,251)`。**首帧高度决定命运**。

修法：**A** isCode 按**渲染盒树**判（直接子节点扫 PRE，遇 `display:contents` 包裹层下钻，≤2 层；
MUST NOT 用 0x0 矩形反推）；**B** 修 A 后**首轮即命中** isCode ⇒ 锁根本不形成；**C** isLayout 进入
条件改读注入自有标记 `e.__dshGlass`（写 transparent 置 1、写不透明/浮层/0.45 置 0），不再读自己
写的 inline；**D** 合成 DOM 加 S10（contents 包裹层）/ S11（首帧高度）/ S12（红线探针）。

**C 的处置：拆自锁，但保留「兜底分支也打标记」。** 四变体对照（合成 DOM 9 轮，**非真机**）：

| 变体 | S10 卡片（笔电形态） | S12 聊天根/tabHost | S2 chatRoot/tabHost | S3 frame | S7 frame | S4 tabHost |
|---|---|---|---|---|---|---|
| V0 = 4a039ab 修前 | `transparent` ✗ | transparent | transparent | transparent | transparent | transparent |
| V1 = 只修 A | `rgb(249,250,251)` ✓ | transparent | transparent | transparent | transparent | transparent |
| V4 = 只修 C | `transparent` ✗ | transparent | transparent | transparent | transparent | transparent |
| **V2 = A+C（采用）** | `rgb(249,250,251)` ✓ | transparent | transparent | transparent | transparent | transparent |
| V3 = A+C1（兜底不打标记） | `rgb(249,250,251)` ✓ | **`rgb(255,255,255)`** ✗ | **`rgb(255,255,255)`** ✗ | **`rgb(255,255,255)`** ✗ | **`rgb(255,255,255)`** ✗ | **1 次翻面** ✗ |

⇒ **A 才是 D1 的解**（V4 单独修 C 修不好）；**C 在 12 个场景与 V0/V1 逐项相同、0 翻转**（行为中性，
价值在消掉自指与「页面改写我们的 inline 就解锁」的耦合）；**彻底拆锁（C1）会把 v1.32.6 红线放回来**
（4 个场景壁纸整层被不透明白盖掉 + 过渡态放回 1 次翻面）⇒ 本轮不采用 C1。

**措辞纪律（本轮教训）**：F 里把**合成 DOM** 的 331x524 套 320x500 写成「真机实测」，于是「只看
直接子节点」被当成真机背书、没人去查真机层级 ⇒ D1 多跑一轮。此后文档与回报里合成结果一律标「合成」。

## 合成 DOM 对照实验（本轮实测，**非真机**）

视口 360x671。**过渡态**（`innerBig` 在 r3 前 = 0、r3 起挂上 30 行消息）：

| 元素（现行 bundle 类名） | v1.32.14 注入 | v1.32.15 注入 |
|---|---|---|
| `_frame_6nhg2_1` | `rgb(255,255,255)` → r3 起 `transparent`（**1 次翻转**） | 全程 `transparent`（**0 翻转**） |
| `_root_5aaaa_1` | 同上（1 次翻转） | 全程 `transparent` |
| `_tabHost_6nhg2_162` | 同上（1 次翻转） | 全程 `transparent` |

十二个场景 × 9 轮，**r1 之后可见翻转全部为 0**（S9 修前、S11 的 0.45→原生收敛除外）（harness `glass-sim.mjs` + `glass-scen.mjs`）：

| 场景 | 关键结果 |
|---|---|
| 聊天稳态 | 布局链 `transparent`；**聊天大 PRE 卡片 `rgb(249,250,251)`**（★D 生效）；小代码块 `0.45`；输入卡 `0.45`；veil 未被触碰 |
| 文档面板打开 | `panelTab rgb(255,255,255)`（v1.32.12）；面板内代码块 `rgb(249,250,251)`（v1.32.13）；底层布局链仍 `transparent` |
| slash 菜单 | `role=listbox` 层 `rgba(255,255,255,0.96)`；无 role 的高浮层仍 transparent（§1.6 已登记遗留，未变） |
| 过渡态 / 换节点 | 容器 0 翻转；代码块仍收敛到不透明 |
| 旧 bundle 类名 | `BynINW_frame` / `Dc7zOa_root` 仍 `transparent`（老宿主不回归） |
| 窄屏侧栏 | 展开态 `0.92`、收起态 `0.45` 均保住 |
| **卡片每轮换节点（D1 回归）** | 修前 `transparent`（1 翻转）；修后 `rgb(249,250,251)`、**0 翻转**。**注**：该场景后来被真机 `nodeSeq` 读数否证为 D1 根因（稳定态并无换节点），保留作「标记随节点丢失」的回归 |
| **S10 卡片经 `display:contents` 包裹层套 PRE（真机笔电形态）** | 修前 `transparent`（**复现真机 D1**）；修后（isCode 按盒树判）`rgb(249,250,251)`、0 翻转；首轮探针即 `isCode=true, isCB=true` |
| S11 首帧矮 → r3 长高（vm1 形态） | 修前后均 `rgb(249,250,251)`、1 次收敛 ⇒ 与 S10 对照即「首帧高度决定命运」 |
| S12 红线探针（聊天根只有一个大后代行） | 修前后均 `transparent`；**C1 变体**（兜底不打标记）下聊天根/tabHost 变 `rgb(255,255,255)` ⇒ 红线依据 |
| PRE 直接挂在聊天根下 | 聊天根被判成内容卡片 ⇒ 不透明。**这是「只看直接子节点」的语义本身**，真机聊天根在 ≥3 层 ⇒ 不命中 |

## 本轮不改 / 已登记风险（lead 裁定，别让下轮当已验）

| 条目 | 处置 |
|---|---|
| 聊天正文大代码块曾被单向写压成 transparent | **本轮已修**（★D `isCode`），不再是代价 |
| 阅读面板若哪天改成 `position:relative` 全屏层 ⇒ `isLayout` 先命中 ⇒ v1.32.12 回归 | **接受**为已登记风险；注释写死「面板 = 定位覆盖层」是当前实测事实；tester 已把「文档预览面板不透明」列为红线断言 |
| 页面自己写 inline `transparent` ⇒ 该元素永久锁透明 | **接受**；注释写明，`isCode` 是唯一出口 |
| 整棵聊天被塞进全屏 absolute/fixed 壳 ⇒ 整棵子树判成面板 | **接受**；缓解在注释（那层壳自身也会被判 `isPanel` 并拿原生 1.0） |
| `position:sticky` 的布局容器不算布局链 ⇒ 可被写不透明 | **下一轮**（与下一条同属侧栏那条线） |
| 窄屏侧栏 `_2H3hWW_root` 补丁**已腐烂**（现行 bundle 0 命中 ⇒ `bwPanelBg` 0.92 与 `skipBg` 空转） | **已腐烂、待下一轮换结构判据**（要真机窄屏才能测 `position`，本轮不扩面）；本轮代码未动 |
| 主循环选择器不含 `pre`/`code` | 登记：`isCode` 的 `tagName==='PRE'` 臂当前是防御性的，真正起作用的是「直接子节点有 PRE」；若哪天把 `pre` 加进列表，0.45 档要重测 |
| **DOM 类名前缀按宿主不同**（QA 实测）：笔电 DOM 仍有 `BynINW_`=6 / `_2H3hWW_root`=1 / `Dc7zOa_root`=1，vm1 DOM 是 `hHd-Xa_` / `wSkVaW_` / `pI_x6G_` / `P3OORG_` / `_6nhg2_`（旧名 0 命中），**而两侧 bundle 逐字节相同**（同名同哈希 1,476,240 B）⇒ 类名前缀疑似按安装/启动生成 | **已登记**（本轮未改代码）：「绝不用类名哈希当决定性闸门」比原先认定的更硬 |
| D2：vm1 上窄屏补丁整体空转（侧栏展开是**挤压布局**而非覆盖层，中列 304→80px、0.92→0.45、`skipBg` 空转）。**新证据**：展开侧栏时代码块被压到 **9x4975（9px 宽）**、收起后恢复 233px ⇒ **功能性破坏**而非观感；QA 已改为「测大代码块前先收侧栏」 | **v1.32.16 议题**，本轮不动 |
| D3：`_emptyTabHost_6nhg2_143` 在 `visibility:hidden` 时被写不透明白 | 当前无视觉影响；上游一显示就会盖壁纸 ⇒ 登记 |
| 未过阈值的小代码块仍 0.45 | 既定设计，未动 |

## Impact

- 受影响 capability：`companion-app`。
- 版本：**并入 1.32.15 / versionCode 81**（三格已在 `3cca84f` 就位，本轮不再 bump）。
- 只动这段注入 + `android-app/GLASS-OVERLAY.md`（§11.4~§11.8 是本轮 ★D/★E 的完整踩坑记录）；
  `verify/**` 是 tester 写域，未动。
- 规格侧按 `openspec validate --strict` 的「ADDED requirement 正文 ≤500 字符」把原来一条 524 字的
  ADDED 拆成 **3 条**（各 226 / 350 / 315 字），举例与边界全部下沉到 scenario；MODIFIED 正文也从
  3878 字压到 413 字（本机 `openspec` CLI 不可用，已用自写脚本按同类规则扫过全部 15 个 `spec.md`：
  结构问题 0、超 500 字的只有既有的 4 条 MODIFIED，而它们在 lead 的 `--strict` 跑里是 PASS ⇒ 该规则
  只作用于 ADDED）。**请 lead 在 vm1 复跑 `openspec validate app-glass-layout-chain --type change --strict`。**
