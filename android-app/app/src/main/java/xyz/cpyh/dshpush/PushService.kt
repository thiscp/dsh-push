package xyz.cpyh.dshpush

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.app.Service
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.net.Uri
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLDecoder
import java.util.concurrent.TimeUnit

interface MsgListener { fun onNewMsg() }

class PushService : Service() {
    companion object {
        const val BASE = "https://ntfy.cpyh.xyz"
        const val WS_URL = "wss://ntfy.cpyh.xyz/dsh/ws"
        const val PREF = "dshpush"
        const val KEY_TOKEN = "token"
        const val CH_NORMAL = "dsh2"
        const val CH_URGENT = "dsh_urgent2"
        const val CH_SERVICE = "dsh_svc"
        const val NOTIF_SERVICE_ID = 2
        // 常驻通知「DSH 入口」动作给主界面的标记（v1.29.0）
        const val EXTRA_SHOW_HOSTS = "showHosts"
        const val APP_VER = "1.32.1"
        const val KEY_WEB = "webUrl"
        val listeners = java.util.Collections.synchronizedList(ArrayList<MsgListener>())
        @Volatile var state = "未启动"
        @Volatile var lastMessage = ""
        val linkRegex = Regex("https://ntfy\\.cpyh\\.xyz/answer/(\\S+)")
        // 机器 trailer 用 MULTILINE：#web 在 #opts 之前，行序不敏感（v1.9.2）
        val optsRegex = Regex("\n#opts (.+)$", RegexOption.MULTILINE)
        val webRegex = Regex("\n#web (\\S+)$", RegexOption.MULTILINE)
        // 自由作答落点的问题 id：#qid <首问id>（v1.11.0 钩子追加；旧 hook 没这行，降级 q0）
        val qidRegex = Regex("\n#qid (\\S+)$", RegexOption.MULTILINE)
        // 实例友好名：#name <标签>（v1.29.0 钩子按各台 WEB_NAME 追加，多 DSH 入口清单用）
        val nameRegex = Regex("\n#name (.+)$", RegexOption.MULTILINE)

        // 任意入口作答成功/过期都回写消息状态，主界面开着即时重排（v1.9.6）。
        // v1.28.0：作答即已读——亲手答过=看过；唯一例外是监督者代答（read=false），
        // 用户没亲眼见过这条，未读点留着
        fun markAnswered(ctx: android.content.Context, callId: String, label: String,
                         read: Boolean = true) {
            try {
                val p = ctx.getSharedPreferences(PREF, android.content.Context.MODE_PRIVATE)
                val arr = JSONArray(p.getString("msgs", "[]") ?: "[]")
                var changed = false
                for (k in 0 until arr.length()) {
                    val o = arr.optJSONObject(k) ?: continue
                    if (o.optString("callId") == callId) {
                        o.put("answered", label)
                        if (read) o.put("read", true)
                        changed = true
                    }
                }
                if (changed) {
                    p.edit().putString("msgs", arr.toString()).apply()
                    listeners.forEach { it.onNewMsg() }
                }
            } catch (e: Exception) { }
        }

        // 显式已读（v1.18.0）：点通知/卡片的「已读」或「打开 DSH」才清未读；
        // mid 为主键，老消息没这字段时按 ts 兜底
        fun markRead(ctx: android.content.Context, mid: Int, ts: Long) {
            try {
                val p = ctx.getSharedPreferences(PREF, android.content.Context.MODE_PRIVATE)
                val arr = JSONArray(p.getString("msgs", "[]") ?: "[]")
                var changed = false
                for (k in 0 until arr.length()) {
                    val o = arr.optJSONObject(k) ?: continue
                    val hit = if (mid != 0) o.optInt("mid", 0) == mid else o.optLong("ts") == ts
                    if (hit && !o.optBoolean("read", false)) { o.put("read", true); changed = true }
                }
                if (changed) {
                    p.edit().putString("msgs", arr.toString()).apply()
                    listeners.forEach { it.onNewMsg() }
                }
            } catch (e: Exception) { }
        }
    }

    private var ws: WebSocket? = null
    private var client: OkHttpClient? = null
    private var prefs: SharedPreferences? = null
    private var reconnectDelay = 2000L
    private var running = false
    private var gen = 0
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate() {
        super.onCreate()
        prefs = getSharedPreferences("dshpush", MODE_PRIVATE)
        client = OkHttpClient.Builder()
            .pingInterval(25, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()
        createChannels()
        // 旧版本残留的服务通知（ID=1，顶着 vivo 主题化的旧图标）显式清掉，
        // 新通知换 ID=2 重发，确保小图标真正换成鲸鱼剪影
        getSystemService(NotificationManager::class.java).cancel(1)
        // 转正放 onStartCommand 做：startForegroundService 起的实例系统要求 5 秒内 startForeground，
        // 在 onCreate 里把异常吞掉不调用会换来 ForegroundServiceDidNotStartInTimeException 首崩
        // （Android 16 模拟器实测，v1.22.2）
        connect()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 尝试转正前台：界面（MainActivity）起的必然允许，常驻通知随之出现；
        // 开机广播普通启动的被拒就吞掉——那次启动没有转正义务，不会触发 5 秒超时崩溃（v1.22.2）
        try {
            startForeground(NOTIF_SERVICE_ID, serviceNotification())
        } catch (_: Exception) {
        }
        // MainActivity 保存/清空通行证后发来 reload：掐掉旧连接，带新令牌重连
        if (intent?.action == "reload") {
            gen++
            ws?.cancel()
            reconnectDelay = 2000L
            // 换主题后 MainActivity 也发 reload：刷新渠道着色并重发常驻通知换色
            createChannels()
            getSystemService(NotificationManager::class.java)
                .notify(NOTIF_SERVICE_ID, serviceNotification())
            connect()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        handler.removeCallbacksAndMessages(null)
        ws?.cancel()
        state = "已停止"
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannels() {
        val m = getSystemService(NotificationManager::class.java)
        // v1.4 及以前的旧渠道：声音挂不上，删掉避免设置页重复
        m.deleteNotificationChannel("dsh")
        m.deleteNotificationChannel("dsh_urgent")
        val aa = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        // 渠道着色跟随所选主题（同 id 重建可更新，v1.7.0）
        val nc = ThemePrefs.color(this, R.attr.dshNotif)
        m.createNotificationChannel(
            NotificationChannel(CH_NORMAL, "DSH 通知（任务结束）",
                NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "DSH 轮次结束的轻快提示"
                lightColor = nc
                setSound(Uri.parse("android.resource://$packageName/raw/notify_done"), aa)
            })
        m.createNotificationChannel(
            NotificationChannel(CH_URGENT, "DSH 紧急（等你选择）",
                NotificationManager.IMPORTANCE_HIGH).apply {
                description = "DSH 提问待答的急促提示"
                lightColor = nc
                setSound(Uri.parse("android.resource://$packageName/raw/notify_question"), aa)
            })
        // 前台服务常驻通知：低优先级渠道=天然静音、不弹横幅
        m.createNotificationChannel(
            NotificationChannel(CH_SERVICE, "DSH 后台服务",
                NotificationManager.IMPORTANCE_LOW).apply {
                description = "监听服务常驻通知（静音）"
                lightColor = nc
                setSound(null, null)
            })
    }

    private fun serviceNotification(): Notification {
        val b = Notification.Builder(this, CH_SERVICE)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(if (state == "等待通行证") "等待通行证…" else "监听中…")
            .setSmallIcon(R.drawable.ic_stat_whale)
            // 常驻通知也带主题色徽章（v1.7.8）
            .setLargeIcon(themedLargeIcon(R.drawable.pet_idle))
            .setColor(ThemePrefs.color(this, R.attr.dshNotif))
            .setContentIntent(activityIntent(MainActivity::class.java, null))
        // 常驻一键直达 DSH 网页：用最近一次推送带来的新鲜链接（v1.9.2）
        val web = prefs?.getString(KEY_WEB, "") ?: ""
        if (web.isNotEmpty()) b.addAction(webAction(web))
        // 多 DSH 常驻入口（v1.29.0）：登记过实例才挂选择器动作——不打开 App 也能选进哪台
        if (DshHosts.all(this).isNotEmpty()) b.addAction(chooseAction())
        return b.build()
    }

    // 「DSH 入口」（v1.29.0）：拉起主界面并让它弹实例选择器
    // （request code 与内容意图错开，防 FLAG_UPDATE_CURRENT 互相覆盖 extras）
    private fun chooseAction(): Notification.Action {
        val i = Intent(this, MainActivity::class.java).putExtra(EXTRA_SHOW_HOSTS, true)
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pi = PendingIntent.getActivity(this, NOTIF_SERVICE_ID * 1000 + 7, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Action.Builder(
            android.R.drawable.ic_menu_sort_by_size, "DSH 入口", pi).build()
    }

    // 网页直达落点：App 内置 WebActivity 单实例窗口（v1.9.8）——
    // vivo 浏览器无视 SINGLE_TOP 每次新开标签页（v1.9.7 实测），自控窗口彻底复用
    // v1.18.0：消息通知的网页按钮带 mid/ts，WebActivity 打开即把该条标已读；
    // 常驻通知不带（request code 也分开，防 FLAG_UPDATE_CURRENT 互相覆盖 extras）
    private fun webAction(url: String, mid: Int = 0, ts: Long = 0): Notification.Action {
        val i = Intent(this, WebActivity::class.java).putExtra("url", url)
        if (mid != 0 || ts != 0L)
            i.putExtra("mmid", mid).putExtra("mts", ts).putExtra("mnid", mid)
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pi = PendingIntent.getActivity(this, url.hashCode() + mid, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Action.Builder(
            android.R.drawable.ic_menu_view, "打开 DSH", pi).build()
    }

    // 已读按钮（v1.18.0）：广播给 AnswerReceiver——标已读 + 撤掉这条通知
    private fun readAction(mid: Int, ts: Long): Notification.Action {
        val i = Intent(this, AnswerReceiver::class.java).putExtra("act", "read")
            .putExtra("mid", mid).putExtra("ts", ts).putExtra("nid", mid)
        val pi = PendingIntent.getBroadcast(this, mid, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Action.Builder(
            android.R.drawable.ic_menu_view, "已读", pi).build()
    }

    private fun activityIntent(cls: Class<*>, extras: Intent?): PendingIntent {
        val i = extras ?: Intent()
        i.setClass(this, cls)
        // 点通知不叠实例：singleTask + 清栈置顶，退一次就回桌面（v1.6.1）
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or
            Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            this, cls.hashCode() + (i.extras?.hashCode() ?: 0), i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun connect() {
        running = true
        val myGen = ++gen
        val token = prefs?.getString(KEY_TOKEN, "") ?: ""
        if (token.isEmpty()) {
            // 还没把通行证交给大肥鱼：服务保持前台运行，不连接、不重连
            state = "等待通行证"
            getSystemService(NotificationManager::class.java)
                .notify(NOTIF_SERVICE_ID, serviceNotification())
            return
        }
        state = "连接中…"
        val since = prefs?.getLong("lastTs", 0L) ?: 0L
        val url = "$WS_URL?since=" + if (since > 0) since.toString() else "latest"
        val req = Request.Builder().url(url)
            .header("Authorization", "Bearer $token").build()
        ws = client!!.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                state = "已连接"
                reconnectDelay = 2000L
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                state = "对端关闭($code)"
                if (running && myGen == gen) {
                    handler.postDelayed({ if (running && myGen == gen) connect() }, reconnectDelay)
                    reconnectDelay = minOf(reconnectDelay * 2, 60000L)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                state = if (response?.code == 401 || response?.code == 403)
                    "通行证被拒(${response.code})" else "断开: ${t.message}"
                if (running && myGen == gen) {
                    handler.postDelayed({ if (running && myGen == gen) connect() }, reconnectDelay)
                    reconnectDelay = minOf(reconnectDelay * 2, 60000L)
                }
            }
        })
    }

    // 立绘合成到主题色圆角底：OriginOS 无视 colorized 卡片染色（v1.7.6 实测），
    // 但 largeIcon 归 App 管——右侧徽章保证跟随主题（v1.7.7）
    private fun themedLargeIcon(resId: Int): android.graphics.Bitmap {
        val src = BitmapFactory.decodeResource(resources, resId)
        val size = maxOf(src.width, src.height)
        val out = android.graphics.Bitmap.createBitmap(size, size,
            android.graphics.Bitmap.Config.ARGB_8888)
        val c = android.graphics.Canvas(out)
        val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
        p.color = ThemePrefs.color(this, R.attr.dshNotif)
        val r = size * 0.22f
        c.drawRoundRect(0f, 0f, size.toFloat(), size.toFloat(), r, r, p)
        c.drawBitmap(src, (size - src.width) / 2f, (size - src.height) / 2f, p)
        return out
    }

    private fun handleMessage(raw: String) {
        try {
            val o = JSONObject(raw)
            if (o.optString("event") != "message") return
            val title = o.optString("title", "DSH")
            val body = o.optString("message", "")
            val prio = o.optInt("priority", 3)
            val ts = o.optLong("time", System.currentTimeMillis() / 1000)
            prefs?.edit()?.putLong("lastTs", ts + 1)?.apply()
            lastMessage = "$title：$body"

            // 作答回声（v1.13.0）：relay 在任意端作答成功后发 priority=1 静默消息——
            // 撤掉该提问的通知、卡片入已答态；不渲染新卡片、不弹通知
            if (body.startsWith("#ans ")) {
                val rest = body.substring(5).trim()
                val ansCallId = rest.substringBefore(" ")
                val ansLabel = rest.substringAfter(" ", "")
                if (ansCallId.isNotEmpty()) {
                    try {
                        val arr = JSONArray(prefs?.getString("msgs", "[]") ?: "[]")
                        for (k in 0 until arr.length()) {
                            val m = arr.optJSONObject(k) ?: continue
                            if (m.optString("callId") == ansCallId) {
                                getSystemService(NotificationManager::class.java)
                                    .cancel(m.optInt("nid"))
                                break
                            }
                        }
                    } catch (e: Exception) { }
                    // 网页/relay 端作答也走这条回声：作答即已读（v1.28.0）；
                    // 监督者代答前缀除外——用户没看过，未读留着
                    val auto = ansLabel.startsWith("【监督者自动唤醒】")
                    markAnswered(this, ansCallId,
                        if (ansLabel.isEmpty()) "已作答" else ansLabel, read = !auto)
                }
                return
            }

            val callId = linkRegex.find(body)?.groupValues?.get(1)?.let {
                try { URLDecoder.decode(it, "UTF-8") } catch (e: Exception) { it }
            }
            // 直答载荷：#opts qid=标签|标签（钩子仅单问题 2-3 选项时追加，v1.9.0）
            val trailer = optsRegex.find(body)?.groupValues?.get(1)
            var directQid = ""
            var directLabels: List<String> = emptyList()
            if (trailer != null && trailer.contains("=")) {
                val qid = trailer.substringBefore("=")
                val labels = trailer.substringAfter("=").split("|").filter { it.isNotEmpty() }
                if (qid.isNotEmpty() && labels.size in 2..3) { directQid = qid; directLabels = labels }
            }
            // 网页直达链接：#web <url>，钩子现取 token 拼 tailnet 基址（v1.9.2）
            val webLink = webRegex.find(body)?.groupValues?.get(1) ?: ""
            // 自由作答落点的问题 id：#opts 的 qid 优先，其次 #qid trailer，都没有降级 q0（v1.11.0）。
            // 服务端按注册的问题 id 校验，单问题场景 q0 常见；猜错只会走"没递出去"toast，不崩
            val qidLine = qidRegex.find(body)?.groupValues?.get(1) ?: ""
            val freeQid = if (directQid.isNotEmpty()) directQid
                          else if (qidLine.isNotEmpty()) qidLine else "q0"
            // 自研 App 原生渲染，通知里不展示裸链接与机器 trailer（#qid 也算 trailer，v1.11.0）
            // #name 同为机器 trailer（v1.29.0）：它只喂实例清单，不进正文
            val displayBody = body.replace(Regex("\n*📱 作答: https?://\\S+"), "")
                .replace(Regex("\n#opts .*$", RegexOption.MULTILINE), "")
                .replace(Regex("\n#web .*$", RegexOption.MULTILINE), "")
                .replace(Regex("\n#name .*$", RegexOption.MULTILINE), "")
                .replace(Regex("\n#qid .*$", RegexOption.MULTILINE), "").trim()
            // v1.21.0：掺入 ts——同标题正文的重复推送（如连续两轮任务结束）
            // 不再共用 mid：已读互不牵连，通知也不再互相顶替
            val nid = (title + body + ts).hashCode()

            // 保留最近 30 条供主页渲染（v1.9.9 由 10 扩容）
            try {
                val old = JSONArray(prefs?.getString("msgs", "[]") ?: "[]")
                val m = JSONObject()
                m.put("title", title); m.put("body", displayBody); m.put("ts", ts)
                // 显式已读的主键（v1.18.0）：所有消息都存，不再只挂在 callId 分支里
                m.put("mid", nid)
                // 新消息默认未读：主界面标题前带强调色圆点，看过后由 MainActivity 置 true（v1.9.9）
                m.put("read", false)
                // 每条消息自带自己那台机器的网页直达链接（v1.9.4）
                if (webLink.isNotEmpty()) m.put("web", webLink)
                if (callId != null) {
                    m.put("callId", callId)
                    m.put("nid", nid)
                    // 自由作答的问题 id 随消息存一份：通知输入框提交与后续入口都用它（v1.11.0）
                    m.put("qid", freeQid)
                    // 主界面直答：选项存进消息记录（v1.9.1）
                    if (directLabels.isNotEmpty()) {
                        val o = JSONObject()
                        o.put("qid", directQid)
                        o.put("labels", JSONArray(directLabels))
                        m.put("opts", o)
                    }
                }
                val updated = JSONArray().put(m)
                for (i in 0 until minOf(old.length(), 29)) updated.put(old.getJSONObject(i))
                prefs?.edit()?.putString("msgs", updated.toString())?.apply()
                listeners.forEach { it.onNewMsg() }
            } catch (e: Exception) { }

            val ch = if (prio >= 4) CH_URGENT else CH_NORMAL
            // 网页直达链接换新（DSH Web 重启后 token 必变）：持久化并重发常驻通知跟随（v1.9.2）
            if (webLink.isNotEmpty()) {
                // 实例清单登记（v1.29.0）：每台推送过的 DSH 都留一条，供主页/常驻通知的
                // 「DSH 入口」选择器用；名称取 `#name` 尾巴（缺省 host:port）
                val hostName = nameRegex.find(body)?.groupValues?.get(1)?.trim()
                val grew = DshHosts.upsert(this, webLink, hostName)
                val webChanged = webLink != prefs?.getString(KEY_WEB, "")
                if (webChanged) prefs?.edit()?.putString(KEY_WEB, webLink)?.apply()
                // 清单变了也要重发常驻通知，否则新增的「DSH 入口」动作要等下次状态刷新才出现
                if (webChanged || grew)
                    getSystemService(NotificationManager::class.java)
                        .notify(NOTIF_SERVICE_ID, serviceNotification())
            }
            val largeArt = if (prio >= 4) R.drawable.pet_please else R.drawable.pet_success
            val b = Notification.Builder(this, ch)
                .setContentTitle(title)
                .setContentText(displayBody)
                .setStyle(Notification.BigTextStyle().bigText(displayBody))
                .setSmallIcon(R.drawable.ic_stat_whale)
                .setLargeIcon(themedLargeIcon(largeArt))
                .setColor(ThemePrefs.color(this, R.attr.dshNotif))
                // 整条通知穿主题色——vivo 折叠态下普通着色几乎不可见（v1.7.4）
                .setColorized(true)
                .setAutoCancel(true)
                .setContentIntent(activityIntent(MainActivity::class.java, null))
            // 按钮编排（AOSP action limit 3）：2-3 选项直答；≤2 选项时留"肥鱼快答"兜底位
            if (callId != null) {
                if (directLabels.isNotEmpty()) {
                    for (lb in directLabels) b.addAction(Notification.Action.Builder(
                        android.R.drawable.ic_menu_send, lb,
                        answerIntent(callId, directQid, lb, nid)).build())
                    if (directLabels.size <= 2)
                        b.addAction(quickAction(callId, freeQid, nid, directLabels))
                } else b.addAction(quickAction(callId, freeQid, nid, directLabels))
            }
            // 网页直达补位：任务结束、或提问直答选项<2 时名额有空（v1.9.2）
            val web = if (webLink.isNotEmpty()) webLink
                      else (prefs?.getString(KEY_WEB, "") ?: "")
            if (web.isNotEmpty() && (callId == null || directLabels.size < 2))
                b.addAction(webAction(web, nid, ts))
            // 已读按钮（v1.18.0）：任务结束通知专属——提问通知动作位被作答占满，
            // 且作答本身即已读语义，无需再加
            if (callId == null) b.addAction(readAction(nid, ts))
            getSystemService(NotificationManager::class.java).notify(nid, b.build())
        } catch (e: Exception) {
            // ignore malformed frames
        }
    }

    // 通知栏"肥鱼快答"（v1.11.0）：挂 RemoteInput，点按钮直接弹 SystemUI 输入框——
    // choices 是前 3 个选项标签（点 chip 即以该文本提交），空数组则只有输入框；
    // 提交走 AnswerReceiver 广播（custom 字段）。SystemUI 不弹框时结果为 null，
    // AnswerReceiver 降级拉起 QuickAnswerActivity，行为等同旧版，零回归。
    private fun quickAction(callId: String, qid: String, nid: Int,
                            labels: List<String>): Notification.Action {
        // allowFreeInput 默认 true（有 choices 时输入框与 chips 共存），无需显式设；
        // setRemoteInputs 是隐藏方法，公开路径用 addRemoteInput（API 24）
        val ri = RemoteInput.Builder("reply")
            .setLabel("自由作答")
            .setChoices(labels.take(3).toTypedArray())
            .build()
        return Notification.Action.Builder(
            android.R.drawable.ic_menu_send, "肥鱼快答", replyIntent(callId, qid, nid))
            .addRemoteInput(ri).build()
    }

    // 回复 PendingIntent（v1.15.0）：改 activity 直达 QuickAnswerActivity——Android 14+
    // 禁止"通知→广播→拉活动"蹦床，广播降级路径在 Android 16 会被静默拦死；
    // activity PendingIntent 无此限制，且 RemoteInput 结果同样随 intent 送达。
    // 必须 FLAG_MUTABLE（SystemUI 要把输入结果写回 intent）
    private fun replyIntent(callId: String, qid: String, nid: Int): PendingIntent {
        val i = Intent(this, QuickAnswerActivity::class.java)
            .putExtra("callId", callId).putExtra("qid", qid)
            .putExtra("nid", nid).putExtra("replySlot", true)
        return PendingIntent.getActivity(this, (callId + "#reply").hashCode(), i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
    }

    private fun answerIntent(callId: String, qid: String, label: String, nid: Int): PendingIntent {
        val i = Intent(this, AnswerReceiver::class.java)
            .putExtra("callId", callId).putExtra("qid", qid)
            .putExtra("label", label).putExtra("nid", nid)
        return PendingIntent.getBroadcast(this, (callId + qid + label).hashCode(), i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}
