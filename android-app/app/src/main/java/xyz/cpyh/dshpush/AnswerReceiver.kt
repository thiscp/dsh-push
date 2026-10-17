package xyz.cpyh.dshpush

import android.app.NotificationManager
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** 通知栏直答：点选项按钮后台提交，不解锁不开 App（v1.9.0）。
 *  提交协议与 QuickAnswerActivity.submit 完全一致，服务端零改动。
 *  v1.11.0：通知上"肥鱼快答"改挂 RemoteInput，广播带 replySlot 标记——
 *  取系统输入框结果按 custom 提交；系统没给输入框就拉起快答界面（降级=旧行为）。 */
class AnswerReceiver : BroadcastReceiver() {

    override fun onReceive(ctx: Context, i: Intent) {
        // 显式已读（v1.18.0；v1.32.10 起 markRead 内部同时撤该条通知，这里不再单独 cancel）
        if (i.getStringExtra("act") == "read") {
            PushService.markRead(ctx, i.getIntExtra("mid", 0), i.getLongExtra("ts", 0L))
            return
        }
        val callId = i.getStringExtra("callId") ?: return
        val nid = i.getIntExtra("nid", 0)
        // 自由直答分支（v1.15.0 起回复改走 QuickAnswerActivity 蹦床豁免，此分支保留为防御：
        // 万一 PendingIntent 类型回退，行为仍正确）
        if (i.getBooleanExtra("replySlot", false)) {
            val reply = RemoteInput.getResultsFromIntent(i)
                ?.getCharSequence("reply")?.toString()?.trim()
            if (reply.isNullOrEmpty()) {
                // SystemUI 没弹输入框（结果拿不到）：降级打开快答界面，行为等同旧版
                try {
                    ctx.startActivity(Intent(ctx, QuickAnswerActivity::class.java)
                        .putExtra("callId", callId)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (e: Exception) { }
                return
            }
            submit(ctx, callId, i.getStringExtra("qid") ?: "q0", null, reply, nid)
            return
        }
        val qid = i.getStringExtra("qid") ?: return
        val label = i.getStringExtra("label") ?: return
        submit(ctx, callId, qid, label, null, nid)
    }

    // 提交段共用：label 走 selected（选项直答），custom 走自由文本（通知输入框/选项 chips）
    private fun submit(ctx: Context, callId: String, qid: String,
                       label: String?, custom: String?, nid: Int) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val pending = goAsync()
        Thread {
            try {
                val ans = JSONObject()
                ans.put("id", qid)
                if (custom != null) {
                    ans.put("selected", JSONArray())
                    ans.put("custom", custom)
                } else ans.put("selected", JSONArray().put(label))
                val payload = JSONObject()
                payload.put("callId", callId)
                payload.put("answers", JSONArray().put(ans))
                val client = OkHttpClient.Builder()
                    .connectTimeout(8, TimeUnit.SECONDS)
                    .readTimeout(10, TimeUnit.SECONDS).build()
                val req = Request.Builder()
                    .url("${PushService.baseOf(ctx)}/answer/submit")
                    .post(payload.toString().toRequestBody("application/json".toMediaType()))
                    .build()
                client.newCall(req).execute().use { r ->
                    val body = r.body?.string() ?: ""
                    val ok = r.isSuccessful && JSONObject(body).optBoolean("ok", false)
                    val shown = custom ?: label ?: ""
                    when {
                        ok -> {
                            nm.cancel(nid)
                            PushService.markAnswered(ctx, callId, shown)
                            // 全路径摇摆立绘（v1.27.0）：主页选项/通知直答也看到成功立绘；
                            // 通知栏后台拉起可能被 OEM 弹窗管控拦截，toast 兜底零回归
                            try {
                                ctx.startActivity(Intent(ctx, SuccessPoseActivity::class.java)
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                            } catch (e: Exception) { }
                            toast(ctx, "已答：${shown.take(20)}，大肥鱼继续盯")
                        }
                        r.code == 404 || r.code == 410 -> {
                            nm.cancel(nid)
                            PushService.markAnswered(ctx, callId, "__expired")
                            toast(ctx, "这个问题已经过期了")
                        }
                        else -> toast(ctx, "直答没递出去，点开肥鱼快答再试")
                    }
                }
            } catch (e: Exception) {
                toast(ctx, "直答没递出去，点开肥鱼快答再试")
            } finally {
                pending.finish()
            }
        }.start()
    }

    private fun toast(ctx: Context, s: String) =
        Handler(Looper.getMainLooper()).post {
            Toast.makeText(ctx, s, Toast.LENGTH_SHORT).show()
        }
}
