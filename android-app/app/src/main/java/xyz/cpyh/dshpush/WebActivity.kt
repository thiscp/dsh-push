package xyz.cpyh.dshpush

import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
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
    // 网络感知（v1.32.8）：
    //   offline     —— 默认网络丢失（onLost）；离线横幅按它显隐
    //   retryAttempt—— 首连失败的退避计数（1s/2s/4s/... 封顶 30s），加载成功清零
    //   retryPending—— 已排期的重试；手动重试/恢复成功时取消，避免双重加载
    //   loadErrored —— 本次加载的主文档出错过（onPageFinished 对错误页也会触发，
    //                  不能拿它当"成功"信号，必须靠这个旗标区分）
    private var offline = false
    private var retryAttempt = 0
    private var retryPending: Runnable? = null
    private var loadErrored = false
    private val ui = Handler(Looper.getMainLooper())
    // 最初那次 loadUrl 的地址：WebView 自己报不出可用地址时用它兜底（v1.32.8）
    private var lastUrl: String = ""
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
                    // 新的一次导航＝新的一次尝试：成败由回调重新判定（v1.32.8）
                    loadErrored = false
                    url?.let { if (it.startsWith("http")) lastUrl = it }
                    // 页内跳去别的机器（如下载链、跨实例链接）时标题跟着换（v1.30.0）
                    url?.let { applyInstanceLabel(it) }
                }

                // 主框架加载失败 → 人设错误页（v1.12.0）+ 退避自动重试（v1.32.8）
                override fun onReceivedError(
                    view: WebView?, request: WebResourceRequest?, error: WebResourceError?
                ) {
                    if (request?.isForMainFrame == true) {
                        loadErrored = true
                        showError()
                        scheduleRetry("onReceivedError")
                    }
                }

                override fun onReceivedHttpError(
                    view: WebView?, request: WebResourceRequest?,
                    errorResponse: WebResourceResponse?
                ) {
                    if (request?.isForMainFrame == true &&
                        (errorResponse?.statusCode ?: 0) >= 500
                    ) {
                        loadErrored = true
                        showError()
                        scheduleRetry("onReceivedHttpError")
                    }
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    // 加载成功才清退避；错误页也会走到这里，所以要靠 loadErrored 区分（v1.32.8）
                    if (loadErrored) {
                        scheduleRetry("onPageFinished(error-page)")
                    } else {
                        retryAttempt = 0
                        cancelRetry()
                    }
                    hideError()
                    // 断网期间页面重载过 → 横幅要重新挂上（页面 DOM 是新的）
                    if (offline) showNetBanner()
                    // 窄屏（≤1023px）修补（v1.32.5）：
                    //   ① 提问卡头部允许换行 + 问题文字占满整行（同 v1.32.2 的做法，但只在窄屏生效）。
                    //   ② 侧栏展开态改成浮层：中心列不被 280px 侧栏压缩，浮层盖在内容上、可滚动、
                    //      点浮层之外的内容区自动收起。
                    //   ③ 关键修复（v1.32.4）：把侧栏祖先链上的 backdrop-filter/filter/transform/contain
                    //      中和掉，并让承载侧栏的 BynINW_sidebarCol overflow:visible。原因：本文件的玻璃化
                    //      注入会给该列加 backdrop-filter:blur(12px)，而 backdrop-filter 会让元素成为
                    //      fixed 后代的包含块 —— 于是 position:fixed 的浮层被锚定在那个 56px 宽、
                    //      overflow:hidden 的网格列里，真机上只画出 56px 一条（getBoundingClientRect 仍
                    //      报 280px，所以只量 computed style 会误判成好的）。
                    //   ④ 展开态面板底色加到 92% 不透明（v1.32.5）：v1.32.4 去掉毛玻璃后，背后聊天文字会
                    //      透上来和侧栏条目混在一起；bwPanelBg() 按当前 computed 色相把 alpha 调到 0.92
                    //      （收起态/桌面宽度仍是毛玻璃的 0.45），并给展开态加 box-shadow 造层次。
                    //      注意玻璃化注入用的是**内联** !important，优先级高于样式表，所以那一步必须
                    //      跳过展开态面板（见下方 skipBg），中间不能只靠样式表压。
                    //   ⑤ 全部规则限定在 @media (max-width:1023px)，桌面宽度零改动。
                    //   ⑥ v1.32.7 修 QA FINDING-1/3（只动这段注入）：
                    //      F1 大字体（font_scale 1.5）：会话标题截断后与时间戳贴死（"…3h" 无间隙）、
                    //        列表末行被底部 Settings 页脚/渐隐压住 → 标题钉死可收缩、时间戳钉死不可收缩并
                    //        留 8px 左间距、滚动列表补 40px 底部留白（上游 hIlkoa_time 本就有 flex-shrink:0。
                    //        注意 [class*='_9lTDKa_list'] 同时命中外层 listArea（不可滚，pb 把裁切折线抬离
                    //        页脚 40px）与真滚动容器 list（pb 给末行滚到底的余量）；1.5 档内容高于视口本来
                    //        就要滚，修完滚到底末行完整露出、距 Settings 顶余量充足）。
                    //      F3 命中区：7 个图标按钮 28×28/23×23/17×23 → 命中框按"相邻中心距"封顶、
                    //        只纵向给 40（QA-ROUND-v1.32.7 FINDING-1/2/3 的教训：横向无脑 40 会让
                    //        相邻框互叠，点 A 的中心实测触发 B——elementFromPoint + 真点击双证据）。
                    //        手法仍是"放大+等量负 margin"，margin box 逐像素不变、整行零位移：
                    //        · 侧栏 Workspaces 行三钮（中心距 32）：min 32×40、margin -6 -2 → 相切零重叠；
                    //        · 头部 Open-in/More-ways 分体钮（实测盒中心距仅 20.2）：main 保自然宽 23、
                    //          chevron min-width:20 且 left margin +1.3（把框推到 main 右缘恰好相切，
                    //          分体钮相邻、纯负 margin 必咬 1.3px）、高都 40——物理上放不进两个 40 宽，
                    //          宽度按中心距封顶（QA 建议）；
                    //        · Agent Team 触发器：撤掉横向扩张（带标签态自然宽 85 已够宽，横向负 margin
                    //          会把框伸进面板/邻居——FINDING-3 的死区+打架），只留纵向 -6 给 40 高；
                    //        · 面板 Collapse 钮与收起态轨道钮无同排邻居，保持 40×40。
                    //        FINDING-4 那批（More actions 等）本轮不动：它们间距也挤，扩了重演同一个洞。
                    //      红线自查：玻璃化大容器 transparent 分支（壁纸唯一通道）没碰；280/0.92/56 没动。
                    // 选择器用 [class*=] 属性包含匹配，不硬编码 CSS-module 哈希；注入幂等（按 id 查重），
                    // 监听器另有标记，onPageFinished 多次触发不会重复挂。
                    view?.evaluateJavascript(
                        "(function(){" +
                        "if(document.getElementById('bw-narrow-fix'))return;" +
                        "var s=document.createElement('style');s.id='bw-narrow-fix';" +
                        "s.textContent=\"@media (max-width:1023px){" +
                        "[class*='mAtvLq_header']{flex-wrap:wrap!important}" +
                        "[class*='mAtvLq_headingBlock']{flex:1 1 100%!important;min-width:0}" +
                        "[class*='BynINW_frame']{grid-template-columns:56px minmax(0,1fr) minmax(0,0px)!important}" +
                        "[class*='BynINW_sidebarCol']{overflow:visible!important;backdrop-filter:none!important;" +
                        "-webkit-backdrop-filter:none!important;filter:none!important;transform:none!important;" +
                        "contain:none!important;will-change:auto!important}" +
                        "[class*='_2H3hWW_root']:not([class*='_2H3hWW_collapsed']){position:fixed!important;" +
                        "left:0;top:0;bottom:0;width:280px!important;max-width:280px!important;" +
                        "z-index:60!important;overflow-y:auto!important;overflow-x:hidden!important;" +
                        "box-shadow:0 8px 32px rgba(0,0,0,.35)!important}" +
                        "[class*='hIlkoa_title']{min-width:0!important;flex-shrink:1!important}" +
                        "[class*='hIlkoa_time']{flex-shrink:0!important;margin-left:8px!important}" +
                        "[class*='_9lTDKa_list']{padding-bottom:40px!important}" +
                        "[class*='_2H3hWW_iconButton']{min-width:40px!important;min-height:40px!important;" +
                        "display:inline-flex!important;align-items:center!important;" +
                        "justify-content:center!important;margin:-6px!important}" +
                        "[class*='_9lTDKa_searchButton'],[class*='_9lTDKa_iconButton']{" +
                        "min-width:32px!important;min-height:40px!important;" +
                        "display:inline-flex!important;align-items:center!important;" +
                        "justify-content:center!important;margin:-6px -2px!important}" +
                        "[class*='EBLgjq_trigger']{min-height:40px!important;margin:-6px 0!important}" +
                        "[class*='WgQWqa_main']{min-height:40px!important;" +
                        "display:inline-flex!important;align-items:center!important;" +
                        "justify-content:center!important;margin:-8.5px 0!important}" +
                        "[class*='WgQWqa_chevron']{min-width:20px!important;min-height:40px!important;" +
                        "display:inline-flex!important;align-items:center!important;" +
                        "justify-content:center!important;margin:-8.5px -3.9px -8.5px 1.3px!important}}\";" +
                        "document.head.appendChild(s);" +
                        "function bwPanelBg(){var sb=document.querySelector(\"[class*='_2H3hWW_root']\");" +
                        "if(!sb)return;var m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(" +
                        "getComputedStyle(sb).backgroundColor);if(!m)return;" +
                        "var narrow=window.innerWidth<=1023;" +
                        "var expanded=sb.className.indexOf('_2H3hWW_collapsed')<0;" +
                        "var a=(narrow&&expanded)?0.92:0.45;" +
                        "sb.style.setProperty('background-color'," +
                        "'rgba('+m[1]+','+m[2]+','+m[3]+','+a+')','important');}" +
                        "window.__bwPanelBg=bwPanelBg;bwPanelBg();" +
                        "setTimeout(bwPanelBg,300);setTimeout(bwPanelBg,1200);" +
                        "var psb=document.querySelector(\"[class*='_2H3hWW_root']\");" +
                        "if(psb&&!window.__bwPanelBgObs){window.__bwPanelBgObs=1;" +
                        "new MutationObserver(function(){bwPanelBg();})" +
                        ".observe(psb,{attributes:true,attributeFilter:['class']});" +
                        "window.addEventListener('resize',function(){bwPanelBg();});}" +
                        "if(window.__bwPanelClose)return;window.__bwPanelClose=1;" +
                        "document.addEventListener('pointerdown',function(e){" +
                        "if(window.innerWidth>1023)return;" +
                        "var sb=document.querySelector(\"[class*='_2H3hWW_root']\");" +
                        "if(!sb||sb.className.indexOf('_2H3hWW_collapsed')>=0)return;" +
                        "var r=sb.getBoundingClientRect();" +
                        "if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom)return;" +
                        "var b=document.querySelectorAll('button');" +
                        "for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';" +
                        "if(a.indexOf('Collapse sidebar')>=0||a.indexOf('收起侧边栏')>=0){b[i].click();return;}}" +
                        "},true);})();", null)
                    // 网页玻璃化（v1.25.1）：全屏画布全透，卡片/侧栏/气泡降为 45% 半透
                    // 注意（v1.32.6）：大容器(>50%视口)必须走 else 的**互斥**分支设 transparent——
                    // 这是壁纸能透出来的唯一原因。v1.32.5 重构 skipBg 时丢了 else，
                    // 大容器先 transparent 再被 45% 覆盖，frame/中心列/包裹层每层 45% 白
                    // 叠成 ~91% 白，壁纸整个消失（真机+模拟器都复现，只看面板截图没看出来）。
                    // 注意（v1.32.4）：BynINW_sidebarCol / BynINW_frame 上不加 backdrop-filter ——
                    // 它会让该元素成为 fixed 后代的包含块，把窄屏侧栏浮层锚死在被裁剪的网格列里
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
                        // 浮层底色回退色（v1.32.11）：真实指令菜单表层 Z9Jnlq_menu 的
                        // computed background 是 **transparent**（它的底色来自样式表/伪元素），
                        // 所以它连下面的正则分支都进不去（!m 或 alpha<1 直接 continue），
                        // 这正是"菜单太透、文字发花"的机制。命中的浮层若自身没有可用色相，
                        // 就按页面文字亮度选深/浅纱（与 #dsh-theme-veil 同一判据）。
                        "var bm=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(" +
                        "getComputedStyle(document.body).color)||[];" +
                        "var blum=bm[1]?(0.299*bm[1]+0.587*bm[2]+0.114*bm[3])/255:0;" +
                        // 0.96 而非 0.92：0.92 下实测仍能隐约看到底层聊天正文叠印（8% 透光），
                        // 而用户投诉的正是"太透"。0.96 只留 4% 透光，肉眼不再有可辨识的叠印。
                        "var ovFallback=blum>0.5?'rgba(18,24,40,0.96)':" +
                        "'rgba(255,255,255,0.96)';" +
                        "var all=document.querySelectorAll('div,main,section," +
                        "header,aside,nav,button,textarea,input,ul,li');" +
                        "for(var i=0;i<all.length;i++){var e=all[i];" +
                        "var m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?" +
                        "/.exec(getComputedStyle(e).backgroundColor);" +
                        "var w=e.offsetWidth,h=e.offsetHeight;" +
                        "var cn=(e.className||'').toString();" +
                        // v1.32.11 浮层例外：菜单/popover/对话框此前和普通卡片一样被压到 0.45，
                        // 立绘与底层聊天文字透上来把菜单项文字搅花（用户真机反馈"选择传文件的控件
                        // 背景透明度是否太低了点"）。判定按**结构/角色**特征，不硬编码 CSS-module
                        // 哈希——上游一改哈希就失效（v1.32.5 的教训）：role ∈ {menu,listbox,dialog,
                        // alertdialog,tooltip} 直接命中；否则要求 position:fixed|absolute +
                        // z-index≥10 + 面积不超 90% 视口 + 至少 3 个可交互子项。
                        // 命中的浮层给 0.92（与展开态侧栏同档）且**不加** backdrop-filter：0.92 已够，
                        // 而 backdrop-filter 会让元素成为 fixed 后代的包含块（v1.32.4 的坑）。
                        // 红线守卫：大容器 transparent 分支仍然存在（v1.32.6 壁纸整层消失的教训），
                        // 但**排在浮层之后且两者互斥**；App 自身锚点（BynINW_*）与侧栏根
                        // （_2H3hWW_root，归 bwPanelBg 管）不进浮层判定。
                        "var isOv=false,ovRole=false;" +
                        "if(cn.indexOf('BynINW_')<0&&cn.indexOf('_2H3hWW_root')<0){" +
                        "var role=(e.getAttribute&&e.getAttribute('role')||'').toLowerCase();" +
                        "if(role==='menu'||role==='listbox'||role==='dialog'||" +
                        "role==='alertdialog'||role==='tooltip'){isOv=true;ovRole=true;}" +
                        "else{var ocs=getComputedStyle(e);" +
                        "if((ocs.position==='fixed'||ocs.position==='absolute')&&" +
                        "ocs.zIndex!=='auto'&&parseInt(ocs.zIndex,10)>=10&&" +
                        "w<=vw*0.9&&h<=vh*0.9&&" +
                        "e.querySelectorAll(\"button,a,li,[role='menuitem']," +
                        "[role='option'],[tabindex]\").length>=3){isOv=true;}}}" +
                        // ★ v1.32.12 内容阅读面板保底：大容器分支把所有 >50%x50% 的元素一律设成
                        // transparent，于是"对话生成的文档"预览面板被抹成全透明 —— 实测
                        // SECTION._tabHost_6nhg2_162（360x671 = 100%x100%）内联被写成
                        // `transparent !important`，而它的**原生**背景是 rgb(255,255,255)
                        // （应用自己就是不透明纯白阅读页）⇒ 底层页签栏/聊天正文/文档文字互相叠印
                        // （用户 2026-10-15 反馈"打开文档背景也是透明的"）。
                        // ⚠ 判据必须是**结构**特征，绝不能用"原生是否不透明"：实测
                        // BynINW_frame（壁纸唯一通道）原生**同样是** rgb(255,255,255)，用颜色判据
                        // 会把壁纸通道一起变不透明 ⇒ 每层白叠加 ⇒ 直接复现 v1.32.6 壁纸整层消失。
                        // 结构判据：阅读面板是**全屏定位覆盖层**（自身 absolute/fixed，或 8 层内有
                        // "定位且 ≥90%×90% 视口"的祖先）；壁纸通道是 static/relative 常规布局。
                        // 实测该判据下 wouldChange 恰好只有 _tabHost 一个，三项关键容器均不命中。
                        "var big=(w>vw*0.5&&h>vh*0.5);" +
                        // ★ v1.32.14：把**布局/滚动容器**一并挡在"取原生色相回写"与 isCB 之外。
                        // 追加 Dc7zOa_root 的依据（QA-ROUND-v1.32.13 FINDING-1 实测 + lead 追查）：
                        // 它是聊天根（304x671，原生 rgb(255,255,255) 兜底白）。v1.32.13 首版里
                        // 「剥内联读原生」对 na>=1 的元素**不还原**（因为要把原生色相写回），
                        // 若此刻 isCB 恰为 true（innerBig 是**运行时测量**：首屏/流式渲染中后代尚未
                        // 撑开 ⇒ 可能临时 <=2），就会写出 rgb(255,255,255) ⇒ **聊天根变不透明白 ⇒
                        // 壁纸被盖 ≈2s**（tester 已截到实锤 qa-C14-dcroot-nativewhite-1.png）。
                        // 布局容器稳定态 innerBig=41/42/70 本不该命中，但**动态态会失真** ⇒
                        // 不能只靠动态量兜底，必须**显式排除**（遵"宁可漏修、不可误修"）。
                        // 代价：内容块(代码块)绝不会是聊天根 ⇒ wouldChange 仍 = 1。
                        "var isAnchor=cn.indexOf('BynINW_')>=0||" +
                        "cn.indexOf('_2H3hWW_root')>=0||" +
                        "cn.indexOf('Dc7zOa_root')>=0;" +
                        "var isPanel=false;" +
                        "if(big&&!isAnchor&&e.id!=='dsh-theme-veil'){" +
                        "var pcs=getComputedStyle(e);" +
                        "if(pcs.position==='absolute'||pcs.position==='fixed'){isPanel=true;}" +
                        "else{var pa=e.parentElement,ph=0;" +
                        "while(pa&&ph<8){var acs=getComputedStyle(pa);" +
                        "if(acs.position==='absolute'||acs.position==='fixed'){" +
                        "var ar=pa.getBoundingClientRect();" +
                        "if(ar.width>=vw*0.9&&ar.height>=vh*0.9){isPanel=true;break;}}" +
                        "pa=pa.parentElement;ph++;}}}" +
                        "if(!m)continue;" +
                        "var a0=(m[4]!==undefined?parseFloat(m[4]):1);" +
                        // 取**原生**色相 pm（v1.32.12 起）：我们可能已把内联值改成 transparent 或 0.45，
                        // 此时 computed 读不出原色 ⇒ 临时摘掉内联再读，读完按需还原。
                        // 原生确实没有不透明底的（如 OUqwTW_panelBody/_surface_6nhg2_125、#dsh-theme-veil）
                        // 一律判为"不是内容面"，**绝不给无底元素凭空加底**。
                        // veil 按 id 显式排除：连瞬时摘除都不做，不依赖"另一段注入恰好先写"的顺序。
                        "var pm=(a0>=1?m:null);" +
                        "if(big&&!isAnchor&&a0<1&&e.id!=='dsh-theme-veil'){" +
                        "var sv=e.style.getPropertyValue('background-color')," +
                        "sp=e.style.getPropertyPriority('background-color');" +
                        "e.style.removeProperty('background-color');" +
                        "var nx=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?" +
                        "/.exec(getComputedStyle(e).backgroundColor);" +
                        "var na=(nx&&nx[4]!==undefined)?parseFloat(nx[4]):(nx?1:0);" +
                        "if(nx&&na>=1){pm=nx;}else{if(sv)e.style.setProperty(" +
                        "'background-color',sv,sp||'');}}" +
                        // ★ v1.32.13「内容块」判据：innerBig = 后代里**自身也超过 50%×50% 视口**的元素
                        // 个数（"里面还套着几层大容器"）。实测布局容器 BynINW_frame/centerCol/Dc7zOa_root
                        // = 70/42/41，而聊天里的大代码块 = **2** ⇒ 20 倍余量，是干净的**结构**判据、
                        // **不依赖 CSS-module 类名**（v1.32.5 教训）。
                        // ⛔ 被实测否决的判据：**"后代含 pre/code"** —— Dc7zOa_root（布局容器，
                        // innerBig=41）后代里也有 pre/code（整棵聊天树含代码块）⇒ 会命中布局容器
                        // ⇒ 多层白叠 ⇒ **复现 v1.32.6「壁纸整层消失」**。只能靠嵌套计数，不能靠语义/颜色。
                        // 代价控制：innerBig 与上面的"剥内联"都**只在 big && !isAnchor 成立时才做**；
                        // 实测该判据下 wouldChange 恰好 = 1（只有目标代码块）。
                        "var innerBig=-1,isCB=false;" +
                        "if(big&&!isAnchor&&pm){" +
                        "innerBig=0;" +
                        "var _ds=e.querySelectorAll('div,section,main," +
                        "aside,article,pre,code,table,ul');" +
                        "for(var _i=0;_i<_ds.length;_i++){if(_ds[_i]===e)continue;" +
                        "var _r=_ds[_i].getBoundingClientRect();" +
                        "if(_r.width>vw*0.5&&_r.height>vh*0.5)innerBig++;}" +
                        "isCB=(innerBig<=2);}" +
                        // 幂等闸门：非浮层/非面板保持原保守语义（已半透明则不再处理）。
                        // ★ 但**内容块必须放行** —— 否则"还矮时被写成 0.45、长高后被闸门挡住"的实例
                        // （坏态 B）**永远修不回来**。实测同屏 10 个 md-code-block，其中 8 个高度未过
                        // 阈值、按设计就该是 0.45（本轮裁定不动）；放行只对命中 isCB 的生效。
                        "if(!isOv&&!(big&&isPanel)&&!isCB&&a0<1)continue;" +
                        "var skipBg=cn.indexOf('_2H3hWW_root')>=0&&" +
                        "cn.indexOf('_2H3hWW_collapsed')<0&&vw<=1023;" +
                        // ★ v1.32.11 复修（QA P1）：分支顺序反了。原先无条件先判
                        // `if(w>vw*0.5&&h>vh*0.5) -> transparent`，浮层分支排在它后面 ⇒
                        // 菜单一旦变高（实测 257x392，vw=360/vh=671 ⇒ 392>335.5）就落进大容器分支
                        // 被写成 transparent，`else if(isOv)` 永远轮不到 ⇒ 用户看到的就是
                        // "菜单还是全透、正文立绘照旧叠印"。我上轮只测到矮菜单（257x172，未过阈值）
                        // 才误以为已修好 —— 阈值上下两种几何都必须测。
                        // 修法：浮层判定提到大容器之前，两者**互斥**；且 role 命中的浮层
                        // （真菜单正是 role=listbox）**豁免全部几何判定**（含大容器分支），
                        // 因为面积阈值会把真实菜单判成"大容器"而废掉它。
                        "if(isOv&&(ovRole||!(w>vw*0.5&&h>vh*0.5))){" +
                        "var oa=(m[4]!==undefined?parseFloat(m[4]):1);" +
                        "e.style.setProperty('background-color'," +
                        "(oa<1?ovFallback:'rgba('+m[1]+','+m[2]+','+m[3]+',0.96)')," +
                        "'important');}" +
                        // ★ v1.32.12 阅读面板：仅当"大容器 + 全屏定位面板 + 原生确实有不透明底"时，
                        // 用它的**原生色相**恢复不透明实底（实测应用原生就是 rgb(255,255,255)
                        // 不透明纯白阅读页 ⇒ alpha=1 是**还原原生设计**，而非我们另造档位）。
                        // 为何是 1 而不是与浮层同档的 0.96：整页长文阅读面板的唯一职责是长时间
                        // 舒适阅读，与"短暂浮在内容上、需要空间线索"的菜单/浮层诉求不同 ⇒ 不必同档；
                        // 且 0.96 实测在面板空白处**仍可辨认底层聊天正文淡影**（lead 亲自看图确认）。
                        // 安全性与 alpha **正交**：是否命中完全由 isPanel 结构判据 + nativeOpaque
                        // 前置 + veil/锚点显式排除三道护栏决定，改 alpha 不改变任何安全性质。
                        // 排在 transparent 通道分支**之前且互斥**；pm 为 null（原生无底）则落到
                        // 通道分支，行为与 v1.32.11 完全一致。
                        "else if(big&&isPanel&&pm){e.style.setProperty(" +
                        "'background-color','rgb('+pm[1]+','+pm[2]+','+pm[3]+')'," +
                        "'important');}" +
                        // ★ v1.32.13 内容块：聊天正文里的大代码块（实测 331x524，原生 rgb(249,250,251)
                        // 不透明浅灰）此前落进大容器分支被抹成 transparent ⇒ 代码透出底层聊天正文
                        // （用户 2026-10-15「修吧」）。判据 isCB = 后代中大容器数 <= 2（见上文推导）；
                        // 给**原生色相**、alpha=1（它是**内容**不是装饰，半透明直接伤代码可读性；
                        // 应用原生本就完全不透明 ⇒ 1.0 是还原原生，与 v1.32.12 阅读面板同构）。
                        // 与 isPanel 分支**互斥**（isCB 计算里已含 !isAnchor，且 isPanel 在前）；
                        // pm 为 null（原生无底）则落回通道分支，行为与 v1.32.12 一致。
                        "else if(big&&isCB&&pm){e.style.setProperty(" +
                        "'background-color','rgb('+pm[1]+','+pm[2]+','+pm[3]+')'," +
                        "'important');}" +
                        "else if(w>vw*0.5&&h>vh*0.5){e.style.setProperty(" +
                        "'background-color','transparent','important');}" +
                        "else if(!skipBg){e.style.setProperty('background-color','rgba('+" +
                        "m[1]+','+m[2]+','+m[3]+',0.45)','important');" +
                        "if(w>vw*0.08&&h>vh*0.03&&" +
                        "!(/BynINW_(sidebarCol|frame)/.test(cn))){" +
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
                setOnClickListener {
                    // 手动重试＝兜底（v1.32.8）：取消已排期的退避、清零计数，避免和自动重试打架
                    cancelRetry()
                    retryAttempt = 0
                    loadErrored = false
                    hideError()
                    val target = currentUrl()
                    if (target.isNotEmpty()) web?.loadUrl(target)
                }
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
        lastUrl = url
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

    // ---- 网络感知（v1.32.8）------------------------------------------------------------
    // 离线横幅：注入到网页 DOM 里（不是原生层），因为原生错误层只在"加载失败"时出现，
    // 而断网时页面往往还好好儿地渲染着（WebSocket 断了、或用的是缓存），用户需要立刻看到提示。
    // 命中区纪律（verify/TESTER.md 规则 6）：横幅 fixed 在顶部、z-index 最高，但 **pointer-events:none**
    // —— 它压在页面头部一排图标按钮上时，点击事件照样穿透给下面的按钮（elementFromPoint 也返回按钮），
    // 所以不会出现"看着能点、点了没反应"；这条要用 elementFromPoint + 真实输入双证来验。
    private fun bannerJs(show: Boolean): String {
        val id = "bw-net-banner"
        return if (show) {
            "(function(){var d=document.getElementById('$id');" +
                "if(!d){d=document.createElement('div');d.id='$id';" +
                "d.textContent='\u7f51\u7edc\u5df2\u65ad\u5f00\uff0c\u6b63\u5728\u7b49\u5f85\u6062\u590d\u2026';" +
                "d.style.cssText='position:fixed;left:0;right:0;top:0;z-index:2147483000;" +
                "background:rgba(18,24,40,0.92);color:#fff;font-size:12px;line-height:1.2;" +
                "padding:8px 10px;text-align:center;pointer-events:none;font-family:inherit;" +
                "box-shadow:0 2px 8px rgba(0,0,0,0.35)';" +
                "(document.body||document.documentElement).appendChild(d);}" +
                "d.style.display='block';return 1;})()"
        } else {
            "(function(){var d=document.getElementById('$id');if(d)d.remove();return 1;})()"
        }
    }

    private fun showNetBanner() {
        web?.evaluateJavascript(bannerJs(true), null)
    }

    private fun hideNetBanner() {
        web?.evaluateJavascript(bannerJs(false), null)
    }

    /** 首连失败的退避重试：1s → 2s → 4s → 8s → 16s → 30s（封顶），成功后清零。 */
    private fun scheduleRetry(why: String) {
        if (retryPending != null) return
        if (isFinishing || isDestroyed) return
        val secs = when {
            retryAttempt <= 0 -> 1
            retryAttempt >= 5 -> 30
            else -> 1 shl retryAttempt
        }
        val r = Runnable {
            retryPending = null
            if (isFinishing || isDestroyed) return@Runnable
            val target = currentUrl()
            if (target.isEmpty()) return@Runnable
            retryAttempt += 1
            loadErrored = false   // 本次尝试成败由回调重新判定
            web?.loadUrl(target)
        }
        retryPending = r
        ui.postDelayed(r, secs * 1000L)
    }

    private fun cancelRetry() {
        retryPending?.let { ui.removeCallbacks(it) }
        retryPending = null
    }

    /** 当前该重载的地址：优先 WebView 正在用的 http(s) 地址，退化到最初那次 loadUrl。 */
    private fun currentUrl(): String {
        val u = web?.url ?: ""
        if (u.startsWith("http://") || u.startsWith("https://")) return u
        return lastUrl
    }

    /** 网络状态变化（v1.32.8）：断网 → ≤2s 出横幅；恢复 → 撤横幅，且页面处于断开态就自动重载。 */
    private fun watchNetwork() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onLost(network: Network) {
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    offline = true
                    showNetBanner()
                }
            }

            override fun onAvailable(network: Network) {
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    offline = false
                    hideNetBanner()
                    // 断开态（错误层在 / 主文档加载失败 / 还没加载成功过）→ 自动重载，不需要用户手点
                    val broken = errorLayer?.visibility == View.VISIBLE || loadErrored
                    if (broken) {
                        cancelRetry()
                        retryAttempt = 0
                        loadErrored = false
                        hideError()
                        val target = currentUrl()
                        if (target.isNotEmpty()) web?.loadUrl(target)
                    }
                }
            }
        }
        netCallback = cb
        try {
            cm.registerDefaultNetworkCallback(cb)
            // 注册那一刻就断着网的情况：主动问一次，别等下次变化
            if (cm.activeNetwork == null) {
                offline = true
                web?.post { showNetBanner() }
            }
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
            lastUrl = u
            loadErrored = false
            cancelRetry()
            retryAttempt = 0
            web?.loadUrl(u)
        }
    }

    // 消息通知的「打开 DSH」带 mid/ts → 该条标已读并撤掉这条通知（setAutoCancel 只管
    // 点本体不管按钮）；常驻通知入口不带这些 extra，零副作用（v1.18.0/1.18.1；
    // v1.32.10 起撤通知收拢进 markRead 内部，mnid 重复自撤删除——双撤本就幂等，行为不变）
    private fun markMsgRead(i: Intent?) {
        if (i == null) return
        val mid = i.getIntExtra("mmid", 0)
        val ts = i.getLongExtra("mts", 0L)
        if (mid != 0 || ts != 0L) {
            PushService.markRead(this, mid, ts)
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
        cancelRetry()   // 关窗后别再排期加载（v1.32.8）
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
