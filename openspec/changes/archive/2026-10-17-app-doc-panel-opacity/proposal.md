# 文档预览面板背景透明（v1.32.12）

## Why

用户真机反馈（2026-10-15 01:17，附截图）：「**对话生成的文档，我打开后背景也是透明的**」。
截图为 DSH Web 内的文件预览/差异面板：抬头可见 `F:\work\work_dsh\story_meizijiu.md` ＋ `Markdown`
＋ 刷新 ＋ `+5 -5` 变更计数。症状是**面板整体无实底** —— 底层页签栏、聊天正文、文档自身多段文字
互相叠印，长文阅读严重发花。

## 侦察结论（实测，非推断）

面板祖先链（自 `Markdown` 徽标向上）中被注入的**只有一层**：

```
SECTION._tabHost_6nhg2_162 _pane_6nhg2_209   360x671  (pctW=100% pctH=100%)
    inline  = transparent !important          ← 被"大容器"分支写成全透明
    computed= rgba(0,0,0,0)  alpha = 0
    NATIVE  = rgb(255, 255, 255)              ← 应用自己就是不透明的纯白阅读页
```
- 视口 `360x671` ⇒ 阈值 `180 / 335.5`；`_tabHost` 为 `360x671` ⇒ `360>180` **且** `671>335.5`
  ⇒ 落进**大容器 `transparent` 分支**（那是为"壁纸唯一通道"设计的）。
- 其余各层（`TdjKvG_preview` / `_tabHostBody` / `_tabCell` / `_tabLayout` / `_surface_6nhg2_125` /
  `OUqwTW_panelBody` / `OUqwTW_panel`）**内联均为空**、未被碰；没有任何 `background-image`，
  `::before/::after` 的 `content` 为 `none`/空 ⇒ **不存在渐变底或伪元素底**，就是一层纯色被抹掉。
- 结论：**首要嫌疑（大容器分支）成立；次要嫌疑（0.45 太薄）排除** —— 该屏 `injected045 = 0`，
  面板根本不是 0.45，而是 **alpha = 0**。

### ⚠ 为什么不能用"原生是否不透明"当判据（会让修法踩回 v1.32.6）

对当前屏**全部 57 个大容器**做"临时摘掉内联、读原生、再逐层还原"的枚举，得到：

| 元素 | 尺寸 | 内联 | **原生** | 锚点? |
|---|---|---|---|---|
| `BynINW_frame` | 360x671 | `transparent` | **`rgb(255,255,255)`** | ★ 壁纸通道 |
| `Dc7zOa_root` | 304x671 | `transparent` | **`rgb(255,255,255)`** | 聊天根 |
| `_tabHost_6nhg2_162` | 360x671 | `transparent` | **`rgb(255,255,255)`** | ← 就是本 bug |
| `_block_7gxqk_4 md-code-block` | 331x524 | `transparent` | `rgb(249,250,251)` | 大代码块 |

**壁纸通道 `BynINW_frame` 的原生色与坏掉的面板一模一样** ⇒ 任何"原生不透明就给回不透明"的
颜色判据都会把壁纸通道一起变不透明 ⇒ 每层白叠加 ⇒ **直接复现 v1.32.6「壁纸整层消失」事故**。
⇒ 必须用**结构**判据。

## What Changes

给大容器分支加"**全屏定位内容面板**"例外，与壁纸通道**互斥**：

**结构判据**（`isPanel`）：元素是**全屏定位覆盖层** —— 自身 `position ∈ {absolute, fixed}`，
**或** 祖先 8 层内存在 `position ∈ {absolute, fixed}` 且覆盖 ≥90%×90% 视口的元素。
依据：文档阅读面板是绝对定位的全屏覆盖层（`OUqwTW_panel` = `absolute` 100%×100%），
而壁纸通道（`BynINW_frame`/`centerCol`/`Dc7zOa_root`）是 **static/relative 常规布局**。

**分支顺序**（浮层分支保持 v1.32.11 一字不动）：
```
if (isOv && (ovRole || !big))                   -> 浮层 0.96        （v1.32.11，不动）
else if (big && isPanel && pm)                  -> 面板 alpha=1     ★ 新增，pm = 原生色相
else if (big)                                   -> transparent      ★ 通道仍全透（红线）
else if (!skipBg)                               -> 0.45
```

**三道护栏**（缺一不可）：
1. **`nativeOpaque` 前置条件**：只有"原生确实有不透明底"（`alpha >= 1`）的元素才走面板分支 ⇒
   **绝不给本来没底色的元素凭空加底**（实测 `OUqwTW_panelBody`/`_surface_6nhg2_125` 原生透明，
   不命中）。由于上一轮可能已把面板写成 `transparent`，实现上需**临时摘掉内联**读原生色相再还原。
2. **`!isAnchor`**：显式排除 `BynINW_*` 与 `_2H3hWW_root`（后者归 `bwPanelBg()` 管）。
3. **按 id 排除 `#dsh-theme-veil`**：它是 `fixed` + 100%×100% ⇒ 会被 `isPanel` 命中。
   即便它当前由另一段注入自己写死内联、暂时安全，也**不能依赖"另一个注入恰好先写"这种隐式顺序**。

**改动面实测 = 1**：该判据下 `wouldChange` 恰好只有 `_tabHost` 一个；
`BynINW_frame` / `BynINW_centerCol` / `Dc7zOa_root` 的 `isPanel` 全为 **false**。

## Impact

- 受影响 capability：`companion-app`。
- 版本：1.32.11 / 77 → **1.32.12 / 78**（三处同步）。
- 只动这段注入，不做重构。
- **已知遗留（本轮不修）**：聊天里的大代码块 `_block_7gxqk_4 md-code-block`（331x524）
  同样被大容器分支抹成透明且影响可读性，但它**不是**全屏定位面板 ⇒ 本判据不覆盖它。
  要修需另立判据、风险更高，故本轮**不夹带扩大改动面**；已在验证探针里加**常驻断言**
  （打印其 alpha 与 native），供下一轮任何一跑即可见。
