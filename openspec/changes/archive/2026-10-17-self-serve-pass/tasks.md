# 任务（第 ① 段中继 + 第 ② 段插件已完成并验收，剩 App 与发版）

- [x] 1. 中继：确认 `dsh-provd` 的实现语言（先探测机器上有什么运行时：python3 / go / 现有 backend 容器），选最省内存的 （python3 3.6 stdlib，最省内存）
- [x] 2. 中继：写 `dsh-provd`（argv 调 `docker exec ntfy ntfy …`；secret 鉴权；body 上限；`--memory=64m`；restart 策略） （`relay/dsh-provd.py` 已上线：argv 调 CLI、secret 鉴权、body ≤ 4 KiB、MemoryMax=64M、Restart=always）
- [x] 3. 中继：`edge` nginx 加 `location /provision/` 反代到 127.0.0.1:2587，`nginx -t` 后 reload（不重启机器） （实际用 **2588**——2587 被我们自己的 answer-relay.py 占了 4 天；`nginx -t` 通过才 reload，改前自动备份）
- [x] 4. 中继冒烟：用 `qa-prov-*` 名字跑 发号 → 列表 → 用返回的只读 token 订阅 topic 成功 → 吊销 → 再订阅应 403 （全绿：发号→列表→只读 token 读自己 topic 拿到消息、读别人 403、匿名 403、只读去发布 403、**吊销后 401**（不是 403，规格已按实测校正）、残留 0；测授权必须用 `/json` 端点）
- [x] 5. 插件 v0.3.0：配置项 + 三个服务端能力 + 网页面板（发号 / 复制通行证 / 列表 / 吊销）+ 写回自身配置 （v0.3.0 已装笔电 profile：面板 + 发号 + 复制 + 列表 + 吊销 + 写回凭据文件并同步别名）
- [x] 6. 插件 selftest 扩到覆盖发号 URL 构造、通行证文本拼装、配置写回（现有 104/104 基线不回退） （**136/136**：URL 拼装、通行证文本、名字清洗、HTTP 四种结果、凭据写回与备份与别名同步、面板状态机含同 seq 幂等、fiber 重启回灌与转交、两张清单同步断言）
- [x] 7. App v1.33.0/103：通行证解析（`dshpush://v1` 与裸 `tk_` 两条路）、topic 持久化、订阅地址派生、状态卡片显示 topic （1.33.0/103 已发；解析器两条路 + 明确拒绝（缺 token / topic 非法 / base 不带 http(s) 就报中文原因且不写偏好）；订阅地址 `wsUrlOf()` 按本机 base+topic 派生；状态卡新增「（topic X）」；顺带修了状态卡陈旧：reload 是异步意图，只靠保存后那一次 refresh() 会把旧状态钉在屏上（真机实测「等待通行证」直到冷启动），改为停留时每 2 秒只刷状态卡、onPause 停表）
- [x] 8. App 验收：模拟器上粘新通行证 ⇒ 连到 `dsh-<name>` 并收到该 topic 的推送；粘老通行证 ⇒ 仍连 `dsh`（回归） （模拟器 emulator-5554 真机驱动：粘 `dshpush://v1?base=https://ntfy.cpyh.xyz&topic=qa-app-test&token=tk_09g…` ⇒ 状态卡「已连接（v1.33.0）」+「topic qa-app-test」，用配对的**只写** token 往该 topic POST（HTTP 200）⇒ 手机上**收到这张卡**；再粘回裸 `tk_5gz…70yo` ⇒ 退回「topic dsh」且已连接（回归通过，且这次不用冷启动））
- [x] 9. 发版：插件 tgz + 两端 profile 钉版（0.3.0）；App 走流水线（核对 `update-notify` 与线上包大小两条）
  - App：**1.33.0 / 103 已发布**，`dsh-app-verify.ps1 -Deploy` **SUMMARY 10/10**；`[PASS] update-notify - id: xPoF9iTLbraF`；线上 `Content-Length` **11,097,343 B**（上一版 11,000,052 B，不同 ✓）
  - 插件：**笔电 profile 已钉 0.3.0**（tgz + package.json + pnpm-lock 五处 integrity，DSH 已重启加载）✓
  - ⚠️ **工作机（work@<tailnet-work>）仍是 0.1.1**（`~/.dsh/profiles/web/node_modules/dsh-push-host`，DSH 从 npx 缓存跑）——它照常推送但没有发号面板；升到 0.3.0 需要重启那台 DSH（轮换 token + 打断在飞会话），**待用户点头再做**。原计划写的「两端」指笔电+台式机，台式机 2026-10-15 已退出 DSH，故此项按现状收口。
- [ ] 10. 文档：HANDOVER、openspec 归档、公开仓同步、skill 补「发号服务」硬事实
