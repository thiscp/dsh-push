# Tasks: 宿主插件可分发 + 单用户开通（dsh-push-distribution）

## 1. npm 打包就绪（交付物 A）

- [x] 1.1 `host-plugin/package.json`：补 `repository`（指向公开仓库 `host-plugin/` 子目录）、
      `homepage`、`bugs`、`author`/`contributors`、`engines`（node >= 20.11）、
      `publishConfig: { access: public, registry }`、`keywords`、`bin`
- [x] 1.2 `files` 白名单定为 `lib` + `cordis.patch.yml` + `README.md` + `LICENSE`（自测脚本不入包）；
      `exports` 同时导出 `./credentials`、`./pairing`、`./pairing-lib`、`./relay`
- [x] 1.3 新增 `host-plugin/LICENSE`（标准 MIT 正文，版权 `cpyh` 2026）；`dsh.bundle` 加 `version: "1"`
      元数据（`patch` 仍为字符串，`bundlePatchFiles` 行为不变）
- [x] 1.4 本机没有 npm（DSH 只带 pnpm，`where npm` 为空），新增零依赖 `tools/pack-npm-tarball.mjs`
      复刻 `npm pack` 的判定（`files` 白名单 + 永远带上/永远排除规则 + 0755 + `package/` 前缀 + gzip），
      并打印同形 `npm notice` 清单与 sha1；`--dry-run` / `--json` 两种输出
- [x] 1.5 实测：`--dry-run` 清单 9 个文件、85,706 B 未压缩（9 文件清单见报告）；
      真打包出 `host-plugin/dsh-push-host-0.1.0.tgz`（30,300 B），tar 解包核对文件模式
      （`lib/pairing.mjs` 0755，其余 0644）；`.tgz` 内容随 README 变动而变，tar 头 mtime 归零但 gzip 字节不同
- [x] 1.6 `.gitignore` 忽略 `*.tgz`（打包产物不入库）
- [x] 1.7 新增 `tools/verify-distribution.mjs`：一条命令复现"清单 → tarball → 装进新 profile →
      dump-config 挂载 → 装了的那份包按凭据文件跑通三种情形"，8/8 通过（`--profile pushdist2` 全新 profile 实测）

## 2. 凭据文件（交付物 B）

- [x] 2.1 新增 `host-plugin/lib/credentials.mjs`：`parseCredentials` / `loadCredentials` /
      `credentialsPath` / `expandHome` / `describeSecrets`；键名不分大小写与连字符，
      接受 `writeToken→ntfyToken`、`readToken→phoneToken`、`relay→relayBase`、`host→hostId` 等别名，
      支持 `hosts{…}` 多 host 形式（根字段为默认值）
- [x] 2.2 `lib/index.js`：`resolvePluginConfig()` 实现分层 **内置默认 → 凭据文件 → profile/overlay 配置
      → 环境变量**；`credentialFilePath()` 暴露给 `pair` 命令；`apply()` 里"有文件且可读"各打一行日志，
      坏文件打 `credentials ignored: …`，**缺文件不打任何日志**（干净 no-op）
- [x] 2.3 兼容性：`resolveConfig()` 语义不变（旧测试用它），`withEnv()` 改为委托并保留导出；
      三个 `*TokenEnv` 环境变量仍最高优先级；`DSH_PUSH_REG_TOKEN` 不出现在凭据文件词汇表里
- [x] 2.4 `webLog` 默认值改为 `~/.dsh/web.log`（此前文档写这个默认值、代码是空串，`#web` 尾巴实际取不到）
- [x] 2.5 实测：44 项断言 `plugin-selftest-credentials.mjs`（凭据映射、优先级、缺文件 no-op、
      坏文件、别名/嵌套、路径解析、载荷 schema、env-only 回归），且**用 tarball 安装后的包**在
      `pushdist` profile 里跑通"文件给 token → 推送/轮询带上正确 header"

## 3. 配对命令（交付物 C）

- [x] 3.1 新增 `host-plugin/lib/pairing-lib.mjs`（纯函数：`buildPairingPayload` / `PAYLOAD_FIELDS` /
      `PAYLOAD_VERSION` / `summarizePayload`）与 `lib/pairing.mjs`（CLI：`payload` / `verify`）
- [x] 3.2 载荷**逐字同构** `deploy/relay-user-add.sh`：`{v:1, relay, host, topic, writeToken, readToken,
      hostToken}`、同顺序；缺字段非零退出并列出缺失项，绝不输出半份
- [x] 3.3 `verify` 五项只读自检（凭据文件 / 字段完整度 / `X-Host-Token` 200 / 读令牌 200 / 写令牌 200），
      `--json` 机器可读，失败给"先在 relay 上开号"的下一步
- [x] 3.4 `package.json` 加 `bin: { "dsh-push-pair": "./lib/pairing.mjs" }`，文件头带 shebang，入口判定
      按 basename（Windows bin shim 也成立）
- [x] 3.5 实测：真 relay 上 `GET /answer/pending?host=test1` + 假 `hk_` → `HTTP 401 bad host token`；
      真读令牌读 `topic dsh` → `HTTP 200`，同一令牌读 `dsh-test1` → `HTTP 403`（ntfy topic 级 ACL）
- [x] 3.6 App 侧不改代码，改为提案：`specs/companion-app/spec.md` 新增"配对载荷导入"要求
- [x] 3.7 新增 `tools/relay-queue-roundtrip.mjs`：真实队列往返证据（pending 基线 / 错令牌 401 /
      register / 作答页 / submit 入队 / pending 取到 / ack / 队列已清）。本机没有 relay 注册令牌
      （只存在于服务器 `/etc/answer-relay/regtoken`，且规则禁止我动服务器），所以该脚本交给主控用
      `DSH_PUSH_PROOF_HOST_TOKEN` + `DSH_PUSH_PROOF_REG_TOKEN` 跑一次即可补齐这条证据

## 4. 文档（交付物 D）

- [x] 4.1 `host-plugin/README.md` 新增"分发（npm 包）"：三种安装方式 + `tools/pack-npm-tarball.mjs` 用法
      + 实测清单体积 + "自测脚本不入包"
- [x] 4.2 新增"给一个真实用户开通"：三步图（开号 → 存凭据文件 → `dsh-push-pair`）、
      凭据文件字段对照表、容错与优先级、缺文件 no-op 语义
- [x] 4.3 新增"配对载荷：一条命令"：`payload` / `verify` 用法与五项自检判据、App 侧现状与提案指引
- [x] 4.4 新增"一个用户跑起来之前需要什么（清单）"8 条（含 `tool-ask-user` 必须 `mode: timed`、
      关掉旧 hook 提问推送、手机端订阅确认、收尾真机问一次答一次）
- [x] 4.5 配置章节重写为"非机密走 YAML / 机密走凭据文件或环境变量"，补
      `credentialsFile` 与 `DSH_PUSH_CREDENTIALS`；验收章节补 2b（配对自检）与 1b（开通层自测）
- [x] 4.6 范围与限制补：App 无导入按钮（含提案路径）、本包不含 relay 服务端、默认 relayBase 指向本项目实例
- [ ] 4.7 仓库根 `README.md` 第 8 条硬事实补一句"凭据文件 + `dsh-push-pair`"（**未做，主控切换生产时一并改**）

## 5. openspec（交付物 E）

- [x] 5.1 新变更 `dsh-push-distribution`：`proposal.md` + `tasks.md` + `design.md` + 两个 capability delta
- [x] 5.2 `dsh-host-plugin` delta：ADDED"包分发"、"凭据文件"、"配对载荷"；MODIFIED"配置与凭据"
      （基线 2 个场景逐字保留，追加 3 个）
- [x] 5.3 `companion-app` delta：ADDED"配对载荷导入"（不改 App，只出规格）
- [x] 5.4 新增 `tools/openspec-modify-check.mjs`：本机没有 openspec CLI，用它做归档前自检
      （MODIFIED 的基线场景是否逐字保留；控制实验证明改标题会被抓到）
- [ ] 5.5 归档（**未做**）：`openspec archive dsh-push-distribution --yes` 留给主控
      （本变更含生产切换前的收尾，归档时机由主控定）

## 6. 明确不做（不在本变更范围）

- [ ] 6.1 生产切换：不动 `profiles/web`、不改 `hooks.json`、不重启宿主
- [ ] 6.2 手机真机确认三类通知与直答行为（`dsh-host-plugin-push` 的 4.3）
- [ ] 6.3 `npm publish`（本机无 npm；由维护者在有 npm 的机器执行）
- [ ] 6.4 任何 App（Kotlin）代码改动
