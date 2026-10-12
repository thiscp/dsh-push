package xyz.cpyh.dshpush

import android.animation.ObjectAnimator
import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.ImageView

/** 全路径作答成功反馈（v1.31.0）：透明悬浮窗里"活立绘"动画 WebP 弹跳入场后循环播放
 *  （发丝裙摆波动+呼吸，API 28+），约 2.6s 自动关闭；API<28 或解码失败退回 v1.27 的
 *  运行时摇摆（静图+属性动画）。主页消息卡片选项与通知栏直答按钮提交成功后由
 *  AnswerReceiver 拉起；快答浮窗自己有内嵌同款动画不走这里。
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
        // 活立绘动画（v1.31.0）：与快答浮窗同款——系统 ImageDecoder 播动画 WebP（API 28+）
        var anim: android.graphics.drawable.AnimatedImageDrawable? = null
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            val animRes = ThemePrefs.poseAnimRes(this)
            if (animRes != 0) try {
                val dr = android.graphics.ImageDecoder.decodeDrawable(
                    android.graphics.ImageDecoder.createSource(resources, animRes))
                if (dr is android.graphics.drawable.AnimatedImageDrawable) {
                    iv.setImageDrawable(dr); anim = dr
                }
            } catch (e: Exception) { }
        }
        // 弹跳过冲入场 → 动画循环（无动画素材时退回摇摆 + 浮动）
        iv.pivotX = w / 2f; iv.pivotY = h.toFloat()
        iv.scaleX = 0.2f; iv.scaleY = 0.2f
        iv.animate().scaleX(1f).scaleY(1f).setDuration(450)
            .setInterpolator(OvershootInterpolator(2.2f)).withEndAction {
                if (anim != null) {
                    anim.repeatCount = -1
                    anim.start()
                } else {
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
                }
            }.start()
        // 验收钩子：--ei holdMs 延长停留（仅测试传，线上无人传零影响）
        val hold = intent.getIntExtra("holdMs", 0)
        iv.postDelayed({ finish() },
            if (hold > 0) hold.toLong() else if (anim != null) 2600L else 1400L)
    }

    override fun onDestroy() {
        breathers.forEach { it.cancel() }
        super.onDestroy()
    }
}
