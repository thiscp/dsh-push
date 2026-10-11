# Tasks

## 1. 服务器权限模型（aliyun ntfy）

- [x] 1.1 建 `dshpub`（write-only dsh）与 `dshphone`（read-only dsh），各发 `tk_` token
- [x] 1.2 curl 五项隔离实测（写 200/读 403；读 403/读 200；匿名 403）

## 2. 工作机推送脚本

- [x] 2.1 `~/.config/dsh-ntfy/token` 追加 `NTFY_TOKEN`（write-only token）
- [x] 2.2 `/usr/local/bin/dsh-ntfy-push` 改 Bearer（备份 `.bak-token`，py_compile 过）
- [x] 2.3 端到端模拟 Stop 推送 exit=0、error.log 无 push fail

## 3. App 改造（v1.6.0 / versionCode 11）

- [x] 3.1 PushService：删 USER/PASS，prefs 读 token，Bearer 头，空令牌等待态，reload action，gen 计数器
- [x] 3.2 MainActivity：通行证卡片（保存/校验 tk_ 前缀）、长按头像清空换令牌、状态行加"通行证"一行
- [x] 3.3 QuickAnswerActivity：GET 改 Bearer（prefs token）
- [x] 3.4 strings 新增 4 条通行证文案；版本号 1.6.0

## 4. 构建与分发

- [x] 4.1 vm1 gradle assembleDebug（无新依赖）
- [x] 4.2 APK 推 aliyun，分享 `?v=20` 链接

## 5. 真机验收

- [x] 5.1 升级安装后首启出现通行证卡片；贴 token 后状态"已连接"、服务通知恢复"监听中…"
- [x] 5.2 推送到达正常（两类通知+提示音不回归）；快答提交成功
- [x] 5.3 长按头像清空 → 状态"等待通行证"、服务不崩不刷重连；贴回 token 恢复
- [x] 5.4 贴错 token（如 write-only 那个）→ 状态"通行证被拒(403)"
- [x] 5.5 验收通过后：删除 `dshbot` 账号，旧 APK 凭据作废（装旧包连不上）

## 6. 收尾

- [x] 6.1 VERIFICATION.md 验收记录
- [x] 6.2 提交推送（vm1 → Windows → Gitee），openspec 归档
