# WebView 下载改自研 OkHttp 链路，绕开 OriginOS DownloadManager 卡死

## Why

v1.21.0 上架时真机（iQOO 13 / Android 16）实测：点「DSH 网页」里的 APK 链接，APP toast"开始下载 dsh-push-….apk"后**下载永远不动**——`DownloadManager.enqueue` 成功但 OriginOS 下载服务静默卡死（自启动/后台限制掐死系统下载组件），通知无进度、文件不落盘。系统下载组件不可控，vivo 上不可依赖。

## What Changes

- `WebActivity` DownloadListener：API 29+ 改 **OkHttp 自下载** → 流式写入 `MediaStore.Downloads`（IS_PENDING 两段式，下载列表仍可见）→ 完成后 `.apk` 直接 ACTION_VIEW 拉包安装器；失败清理 pending 条目并 toast 原因
- API<29 保留原 DownloadManager 路径（含同名加时间戳后缀逻辑）
- 安装器"未知来源"弹窗走系统标准流程（首次需用户在设置里放行"安装未知应用"）

## Impact

- 受影响 spec：`companion-app`（APK 下载分发——补自研下载与卡死兜底场景）
- 版本：v1.21.1（versionCode 50）
