# Proposal: android-webview-files

## Why

App 内置网页窗口（WebActivity）缺文件通道：网页里 `<input type=file>` 点了没反应（没挂 WebChromeClient），APK 等下载链接被 WebView 无声吞掉（没挂 DownloadListener）——用户在 DSH Web 里既传不了附件也下不了推送里的 APK。

## What Changes

- **v1.19.0**：WebChromeClient.onShowFileChooser → 系统文件选择器（ACTION_GET_CONTENT，多选，*/*），onActivityResult 喂回 ValueCallback；顺带恢复 JS alert/confirm。DownloadListener → 系统 DownloadManager 写公共 Downloads（重名加时间戳），通知栏进度+完成项；manifest 加 WRITE_EXTERNAL_STORAGE(maxSdk 28)。踩坑：DownloadManager 方法名是 addRequestHeader 不是 addHeader；vm1 的 android.jar 解析不了 FileChooserParams.acceptType，放弃 MIME 过滤
- **v1.19.1**：下载文件名优先信 URL 路径扩展名（服务器对 .apk 回 application/octet-stream，guessFileName 被带偏成 .bin）
- **v1.20.0**：DownloadDoneReceiver 接 DOWNLOAD_COMPLETE 系统广播——下载完成且是 .apk 时 ACTION_VIEW 自动拉安装器（省掉手动翻找）
- **v1.20.1**：manifest 补 REQUEST_INSTALL_PACKAGES（不声明则"安装未知应用"名单没有我们，安装器拒绝）
- **v1.20.2**：Android 16 DownloadManager 对公共 Downloads 返回 file:// URI，直接递安装器必抛 FileUriExposedException——改从 MediaStore.Downloads 按 DISPLAY_NAME 换 content:// URI 再递；toast 带异常名便于远程确诊

## Impact

- 修改：`WebActivity`（chrome client/下载监听/文件回调）、新增 `DownloadDoneReceiver`、manifest 两条权限+一个 receiver
- 真机验收：上传 ✓、.apk 命名 ✓、下载完成自动弹安装界面 ✓（2026-10-11 午，vivo iQOO 13 / Android 16）
