# 设计要点

## 回传路由（多主机）

- relay 保持单 BRIDGE_URL 常量（不引入主机表）：指向**最近接入主机**的桥接（当前 Windows `<tailnet-windows>:2588`）。
- Windows 桥接注册表键 `agentId + "|" + 排序后 qids`：本地 `$events` 流见过的 agentId 本地解（`$events/result`，失败回退 `userQuestions/answer`）；未命中则 6s 超时转发上游工作机桥接（同 X-Bridge-Token），上游响应原样回传。
- 问题注册仍由钩子脚本直连 relay（X-Reg-Token），与桥接无关；ntfy 推送与主机无关。

## Windows 钩子生效三件套（缺一即哑，均有 hook/result 事件实证）

1. **插件挂载**：`~/.dsh/hooks.json` 单独存在是死的；钩子是桥插件 `@deepseek-ai/dsh-hooks-claude-code`，必须在 profile `cordis.patch.yml` 用 `- insert:` 挂载并给 `config.configPath`。裸 `- id:` 条目只对已挂载插件做 config merge。
2. **部署级沙箱**：钩子命令（无会话上下文的 shell 调用）拿 `@deepseek-ai/dsh-sandbox-policy` 的部署默认 mode，而非会话 preset。Windows 服务（session 0）下 ACL 受限令牌子进程必死 0xC0000142（runner 文档自认 Console isolation is unavailable），故 patch `mode: danger-full-access`。会话侧沙箱语义由 permission presets 决定，不受影响（本机 defaultPreset 本就是 danger-full-access）。
3. **temp 出 workspace**：workspace-write 下 ACL runner 硬性要求 temp 根在 workspace 外；会话 cwd 缺失时 workspace 退化为服务进程 cwd（家目录），`%TEMP%` 必被包进 → 拒跑。run-dsh.cmd 固定 `TEMP=C:\Temp` 兜底（danger-full-access 下不触发，防回退）。

## 重启真实性

- status 探针答"活着吗"不答"换没换"：stop 阶段 Access denied 时老进程仍持端口，restart 假成功。
- 唯一真相 = 端口持有权：restart-once 前后快照 `Get-NetTCPConnection -LocalPort 3081 -State Listen` 的 OwningProcess，未变则 taskkill /T /F 真凶并重新 start。
- 配置是否进进程用 `dsh --profile web --dump-config` 看目标 id 行内容；退出码 0 不代表挂载成功。

## 会话事件取证

`~/.dsh/sessions/<proj>/<sid>/session.v4.jsonl.zstd` 为多帧流式 zstd：Node `zstdDecompressSync` 只解第一帧；用 python `zstandard.stream_reader` 全量解。`hook/invoked`+`hook/result` 成对，`stderrSummary` 携带沙箱拒绝原文。
