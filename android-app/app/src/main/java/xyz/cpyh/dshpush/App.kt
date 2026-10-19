package xyz.cpyh.dshpush

import android.app.Application
import android.content.Intent
import android.content.SharedPreferences
import java.io.PrintWriter
import java.io.StringWriter

/** 全局崩溃捕获：堆栈同步落盘 + 拉起独立进程的摔跤报告页（v1.7.1） */
class App : Application() {

    override fun onCreate() {
        super.onCreate()
        val sp = getSharedPreferences(PushService.PREF, MODE_PRIVATE)
        val prev = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            try {
                val sw = StringWriter()
                e.printStackTrace(PrintWriter(sw))
                // 进程马上要死，必须 commit 同步落盘，apply 来不及
                sp.edit()
                    .putString(KEY_CRASH, "${System.currentTimeMillis()}|${t.name}\n$sw")
                    .putInt(KEY_SEQ, sp.getInt(KEY_SEQ, 0) + 1)
                    .commit()
                try {
                    startActivity(Intent(this, CrashReportActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS))
                } catch (_: Exception) { }
            } catch (_: Exception) { }
            prev?.uncaughtException(t, e)
        }
    }

    companion object {
        const val KEY_CRASH = "crash"
        const val KEY_SEQ = "crash_seq"
        const val KEY_SEEN = "crash_seen"
    }
}
