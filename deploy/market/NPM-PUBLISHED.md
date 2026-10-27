# dsh-push-host 已发布到 npm（v0.3.1，2026-10-27）

## 事实

- 包页：https://www.npmjs.com/package/dsh-push-host
- registry：https://registry.npmjs.org/dsh-push-host
- `latest` dist-tag = **0.3.1**（10 个文件 / 64.2 kB 包 / 173.2 kB 展开）
- tarball sha1 `5e2cab2d1faea276e8cd7221aa2921b3c5de87c9`，与本地 `npm pack` 逐字节一致
- `repository` 字段 = `git+https://github.com/thiscp/dsh-push.git`（`directory: host-plugin`）
  ⇒ awesome-dsh-plugin 的 npm 关联靠这个字段自动采集，无需在任何 YAML 里写 `npm:`
- 装包冒烟：`npm install dsh-push-host` 在空目录成功，`dsh.bundle` / `cordis.patch.yml` / `dsh.client` 都在

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
