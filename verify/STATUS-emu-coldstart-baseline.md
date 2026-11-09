# 模拟器真 GPU 冷启基线（STATUS）

> 产出于 2026-10-14 20:5x，由 `verify/emu-coldstart-baseline.ps1 -Force` 在笔电上执行一次真实冷启动。
> 判据同源：`verify/emu-coldstart-real-gpu.ps1`（钉选择器 `host` → 跑权威自愈 → 断言渲染器含 `NVIDIA`，fail-closed）。
> 本次一并收掉两件欠账：**① 真 GPU 冷启基线未重打**、**② F4（config.ini 重复键 + `hw.gpu.enabled=no`）的冷启验收**。

---

## 1. 结论

| 项 | 结果 |
|---|---|
| **真 GPU 冷启耗时** | **49.8 s**（脚本总耗时，含清锁→自愈→boot 轮询→量测）；其中**自愈阶梯自身报告 `host-GPU ladder OK in 24s`** |
| 渲染器 | ✅ `GLES: Google (NVIDIA Corporation), Android Emulator OpenGL ES Translator (NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2), OpenGL ES 3.1 (4.5.0 NVIDIA 616.92)` |
| qemu | `pid=28612`，`-gpu host`（旧进程 36308 已被本次冷启动杀掉） |
| 选择器 `emu-ladder.gpu` | `host`（未回退） |
| 几何 | `Physical size: 1440x3168` / `Physical density: 640` |
| config.ini 键重数 | `hw.lcd.width` ×1 [1440]、`hw.lcd.height` ×1 [3168]、`hw.lcd.density` ×1 [640]、`hw.gpu.enabled` ×1 [yes] |
| 自愈脚本哈希 | `21C1856BB181476C882D05A4981F6CAA84BFDEADF6B155045A49BA1FE0358C3D`（= 加固版，未回退） |
| **VERDICT** | ✅ **PASS**（脚本 exit 0） |

---

## 2. 逐项判据与实测值

| # | 判据 | 期望 | 实测 | 判定 |
|---|---|---|---|---|
| 1 | 冷启脚本 exit code | `0` | `0` | ✅ |
| 2 | 渲染器 | 含 `NVIDIA` | 含 `NVIDIA GeForce RTX 4060 Laptop GPU` | ✅ |
| 3 | 是否软渲染 | 否（不得出现 `SwiftShader` / `Google (Google)`） | 否 | ✅ |
| 4 | 几何 | `1440x3168` + `640` | 完全一致 | ✅ |
| 5 | config.ini 三个 LCD 键 | **各恰好 1 条**且值正确（F4 冷启验收） | 各 1 条、值正确 | ✅ |
| 6 | `hw.gpu.enabled` | `yes` | `yes` | ✅ |
| 7 | 选择器 | `host`（不得被软渲染救援写回） | `host` | ✅ |

---

## 3. 冷启过程原文（笔电 `G:\Android\emu-ladder.log`）

```
2026-10-14 20:55:53 === emu-selfheal start (SshdOnly=False DryRun=False) ===
2026-10-14 20:55:53 sshd: already Running (StartType=Automatic)
2026-10-14 20:55:53 interactive console session: True (INFORMATIONAL ONLY - no longer gates the GPU ladder)
2026-10-14 20:55:53 no emulator process running
2026-10-14 20:55:54 rung 1: real GPU (-gpu host) -- attempted unconditionally (the old "no interactive session" skip was based on a falsified premise)
2026-10-14 20:55:54   rung 1-host-gpu -> gpu=host via task emu-ladder-rung
2026-10-14 20:55:55     schtasks /Run /TN emu-ladder-rung -> rc=0
2026-10-14 20:56:19   [host-gpu] boot_completed=1 and shell responsive after 24s
2026-10-14 20:56:19   [host-gpu] renderer: GLES: Google (NVIDIA Corporation), Android Emulator OpenGL ES Translator (NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2), OpenGL ES 3.1 (4.5.0 NVIDIA 616.92)
2026-10-14 20:56:20 RESULT: host-GPU ladder OK in 24s (real GPU confirmed by renderer)
2026-10-14 20:56:20 === emu-selfheal end ===
```

脚本侧打印（节选）：
```
[cold] killing emulator/qemu
  KILL emulator 13924
  KILL qemu-system-x86_64-headless 36308
  CLEANED hardware-qemu.ini.lock
  CLEANED multiinstance.lock
[cold] selector already 'host'
[cold] running the self-heal ladder once (this is the authoritative launcher)
[cold] BOOTED after 4s
[cold] renderer: GLES: Google (NVIDIA Corporation), ... (NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2) ...
[cold] wm size    : Physical size: 1440x3168
[cold] wm density : Physical density: 640
VERDICT: PASS - real GPU, booted, geometry asserted
```

机读证据：`verify/evidence-coldstart/20261014-205633-emu-coldstart-baseline.json`（字段与上表一一对应，`verdict: "PASS"`）。

---

## 4. 两条如实说明

1. **49.8 s 是"脚本总耗时"，24 s 是"阶梯自身耗时"**——两者口径不同，**别混用**：
   - `49.8 s` = 杀进程 + 等 10 s + 清锁 + 跑自愈 + boot 轮询 + 量测 + 写证据；
   - `24 s` = 阶梯发起 rung 1 到 `boot_completed=1` 且 shell 可应答。
   要对外引用"冷启多久"时说清是哪个。**这两个数字才第一次让"真 GPU 冷启"有了实测基线**。
2. **旧数字已作废**：巡检时那个 **6 s 是 quickboot 快照引导**（内存快照恢复），**不是冷启动**，
   与本次的 24 s / 49.8 s 不可比。凡"冷启耗时"一律以本文件为准。

---

## 5. 本次暴露并修掉的一个工具缺陷（记录在案）

首跑时脚本把 markdown 报告与 JSON 副本写在 **`F:\work\work_dsh\dsh-push\verify\...`**，
但**脚本是在笔电上跑的**，笔电没有 `F:` 盘 ⇒ 报：

```
New-Item : Cannot find drive. A drive with the name 'F' does not exist.
WARNING: could not write the report (... 未能找到路径 ...); json still at G:\Android\emu-coldstart-baseline.json
```

**注意：量测本身全部成功，退出码仍是 0**——只是"写报告"这一步失败了。这正是本仓纪律里那句
**「命令成功 ≠ 真的做了活」**：若只看 exit 0 就会以为报告已生成。
**已修**：默认输出改为笔电本地（`G:\Android\STATUS-emu-coldstart-baseline.md` + `G:\Android\evidence-coldstart\`），
并打印一条显式的 **PULL 提示**（由台式机 `scp` 取回入库），彻底消除跨机写盘。
本文件的证据 JSON 就是按那条 PULL 提示取回来的。

---

## 6. 与其它文档的关系

- 冷启姿势与"禁止 `dsh-emu-sw`"的**硬事实**：skill `dsh-push-app-dev` §2；`verify/TEAM-START.md` §0.1
- F4 的修复过程与双臂验证：`verify/INFRA-F4-F5-F6-2026-10-14.md` §1（本文件是它的**冷启验收**环节）
- 自愈加固与其真机验证：`verify/laptop-emu-selfheal.hardened.ps1`、`verify/INFRA-HEALTH-2026-10-14.md` §9.7
- 命令：`powershell -File verify\emu-coldstart-baseline.ps1 -Force`（笔电执行；**不加 `-Force` 只打印计划**）
