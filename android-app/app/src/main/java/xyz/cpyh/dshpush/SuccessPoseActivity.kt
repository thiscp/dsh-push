package xyz.cpyh.dshpush

import android.animation.ObjectAnimator
import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.ImageView

/** 全路径作答成功反馈（v1.27.0）：透明悬浮窗里立绘弹跳入场 + 原地摇摆浮动，
 *  1.4s 自动关闭。主页选项 chips 与通知栏直答按钮提交成功后由 AnswerReceiver
 *  拉起；快答浮窗自己有内嵌同款动画不走这里。
 *  通知栏后台拉起受 OEM 弹窗管控限制，被拦时 catch 掉，toast 兜底零回归。 */
class SuccessPoseActivity : Activity() {
    private val breathers = ArrayList<ObjectAnimator>()
    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pose = ThemePrefs.poseRes(this)
        if (pose == 0) { finish(); return }
        val iv = ImageView(this).apply { setImageResource(pose) }
        val h = dp(230)
        val w = (h * 935f / 1682f).toInt()
        val root = FrameLayout(this)
        root.addView(iv, FrameLayout.LayoutParams(w, h, Gravity.CENTER))
        setContentView(root)
        window?.apply {
            setDimAmount(0f)
            setBackgroundDrawableResource(android.R.color.transparent)
        }
        // 与快答浮窗内嵌动画同款：弹跳过冲入场 → 摇摆 + 浮动
        iv.pivotX = w / 2f; iv.pivotY = h.toFloat()
        iv.scaleX = 0.2f; iv.scaleY = 0.2f
        iv.animate().scaleX(1f).scaleY(1f).setDuration(450)
            .setInterpolator(OvershootInterpolator(2.2f)).withEndAction {
                ObjectAnimator.ofFloat(iv, "rotation", 0f, -2.5f, 0f, 2.5f, 0f).apply {
                    duration = 1300
                    repeatCount = ObjectAnimator.INFINITE
                    interpolator = AccelerateDecelerateInterpolator()
                    start(); breathers.add(this)
                }
                ObjectAnimator.ofFloat(iv, "translationY", 0f, -dp(6).toFloat(), 0f).apply {
                    duration = 900
                    repeatCount = ObjectAnimator.INFINITE
                    interpolator = AccelerateDecelerateInterpolator()
                    start(); breathers.add(this)
                }
            }.start()
        iv.postDelayed({ finish() }, 1400)
    }

    override fun onDestroy() {
        breathers.forEach { it.cancel() }
        super.onDestroy()
    }
}
