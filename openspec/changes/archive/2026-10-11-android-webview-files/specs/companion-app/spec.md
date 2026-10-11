# Spec delta: companion-app

## ADDED Requirements

### Requirement: 网页文件上传与下载
App 内置网页窗口 SHALL 支持网页文件上传（`<input type=file>` 触发系统文件选择器，支持多选，结果喂回网页）与文件下载（非网页内容交系统 DownloadManager 写入公共 Downloads，通知栏出进度与完成项）。下载文件名 SHALL 优先取 URL 路径中的扩展名，MUST NOT 被泛型 MIME 带偏。下载完成且文件为 `.apk` 时 SHALL 自动拉起系统安装器（经 content:// URI 传递并授予读权限；非 APK 文件不自动打开）。

#### Scenario: 网页上传附件
- **WHEN** 用户在 DSH Web 聊天里点附件按钮选一张图
- **THEN** 系统文件选择器弹出，选中后图片正常上传进对话

#### Scenario: APK 链接下载
- **WHEN** 用户点网页里的 `…/dsh-push.apk?v=N` 链接
- **THEN** 通知栏出现下载进度，完成后文件名保持 `.apk` 扩展名

#### Scenario: APK 下载完成自动安装
- **WHEN** 一个 `.apk` 下载完成
- **THEN** 系统安装界面自动弹出（首次会请求"安装未知应用"授权）；图片等非 APK 下载完成则仅保留下载通知
