package xyz.cpyh.dshpush

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.widget.Toast

/** APK 下载完成自动拉起安装器（v1.20.0）：
 *  DownloadManager 完成后发 DOWNLOAD_COMPLETE 系统广播——按 id 查出本地
 *  content:// URI，是 .apk 就直接 ACTION_VIEW 包安装器，省掉手动翻找。 */
class DownloadDoneReceiver : BroadcastReceiver() {

    override fun onReceive(ctx: Context, i: Intent) {
        val id = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
        if (id < 0) return
        try {
            val dm = ctx.getSystemService(DownloadManager::class.java)
            var uri: Uri? = null
            var ok = false
            (dm.query(DownloadManager.Query().setFilterById(id)))?.use { c: Cursor ->
                if (c.moveToFirst()) {
                    val status = c.getInt(c.getColumnIndexOrThrow(
                        DownloadManager.COLUMN_STATUS))
                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        uri = c.getString(c.getColumnIndexOrThrow(
                            DownloadManager.COLUMN_LOCAL_URI))?.let { Uri.parse(it) }
                        ok = uri != null
                    }
                }
            }
            if (!ok || uri == null) return
            val path = uri!!.path ?: ""
            if (!path.endsWith(".apk", true)) return  // 非 APK 保持原样：只留下载通知
            // Android 7+ 禁把 file:// 递给别的 App（FileUriExposedException 必抛）；
            // 公共 Downloads 里的文件改从 MediaStore 换 content:// URI（v1.20.2）
            var finalUri = uri!!
            try {
                if (android.os.Build.VERSION.SDK_INT >= 29 && uri!!.scheme == "file") {
                    val name = path.substringAfterLast('/')
                    ctx.contentResolver.query(
                        android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                        arrayOf(android.provider.MediaStore.MediaColumns._ID),
                        android.provider.MediaStore.MediaColumns.DISPLAY_NAME + "=?",
                        arrayOf(name), null
                    )?.use { c ->
                        if (c.moveToFirst()) finalUri = android.content.ContentUris.withAppendedId(
                            android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                            c.getLong(0))
                    }
                }
            } catch (e: Exception) { }
            val install = Intent(Intent.ACTION_VIEW)
                .setDataAndType(finalUri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                ctx.startActivity(install)
            } catch (e: Exception) {
                Toast.makeText(ctx, "下载完了，但拉不起安装器(${e.javaClass.simpleName})，" +
                    "去下载列表手动装", Toast.LENGTH_LONG).show()
            }
        } catch (e: Exception) { }
    }
}
