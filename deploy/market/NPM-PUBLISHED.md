# dsh-push-host 已发布到 npm（v0.3.2，2026-10-27）

## 事实

- 包页：https://www.npmjs.com/package/dsh-push-host
- registry：https://registry.npmjs.org/dsh-push-host
- `latest` dist-tag = **0.3.2**（10 个文件 / 65.0 kB 包 / 173.8 kB 展开）
- 0.3.2 tarball sha1 `23ea68ddce0741dbb46498a22c809c2c2e6513ca`，与本地 `npm pack` 逐字节一致
- 0.3.1 tarball sha1 `5e2cab2d1faea276e8cd7221aa2921b3c5de87c9`（保留在 registry，可回退）
- 版本历史：`0.0.0-stage`（npm 的 staged-publish 占位）→ `0.3.1` → `0.3.2`
- `repository` 字段 = `git+https://github.com/thiscp/dsh-push.git`（`directory: host-plugin`）
  ⇒ awesome-dsh-plugin 的 npm 关联靠这个字段自动采集，无需在任何 YAML 里写 `npm:`
- 装包冒烟：`npm install dsh-push-host` 在空目录成功，`dsh.bundle` / `cordis.patch.yml` / `dsh.client` 都在

## 0.3.2 修了什么（0.3.1 → 0.3.2）

`RelayClient.push()` 的默认 `priority` 从字符串 `'default'` 改成整数 `3`。
ntfy 的 **JSON body** 只接受整数 1–5；字符串 `'default'`（那是请求头写法）会被判
`400 {"code":40024,"error":"invalid request: request body must be valid JSON"}`。
插件内部三个调用点都显式传 `4/1/3`，所以线上一直没暴露，只有"没传 priority"的外部调用方会踩。
实测对照（同一 relay、同一 token）：
`{priority:'default'}` → 400；`{priority:'high'}` → 400；`{priority:'4'}` → 400；
`{priority:3}` / `{priority:4}` / 不传 → 200。

## 在两个真实宿主上做的安装 + 功能验收（2026-10-27）

| 宿主 | 装前 | 装后 | 装法 | relay ready | fatal | push 回执 |
|---|---|---|---|---|---|---|
| VM1 `user@<tailnet-vm1>` | 0.2.5（本地 tarball） | **0.3.2** | `pnpm add dsh-push-host@0.3.2` | `host=vm1 topic=dsh poll=3000ms` | 0 | 200 `V9Ubm8zvA4F3` |
| 工作VM `work@<tailnet-work>` | 0.1.1（本地 tarball） | **0.3.2** | `corepack pnpm add dsh-push-host@0.3.2` | `host=work … claimForeground=on` | 0 | 200 `JmJEZIuzXKOP` |

- 两台的 `dsh.profile.bundles` 里 `dsh-push-host` 条目**换依赖后依旧在**（换 npm 包不会丢 bundle 注册）。
- `dsh plugin --profile web add dsh-push-host`（裸名）**不会升级**：它只按 lockfile 解析，
  在已有 `^0.3.1` 满足约束时输出 "Lockfile is up to date, resolution step is skipped" 并原地不动。
  **要升版本必须写全 `name@version`。**
- VM1 用 `pnpm add dsh-push-host@0.3.2` 会把 `package.json` 里的 spec 从 `^0.3.1` 收紧成精确 `0.3.2`；
  工作VM 用 `corepack pnpm add` 则写成 `^0.3.2`。两者都验证过，功能一致。
- 工作VM 的 systemd 单元是系统级（`User=work`），`sudo systemctl restart dsh-net` 需要密码；
  **重启用用户态脚本即可**：`bash /home/work/work/learn/vmware/cp_learn_vmware/deepseek-harness/dsh-net.sh restart`。
- 顺带证实（VM1）：老的 0.2.5 每次启动都会在 `web.log` 打
  `fatal load failure: cannot get required service "configEditor" in inactive context`
  （`AskUserModeSwitch.sync` 缺 `fiberIsActive` 守卫，`lib/index.js:964`）；
  0.3.x 的 `sync()` 首行是 `if (!fiberIsActive(ctx)) return`，换上来后 fatal 计数为 0。

## 发不出去的两个坑（按顺序踩的）

1. **granular token 权限选成 No access** → 一切操作 403。必须选 `Read and write (publish and stage)`；
   包还没发布过时搜不到包名，直接选 `All packages`。
2. **账号开了 2FA** → 纯 publish 报
   `Two-factor authentication or granular access token with bypass 2fa enabled is required`。
   必须回到 token 页面**勾上 "Bypass two-factor authentication (2FA)"** 再生成。
   `npm whoami` 能过不代表能发布——发布是单独一道 2FA 闸。

## 两个会误导人的现象

- **registry 里会先冒出一个 `0.0.0-stage` 版本**，描述是
  `Temporary package placeholder for staged publishing`，并且 `dist-tags.latest` 一度指向它。
  ⇒ 发布成功后**必须把 `latest` 指回真实版本**：`npm dist-tag add dsh-push-host@0.3.1 latest`。
  这个占位版本用 bypass-2FA token **删不掉**（unpublish 被 `gh.io/npm-gat-bypass2fa-deprecation` 拦），
  要在网页上手工删，或者留着（不影响安装，`latest` 已经是 0.3.1）。
- **`https://www.npmjs.com/package/<name>` 用 curl 访问返回 403** 是 npm 的 bot 防护，不是包不存在。
  验证走 `https://registry.npmjs.org/<name>`，别拿网页 403 当失败。

## 发布命令

    powershell -NoProfile -ExecutionPolicy Bypass -File verify\npm-publish-host.ps1 -Token npm_xxx

脚本行为：把 `<registry>/:_authToken=` **一行**写进 `C:\Users\<user>\.npmrc`（先备份成 `.bak-publish`，
并清掉旧 authToken 行，不动其它配置）→ `npm publish --access public` →
回读 `registry.npmjs.org/<name>` 与 `/latest` 确认版本落地。

## 后续发版的正确姿势（推荐）

顶部黄条是官方的：**允许 bypass 2FA 的 token 从 2027 年 1 月起不能再直接发布**。
现在能用，但长期应改成 **Trusted Publishing**：GitHub Actions 用 OIDC 身份发布，
`npm publish --provenance`，不需要任何 token、也不会过期。要换的时候再说。

## 仍未完成

- GitHub 仓 `thiscp/dsh-push` 还没加 `dsh-plugin` topic（需要 GitHub 写权限）。
- 还没向 `awesome-dsh-plugin/awesome-dsh-plugin` 提 PR（条目文件已备好在 `deploy/market/`）。
