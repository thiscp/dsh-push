package xyz.cpyh.dshpush

import android.app.Activity
import android.app.DownloadManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/** App 内置网页窗口（v1.9.8）：单实例复用，新链接在原窗口加载。
 *  vivo 浏览器无视 SINGLE_TOP 每次新开标签页（v1.9.7 实测），改为自控窗口彻底解决。 */
class WebActivity : Activity() {
    private var web: WebView? = null
    private var errorLayer: View? = null
    private var errText: TextView? = null
    // 标题栏文字（v1.30.0）：随加载的链接刷新成「DSH 网页 · 实例名」
    private var titleView: TextView? = null
    private var netCallback: ConnectivityManager.NetworkCallback? = null
    // 网页文件选择的回调（v1.19.0）：onActivityResult 里喂结果
    private var fileCb: ValueCallback<Array<Uri>>? = null

    companion object { private const val REQ_FILE = 119 }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_FILE) return
        val cb = fileCb ?: return
        fileCb = null
        val uris = ArrayList<Uri>()
        val clip = data?.clipData
        if (clip != null && clip.itemCount > 0) {
            for (k in 0 until clip.itemCount) clip.getItemAt(k).uri?.let { uris.add(it) }
        } else data?.data?.let { uris.add(it) }
        if (resultCode != RESULT_OK || uris.isEmpty()) { cb.onReceiveValue(null); return }
        cb.onReceiveValue(uris.toTypedArray())
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun c(attr: Int): Int {
        val tv = TypedValue()
        theme.resolveAttribute(attr, tv, true)
        return if (tv.resourceId != 0) resources.getColor(tv.resourceId, theme) else tv.data
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // 同全家规矩：setTheme 必须在 super.onCreate 之前（Android 16）
        setTheme(ThemePrefs.themeRes(this))
        super.onCreate(savedInstanceState)
        // 从消息通知「打开 DSH」进来 → 该条消息视为已读（v1.18.0）
        markMsgRead(intent)

        // 主题壁纸叠放（v1.25.0）：场景矢量 + 52% 立绘，与主界面同一套规则；
        // 网页区透明叠在其上，DSH Web 空隙处透出壁纸与鲸鱼娘
        val root = FrameLayout(this)
        root.addView(ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            val wp = android.util.TypedValue()
            theme.resolveAttribute(R.attr.dshWallpaper, wp, true)
            setImageResource(
                if (wp.resourceId != 0) wp.resourceId else R.drawable.bg_whale)
        }, FrameLayout.LayoutParams(-1, -1))
        val themeKey = ThemePrefs.KEYS[ThemePrefs.current(this)]
        val pose = when (themeKey) {
            "day" -> R.drawable.pose_maid to android.view.Gravity.END
            "night" -> R.drawable.pose_serious to android.view.Gravity.END
            "sakura" -> R.drawable.pose_shy to android.view.Gravity.START
            "matcha" -> R.drawable.pose_confused to android.view.Gravity.END
            "starry" -> R.drawable.pose_starry to android.view.Gravity.START
            "caramel" -> R.drawable.pose_cheerful to android.view.Gravity.END
            else -> 0 to android.view.Gravity.END
        }
        if (pose.first != 0) {
            val poseView = ImageView(this).apply {
                setImageResource(pose.first)
                scaleType = ImageView.ScaleType.FIT_XY
            }
            root.addView(poseView, FrameLayout.LayoutParams(1, 1).apply {
                gravity = android.view.Gravity.BOTTOM or pose.second
            })
            poseView.post {
                val h = (root.height * 0.52f).toInt()
                if (h > 1) {
                    val lp = poseView.layoutParams as FrameLayout.LayoutParams
                    lp.width = (h * 935f / 1682f).toInt()
                    lp.height = h
                    poseView.layoutParams = lp
                }
            }
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(6))
        }
        val tv = TextView(this).apply {
            text = "DSH 网页"
            textSize = 16f
            setTextColor(c(R.attr.dshTextPrimary))
            setTypeface(android.graphics.Typeface.DEFAULT_BOLD)
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        }
        titleView = tv
        bar.addView(tv)
        bar.addView(Button(this).apply {
            text = "关闭"
            textSize = 12f
            setBackgroundResource(R.drawable.bg_pill)
            setTextColor(c(R.attr.dshAccent))
            stateListAnimator = null
            setPadding(dp(16), dp(6), dp(16), dp(6))
            setOnClickListener { finish() }
        })
        content.addView(bar)

        // 深色三档：仅所选主题为深色时开，浅色主题保持亮页（v1.12.0）
        val dark = ThemePrefs.KEYS[ThemePrefs.current(this)] in setOf("night", "starry")
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // 去掉 Mobile 标记，DSH Web 按桌面版渲染（v1.9.8）
            settings.userAgentString =
                settings.userAgentString?.replace(" Mobile", "")?.replace("; wv", "")
            // 网页透明，让主题壁纸从空隙透出（v1.25.0）
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            if (Build.VERSION.SDK_INT >= 33) {
                settings.isAlgorithmicDarkeningAllowed = dark
            } else if (Build.VERSION.SDK_INT >= 29) {
                @Suppress("DEPRECATION")
                settings.forceDark =
                    if (dark) WebSettings.FORCE_DARK_ON else WebSettings.FORCE_DARK_OFF
            }
            // 26–28 无框架深色 API，不动
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?, request: WebResourceRequest?
                ): Boolean {
                    val u = request?.url ?: return false
                    val s = u.scheme ?: return false
                    if (s == "http" || s == "https") return false
                    // 站外协议（intent://、mailto: 等）交还系统
                    try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (e: Exception) { }
                    return true
                }

                override fun onPageStarted(
                    view: WebView?, url: String?, favicon: android.graphics.Bitmap?
                ) {
                    // 页内跳去别的机器（如下载链、跨实例链接）时标题跟着换（v1.30.0）
                    url?.let { applyInstanceLabel(it) }
                }

                // 主框架加载失败 → 人设错误页（v1.12.0）
                override fun onReceivedError(
                    view: WebView?, request: WebResourceRequest?, error: WebResourceError?
                ) {
                    if (request?.isForMainFrame == true) showError()
                }

                override fun onReceivedHttpError(
                    view: WebView?, request: WebResourceRequest?,
                    errorResponse: WebResourceResponse?
                ) {
                    if (request?.isForMainFrame == true &&
                        (errorResponse?.statusCode ?: 0) >= 500
                    ) showError()
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    hideError()
                    // 窄屏（≤1023px）三处修补（v1.32.3）：
                    //   ① 提问卡头部允许换行 + 问题文字占满整行。DSH Web 的卡头部是单行 flex
                    //      (justify-content:space-between)，右侧按钮组 flex-shrink:0 且 nowrap，
                    //      文字块是唯一可收缩项 → 一行放不下时被压成 width:0，汉字一列一字竖排。
                    //   ② 侧栏改成浮层：中心列不再被 280px 侧栏压缩（DSH 自己在 1024px 以下会
                    //      自动收起侧栏，但手机屏上手动展开后它不收缩，中心列只剩 132px）。
                    //      展开态 position:fixed 盖在内容上、可滚动；点内容区自动收起。
                    //   ③ 全部规则都放在 @media (max-width:1023px) 内 —— 桌面宽度布局零改动。
                    // 选择器用 [class*=] 属性包含匹配，不硬编码 CSS-module 哈希；注入幂等
                    //（先按 id 查重），并单独给监听器打标记，onPageFinished 多次触发不会重复挂。
                    view?.evaluateJavascript(
                        "(function(){" +
                        "if(document.getElementById('bw-narrow-fix'))return;" +
                        "var s=document.createElement('style');s.id='bw-narrow-fix';" +
                        "s.textContent=\"@media (max-width:1023px){" +
                        "[class*='mAtvLq_header']{flex-wrap:wrap!important}" +
                        "[class*='mAtvLq_headingBlock']{flex:1 1 100%!important;min-width:0}" +
                        "[class*='BynINW_frame']{grid-template-columns:56px minmax(0,1fr) minmax(0,0px)!important}" +
                        "[class*='_2H3hWW_root']:not([class*='_2H3hWW_collapsed']){position:fixed!important;" +
                        "left:0;top:0;bottom:0;width:280px!important;max-width:280px!important;" +
                        "z-index:60!important;overflow-y:auto!important;overflow-x:hidden!important;" +
                        "box-shadow:0 8px 32px rgba(0,0,0,.28)!important}}\";" +
                        "document.head.appendChild(s);" +
                        "if(window.__bwPanelClose)return;window.__bwPanelClose=1;" +
                        "document.addEventListener('pointerdown',function(e){" +
                        "if(window.innerWidth>1023)return;" +
                        "var sb=document.querySelector(\"[class*='_2H3hWW_root']\");" +
                        "if(!sb||sb.className.indexOf('_2H3hWW_collapsed')>=0)return;" +
                        "if(e.clientX<=280)return;" +
                        "var b=document.querySelectorAll('button');" +
                        "for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';" +
                        "if(a.indexOf('Collapse sidebar')>=0||a.indexOf('收起侧边栏')>=0){b[i].click();return;}}" +
                        "},true);})();", null)
                    // 网页玻璃化（v1.25.1）：全屏画布全透，卡片/侧栏/气泡降为 45% 半透
                    // + 毛玻璃模糊，壁纸全程可见且文字清晰；CSSOM 写内联样式（页面 CSP
                    // 拦动态 style 标签），MutationObserver 让后渲染的元素也自动玻璃化，
                    // 纱罩深浅按网页文字亮度自动选（深色页配深纱、浅色页配白纱）
                    view?.evaluateJavascript(
                        "(function(){" +
                        "function apply(){if(!document.body)return;" +
                        "document.documentElement.style.setProperty(" +
                        "'background-color','transparent','important');" +
                        "document.body.style.setProperty('background-color'," +
                        "'transparent','important');" +
                        "var vw=window.innerWidth,vh=window.innerHeight;" +
                        "var all=document.querySelectorAll('div,main,section," +
                        "header,aside,nav,button,textarea,input,ul,li');" +
                        "for(var i=0;i<all.length;i++){var e=all[i];" +
                        "var m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?" +
                        "/.exec(getComputedStyle(e).backgroundColor);" +
                        "if(!m)continue;if(m[4]!==undefined&&+" +
                        "parseFloat(m[4])<1)continue;" +
                        "var w=e.offsetWidth,h=e.offsetHeight;" +
                        "if(w>vw*0.5&&h>vh*0.5)e.style.setProperty(" +
                        "'background-color','transparent','important');" +
                        "else{e.style.setProperty('background-color','rgba('+" +
                        "m[1]+','+m[2]+','+m[3]+',0.45)','important');" +
                        "if(w>vw*0.08&&h>vh*0.03){" +
                        "e.style.setProperty('backdrop-filter','blur(12px)'," +
                        "'important');e.style.setProperty('-webkit-backdrop-" +
                        "filter','blur(12px)','important');}}}" +
                        "var v=document.getElementById('dsh-theme-veil');" +
                        "if(!v){v=document.createElement('div');v.id='dsh-theme-veil';" +
                        "document.body.appendChild(v);}" +
                        "var mm=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(" +
                        "getComputedStyle(document.body).color)||[];" +
                        "var lum=mm[1]?(0.299*mm[1]+0.587*mm[2]+0.114*mm[3])/255:0;" +
                        "v.style.cssText='position:fixed;inset:0;z-index:-1;" +
                        "pointer-events:none;background:'+(lum>0.5?" +
                        "'rgba(18,24,40,0.45)':'rgba(255,255,255,0.45)');}" +
                        "apply();setTimeout(apply,1500);setTimeout(apply,4000);" +
                        "var t=null;new MutationObserver(function(){clearTimeout(t);" +
                        "t=setTimeout(apply,400);}).observe(document.body," +
                        "{childList:true,subtree:true});})();", null)
                }
            }
            // 上传与下载（v1.19.0）：
            // WebChromeClient——<input type=file> 弹系统文件选择器，顺带恢复 JS alert/confirm
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?, cb: ValueCallback<Array<Uri>>?,
                    params: FileChooserParams?
                ): Boolean {
                    if (cb == null) return false
                    fileCb = cb
                    // 不做 acceptType 过滤：DSH Web 上传本就任意文件，*/* 最稳
                    val pick = Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        setType("*/*")
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                    return try {
                        startActivityForResult(
                            Intent.createChooser(pick, "选择文件"), REQ_FILE); true
                    } catch (e: Exception) { fileCb = null; false }
                }
            }
            // DownloadListener——APK 等非网页内容 WebView 渲染不了会无声吞掉。
            // v1.21.1：OriginOS 的系统 DownloadManager 常静默卡死（enqueue 成功但永远不动，
            // 1.21.0 上架实锤），改为 OkHttp 自下载落 MediaStore Downloads（下载列表仍可见），
            // 完成直接拉安装器；API<29 无 MediaStore.Downloads，退回系统 DownloadManager
            setDownloadListener { u, ua, cd, mime, _ ->
                try {
                    // guessFileName 会被 octet-stream 之类泛型 MIME 带偏成 .bin
                    // （.apk 不在系统 MIME 表）；URL 路径自带扩展名时直接信 URL（v1.19.1）
                    val seg = Uri.parse(u).path?.substringAfterLast('/') ?: ""
                    val name = if (seg.contains('.')) seg
                               else URLUtil.guessFileName(u, cd, mime)
                    if (Build.VERSION.SDK_INT >= 29) {
                        val app = applicationContext
                        val main = android.os.Handler(android.os.Looper.getMainLooper())
                        android.widget.Toast.makeText(
                            this@WebActivity, "开始下载 $name", android.widget.Toast.LENGTH_SHORT
                        ).show()
                        Thread {
                            var dlUri: Uri? = null
                            try {
                                val rq = okhttp3.Request.Builder().url(u)
                                    .header("User-Agent", ua ?: "").build()
                                okhttp3.OkHttpClient().newCall(rq).execute().use { resp ->
                                    if (!resp.isSuccessful) error("HTTP ${resp.code}")
                                    val values = android.content.ContentValues().apply {
                                        put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name)
                                        put(android.provider.MediaStore.Downloads.MIME_TYPE,
                                            mime ?: "application/octet-stream")
                                        put(android.provider.MediaStore.Downloads.IS_PENDING, 1)
                                    }
                                    dlUri = app.contentResolver.insert(
                                        android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                                        values) ?: error("MediaStore insert 失败")
                                    app.contentResolver.openOutputStream(dlUri!!)!!.use { dst ->
                                        resp.body!!.byteStream().use { src -> src.copyTo(dst) }
                                    }
                                    values.put(
                                        android.provider.MediaStore.Downloads.IS_PENDING, 0)
                                    app.contentResolver.update(dlUri!!, values, null, null)
                                }
                                if (name.endsWith(".apk", true)) {
                                    val install = Intent(Intent.ACTION_VIEW)
                                        .setDataAndType(
                                            dlUri, "application/vnd.android.package-archive")
                                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                            Intent.FLAG_ACTIVITY_NEW_TASK)
                                    try { app.startActivity(install) }
                                    catch (e: Exception) {
                                        main.post {
                                            android.widget.Toast.makeText(app,
                                                "下载完了，但拉不起安装器(${e.javaClass.simpleName})，" +
                                                "去下载列表手动装", Toast.LENGTH_LONG).show()
                                        }
                                    }
                                }
                            } catch (e: Exception) {
                                if (dlUri != null) try {
                                    app.contentResolver.delete(dlUri!!, null, null)
                                } catch (_: Exception) { }
                                main.post {
                                    android.widget.Toast.makeText(app,
                                        "下载失败: ${e.javaClass.simpleName} ${e.message ?: ""}",
                                        Toast.LENGTH_LONG).show()
                                }
                            }
                        }.start()
                    } else {
                        var n = name
                        val dir = Environment.getExternalStoragePublicDirectory(
                            Environment.DIRECTORY_DOWNLOADS)
                        if (java.io.File(dir, n).exists()) {
                            val dot = n.lastIndexOf('.')
                            n = if (dot > 0)
                                n.substring(0, dot) + "-" + System.currentTimeMillis() / 1000 +
                                    n.substring(dot)
                            else n + "-" + System.currentTimeMillis() / 1000
                        }
                        val req = DownloadManager.Request(Uri.parse(u))
                        req.addRequestHeader("User-Agent", ua ?: "")
                        req.setTitle(n)
                        req.setNotificationVisibility(
                            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        req.setDestinationInExternalPublicDir(
                            Environment.DIRECTORY_DOWNLOADS, n)
                        getSystemService(DownloadManager::class.java).enqueue(req)
                        android.widget.Toast.makeText(
                            this@WebActivity, "开始下载 $n", android.widget.Toast.LENGTH_SHORT
                        ).show()
                    }
                } catch (e: Exception) {
                    // 兜底：交系统浏览器处理
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) }
                    catch (_: Exception) { }
                }
            }
        }
        // 错误层：盖在 WebView 上的叠放层，默认隐藏（v1.12.0）
        val layer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            visibility = View.GONE
            setBackgroundColor(c(R.attr.dshBgPage))
            addView(ImageView(this@WebActivity).apply {
                setImageResource(R.drawable.pet_idle)
            }, LinearLayout.LayoutParams(dp(110), dp(110)))
            val tv = TextView(this@WebActivity).apply {
                textSize = 14f
                gravity = Gravity.CENTER
                setTextColor(c(R.attr.dshTextSecondary))
                setPadding(0, dp(16), 0, dp(16))
            }
            errText = tv
            addView(tv, LinearLayout.LayoutParams(-2, -2))
            addView(Button(this@WebActivity).apply {
                text = "重试"
                textSize = 12f
                setBackgroundResource(R.drawable.bg_pill)
                setTextColor(c(R.attr.dshAccent))
                stateListAnimator = null
                setPadding(dp(20), dp(8), dp(20), dp(8))
                setOnClickListener { hideError(); web?.reload() }
            })
        }
        errorLayer = layer
        val webBox = FrameLayout(this).apply {
            addView(web, FrameLayout.LayoutParams(-1, -1))
            addView(layer, FrameLayout.LayoutParams(-1, -1))
        }
        content.addView(webBox, LinearLayout.LayoutParams(-1, -1))
        root.addView(content, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        watchNetwork()

        val url = intent?.getStringExtra("url") ?: ""
        if (url.isEmpty()) { finish(); return }
        applyInstanceLabel(url)
        web?.loadUrl(url)
    }

    /** 标题栏与最近任务标签带上实例名（v1.30.0）：
     *  按 host:port 反查 v1.29 的实例清单（名称来自推送 #name 或用户改名），
     *  查不到退化为 host:port——工作 VM 还是本地台式机一眼可辨。 */
    private fun applyInstanceLabel(url: String) {
        if (url.isEmpty()) return
        val id = DshHosts.hostOf(url)
        val name = try {
            DshHosts.all(this).firstOrNull { it.id == id }?.name
        } catch (e: Exception) {
            null
        } ?: id
        titleView?.text = "DSH 网页 · $name"
        // 最近任务卡片标题同步——多开时也能分清哪张是哪台
        title = "DSH · $name"
    }

    /** 错误页：睡觉鲸鱼 + 主机名 + 重试胶囊（v1.12.0） */
    private fun showError() {
        val u = web?.url ?: ""
        val host = try { Uri.parse(u).host } catch (e: Exception) { null } ?: u
        errText?.text = "连不上这台机器\n$host\n可能它睡着了或网络断了"
        errorLayer?.visibility = View.VISIBLE
    }

    private fun hideError() {
        errorLayer?.visibility = View.GONE
    }

    /** 错误页显示期间网络恢复 → 自动重试（v1.12.0，API 24+） */
    private fun watchNetwork() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread {
                    if (errorLayer?.visibility == View.VISIBLE) {
                        hideError()
                        web?.reload()
                    }
                }
            }
        }
        netCallback = cb
        try {
            cm.registerDefaultNetworkCallback(cb)
        } catch (e: Exception) {
            netCallback = null
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        // 窗口复用：token 换新等直接在同一窗口加载新链接（v1.9.8）
        markMsgRead(intent)
        val u = intent?.getStringExtra("url") ?: ""
        if (u.isNotEmpty()) {
            applyInstanceLabel(u)
            web?.loadUrl(u)
        }
    }

    // 消息通知的「打开 DSH」带 mid/ts → 该条标已读并撤掉这条通知（setAutoCancel 只管
    // 点本体不管按钮）；常驻通知入口不带这些 extra，零副作用（v1.18.0/1.18.1）
    private fun markMsgRead(i: Intent?) {
        if (i == null) return
        val mid = i.getIntExtra("mmid", 0)
        val ts = i.getLongExtra("mts", 0L)
        if (mid != 0 || ts != 0L) {
            PushService.markRead(this, mid, ts)
            val nid = i.getIntExtra("mnid", 0)
            if (nid != 0) getSystemService(NotificationManager::class.java).cancel(nid)
        }
    }

    override fun onPause() {
        super.onPause()
        web?.onPause()
        android.webkit.CookieManager.getInstance().flush()
    }

    override fun onResume() {
        super.onResume()
        web?.onResume()
    }

    override fun onDestroy() {
        netCallback?.let { cb ->
            try {
                (getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)
                    ?.unregisterNetworkCallback(cb)
            } catch (e: Exception) { }
        }
        netCallback = null
        web?.let { w ->
            (w.parent as? ViewGroup)?.removeView(w)
            w.destroy()
        }
        web = null
        android.webkit.CookieManager.getInstance().flush()
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (web?.canGoBack() == true) web?.goBack() else super.onBackPressed()
    }
}
