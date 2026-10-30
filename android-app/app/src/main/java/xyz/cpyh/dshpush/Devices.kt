package xyz.cpyh.dshpush

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * 多设备订阅清单（v1.34.0）。
 *
 * 背景：以前 App 只认一套凭据（base/topic/token 三个偏好项），扫第二台机器的码就把第一台顶掉。
 * 现在每扫一次配对码就登记一台设备，全部同时在线；不想收某台的推送时把它吊销（记录留着，方便
 * 认人），要恢复就重新扫一次码。
 *
 * 存储：`dshpush` 偏好里的 `devices` 一项，JSON 数组，字段见 [Dev]。
 * 兼容：老用户升级后 `devices` 为空但旧的 `token` 还在 → [migrateLegacy] 把它迁成第一台设备，
 * 保证「升级完推送不能突然没了」。
 */
object Devices {
    /** 与 PushService.PREF 同域：老凭据就存在这里，迁移要读 */
    private const val PREF = "dshpush"
    private const val KEY = "devices"

    /**
     * 一台可订阅的设备。
     *
     * [id] 由 `base|topic` 派生而不是随机数：同一个插件重新出码，设备应当是**同一条**，
     * 否则每扫一次码就多一条记录、回路里还多一条游标（lastTs:<id>），历史消息的已读态也会断。
     */
    data class Dev(
        val id: String,
        val name: String,
        val base: String,
        val topic: String,
        val token: String,
        val web: String = "",
        val revoked: Boolean = false,
        val addedAt: Long = 0L,
    ) {
        /** 合并键：同一个 base+topic 只需一条 WebSocket（多台机器共用一个 topic 是常态） */
        val topicKey: String get() = base.trimEnd('/') + "|" + topic

        /** 界面显示名：插件给了机器名就用它，否则退化成 topic */
        val label: String get() = if (name.isNotBlank()) name else topic
    }

    private fun sp(ctx: Context) = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)

    fun idOf(base: String, topic: String): String =
        "d" + Integer.toHexString((base.trimEnd('/') + "|" + topic.trim()).hashCode())

    /** 全部记录（含已吊销），主页要能把吊销过的也列出来认人 */
    fun all(ctx: Context): List<Dev> {
        val raw = sp(ctx).getString(KEY, "") ?: ""
        if (raw.isBlank()) return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val base = o.optString("base", "").trim()
                val topic = o.optString("topic", "").trim()
                val token = o.optString("token", "").trim()
                if (base.isEmpty() || token.isEmpty()) return@mapNotNull null
                Dev(
                    id = o.optString("id", "").ifEmpty { idOf(base, topic) },
                    name = o.optString("name", ""),
                    base = base,
                    topic = topic.ifEmpty { PushService.DEFAULT_TOPIC },
                    token = token,
                    web = o.optString("web", ""),
                    revoked = o.optBoolean("revoked", false),
                    addedAt = o.optLong("addedAt", 0L),
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    /** 真正要订阅的（已吊销的不连） */
    fun subs(ctx: Context): List<Dev> = all(ctx).filter { !it.revoked && it.token.isNotEmpty() }

    /** 作答/答题回声这类「发一条出去」的操作走主设备（第一条未吊销的） */
    fun primary(ctx: Context): Dev? = subs(ctx).firstOrNull()

    fun bySub(ctx: Context, topicKey: String): Dev? =
        subs(ctx).firstOrNull { it.topicKey == topicKey }

    fun byId(ctx: Context, id: String): Dev? = all(ctx).firstOrNull { it.id == id }

    private fun save(ctx: Context, list: List<Dev>) {
        val arr = JSONArray()
        for (d in list) {
            val o = JSONObject()
            o.put("id", d.id)
            o.put("name", d.name)
            o.put("base", d.base)
            o.put("topic", d.topic)
            o.put("token", d.token)
            o.put("web", d.web)
            o.put("revoked", d.revoked)
            o.put("addedAt", d.addedAt)
            arr.put(o)
        }
        sp(ctx).edit().putString(KEY, arr.toString()).apply()
    }

    /**
     * 扫码登记（幂等）。
     *
     * @return `true` = 新增一台，`false` = 更新了已有的一台（含「吊销后重扫 = 恢复」）
     */
    fun upsert(
        ctx: Context,
        name: String,
        base: String,
        topic: String,
        token: String,
        web: String = "",
    ): Boolean {
        val b = base.trim().trimEnd('/').ifEmpty { PushService.BASE }
        val t = topic.trim().ifEmpty { PushService.DEFAULT_TOPIC }
        val id = idOf(b, t)
        val list = all(ctx).toMutableList()
        // 先按 id 找；找不到再按 base|topic 找（旧记录里的 id 可能是历史遗留/手工写进去的，
        // 只认 id 会让同一台设备被登成两条 —— 2026-10-30 实测踩到过）。
        var idx = list.indexOfFirst { it.id == id }
        if (idx < 0) {
            idx = list.indexOfFirst { it.base.trimEnd('/') == b && it.topic == t }
        }
        val nm = name.trim().ifEmpty { list.getOrNull(idx)?.name ?: "" }
        if (idx >= 0) {
            val old = list[idx]
            list[idx] = old.copy(
                name = nm,
                token = token.trim(),
                web = web.ifBlank { old.web },
                revoked = false,   // 重扫即恢复
            )
            save(ctx, list)
            return false
        }
        list.add(
            Dev(
                id = id, name = nm, base = b, topic = t, token = token.trim(),
                web = web.trim(), revoked = false, addedAt = System.currentTimeMillis(),
            )
        )
        save(ctx, list)
        return true
    }

    /** 吊销：断它的推送、留记录。重扫码即恢复 */
    fun revoke(ctx: Context, id: String) {
        val list = all(ctx).toMutableList()
        val i = list.indexOfFirst { it.id == id }
        if (i < 0) return
        list[i] = list[i].copy(revoked = true)
        save(ctx, list)
    }

    /** 彻底删除（记录也不留） */
    fun remove(ctx: Context, id: String) {
        save(ctx, all(ctx).filterNot { it.id == id })
    }

    /** 记下这台机器最近一次推送里带的网页直链（换新后答题/入口都跟它走） */
    fun setWeb(ctx: Context, id: String, web: String) {
        if (web.isBlank()) return
        val list = all(ctx).toMutableList()
        val i = list.indexOfFirst { it.id == id }
        if (i < 0) return
        if (list[i].web == web) return
        list[i] = list[i].copy(web = web)
        save(ctx, list)
    }

    /**
     * 这条推送是哪台机器发的。
     *
     * 先按 `#name` trailer 精确匹配（同一个 topic 下多台机器全靠它区分），
     * 匹配不上再退回「这条流是谁建的」（单机场景足够），最后给空串（不标注来源）。
     */
    fun resolve(ctx: Context, hostName: String, fallbackId: String): String {
        val nm = hostName.trim()
        if (nm.isNotEmpty()) {
            val hit = all(ctx).firstOrNull {
                it.name.equals(nm, ignoreCase = true) ||
                    it.name.endsWith(nm, ignoreCase = true) ||
                    nm.endsWith(it.name, ignoreCase = true) && it.name.isNotBlank()
            }
            if (hit != null) return hit.id
        }
        return if (byId(ctx, fallbackId) != null) fallbackId else ""
    }

    /**
     * 老用户迁移：`devices` 空、旧 `token` 非空 → 把它变成第一台设备。
     *
     * 只跑一次；跑完把旧 token 留着不动（回滚到 1.33.x 还能用）。
     */
    fun migrateLegacy(ctx: Context) {
        if (all(ctx).isNotEmpty()) return
        val p = sp(ctx)
        val token = p.getString(PushService.KEY_TOKEN, "")?.trim() ?: ""
        if (token.isEmpty()) return
        val base = PushService.baseOf(ctx)
        val topic = PushService.topicOf(ctx)
        upsert(
            ctx,
            name = p.getString("devName", "") ?: "",
            base = base,
            topic = topic,
            token = token,
            web = p.getString(PushService.KEY_WEB, "") ?: "",
        )
    }
}
