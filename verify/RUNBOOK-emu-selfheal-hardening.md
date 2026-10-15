# RUNBOOK：把笔电模拟器自愈脚本加固到 F1–F3（禁 CPU 软渲染）

> **读者**：下一轮的 leader（或任何要动笔电模拟器基础设施的人）。
> **状态**：✅ **已执行完成（2026-10-14 19:02）**，并在 **2026-10-15 追加 F7**。
> 加固版已部署为笔电现网脚本 `G:\Android\emu-selfheal.ps1`。
> ⚠️ **现网 sha256 已变**：F1–F3 完成时为 `21C1856BB181476C882D05A4981F6CAA84BFDEADF6B155045A49BA1FE0358C3D`，
> **2026-10-15 加 F7 后 = `26F2CFE123F140F0ADA463E41187C58A9C55EF5FD670317D28BA7916F34184EE`**。
> **F7 = 每次 pass 断言 rung 任务为「shim 动作 + Hidden=True」**（治"桌面闪窗"，见
> `CONSOLE-WINDOW-FIX-2026-10-15.md`）。改脚本后必须同步 `verify/laptop-emu-selfheal.hardened.ps1`。
> 生产模式验收通过。**本手册保留为复现/换机器/回滚指南**，执行记录与踩坑见
> `verify/INFRA-HEALTH-2026-10-14.md` §9（含首跑挖出的 `Run-Timeout` 死锁根因与修法）。
> 备份：`G:\Android\emu-selfheal.ps1.bak-f13`（= 旧脚本 `BE99A7F9…`，F1–F3 之前）→ 回滚见 §4；
> **加 F7 前的上一版 = `emu-selfheal.ps1.bak-hidden-20261015-155150`（`21C1856B…`）**。
> **配套**：`verify/INFRA-HEALTH-2026-10-14.md`（根因与取证）、`verify/laptop-emu-selfheal.hardened.ps1`（成品）、
> `verify/drive-hardened-dryrun.ps1`（证明脚本）、`verify/emu-gpu-verdict.ps1`（一条命令判档位）。

---

## 0. 为什么要做（一句话）

用户硬约束：**模拟器不许跑 CPU 软渲染**（swiftshader 会让笔电风扇狂转、噪音大）。
笔电现网 `G:\Android\emu-selfheal.ps1` 有三个缺陷会让它**无声地退回 CPU 并长期固化**：

| 缺陷 | 后果 |
|---|---|
| **F1** 按"无交互会话 ⇒ 真 GPU 会挂"**跳过 rung 1** | 该前提已实测证伪（console 断开时 `-gpu host` 6s 起得来）；这道"保护"实为把机器往 CPU 赶 |
| **F2** "已健康"只查 `boot_completed`+`echo ok`，不含渲染模式 | swiftshader 实例被判健康 ⇒ 每 5 分钟路过却不纠正 = **CPU 稳态固化** |
| **F3** 软渲染降级后选择器文件永久留 `swiftshader` | **一次误判 = 之后每次启动默认走 CPU** |

---

## 1. 前置条件（逐条先验，不满足就别开始）

| 检查 | 命令 | 期望 |
|---|---|---|
| 笔电可达 | `ssh -o BatchMode=yes user@<tailnet-laptop> hostname` | `<win-host-a>`（**防双胞胎主机认错**） |
| 当前档位 | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\emu-gpu-verdict.ps1` | `exit 0 / PASS`（先确认起点是真 GPU） |
| 成品在位 | `Test-Path verify\laptop-emu-selfheal.hardened.ps1` | True |
| 现网脚本可备份 | `ssh ... powershell -NoProfile -Command "Test-Path G:\Android\emu-selfheal.ps1"` | True |

> ⚠️ **红线**：本操作改的是**笔电上不在版本控制里的基础设施脚本**。改前必须备份、改后必须观察一个自愈周期。

---

## 2. 部署步骤（五步，逐条留证据）

### 步骤 1 — 备份现网脚本（**不可跳过**）

```powershell
ssh -o BatchMode=yes user@<tailnet-laptop> powershell -NoProfile -Command "Copy-Item G:\Android\emu-selfheal.ps1 G:\Android\emu-selfheal.ps1.bak-f13 -Force; (Get-FileHash G:\Android\emu-selfheal.ps1 -Algorithm SHA256).Hash"
```

**记录哈希**（回滚判据，也是"确实是旧脚本"的证据）。

### 步骤 2 — 下发加固版

```powershell
scp -o BatchMode=yes verify\laptop-emu-selfheal.hardened.ps1 user@<tailnet-laptop>:C:/Users/<user>/emu-selfheal.hardened.ps1
scp -o BatchMode=yes verify\drive-hardened-dryrun.ps1 user@<tailnet-laptop>:C:/Users/<user>/drive-hardened-dryrun.ps1
```

### 步骤 3 — **真机 `-DryRun` 复核**（先证明它认得出"现在就是真 GPU"）

```powershell
ssh -o BatchMode=yes user@<tailnet-laptop> powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\<user>\emu-selfheal.hardened.ps1 -DryRun
```

**必须看到**：`already healthy ON THE REAL GPU ... -> nothing to do`。
若报 `VIOLATION`，说明渲染器判据与现场不符 → **停下**，先查 `dumpsys SurfaceFlinger` 的真实渲染器行，别硬上。

### 步骤 4 — 覆盖现网脚本并复验降级分支

```powershell
# 先复验降级分支（仍在干跑，不碰机器）
ssh ... powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\<user>\emu-selfheal.hardened.ps1 -DryRun -ForceLadder -BreakHostRung -DryRunLadderOutcome sw-ok
# 必须看到：REGRESSION + would rewrite ...emu-ladder.gpu back to "host"

# 再正式覆盖（此时才写磁盘）
ssh ... powershell -NoProfile -Command "Copy-Item C:\Users\<user>\emu-selfheal.hardened.ps1 G:\Android\emu-selfheal.ps1 -Force; (Get-FileHash G:\Android\emu-selfheal.ps1 -Algorithm SHA256).Hash"
```

**记录新哈希**（应等于加固版哈希）。

### 步骤 5 — 观察一个自愈周期（5 分钟）并验真机行为

```powershell
# 等 5-6 分钟（自愈任务 PT5M 触发），然后看日志
ssh ... powershell -NoProfile -Command "Get-Content G:\Android\emu-ladder.log -Tail 12"
# 再判档位
powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\emu-gpu-verdict.ps1
```

**验收断言表**：

| # | 断言 | 依据 |
|---|---|---|
| 1 | 一个周期后**无** `VIOLATION` 行 | 现场本来就是真 GPU，应稳定放行 |
| 2 | 日志出现 `renderer: GLES: ... NVIDIA ...` | F2 判据确实在跑 |
| 3 | `emu-gpu-verdict.ps1` → **exit 0** | 端到端档位确认真 GPU |
| 4 | `emu-ladder.log` 里 `interactive console session` 行带 `INFORMATIONAL ONLY` | F1 闸口已降级为纯日志 |
| 5 | `emu-ladder.gpu` 内容 = `host` | 未被任何分支改写回 swiftshader |

---

## 3. 残留风险（**如实告知，别当已知安全**）

0. **⚠️ 首跑曾失败并挖出真 bug（已修）**：`Run-Timeout` 先 `WaitForExit()` 后 `ReadToEnd()`，
   大输出（`dumpsys SurfaceFlinger` 46 KB）会**死锁** → 渲染器读空 → `fail closed` 判 `VIOLATION`
   → **每 5 分钟误杀健康的真 GPU 模拟器**。已用「异步排空 + 设备侧 `grep`」双保险修掉，
   并补 `-SelfTest`（含**实时**探测）作永久回归。**完整根因与复现证据见
   [INFRA-HEALTH-2026-10-14.md](F:\work\work_dsh\dsh-push\verify\INFRA-HEALTH-2026-10-14.md) §9.4。**
   ⇒ **教训：改完务必先跑 `-SelfTest` 再上真机**，别只看干跑（干跑用注入值，绕过真实探测路径）。
1. ✅ **已闭环（2026-10-14 20:00 真机验证）**：~~「真跑 kill+重启能把 CPU 实例拉回 GPU」仍未真机验证。~~
   用户批准后由 lead 实测：造出真 **SwiftShader** 实例 → 生产自愈 **37s 内**完成
   `VIOLATION → kill → rung 1 -gpu host`，**渲染器回到 NVIDIA RTX 4060（+24s）**、`LastTaskResult=0x0`、
   选择器还原 `host`；CPU 软渲染窗口仅 **~23s**。
   判据与日志原文见 `INFRA-HEALTH-2026-10-14.md` §9.7。**该路径风险已消除。**
   > 附带纪律：读 Windows 计划任务结果**必须等它离开 `Running`**，否则 `LastTaskResult=267009`（`0x41301`）
   > 会被误读成错误码（实为"正在运行"）。
2. **`-BreakHostRung` 只在干跑用过**；真机从未用它验证过 rung 1 真失败时的兜底时序。
3. **测试钩子安全性**：`-ForceLadder`/`-DryRunLadderOutcome` 不带 `-DryRun` 时脚本**直接 exit 2 拒绝**（已实测）；
   但 `-TestRendererOverride` 本身不加该锁（它只替换渲染器字符串，不改变行为）——**不要在生产路径传它**。
   `-SelfTest` 是只读的，可随时在生产机上跑。
4. **不要用 `ssh ... -EncodedCommand` 下发长脚本**：远端命令行上限约 **8191 字符**，
   超长会被截断且**静默不执行**（本轮步骤 4–5 因此整段没跑、检查全空，还被误判成 FAIL）。
   **一律 `scp` + `powershell -File`。**
5. **产物与 HEAD 一致性**：部署用的加固版必须与提交里的**逐字节一致**；
   比对用 `cmd /c "git cat-file blob HEAD:verify/laptop-emu-selfheal.hardened.ps1 > $tmp\x.ps1"` 再取哈希
   （**PowerShell 管道会改行尾导致假 DIFF**，这条坑本仓踩过）。

---

## 4. 回滚（任何一步不对就回）

```powershell
ssh ... powershell -NoProfile -Command "Copy-Item G:\Android\emu-selfheal.ps1.bak-f13 G:\Android\emu-selfheal.ps1 -Force"
# 验回滚成功：哈希应等于步骤 1 记录的旧哈希
ssh ... powershell -NoProfile -Command "(Get-FileHash G:\Android\emu-selfheal.ps1 -Algorithm SHA256).Hash"
```

回滚后**必须**再跑一次 `emu-gpu-verdict.ps1` 确认档位没被搞坏。
**回滚不需要重启任何 DSH 服务**（这是笔电上的独立计划任务，与 DSH 无关）。

---

## 5. 收尾（部署完成后更新交接）

**本次已完成**：
1. ✅ `verify/emu-gpu-verdict.ps1` → `exit 0`；
2. ✅ 部署记录 + 新哈希 + 生产验收 + 死锁根因写进 `INFRA-HEALTH-2026-10-14.md` §9；
3. ✅ `HANDOVER.md` §1「下轮第一件事」已改为下一项（CPU 稳态隐患已消除）；
4. ✅ 新坑（死锁、ssh 长度上限）写进 skill `dsh-push-app-dev` §2 并**带判据**。

**换机器/重做时**：照 §1–§2 走；**但务必先跑 `-SelfTest`**，再真机 `-DryRun`，最后才覆盖现网。
