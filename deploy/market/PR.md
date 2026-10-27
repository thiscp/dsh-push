# 投稿到 DSH 插件市场（awesome-dsh-plugin）

收录目录的真源是 GitHub 仓 `awesome-dsh-plugin/awesome-dsh-plugin` 的
`data/plugins/<owner>__<repo>.yml`（一个插件一个文件）。README 由脚本生成，**不要手改**。

## 一、前置：给仓库加 topic（必须在 PR 之前）

GitHub 上打开 https://github.com/thiscp/dsh-push → 右上齿轮 **Topics** → 添加 `dsh-plugin` → 保存。
这是硬性要求，CI 之外维护者也会看。

## 二、投稿文件

路径（文件名必须与 url 推导出的 slug 完全一致）：

    data/plugins/thiscp__dsh-push--host-plugin.yml

内容（本目录已存一份同名文件）：

```yaml
url: https://github.com/thiscp/dsh-push/tree/main/host-plugin
name: thiscp/dsh-push#host-plugin
category: notify
description:
  en: 'Phone push for DeepSeek Harness: hooks the question seam in-process so a pending question is delivered to your phone through an ntfy relay, and the answer you send from the phone is fed back to the agent as a user message even after it has stopped waiting.'
  zh: 'DSH 手机推送：进程内挂载提问 seam，把待答问题经 ntfy relay 推到手机；手机作答在该问题已超时后仍会以 user 消息回灌给 agent。'
```

要点：
- 走的是 **monorepo 子包**形态（插件在 `host-plugin/`），所以 `url` 指到子目录，
  `name` 用 `owner/repo#子名`，文件名变成 `owner__repo--子目录.yml`（斜杠换 `-`）。
- `category: notify` —— 手机推送通知，官方分类表里有这一项。
- 描述里的冒号用单引号包起来（YAML 里 `: ` 会被当嵌套键，官方文档专门警告过这条）。
- 描述里的每一条都能在代码里对上：`lib/index.js` 用 `ctx.waterfall("user-questions/request")`
  挂提问 seam；POST relay 由 relay 侧发 ntfy；手机答案经
  `ctx.userQuestions.answer(...)` + `agent.steer(...)` 回灌，即使问题已 `continued` 也照发。

## 三、PR 标题与正文

标题：

    Add thiscp/dsh-push (host-plugin) — phone push over ntfy relay

正文：

    Adds one entry: data/plugins/thiscp__dsh-push--host-plugin.yml

    dsh-push-host is the host-side half of a phone companion for DSH. It mounts the
    question seam in-process (`ctx.waterfall("user-questions/request")`), pushes a
    pending question to the phone through an ntfy relay, and feeds the answer the
    user sends from the phone back to the agent as a user message — including after
    the question has already timed out and the agent moved on.

    Installable directly from the repo (`dsh.bundle` + `cordis.patch.yml` present at
    host-plugin/package.json). Published to npm as `dsh-push-host`.

    Category: notify (it exists to deliver notifications to a phone and take the
    answer back). Monorepo subpackage entry, hence the /tree/main/host-plugin url.

## 四、本地自查（已跑过）

拉下 awesome 仓后：

    npm ci
    node scripts/generate-readme.mjs     # 可选，预览生成结果

用仓里的校验器跑全量条目（7212 条）验证，结果 `problems=0`。
