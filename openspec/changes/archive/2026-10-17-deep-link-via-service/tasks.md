# 任务

- [x] 1. 复现用户场景：页面已开着、只改片段不重载（`runurl.mjs` + 页内 `location.hash = <id>`）
- [x] 2. v0.2.3：加 `hashchange` 监听、每次现读片段；并修 `ctx.effect` 的清理器写法（fn 是立即执行的效果体，
      返回的那个函数才是清理器——写错会让监听刚挂上就被摘掉）
- [x] 3. 中文形态实测：摘掉语义锚点 + 标签改成「打开侧边栏」⇒ 仍能切换（v0.2.4，语义锚点 + 中英双标签）
- [x] 4. v0.2.5：改用 `ctx.inject(["uiWorkspace"])` 取服务并调 `openSession`；加 `workspaceProbed` 闸门，
      防止服务到货前误点侧栏开关（实测第一拍 inject 还没到货）
- [x] 5. 全程采样验收「抽屉到底有没有弹」：9 秒 36 次采样侧栏会话行数 **maxRows = 0**、**500ms** 内切换
      （VM1 与笔电生产各一次，`service:true / opened:false / clicks:0 / done:true`、片段抹掉）
- [x] 6. `node --check` 通过、插件 selftest 104/104；两台 profile 的 tgz 钉法与 lock 的 specifier/integrity/
      快照 version 一并升到 0.2.5（VM1 的 tgz 挪到持久目录 `~/dsh-pkgs/`）
