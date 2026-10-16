# dsh-push 项目指令（自动注入本仓库会话）

开工前先读 README.md 的「AI 开发工作流硬事实」和 CHANGELOG 顶部，别重新交学费。

- **方案与素材先上网**：Android API 行为、OriginOS/vivo 私有坑、人设立绘/壁纸素材，先 web_search 定位 + web_fetch 读原文/素材源，再动手写码；模拟器与 adb 探测只用于验证结论，不用于发现事实。
- **一条命令发布**：`powershell -File verify\dsh-app-verify.ps1 -Deploy -DeployNote "…"`（vm1 构建 → 模拟器安装 → 推送断言 → 上传 APK → 更新通知），期望 `SUMMARY: 9/9`。
- **每笔功能变更走 openspec**：`changes/<name>/proposal.md` + specs delta；MODIFIED 需求必须**逐字保留全部既有场景**再追加新场景。归档在 vm1 跑 `openspec archive <name> --yes`，改完双向 scp 同步 openspec 目录。
- **发布后同步开源**：`powershell -File verify\export-public.ps1 -Msg "…"`（GitHub + Gitee，脱敏闸门会拦 token/IP/用户名）。
- 含中文的文件一律用编辑器/.NET 读写，禁 PowerShell 文本 cmdlet；`.cmd` 文件 ASCII+CRLF；版本号**只在 `android-app/app/build.gradle.kts` 两处**（`versionCode` / `versionName`）；App 内显示的版本运行时从 `PackageInfo.versionName` 派生，**禁止再写死常量**（v1.32.17 起，`PushService.APP_VER` 已删）。
