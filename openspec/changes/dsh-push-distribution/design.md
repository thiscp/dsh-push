# Design: 宿主插件可分发 + 单用户开通

## 决策 1：为什么令牌先落"凭据文件"而不是继续用环境变量

环境变量对**开发者**成立（本机 profile 早就这么跑），对**用户**不成立：Windows 上要给 DSH 宿主进程
注入环境变量意味着改计划任务/服务定义或启动器脚本，出错时插件只会安静地降级成透明监听器——用户看到
的现象是"装了没反应"，没有任何线索。凭据文件把三件事收进一个可被工具读写、可被复制、可被
`verify` 自检的落点，而且**正好就是给手机的那份配对载荷**，不需要第二套 schema。

分层顺序选 `默认 < 文件 < profile 配置 < 环境变量`：

- 环境变量最高：老部署与"临时换一个令牌试试"都不受影响；
- profile 配置高于文件：操作者显式写在 YAML 里的值应当赢过文件（可诊断：文件被谁压过看代码即可）；
- 文件高于默认：文件存在的意义就是生效。

"文件不存在 = 干净 no-op"是硬要求：插件必须在**没有做任何开通**的 profile 里也能挂载（否则
`dsh plugin add` 之后宿主起不来），所以"没有文件"不能算错误，只有"文件在但坏了"才值得一条日志。

## 决策 2：配对命令为什么放在插件包里

`deploy/relay-user-add.sh` 跑在 relay 主机（Linux、有 docker/ntfy/curl/python），它产出**开号结果**；
`dsh-push-pair` 跑在用户主机（Windows、只有 DSH 自带的 node），它产出**同一份载荷**用来交给手机。
两者职责不同但 schema 必须一致：因此 `pairing-lib.mjs` 只做纯函数映射，字段名与顺序以
`relay-user-add.sh` 里那段 python 为唯一定义（`v`=1、`relay/host/topic/writeToken/readToken/hostToken`），
并把"缺字段拒绝输出"做成硬行为，避免出现"半份载荷"这种最难查的故障。

`verify` 的价值在于把"令牌对不对"提前到手机上动手之前：五项检查全部是**只读**（写令牌那项发一条
普通优先级通知，也算给用户一个可见信号），不读别人的队列、不改 relay 状态。

## 决策 3：本机没有 npm，怎么"证明可发布"

本机 `where npm` 为空，DSH 只带 pnpm 运行时，装 npm 不在本任务范围内（也会污染宿主）。但"可发布"
的判据不是"npm publish 成功"，而是：**包内容正确**（谁在包里、路径与模式对不对）+ **这个包能装能用**。
因此：

- `tools/pack-npm-tarball.mjs` 复刻 `npm pack` 的判定并输出同形清单（9 文件 / 75.0 kB），
  产物是标准 npm tarball（`package/` 前缀 + gzip + ustar 头 + 0755 bin）；
- 真正的验收是**把 tarball 装进一个全新 profile**：`dsh plugin --profile pushdist add ./…tgz`
  → pnpm 把它当包下载安装 → `--dump-config` 出现 `- id: push-host`；
- 发布本身（`npm publish`）留给有 npm 的机器，命令写在 tasks 与本报告里。

## 决策 4：`dsh.bundle` 加 `version` 是否安全

读 `@deepseek-ai/dsh-app-boot` 源码（asar 内）确认 `bundlePatchFiles()` 只读 `bundle.patch`
（字符串或字符串数组），其余键忽略；`dsh-plugin-manager` 用 `manifest.dsh?.bundle?.patch === undefined`
判断"是不是 bundle"。因此加 `version` 不影响挂载，只作为元数据；实测安装 + `--dump-config` 通过。

## 决策 5：openpspec 自检脚本而不是直接归档

`openspec` CLI 只装在 vm1，本机没有；而本变更的 MODIFIED 块一旦漏抄基线场景，归档会被拒。
`tools/openspec-modify-check.mjs` 复刻那条检查（基线场景标题是否逐字保留），并用**控制实验**
（故意改一个标题）证明它真的会报错——否则这类脚本很容易"永远 PASS"。归档时机留给主控，因为
本变更的收尾（生产切换）由主控执行。

## 已知限制

- `verify` 的写令牌检查会发一条 ntfy 通知；对生产 topic 而言就是手机收到一条"配对自检"。这是
  刻意的（可见证据优于静默通过），操作者知道自己在做什么。
- 凭据文件里的 `readToken` 插件侧只做"带过去给配对命令"，插件自己不读 topic——也就是手机侧的
  只读令牌在主机上存在一份副本。这是"操作者手里一份文件办完所有事"的取舍，写进了 README 的字段表。
