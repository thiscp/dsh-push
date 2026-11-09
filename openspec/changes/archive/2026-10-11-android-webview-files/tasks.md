# Tasks: android-webview-files

- [x] 1. v1.19.0：WebChromeClient 文件选择 + onActivityResult 多选回喂 + DownloadListener 转 DownloadManager（addRequestHeader 坑、acceptType 坑）+ WRITE_EXTERNAL_STORAGE(maxSdk28)
- [x] 2. v1.19.1：下载文件名优先信 URL 路径扩展名（octet-stream 带偏 .bin）
- [x] 3. v1.20.0：DownloadDoneReceiver 接 DOWNLOAD_COMPLETE，.apk 自动 ACTION_VIEW 拉安装器
- [x] 4. v1.20.1：补 REQUEST_INSTALL_PACKAGES 声明
- [x] 5. v1.20.2：file:// → MediaStore content:// URI（FileUriExposedException 修复），toast 带异常名
- [x] 6. 真机验收：上传 ✓、.apk 名 ✓、自动弹安装界面 ✓（用户："新版本安装后好像可以了"）后归档
