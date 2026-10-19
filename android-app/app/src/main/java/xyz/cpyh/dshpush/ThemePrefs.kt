package xyz.cpyh.dshpush

import android.content.Context
import android.util.TypedValue
import android.view.ContextThemeWrapper

/** 主题选择持久化 + 主题资源映射（v1.7.0 主题切换） */
object ThemePrefs {
    const val KEY = "theme"
    val KEYS = arrayOf("day", "night", "sakura", "matcha", "starry", "caramel")
    val NAMES = arrayOf("日间 · 晴海（默认）", "深夜 · 深海夜光", "樱花 · 樱瓣飘浮", "抹茶 · 抹茶布丁", "星空 · 银河入梦", "焦糖 · 焦糖布丁")

    private val ACT = intArrayOf(
        R.style.Theme_Dsh_Day, R.style.Theme_Dsh_Night,
        R.style.Theme_Dsh_Sakura, R.style.Theme_Dsh_Matcha,
        R.style.Theme_Dsh_Starry, R.style.Theme_Dsh_Caramel)
    private val DLG = intArrayOf(
        R.style.Theme_Dsh_Day_Dialog, R.style.Theme_Dsh_Night_Dialog,
        R.style.Theme_Dsh_Sakura_Dialog, R.style.Theme_Dsh_Matcha_Dialog,
        R.style.Theme_Dsh_Starry_Dialog, R.style.Theme_Dsh_Caramel_Dialog)

    fun current(ctx: Context): Int {
        val k = ctx.getSharedPreferences(PushService.PREF, Context.MODE_PRIVATE)
            .getString(KEY, "day") ?: "day"
        return KEYS.indexOf(k).coerceAtLeast(0)
    }

    fun set(ctx: Context, idx: Int) {
        ctx.getSharedPreferences(PushService.PREF, Context.MODE_PRIVATE)
            .edit().putString(KEY, KEYS[idx.coerceIn(0, KEYS.size - 1)]).apply()
    }

    /** 主界面用（NoActionBar 全屏主题） */
    fun themeRes(ctx: Context) = ACT[current(ctx)]

    /** 当前主题的全身立绘资源（无对应返回 0）；pose 映射唯一权威表（v1.26.0） */
    fun poseRes(ctx: Context): Int = when (KEYS[current(ctx)]) {
        "day" -> R.drawable.pose_maid
        "night" -> R.drawable.pose_serious
        "sakura" -> R.drawable.pose_shy
        "matcha" -> R.drawable.pose_confused
        "starry" -> R.drawable.pose_starry
        "caramel" -> R.drawable.pose_cheerful
        else -> 0
    }

    /** 当前主题的"活立绘"动画（res/raw 动画 WebP，API 28+ 播放；v1.31.0）。
     *  素材由 tools/gen_pose_anim.py 从静态立绘离线合成（发丝/裙摆/尾尖波动+呼吸）。 */
    fun poseAnimRes(ctx: Context): Int = when (KEYS[current(ctx)]) {
        "day" -> R.raw.pose_anim_maid
        "night" -> R.raw.pose_anim_serious
        "sakura" -> R.raw.pose_anim_shy
        "matcha" -> R.raw.pose_anim_confused
        "starry" -> R.raw.pose_anim_starry
        "caramel" -> R.raw.pose_anim_cheerful
        else -> 0
    }

    /** 快答浮窗用（Dialog 主题，保持对话框窗口形态） */
    fun dialogThemeRes(ctx: Context) = DLG[current(ctx)]

    /** 从"所选主题"（而非 ctx 自带主题）解析颜色属性——服务场景用 */
    fun color(ctx: Context, attr: Int): Int {
        val t = ContextThemeWrapper(ctx, themeRes(ctx)).theme
        val tv = TypedValue()
        t.resolveAttribute(attr, tv, true)
        return if (tv.resourceId != 0) ctx.resources.getColor(tv.resourceId, t) else tv.data
    }
}
