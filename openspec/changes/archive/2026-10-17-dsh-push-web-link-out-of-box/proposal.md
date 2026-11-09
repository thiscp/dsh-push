# 网页入口开箱即有（插件 0.1.1）

## Why

新电脑"装 DSH → 装插件 → 装 App"后，推送上的「DSH 网页」按钮**静默缺席**：`webBase` 默认为空时
插件直接不带 `#web`（旧行为），而配对命令 `dsh-push-pair payload` 又从不输出这个字段——熟人照文档
setup 也踩坑，且没有任何报错提示。2026-10-13 用户在同一屏里看到"VM 的推送有按钮、台式机的没有"
才发现这个不对称（VM 走旧外部 hook 自带链接，台式机走新插件没配基址）。

## What Changes

- **`webUrl()` 兜底**：`webBase` 为空时不再返回空串，改为**直接使用 web.log 里 DSH 自己打印的最后一条
  `?token=` URL**（里面本来就含 host:port:token）。可达性 = DSH 实际绑定地址的可达性；`webBase`
  仍是"手机从别的网络拨进来"时的正解。web.log 读不到/无 token 行 → 仍不带 `#web`（行为不变）。
- **配对载荷可选字段**：`dsh-push-pair payload` 新增 `--web-base <url>` / `--web-name <名>`；
  已知时把 `webBase`/`webName` 写进载荷 JSON（存成凭据文件后插件即带链接）。不知道就不写——
  7 字段载荷与 `relay-user-add.sh` 仍逐字同构，`v` 不变，缺字段判定不变。
- selftest 新增 5 条断言（回退/重基址/载荷含与不含/新参数解析），并把 selftest 改为**封闭**：
  `DSH_PUSH_CREDENTIALS` 指向不存在的路径——本次就因它读真凭据文件（刚加了 webBase）污染了
  "空 webBase"用例，教训写进文件头。
- 版本号 `dsh-push-host` 0.1.0 → 0.1.1；README 配置表与配对一节同步。
- 不改 App、不改 relay、不改 `relay-user-add.sh`（它不知道用户网络，从不输出这两个字段）。

## Impact

- 影响面：`host-plugin/lib/index.js`（webUrl）、`lib/pairing-lib.mjs`、`lib/pairing.mjs`、selftest、README。
- 不影响：推送语法其余 trailer、relay 契约、App 解析（消息侧 `#web` 规则不变：消息带链接且有
  `?token=` 才画按钮）、老部署（显式 `webBase` 的行为逐字不变）。
- 验收：`node plugin-selftest.mjs` 53/53；台式机重启后真实"任务结束"推送正文含
  `#web http://<tailnet-windows>:3080/?token=<新鲜token>`（凭据已配 webBase，走重基址路径）。
