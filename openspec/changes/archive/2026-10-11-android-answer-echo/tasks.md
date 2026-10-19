# Tasks: android-answer-echo

- [x] 1. relay：备份（answer-relay.py.bak-echo-20261011-062628）→ submit 成功后发 `#ans` 静默消息（读 /etc/answer-relay/ntfytok）→ 重启服务 active → 隔离验证：写 token 发布 200、读 token 轮询收到（手机视角通路成立）
- [x] 2. App：handleMessage `#ans ` 早分支（cancel nid + markAnswered + 不渲染）；版本 1.13.0 / versionCode 37
- [x] 3. Lead 构建部署 aliyun `?v=45`（06:29:09 APK）；repo 副本 deploy/aliyun/answer-relay.py 已同步
- [x] 4. 用户醒来真机验收（网页上作答→手机通知消失）后归档
- [x] 5. 补丁：两端 hook 注册 PostToolUse 发 `#ans`（覆盖聊天界面作答，实测缺口）；repo 新增 deploy/windows 副本；模拟验证通过
