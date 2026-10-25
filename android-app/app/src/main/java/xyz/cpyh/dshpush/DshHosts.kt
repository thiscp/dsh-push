package xyz.cpyh.dshpush

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject

/** 多 DSH 实例清单（v1.29.0）。
 *
 *  为什么需要：卡片与常驻通知上的「打开 DSH」用的是**这条推送自带**的 `#web` 链接，
 *  所以长期只用一台时，另一台就没有稳定入口。这里把"推送见过的实例"登记下来，
 *  给主页按钮与常驻通知动作共用，让用户自己挑进哪台。
 *
 *  去重键 = host:port；链接每次推送刷新——token 每次 DSH 重启必变，登记即自愈。
 *  名称优先取推送的 `#name` 尾巴（各台在 token 文件里配 WEB_NAME），缺省 host:port。 */
object DshHosts {
    private const val KEY = "hosts"
    private const val MAX = 10

    data class Host(val id: String, val name: String, val url: String, val lastSeen: Long)

    /** host:port（默认端口按 scheme 补 80/443），解析失败退化为整串 */
    fun hostOf(url: String): String {
        return try {
            val u = Uri.parse(url)
            val h = u.host ?: return url
            val p = if (u.port > 0) u.port else if (u.scheme == "https") 443 else 80
            "$h:$p"
        } catch (e: Exception) {
            url
        }
    }

    /** 只有带 ?token= 的链接才算 DSH 实例：更新通知的 `#web` 指向 APK 下载链接，
     *  早期版本会把它登记成 "ntfy.cpyh.xyz:443" 这种假实例（v1.29.1 修） */
    private fun looksLikeDsh(url: String) = url.contains("token=")

    fun all(ctx: Context): List<Host> {
        val out = ArrayList<Host>()
        try {
            val p = ctx.getSharedPreferences(PushService.PREF, Context.MODE_PRIVATE)
            val arr = JSONArray(p.getString(KEY, "[]") ?: "[]")
            for (k in 0 until arr.length()) {
                val o = arr.optJSONObject(k) ?: continue
                val id = o.optString("id")
                val url = o.optString("url")
                if (id.isEmpty() || url.isEmpty()) continue
                if (!looksLikeDsh(url)) continue      // 历史脏数据读时即过滤
                val nm = o.optString("name")
                out.add(Host(id, if (nm.isEmpty()) id else nm, url, o.optLong("lastSeen")))
            }
        } catch (e: Exception) {
        }
        out.sortByDescending { it.lastSeen }
        return out
    }

    /** 登记或刷新一台实例；changed=true 表示清单结构变化（调用方可据此刷新常驻通知） */
    fun upsert(ctx: Context, url: String, name: String?): Boolean {
        if (url.isEmpty() || !looksLikeDsh(url)) return false
        return try {
            val p = ctx.getSharedPreferences(PushService.PREF, Context.MODE_PRIVATE)
            val id = hostOf(url)
            val list = read(p)
            val before = list.size
            var found = false
            for (o in list) {
                if (o.optString("id") == id) {
                    o.put("url", url)
                    o.put("lastSeen", now())
                    if (!name.isNullOrEmpty()) o.put("name", name)
                    found = true
                    break
                }
            }
            if (!found) {
                list.add(JSONObject()
                    .put("id", id)
                    .put("name", if (name.isNullOrEmpty()) id else name)
                    .put("url", url)
                    .put("lastSeen", now()))
            }
            list.sortByDescending { it.optLong("lastSeen") }
            val kept = JSONArray()
            for ((i, o) in list.withIndex()) if (i < MAX) kept.put(o)
            p.edit().putString(KEY, kept.toString()).apply()
            PushService.listeners.forEach { it.onNewMsg() }
            !found || list.size != before
        } catch (e: Exception) {
            false
        }
    }

    fun rename(ctx: Context, id: String, name: String) {
        mutate(ctx) { o ->
            if (o.optString("id") == id && name.isNotEmpty()) o.put("name", name)
            false // 改名不删条目
        }
    }

    fun remove(ctx: Context, id: String) {
        mutate(ctx) { o -> o.optString("id") == id }
    }

    // ── 最后使用过的会话（v1.33.39，用户 m06190）──────────────────────────────
    // 网页切会话**不写 URL**（DSH Web 没有路由，revealFromHash 还会把片段抹掉），
    // 所以「用户最后停在哪个对话」只能由页面侧读出、经 App 的 bwNative.saveSess 落盘。
    // 按 host:port 分开存：三台宿主的会话 id 互不相干。
    private const val SESS_PREFIX = "sess:"

    fun lastSess(ctx: Context, hostId: String): String {
        if (hostId.isEmpty()) return ""
        return try {
            ctx.getSharedPreferences(PushService.PREF, Context.MODE_PRIVATE)
                .getString(SESS_PREFIX + hostId, "") ?: ""
        } catch (e: Exception) {
            ""
        }
    }

    fun saveLastSess(ctx: Context, hostId: String, sid: String) {
        if (hostId.isEmpty() || sid.isEmpty()) return
        try {
            val p = ctx.getSharedPreferences(PushService.PREF, Context.MODE_PRIVATE)
            if (p.getString(SESS_PREFIX + hostId, "") == sid) return
            p.edit().putString(SESS_PREFIX + hostId, sid).apply()
        } catch (e: Exception) {
        }
    }

    private fun mutate(ctx: Context, f: (JSONObject) -> Boolean) {
        try {
            val p = ctx.getSharedPreferences(PushService.PREF, Context.MODE_PRIVATE)
            val kept = JSONArray()
            for (o in read(p)) if (!f(o)) kept.put(o)
            p.edit().putString(KEY, kept.toString()).apply()
            PushService.listeners.forEach { it.onNewMsg() }
        } catch (e: Exception) {
        }
    }

    private fun read(p: android.content.SharedPreferences): ArrayList<JSONObject> {
        val list = ArrayList<JSONObject>()
        try {
            val arr = JSONArray(p.getString(KEY, "[]") ?: "[]")
            for (k in 0 until arr.length()) arr.optJSONObject(k)?.let { list.add(it) }
        } catch (e: Exception) {
        }
        return list
    }

    private fun now() = System.currentTimeMillis() / 1000
}
