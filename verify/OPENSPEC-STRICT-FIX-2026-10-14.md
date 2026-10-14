# openspec `--all --strict` 全绿：修复记录（2026-10-14，lead 接手 task-11）

> task-11 原本派给 developer，但其引擎**连崩两次**（均发生在动笔前，无残留）。
> 这是一件**边界清晰、不需设备、不开队友**的编辑活，故由 lead 直接接手完成。

---

## 1. 结果

```
- Validating...
✓ spec/answer-relay
✓ spec/companion-app
✓ spec/dsh-host-integration
✓ spec/dsh-host-plugin
✓ change/dsh-push-web-link-out-of-box
✓ spec/dsh-question-notify
✓ spec/dsh-turn-notify
✓ change/plugin-timed-switch
✓ spec/push-relay-server
✓ change/webview-network-awareness
Totals: 10 passed, 0 failed (10 items)
```

**修复前**：`Totals: 5 passed, 5 failed (10 items)`。

**命令（在 vm1 仓跑）**：
```bash
cd ~/work/projects/dsh-push && openspec validate --all --strict
```
⚠️ CLI 是 `/usr/local/bin/openspec`。**别用 `npx openspec@1.14.1`**——npm 上**没有**该版本，会报 `ETARGET`（本轮踩过）。

---

## 2. 修了哪些（共 5 个 spec）

### 2.1 Purpose 占位/过短（4 处）

openspec 的提示原文写得很直白：
> Replace it with what this capability is for, **editing the main spec directly: a `## Purpose` in a delta is read only when the capability is created, so it cannot replace this one.**

⇒ **必须改主 spec**（`openspec/specs/<cap>/spec.md`），改 delta 无效。已改：

| capability | 修复前 | 修复后 |
|---|---|---|
| `dsh-host-integration` | `TBD - created by archiving change windows-dsh-web-push. Update Purpose after archive.` | 定义主机接入推送时"钩子链路"的外部可观察契约：桥插件挂载语义、生效条件（沙箱档位与 temp 根位置）、条件未满足时的静默行为（81 字符） |
| `dsh-host-plugin` | `TBD - created by archiving change dsh-host-plugin-push. Update Purpose after archive.` | 定义 `dsh-push-host` 宿主插件的行为契约：挂载与生效条件、两类推送、前台作答权归属、手机作答回灌与回声、轮询可靠性、配置/凭据/包分发（87 字符） |
| `dsh-turn-notify` | 原为 32 字符（过短） | 补全"轮次结束触发推送"的契约范围：触发时机、载荷与标题格式、失败隔离、同轮去重（87 字符） |
| `push-relay-server` | 原为 37 字符（过短） | 补全自建 ntfy 的外部可观察行为：HTTPS/WS 可达、写入鉴权、边缘 nginx SNI 分流、证书自动续期、重启自愈（111 字符） |

### 2.2 requirement 正文 > 500 字符（7 处正文 + 13 条新场景）

**修法选择**：openspec 给了两条路——"把示例与边界挪进 scenario"或"拆成多条 requirement"。
**选了前者**，因为**拆分要改需求名**，而这些名字正被活跃 change 的 `MODIFIED Requirements` 按名引用
（`dsh-push-web-link-out-of-box` 就 MODIFIED 了「提问推送（宿主插件路径）」与「轮次结束推送（宿主插件路径）」），
改名会让 delta 对不上。**只搬动词、不动需求名**是零风险路径。

| spec | requirement | 修复前 | 修复后 | 做法 |
|---|---|---|---|---|
| dsh-host-plugin | 包分发 | 547 | <500 | 元数据/打包清单细节 → 新场景「包元数据与运行入口」「三种安装方式等价」 |
| dsh-host-plugin | 凭据文件 | 627 | <500 | 字段名与别名映射表 → 新场景「字段名与别名映射」 |
| dsh-host-plugin | 配对载荷 | 534 | <500 | `verify` 五项检查 → 新场景「自检的五项检查」 |
| companion-app | 网页直达按钮 | 597 | 437 | 实例名反查规则 → 新场景「实例名反查与退化」 |
| companion-app | 快答成功页主题立绘动画 | 547 | <500 | 素材来源与规格（Wan2.2/首尾帧同图/alpha 遮罩） → 新场景「活立绘素材的来源与规格」 |
| companion-app | 内置浏览器提问卡窄屏防塌陷 | 1372 → 580 → **301** | 两轮压缩 | 三条规则、选择器匹配、包含块中性化、浮层判定、背景色来源 → 新场景「提问卡头部换行与文字占满整行」「窄屏侧栏不占用网格列」「选择器用属性包含匹配」「侧栏浮层不因包含块被裁剪」「浮层收起判定按实际矩形」「展开面板背景与色相来源」 |
| companion-app | 配对载荷导入 | 551 | <500 | 字段清单与 App 取用范围 → 新场景「载荷字段与 App 的取用范围」 |

**共新增 13 条场景**（`dsh-host-plugin` +4、`companion-app` +9）。

---

## 3. 红线校验：既有场景逐字保留（PASS）

本仓红线：**MODIFIED 需求必须逐字保留全部既有场景**。本次虽只改主 spec，仍按同一标准自证。

- **工具**：`F:\work\work_dsh\tmp\verify-scen-preserved2.mjs`
- **方法**：`cmd /c "git show HEAD:<path> > orig"` 取**改动前**的 blob（按仓库纪律用 cmd 重定向——PowerShell 管道会改行尾造成假差异），
  然后用**同一个解析函数**解析前后两侧，逐块比对。

```
file                    before  now  preserved  added  ALTERED
dsh-host-plugin           37   41         37      4        0
companion-app            117  126        117      9        0
dsh-host-integration       9    9          9      0        0
dsh-turn-notify            6    6          6      0        0
push-relay-server          8    8          8      0        0

TOTAL preserved=177  added=13  altered-or-lost=0
VERDICT: PASS - every pre-existing scenario is present byte-for-byte (modulo trailing blank lines); only additions were made.
```

### ⚠️ 如实登记：**第一版校验器给出了假 FAIL**

第一版 `verify-scen-preserved.mjs` 报了 **"companion-app preserved=0, altered=116"**、结论 `FAIL`——
**文件其实一个字都没被改**。根因：它**用脚本 A 拍快照、用脚本 B（不同解析器）比对**，
两者对块尾空白的处理不一致，于是"全部不等"。

这正是本仓纪律那条 **「先怀疑判据」**：检查器尖叫时，先怀疑检查器。
第二版改为**同一解析函数 + 从 git 取原件**，才得到可信的 PASS。
（若当时信了第一版，就会去"修"一个根本没坏的改动，把好文件改坏。）

---

## 4. 同步与提交

- 改动同步到 vm1 仓（`scp -r openspec/specs`），在 vm1 上取得上述 **10/10 全绿**输出。
- 提交只含 `openspec/specs/**`（task-11 的写入范围），**未碰 `verify/**`**（tester 的 task-10 正在跑，范围重叠必须串行）。

---

## 5. 未纳入本次的（如实说明）

- **`change/*` 的 delta 未动**：本次只改主 spec 的 Purpose 与需求正文。三个活跃 change 本身 **均为 ✓**（`dsh-push-web-link-out-of-box`、`plugin-timed-switch`、`webview-network-awareness`）。
- **未新增/删除 capability**，未改任何需求名，未改任何既有场景语义。
- **`companion-app` 里 483/487 字符的两条**（「消息列表管理」「小清新视觉主题」）在 500 阈值下**本就是合格的**，未动——避免无谓改动扩大回归面。
