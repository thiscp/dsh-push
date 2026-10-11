package xyz.cpyh.dshpush

import android.animation.ObjectAnimator
import android.app.Activity
import android.app.AlertDialog
import android.app.NotificationManager
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.animation.OvershootInterpolator
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class QuickAnswerActivity : Activity() {
    private val client = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS).build()
    private var callId = ""
    private var nid = 0
    private var loadingDlg: AlertDialog? = null
    private val breathers = ArrayList<ObjectAnimator>()
    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun c(attr: Int): Int {
        val tv = TypedValue()
        theme.resolveAttribute(attr, tv, true)
        return if (tv.resourceId != 0) resources.getColor(tv.resourceId, theme) else tv.data
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // 同 MainActivity：setTheme 放 super.onCreate 前，attachBaseContext 阶段 window 为 null（v1.7.0 闪退根因）
        setTheme(ThemePrefs.dialogThemeRes(this))
        super.onCreate(savedInstanceState)
        callId = intent.getStringExtra("callId") ?: ""
        nid = intent.getIntExtra("nid", 0)
        if (callId.isEmpty()) { finish(); return }
        // 通知"肥鱼快答"= activity PendingIntent + RemoteInput（v1.15.0）：
        // 系统弹了输入框 → 结果在 intent 里，直接提交走成功动画；
        // 没弹框（结果 null）→ 落到下面正常快答流程，行为等同旧版，零回归
        if (intent.getBooleanExtra("replySlot", false)) {
            val reply = android.app.RemoteInput.getResultsFromIntent(intent)
                ?.getCharSequence("reply")?.toString()?.trim()
            if (!reply.isNullOrEmpty()) {
                val ans = JSONArray().put(JSONObject()
                    .put("id", intent.getStringExtra("qid") ?: "q0")
                    .put("selected", JSONArray())
                    .put("custom", reply))
                submit(ans)
                return
            }
        }
        showLoading()
        val t0 = android.os.SystemClock.elapsedRealtime()
        Thread {
            try {
                val tk = getSharedPreferences(PushService.PREF, MODE_PRIVATE)
                    .getString(PushService.KEY_TOKEN, "") ?: ""
                val req = Request.Builder()
                    .url("${PushService.BASE}/answer/${URLEncoder.encode(callId, "UTF-8")}/json")
                    .header("Authorization", "Bearer $tk")
                    .build()
                client.newCall(req).execute().use { r ->
                    val body = r.body?.string() ?: ""
                    if (!r.isSuccessful) {
                        hideLoading()
                        PushService.markAnswered(this, callId, "__expired")
                        toastOnMain("问题已过期或不存在"); finish(); return@use
                    }
                    val j = JSONObject(body)
                    val questions = j.getJSONArray("questions")
                    // 呼吸动画至少展示 600ms，网络再快也看得见（v1.8.1）
                    val wait = 600L - (android.os.SystemClock.elapsedRealtime() - t0)
                    runOnUiThread {
                        window.decorView.postDelayed({
                            if (!isFinishing && !isDestroyed) {
                                hideLoading(); askQuestion(questions, 0, JSONArray())
                            }
                        }, maxOf(wait, 0L))
                    }
                }
            } catch (e: Exception) {
                hideLoading()
                toastOnMain("网络错误: ${e.message}"); finish()
            }
        }.start()
    }

    // 取问题期间的呼吸等待（v1.8.0）：不再白屏干等
    private fun showLoading() {
        val iv = ImageView(this).apply { setImageResource(R.drawable.pet_idle) }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(14), dp(20), dp(14))
            addView(iv, LinearLayout.LayoutParams(dp(46), dp(46)))
            addView(TextView(context).apply {
                text = "大肥鱼正在取问题…"
                textSize = 14f
                setTextColor(c(R.attr.dshTextPrimary))
                setPadding(dp(12), 0, 0, 0)
            })
        }
        loadingDlg = AlertDialog.Builder(this).setView(box).setCancelable(false).create()
        loadingDlg?.show()
        for (prop in arrayOf("scaleX", "scaleY")) {
            ObjectAnimator.ofFloat(iv, prop, 1f, 1.1f, 1f).apply {
                duration = 1100
                repeatCount = ObjectAnimator.INFINITE
                start()
                breathers.add(this)
            }
        }
    }

    private fun hideLoading() = runOnUiThread {
        breathers.forEach { it.cancel() }
        breathers.clear()
        loadingDlg?.dismiss()
        loadingDlg = null
    }

    // 提交成功（v1.26.0）：主题全身立绘弹跳入场后原地摇摆浮动，约 1.4s 自动关闭；
    // 底色跟随主题 dshCardBg（深色主题不穿帮）；摇摆是运行时属性动画，零动图素材
    private fun showSuccessThenFinish() {
        val pose = ThemePrefs.poseRes(this)
        val iv = ImageView(this).apply {
            setImageResource(if (pose != 0) pose else R.drawable.pet_success)
        }
        val h = dp(230)
        val w = (h * 935f / 1682f).toInt()
        val box = FrameLayout(this).apply {
            setBackgroundColor(c(R.attr.dshCardBg))
            addView(iv, FrameLayout.LayoutParams(w, h, Gravity.CENTER))
        }
        val d = AlertDialog.Builder(this).setView(box).setCancelable(false).create()
        d.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(0x00000000))
        d.setOnDismissListener { breathers.forEach { it.cancel() }; breathers.clear() }
        d.show()
        iv.pivotX = w / 2f; iv.pivotY = h.toFloat()   // 摇摆以脚底为轴
        iv.scaleX = 0.2f; iv.scaleY = 0.2f
        iv.animate().scaleX(1f).scaleY(1f).setDuration(450)
            .setInterpolator(OvershootInterpolator(2.2f)).withEndAction {
                ObjectAnimator.ofFloat(iv, "rotation", 0f, -2.5f, 0f, 2.5f, 0f).apply {
                    duration = 1300
                    repeatCount = ObjectAnimator.INFINITE
                    interpolator = android.view.animation.AccelerateDecelerateInterpolator()
                    start(); breathers.add(this)
                }
                ObjectAnimator.ofFloat(iv, "translationY", 0f, -dp(6).toFloat(), 0f).apply {
                    duration = 900
                    repeatCount = ObjectAnimator.INFINITE
                    interpolator = android.view.animation.AccelerateDecelerateInterpolator()
                    start(); breathers.add(this)
                }
            }.start()
        iv.postDelayed({ d.dismiss(); finish() }, 1400)
    }

    private fun askQuestion(questions: JSONArray, index: Int, collected: JSONArray) {
        if (index >= questions.length()) { submit(collected); return }
        val q = questions.getJSONObject(index)
        val options = q.optJSONArray("options") ?: JSONArray()
        val labels = ArrayList<String>()
        for (i in 0 until options.length()) labels.add(options.getString(i))
        labels.add("自己输入…")
        val d = dp(16)
        val titleView = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(d, d, d, 0)
            addView(ImageView(context).apply {
                setImageResource(R.drawable.pet_please)
            }, LinearLayout.LayoutParams(dp(56), dp(56)))
            addView(TextView(context).apply {
                text = "${getString(R.string.quick_title)}\n${q.getString("question")}"
                textSize = 16f
                setTextColor(c(R.attr.dshTextPrimary))
                setPadding(dp(12), 0, 0, 0)
            })
        }
        AlertDialog.Builder(this)
            .setCustomTitle(titleView)
            .setItems(labels.toTypedArray()) { dd, which ->
                val ans = JSONObject()
                ans.put("id", q.getString("id"))
                if (which < options.length()) {
                    ans.put("selected", JSONArray().put(options.getString(which)))
                } else {
                    val input = EditText(this)
                    input.inputType = InputType.TYPE_CLASS_TEXT
                    AlertDialog.Builder(this)
                        .setTitle("输入答案")
                        .setView(input)
                        .setPositiveButton("确定") { _, _ ->
                            ans.put("selected", JSONArray())
                            ans.put("custom", input.text.toString().trim())
                            collected.put(ans)
                            askQuestion(questions, index + 1, collected)
                        }
                        .setNegativeButton("取消") { _, _ -> finish() }
                        .show()
                    return@setItems
                }
                collected.put(ans)
                askQuestion(questions, index + 1, collected)
            }
            .setOnCancelListener { finish() }
            .show()
    }

    private fun submit(answers: JSONArray) {
        Thread {
            try {
                val payload = JSONObject()
                payload.put("callId", callId)
                payload.put("answers", answers)
                val req = Request.Builder()
                    .url("${PushService.BASE}/answer/submit")
                    .post(payload.toString().toRequestBody("application/json".toMediaType()))
                    .build()
                client.newCall(req).execute().use { r ->
                    val body = r.body?.string() ?: ""
                    val ok = r.isSuccessful && JSONObject(body).optBoolean("ok", false)
                    val code = r.code
                    runOnUiThread {
                        if (ok) {
                            // 本地撤通知（v1.16.0）：RemoteInput 作答后系统会把通知"重贴"回栏里
                            // 显示内联回复，晚于回声撤除 0.5s 就会复活通知（11:33 实测）——
                            // 提交成功当场自己撤，回声只做跨端兜底
                            if (nid != 0) getSystemService(NotificationManager::class.java)
                                .cancel(nid)
                            // 已答态摘要：各题 selected/custom 用 " / " 连接（v1.9.6）
                            val parts = ArrayList<String>()
                            for (k in 0 until answers.length()) {
                                val a = answers.optJSONObject(k) ?: continue
                                val sel = a.optJSONArray("selected")
                                when {
                                    sel != null && sel.length() > 0 -> parts.add(sel.getString(0))
                                    a.optString("custom").isNotEmpty() -> parts.add(a.getString("custom"))
                                }
                            }
                            PushService.markAnswered(this, callId,
                                if (parts.isEmpty()) "已答" else parts.joinToString(" / "))
                            showSuccessThenFinish()
                        }
                        else {
                            // 问题已被消费/过期（404/409/410）：通知留着只会碍事，撤掉并入已答态（v1.16.0）
                            if (code == 404 || code == 409 || code == 410) {
                                if (nid != 0) getSystemService(NotificationManager::class.java)
                                    .cancel(nid)
                                PushService.markAnswered(this, callId, "__expired")
                            }
                            Toast.makeText(this, "失败: ${JSONObject(body).optString("error", r.code.toString())}", Toast.LENGTH_LONG).show()
                            finish()
                        }
                    }
                }
            } catch (e: Exception) {
                toastOnMain("提交失败: ${e.message}"); finish()
            }
        }.start()
    }

    private fun toastOnMain(s: String) = runOnUiThread {
        Toast.makeText(this, s, Toast.LENGTH_LONG).show()
    }
}
