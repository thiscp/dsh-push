# RUNBOOK：host-plugin 0.2.1 生产上线（台式机 DSH Web）

> 适用：把 `dsh-push-host` 从 **0.1.1** 升级到 **0.2.1**（设置页「手机作答模式」开关）。
> 为什么有这份：0.2.0 是**手工**上线并打出了 P0（插件开机把生产 `tool-ask-user` 从 `timed` 反向写成
> `legacy`）。本手册把每一步都变成「先快照、再执行、后比对」，可回滚、可审计。
> 脚本：[prod-rollout-plugin.ps1](prod-rollout-plugin.ps1)。事故记录见 [HANDOVER.md](HANDOVER.md) §3.5。

---

## 0. 前置（缺一不可）

| 条件 | 判据 |
|---|---|
| QA 放行 | P07（vm1 服务开机零写入）= PASS；P01（selftest 101/101）= PASS（已达成，commit `90073d4`） |
| 产物已定稿 | `host-plugin/dsh-push-host-0.2.1.tgz` sha256 `59B0A9D9EB7B20148C6AAFB1FEA7F09C5E0FE2742ECF016D4D684F320B456D31` |
| 产物 ≡ 提交 | tarball 内 `lib/index.js`/`lib/client.js`/`package.json`/`README.md` 与 `HEAD` **逐字节 MATCH** |
| 生产基线 | `cordis.patch.yml` sha256 = `D8F12BC0ED0962126D45DA8EC9CDFFA8128DAA5411E07CA683DFDE79E0563731`（两处 `mode: timed`） |
| 用户同意 | 重启会**换 web token**、GUI 断约 10–15 秒 —— 需用户点头 |

**若生产 patch 哈希对不上**：先查清原因（谁改的、改成什么），再决定是否继续；不要「反正要覆盖」地装。

## 1. 预检（只读，随时可跑）

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\prod-rollout-plugin.ps1 -Check
```

输出：dsh cli / profile / patch 哈希与期望比对 / 当前插件版本 / 备份数 / 3081 端口持有者 / web.log 行数 /
tarball 存在与哈希 / patch 里 `timed`、`legacy` 计数。**同时把快照写进
`F:\work\work_dsh\tmp\prod-rollout-state.json`**（后续 `-Verify` 就与这份快照比对）。

## 2. 安装（含备份，不重启）

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\prod-rollout-plugin.ps1 -Install
```

脚本动作：① 快照 + `cordis.patch.yml.prodroll-<ts>` / `package.json.prodroll-<ts>` 双备份；
② 校验 patch 哈希 == 期望，否则**中止**；③ 删旧 `node_modules\dsh-push-host`（同版本重复 add 是 no-op）；
④ `dsh plugin add <tarball>`；⑤ 断言装出的版本 == 0.2.1；⑥ 打印装后状态（此时**尚未重启**）。

## 3. 重启（会切断当前会话 —— 预期行为）

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\prod-rollout-plugin.ps1 -DispatchRestart
```

用一次性计划任务（`dsh-net-restart-once.ps1`）在**进程树外**重启，因此 agent 自身被杀掉也能完成。
重启后：token 必换、会话从磁盘续上、看门狗继续管。重置刚回来会由 `DshRestartResume` 守卫通知续跑。

## 4. 装后验收（**最关键的一步**）

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\prod-rollout-plugin.ps1 -Verify
```

与预检快照逐项比对，全部满足才 PASS：

| 断言 | 期望 | 为什么 |
|---|---|---|
| patch 哈希 | == 快照值（`D8F12BC0…`） | 插件开机**没写**用户配置 = P0 未复发 |
| 备份数 | == 快照值 | 没触发切换路径（切换才备份） |
| 新日志窗口「手机作答模式」行 | **0** | 没有发生任何 timed↔legacy 切换 |
| `skipping profile bundle … dsh-push-host` | **0** | 插件真的被解析加载了（不是被跳过） |
| 正向加载标记（`relay ready/relay disabled/credentials file`） | **≥1** | 反向证明插件 `apply()` 跑到了 |
| 3081 端口持有者 | **≠ 快照值** | 真重启（老进程活着也会答 RUNNING） |
| 插件版本 | `0.2.1` | 装的是目标版本 |

**判据纪律**：日志是**跨重启追加**的 → 只判「本次重启窗口」（脚本按行号偏移切窗口）。
只看「退出码 0」或「服务 RUNNING」都不算过。

PASS 后取新链接：

```powershell
Select-String -Path "$env:USERPROFILE\.dsh\web.log" -Pattern 'dsh web: http' | Select-Object -Last 1
```

把 `http://<tailnet-windows>:3080/?token=<新 token>` 发给用户，并通知 tester 可跑 P02（生产设置页只读实测）。

## 5. 回滚（任何一步不对就做这个）

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\prod-rollout-plugin.ps1 -Rollback
# 然后重启清掉进程内存态，再跑 -Check 确认哈希回到期望值
powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\prod-rollout-plugin.ps1 -DispatchRestart
```

脚本动作：找回最近的 `*.prodroll-*` 备份 → 还原 `cordis.patch.yml` **与** `package.json`
（**只删 node_modules 会留悬空 `dsh.profile.bundles` 条目，之后每次开机报 `skipping profile bundle`**）→
卸插件 → 提示重启。

**教训（0.2.0 事故当天的实况）**：只回滚磁盘**不够** —— 仍在运行的坏插件会再次改写配置
（当时 `.bak` 时间戳 16:12:07 / 16:13:22 / 16:14:37 三连）。**必须同时重启承载进程。**

## 6. 边界与已知残余

1. **老会话不换变体**：`ask_user_question` 的 timed/legacy 变体在**会话创建时**钉进会话 header；
   设置页开关对**新会话**立即生效，已开的老会话保持旧行为（平台事实，UI 文案已写明）。
2. **状态显示依赖 cosmokit 私有符号**：`setVolatileValue` 用 `Symbol.for('cosmokit.volatile.write')` 写内存镜像。
   该符号若在 DSH 版本间改名，表现是**设置行状态文案不刷新**（不是写坏配置）——由 P02 的 UI 实测兜住。
3. **老会话 legacy 僵卡**：网页提问卡在外部作答后不结算（§3.5 根因），点卡片「跳过」无害解锁；根治需 DSH 上游补丁。
4. **本次不改 relay/aliyun**；不改 `claimForeground`（保持 `on`）。
