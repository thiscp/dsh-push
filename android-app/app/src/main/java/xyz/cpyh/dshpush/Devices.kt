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
     * [id] 由 `base|topic|name` 派生而不是随机数：同一台机器重新出码，设备应当是**同一条**，
     * 否则每扫一次码就多一条记录、回路里还多一条游标（lastTs:<id>），历史消息的已读态也会断。
     *
     * ⚠ v1.34.2 及以前 id 只含 `base|topic`，而**多台机器共用一个 topic 是常态**（我们三台都叫
     * `dsh`）⇒ 扫第二台的码会把第一台**顶掉**：清单里还是那一行（看着像「没新增」），
     * 但那一行的 web 已被换成新机器，点进去就成了别人的网页（用户 2026-11-01）。
     * 机器名进 id 之后才是「一台一行」。
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

        /** 界面显示名：机器名 → 网页地址的主机名 → topic（插件 ≤0.7.17 的二维码不带机器名） */
        val label: String get() = when {
            name.isNotBlank() -> name
            webHost.isNotEmpty() -> webHost
            else -> topic
        }

        /** 网页地址里的主机名，只当显示名用（解析不出来就是空串） */
        val webHost: String get() = hostOf(web)
    }

    private fun sp(ctx: Context) = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)

    /** 现行 id：base|topic|机器名（大小写无关）。同名同频道同中继 = 同一台，重扫即更新 */
    fun idOf(base: String, topic: String, name: String): String =
        "d" + Integer.toHexString(
            (base.trimEnd('/') + "|" + topic.trim() + "|" + name.trim().lowercase()).hashCode())

    /** ≤v1.34.2 的老 id：只含 base|topic。只用于认旧记录，不再拿它生成新记录 */
    fun legacyIdOf(base: String, topic: String): String =
        "d" + Integer.toHexString((base.trimEnd('/') + "|" + topic.trim()).hashCode())

    /**
     * 网页地址的「机器指纹」：`scheme://host:port`（小写、默认端口归一）。
     *
     * 同一台机器重启 DSH 只会换 token，不会换 host:port ⇒ 拿它能认出「同一个 topic 下的另一台机器」，
     * 哪怕二维码里没带机器名（插件 ≤0.7.17 就不带：手工配的实例没有 host，2026-11-01 实测扫 VM1
     * 把 laptop 那行顶掉了）。解析不出来就返回空串，不参与判定。
     */
    /** 网页地址里的主机名（显示名与提示用；解析不出来返回空串） */
    fun hostOf(web: String): String = try {
        java.net.URI(web.trim()).host ?: ""
    } catch (e: Exception) {
        ""
    }

    fun webOrigin(web: String): String {
        val s = web.trim()
        if (s.isEmpty()) return ""
        return try {
            val u = java.net.URI(s)
            val host = u.host ?: return ""
            val scheme = (u.scheme ?: "").lowercase()
            if (host.isEmpty() || scheme.isEmpty()) return ""
            val port = if (u.port > 0) u.port else when (scheme) {
                "https" -> 443
                "http" -> 80
                else -> -1
            }
            "$scheme://$host:$port"
        } catch (e: Exception) {
            ""
        }
    }

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
                    id = o.optString("id", "").ifEmpty { idOf(base, topic, o.optString("name", "")) },
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

    /**
     * v1.34.11：按网页地址的 host:port 找这台机器的名字。
     *
     * 网页顶栏原先只查 `DshHosts`（推送 `#name` 喂的那份清单），于是用户把设备名改成 VM1 之后，
     * 手机里的设备清单已经是 VM1，而网页顶栏还停在旧名字——两份清单各说各的。
     * 以「创建二维码时设的名字」（`Devices` 这份，重扫就会更新）为准。
     */
    fun nameForWeb(ctx: Context, web: String): String {
        val origin = webOrigin(web)
        if (origin.isEmpty()) return ""
        return all(ctx).firstOrNull { !it.revoked && it.name.isNotBlank() && webOrigin(it.web) == origin }
            ?.name ?: ""
    }

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
     * 判定「是不是同一台」：**同中继 + 同频道 + 同机器名**（大小写无关）。
     * 名字不同就是另一台 —— 三台机器共用 `topic=dsh` 是常态，只按 base|topic 认会把上一台顶掉。
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
        val nm = name.trim()
        val id = idOf(b, t, nm)
        val list = all(ctx).toMutableList()
        // ① 先按 id 找（同 base|topic|机器名 = 同一台）。
        var idx = list.indexOfFirst { it.id == id }
        if (idx < 0 && nm.isNotEmpty()) {
            // ② 同 base|topic 且机器名一致：旧记录里的 id 可能是历史遗留/手工写进去的，
            //    只认 id 会让同一台设备被登成两条（2026-10-30 实测踩到过）。
            idx = list.indexOfFirst {
                it.base.trimEnd('/') == b && it.topic == t &&
                    it.name.trim().equals(nm, ignoreCase = true)
            }
        }
        if (idx < 0 && nm.isEmpty()) {
            // ③ 载荷没带机器名（插件 ≤0.7.17 / 手粘一串 tk_）：先按网页地址的「机器指纹」认人。
            //    同 base|topic 的清单里已经有别的机器、且没有一台的 host:port 对得上
            //    ⇒ 这是**另一台**，往下走新增一行；否则退回 v1.34.0 的老逻辑
            //    （宁可更新别人，也别给只有一台机器的老用户凭空多一行重复设备）。
            val origin = webOrigin(web)
            val sameBase = list.filter { it.base.trimEnd('/') == b && it.topic == t }
            val anotherMachine = origin.isNotEmpty() &&
                sameBase.isNotEmpty() &&
                sameBase.any { it.web.isNotEmpty() } &&
                sameBase.none { webOrigin(it.web) == origin }
            if (!anotherMachine) {
                idx = list.indexOfFirst { it.id == legacyIdOf(b, t) }
                if (idx < 0) idx = list.indexOfFirst { it.base.trimEnd('/') == b && it.topic == t }
            }
        }
        // ④ v1.34.10：**改名后重扫不能长出新的一行**。
        //    id 由 base|topic|机器名 派生，所以用户把「测试VM1」改成「VM1」再扫码时，
        //    按 id 和按名字都找不到旧记录，于是新增一行 ⇒ 手机里同时挂着「测试VM1」和「VM1」
        //    （2026-11-02 模拟器实测复现）。同一台机器的判据改用**网页地址的 host:port**：
        //    名字可以改、token 每次重启都换，但 host:port 不变。
        if (idx < 0) {
            val origin = webOrigin(web)
            if (origin.isNotEmpty()) {
                idx = list.indexOfFirst {
                    it.base.trimEnd('/') == b && it.topic == t && webOrigin(it.web) == origin
                }
            }
            if (idx < 0 && origin.isEmpty()) {
                // 载荷没带网页地址（老插件/手粘的串）：只有「同 base|topic 恰好一台」时才敢认，
                // 多台时宁可新增，也不能把别人的记录改名。
                val same = list.filter { it.base.trimEnd('/') == b && it.topic == t }
                if (same.size == 1) idx = list.indexOf(same[0])
            }
        }
        if (idx >= 0) {
            val old = list[idx]
            // id 保持旧值不动：lastTs:<id> 游标、已读态都挂在它上面，换 id 等于把历史抹掉
            list[idx] = old.copy(
                name = nm.ifEmpty { old.name },
                token = token.trim(),
                web = web.ifBlank { old.web },
                revoked = false,   // 重扫即恢复
            )
            // 顺手把「改名时期长出来的重复行」清掉（同一台机器 = 同 base|topic|host:port）。
            val keep = list[idx]
            val keepOrigin = webOrigin(keep.web)
            if (keepOrigin.isNotEmpty()) {
                list.removeAll { other ->
                    other.id != keep.id && other.base.trimEnd('/') == b && other.topic == t &&
                        webOrigin(other.web) == keepOrigin
                }
            }
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
     * 换通行证（v1.34.8）：插件重新开通（/enroll）后 topic 与 token 全换，手机还挂着旧的那套，
     * 表现就是「那台设备突然 403、推送没了」。插件会往**旧 topic** 补发一条 `#sysmove`，
     * 这里就地改掉这台设备的订阅，用户不必重新扫码。
     */
    /**
     * 改设备显示名（v1.34.9）：插件那边「机器名称」改了之后，`#name` 会随 `#syslink` 一起发过来，
     * 这里就地改名，用户不必重新扫码。空名/超长忽略（老插件不发 `#name` 也不会误改）。
     */
    fun rename(ctx: Context, id: String, name: String) {
        val nm = name.trim()
        if (nm.isEmpty() || nm.length > 32) return
        val list = all(ctx).toMutableList()
        val i = list.indexOfFirst { it.id == id }
        if (i < 0) return
        if (list[i].name == nm) return
        list[i] = list[i].copy(name = nm)
        save(ctx, list)
    }

    fun updatePass(ctx: Context, id: String, topic: String, token: String) {
        if (topic.isBlank() || token.isBlank()) return
        val list = all(ctx).toMutableList()
        val i = list.indexOfFirst { it.id == id }
        if (i < 0) return
        if (list[i].topic == topic && list[i].token == token) return
        list[i] = list[i].copy(topic = topic, token = token)
        save(ctx, list)
    }

    /**
     * 这条推送是哪台机器发的。认不出返回空串（调用方就不标注、不改 web）。
     *
     * ① `#name` trailer 精确/前后缀匹配（同一个 topic 下多台机器全靠它区分）；
     * ② 按 `#web` 的机器指纹 [webOrigin] 反查——同一台机器重启 DSH 只换 token 不换 host:port，
     *    所以机器改了名、或推送没带 `#name`（看门狗这类直发 ntfy 的消息）时它还能认出来；
     * ③ 只有「这个 topic 上就一台」时才退回「这条流是谁建的」（单机老用户行为不变）；
     * ④ 多台又认不出 → 空串。v1.34.4 及以前在这里无条件拿第一台兜底，结果
     *    **别人的推送把第一行的 web 盖掉**（2026-11-01 实测：laptop 那行点进去是工作VM 的网页）。
     */
    fun resolve(ctx: Context, hostName: String, fallbackId: String, web: String = ""): String {
        val nm = hostName.trim()
        if (nm.isNotEmpty()) {
            val hit = all(ctx).firstOrNull {
                it.name.equals(nm, ignoreCase = true) ||
                    it.name.endsWith(nm, ignoreCase = true) ||
                    nm.endsWith(it.name, ignoreCase = true) && it.name.isNotBlank()
            }
            if (hit != null) return hit.id
        }
        val origin = webOrigin(web)
        if (origin.isNotEmpty()) {
            val hit = all(ctx).firstOrNull { it.web.isNotEmpty() && webOrigin(it.web) == origin }
            if (hit != null) return hit.id
        }
        val fb = byId(ctx, fallbackId) ?: return ""
        val onTopic = all(ctx).count { !it.revoked && it.topicKey == fb.topicKey }
        return if (onTopic <= 1) fallbackId else ""
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
