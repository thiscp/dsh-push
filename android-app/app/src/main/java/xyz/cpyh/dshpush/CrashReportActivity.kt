package xyz.cpyh.dshpush

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** 摔跤报告页：跑在独立 :crash 进程，主进程摔了它也站着（v1.7.1）。
 *  刻意不用自定义主题/资源——报告页自己绝不能成为新的崩溃点。 */
class CrashReportActivity : Activity() {
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val sp = getSharedPreferences(PushService.PREF, MODE_PRIVATE)
        val raw = sp.getString(App.KEY_CRASH, "") ?: ""
        if (raw.isEmpty()) { finish(); return }
        val seq = sp.getInt(App.KEY_SEQ, 0)
        // 看过即记账：主界面兜底不再重复弹（v1.7.3）
        sp.edit().putString(App.KEY_SEEN, raw.substringBefore('|')).apply()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(10))
        }
        root.addView(TextView(this).apply {
            text = "大肥鱼第 $seq 次摔跤（复制下面内容发给开发者）"
            textSize = 13f
            setTextColor(0xFF2C3E50.toInt())
            setTypeface(android.graphics.Typeface.DEFAULT_BOLD)
        })
        val trace = TextView(this).apply {
            text = raw
            textSize = 10f
            setTextIsSelectable(true)
        }
        root.addView(ScrollView(this).apply {
            addView(trace, LinearLayout.LayoutParams(-1, -2))
        }, LinearLayout.LayoutParams(-1, dp(340)).apply { topMargin = dp(8) })
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
        }
        row.addView(Button(this).apply {
            text = "复制"
            setOnClickListener {
                val cm = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("dshpush crash", raw))
                text = "已复制"
            }
        }, LinearLayout.LayoutParams(-2, -2))
        row.addView(Button(this).apply {
            text = "清除记录"
            setOnClickListener {
                sp.edit().remove(App.KEY_CRASH).remove(App.KEY_SEQ).remove(App.KEY_SEEN).apply()
                finish()
            }
        }, LinearLayout.LayoutParams(-2, -2))
        root.addView(row)
        setContentView(root)
    }
}
