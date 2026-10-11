package xyz.cpyh.dshpush

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        // Android 16（API 36）模拟器实测：BOOT_COMPLETED 起前台服务要么被拒首崩，
        // 要么被允许但服务内转正被拒换来 5 秒超时崩溃（v1.22.0/v1.22.1 两连崩）。
        // 改普通 startService（广播运行期间允许）：服务无转正义务、WS 照连；
        // 用户一开界面 MainActivity 即 startForegroundService 把它升回前台（v1.22.2）
        try {
            context.startService(Intent(context, PushService::class.java))
        } catch (e: Exception) {
            try {
                context.startForegroundService(Intent(context, PushService::class.java))
            } catch (_: Exception) {
            }
        }
    }
}
