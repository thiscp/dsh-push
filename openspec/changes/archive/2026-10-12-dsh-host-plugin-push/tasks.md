# Tasks: DSH 宿主插件接管推送与作答

## 1. 插件实现（本变更核心）

- [x] 1.1 `host-plugin/lib/index.js`：`Config` + `apply()`；`inject: ['userQuestions', 'timer']`；
      全部字段带默认值，缺 `host`/`hostToken` 时透明停用
- [x] 1.2 通知层：`user-questions/request` prepend → 推 ntfy（priority 4，含 `📱 作答` 链接、`#qid`、
      `#opts`、`#web`、`#name`）+ `/answer/register`（带 `hostId`）→ `return next()`
- [x] 1.3 通知兜底：`tools/pre-execute` 第二触发点，按 `exec.callId` 与 1.2 去重
- [x] 1.4 作答层：`ctx.interval` 轮询 `/answer/pending` → `ctx.userQuestions.answer(活根 agent, callId)`
      → `/answer/ack`；`open` 扣住、`settled` 丢弃、无活 agent 留队列、legacy 明确拒绝
- [x] 1.5 结束推送：`agent/turn-stopping` → `DSH 任务结束 [sess8]` + `目录: <cwd>` + `#web` + `#name`，
      按 `session:turn` 去重，priority 3，fire-and-forget
- [x] 1.6 回声：`tools/post-execute` → `#ans <callId> <摘要>`（priority 1）；`{pending:true}` 不回声；
      与"relay 投递后自回声"互相去重
- [x] 1.7 `lib/relay.js` 轮询 URL 唯一化（`&_=<时间戳>`），修"同一 URL 拿到缓存响应"的坑
- [x] 1.8 `plugin-selftest.mjs`：假 ctx + 假 relay，48 项断言（含 open 期扣住、settled 才丢、
      pending 不回声、工具链透明性、轮次去重）

## 2. relay 侧（已部署，本变更入库契约）

- [x] 2.1 `POST /answer/host` 开号签发 `hk_` 令牌 + topic
- [x] 2.2 `POST /answer/register`（带 `hostId`）→ `/answer/submit` 入队并回 `queued:true`
- [x] 2.3 `GET /answer/pending` + `POST /answer/ack`（`X-Host-Token`）
- [x] 2.4 每用户隔离开号脚本 `deploy/relay-user-add.sh`（已 4/4 验证）

## 3. 宿主侧验收（本机实测，2026-10-12）

- [x] 3.1 `--from-default-profile headless` 新建 `pushtest`，`plugin add "link:…/host-plugin"`
- [x] 3.2 `--dump-config` 尾部出现 `- id: push-host` / `name: dsh-push-host`
- [x] 3.3 通知层真机冒烟：合成提问 → ntfy 收到提问卡（正文含链接与四条 trailer，priority 4）
- [x] 3.4 作答页：`GET /answer/<callId>` 200 且渲染问题/选项
- [x] 3.5 端到端闭合（真 agent + timed 工具）：窗口期内提交 → `state=open` 扣住 → 超时后
      `answered (continued)` → agent 回复承认收到答案
- [x] 3.6 结束推送与回声：`DSH 任务结束 [sess]`（priority 3）与 `#ans`（priority 1）到达同一 topic
- [x] 3.7 `node plugin-selftest.mjs` → 48/48

## 4. APP 侧回归（"功能完全一致"的判据）

- [x] 4.1 载荷语法逐字复刻（问题/结束/回声三类，字段与 priority 与 hook 一致，见 design 决策 6）
- [x] 4.2 APP 侧（模拟器）回归：**2026-10-12 完成**
      - 基线流水线（生产 topic `dsh`，APP 的 topic 硬编码）：
        `verify\dsh-app-verify.ps1 -SkipBuild -Apk <当期 APK> -Fresh` → **`SUMMARY: 7/7 passed`**
        （install Success / push-received / mid-unique / entry-unread / 截图 224107）
      - 插件路径：pushtest 宿主以 `topic: dsh` 跑真 agent 提 timed 问（90 s），APP 落库条目
        `{"title":"DSH 等你选择 [57a912cd]","body":"App regression: which option?\n→ alpha / beta",
        "callId":"call_00_ET_rA84…","qid":"q1","opts":{"qid":"q1","labels":["alpha","beta"]},"answered":"alpha"}`
        —— 即 APP 按既有语法解析了插件的 `#qid`/`#opts`，并因 `#ans` 回声把卡片置为已答；
        截图 `plugin-notif.png` 里"大肥鱼盯梢"组内可见 `DSH 等你选择 [57a912cd]` 卡片。
      - 同一轮插件日志：`queue: 1 item(s)` → `not answerable yet (state=open); keeping the phone answer queued`
        → `returned pending; the phone card stays answerable` → `answered (continued) <callId>`
        → 紧接着 agent 进入第二问 q2（证明第一问工具调用返回后 agent 继续）。
      - 环境处置记录见 `verify/README.md` 硬事实（`-gpu host` 非交互起不来 / 强杀留锁 / 客机框架半死指纹）。
- [x] 4.2b 载荷形态覆盖（同一 prefs 断言标准，2026-10-12）
      - 多问题批次（2 问，单批）：ntfy 收到
        `App regression multi: first question\n→ alpha / beta\n📱 作答: …\n#qid q1\n#web http://<tailnet-windows>:3080/?token=…\n#name win-test`
        （**无 `#opts`**）；APP 落库 `{"title":"DSH 等你选择 [7158805a]","body":"…","web":"…","callId":"…","nid":…,"qid":"q1"}`
        —— `qid=q1` 有、`opts` 无，即"多问题走快答/自由文本、自由文本默认答给首问"的落点正确
      - `#web`/`#name`：APP 的 `hosts` 条目被改名 `{"id":"<tailnet-windows>:3080","name":"win-test","url":"…","lastSeen":…}`
        （此前是 hook 推送留下的"台式机"），`webUrl` 同步刷新 token
      - 结束推送：APP 落库 `{"title":"DSH 任务结束 [7158805a]","body":"目录: F:\\work\\work_dsh","web":"…","mid":…,"read":false}`
      - 截图：`plugin-notif.png`（通知组内可见 `DSH 等你选择 [57a912cd]` 卡片）
- [ ] 4.3 真机确认：用户在手机上确认三类通知与直答行为与现状一致

## 5. 规格与文档

- [x] 5.1 新增能力 `dsh-host-plugin` 规格
- [x] 5.2 `dsh-turn-notify` / `dsh-question-notify` 泛化措辞（既有场景逐字保留）
- [x] 5.3 `answer-relay` 补队列与开号要求
- [x] 5.4 `dsh-host-integration` 补宿主插件挂载与生效要求
- [x] 5.5 `host-plugin/README.md`（配置、安装、三个坑、三个触发点对照表、验收记录）
- [x] 5.6 仓库 README：目录表补 `host-plugin/`，硬事实补第 8 条（timed 依赖 + 两个实测坑）

## 6. 部署（未执行，用户确认后做）

- [ ] 6.1 给目标 profile 的 `tool-ask-user` 加 `config: { mode: timed, timeout: 120 }`
- [ ] 6.2 `dsh plugin --profile <profile> add <本仓库 host-plugin 路径>` + 环境变量配三个令牌
- [ ] 6.3 关掉 `hooks.json` 的 `PreToolUse` 提问推送（避免双推；`Stop` 推送可留可撤）
- [ ] 6.4 重启宿主（token/插件加载），以端口持有权 PID 变更 + `--dump-config` 行内容为判据
- [ ] 6.5 归档本变更：`openspec archive dsh-host-plugin-push --yes`
