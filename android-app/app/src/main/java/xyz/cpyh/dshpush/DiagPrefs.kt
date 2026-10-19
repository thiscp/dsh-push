package xyz.cpyh.dshpush

import android.content.Context

/**
 * 调试浮层开关（v1.32.28）。
 *
 * 默认**关**：正常使用时网页里不出现任何调试文字。
 * 打开后 WebView 页面左上角会出现诊断 HUD（谁在画当前元素 / 走了哪个分支 /
 * 有没有被 .dshOv 标记 / 视口多高），用来排查「模拟器复现不了」的真机问题
 * （典型：软键盘弹起后视口变矮、浮层被键盘态改写）。
 *
 * 开关在主界面第三行「调试浮层」按钮上切换，存 shared_prefs/dshpush.xml。
 * WebActivity 注入脚本时把这个值烘进字符串（随页面加载定态）；切完回到页面
 * 由 onResume 里的 window.__dshDiagSet 热改，不必重开页面。
 */
object DiagPrefs {
    const val KEY = "diagHud"

    fun on(ctx: Context): Boolean =
        ctx.getSharedPreferences(PushService.PREF, Context.MODE_PRIVATE)
            .getBoolean(KEY, false)

    fun set(ctx: Context, v: Boolean) {
        ctx.getSharedPreferences(PushService.PREF, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY, v).apply()
    }
}
