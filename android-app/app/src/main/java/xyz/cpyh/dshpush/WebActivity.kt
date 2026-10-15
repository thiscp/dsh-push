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
                    //          ⚠ 该前提在 CSS360（v1.32.8 起的基线）下不成立——见 F5。
                    //        FINDING-4 那批（More actions 等）本轮不动：它们间距也挤，扩了重演同一个洞。
                    //      F5 命中区（v1.32.15，QA-A14 P1 的 App 侧残留）：v1.32.7 那句"面板 Collapse 钮
                    //        无同排邻居"在 360 宽下是错的。展开态侧栏被改成浮层后，中心列被压到 304、
                    //        头部控件整体左移（实测 智能体团队 203.8→231.8、Open-in 234.6→257.6、
                    //        More-ways 258.9→278.9），而 toggle 的自然盒是 240→268 ⇒ **上游本身就压在一起**；
                    //        再叠加 min-width:40 + margin:-6 的外扩 ⇒ 命中框 234→274，与 Open-in 的
                    //        命中框重叠 23.0px（与 More-ways 15.1px）——实测 elementFromPoint 在
                    //        Open-in 视觉中心 (246.1,25.5) 拿到的是 toggle 而非 Open-in（真页面 + 真注入复现）。
                    //        修法：**展开态**把 toggle 的命中框收回自然宽（28×28，右缘 268 < 浮层右缘 280，
                    //        不再越出面板侵入内容列控件条带）；**收起态（56px 轨道）无同排邻居，40×40 一字不动**。
                    //        实测：展开态重叠 23.0→17.6（残余部分来自上游版面，App 侧无法清零）、toggle 中心/四边
                    //        自命中全 OK；收起态 toggle 仍 40×40、轨道 6 钮 selfHit 6/6 不回归。
                    //        诚实边界：展开态下 Open-in 等 header 控件在 360 宽下**本来就被 280px 浮层盖住**
                    //        （浮层 z-index:60、覆盖 x≤280），用户点不到它们 ⇒ 本修**不声称"消除了用户误触"**，
                    //        只消除命中框越界这一 App 侧缺陷（QA-A14 的判据本身）。
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
                        "[class*='_2H3hWW_root']:not([class*='_2H3hWW_collapsed']) " +
                        "[class*='_2H3hWW_toggle']{min-width:0!important;min-height:0!important;" +
                        "margin:0!important}" +
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
                // ★ v1.32.16 D2（P2）：上面整段样式表按**类名前缀**认元素，换宿主哈希命名后
                //   **整体空转**。vm1 实测（verify/qa-d1-vm1b.json 的 census）：BynINW_=0、
                //   _2H3hWW_root=0，真实名字是 pI_x6G_frame / pI_x6G_sidebarCol / hHd-Xa_root
                //   ⇒ 展开态侧栏仍**在流内**吃掉 280px（sidebarCol 280x671），正文列
                //   centerCol 只剩 80px，7 个代码块全被压成 **9px 宽**（9x4975 / 9x2942 /
                //   9x2524 / 9x2410 …）；收起侧栏才恢复 233px（verify/qa-d1b-vm1.json：
                //   centerCol 304x671、卡片 233x353）。这不是观感问题，是**功能性破坏**
                //   （代码块根本读不了）。
                //   下面这段**只用渲染盒模型 / 几何**认元素，MUST NOT 依赖任何类名或前缀：
                //     · 框架 = computed display 为 grid、宽 ≥90% 视口、高 ≥50% 视口、
                //       解析出的轨道（gridTemplateColumns 的 used 值）≥2 条；
                //     · 侧栏列 = 框架子节点里贴左缘（left ≤ 框架左缘+2）、高 ≥60% 视口、
                //       宽 ∈ [96px, 90%vw]、且 position 为 static/relative —— **在流内**才叫
                //       挤压；已是 fixed 浮层（笔电样式表生效的样子）不算；
                //     · 饥饥 = 同一框架里存在宽 <35% 视口、高 ≥50% 视口的兄弟列
                //       （= 正文列被吃掉，即 lead 说的「检测有个兄弟块在吃宽度」）；
                //     · 展开态 = 侧栏列宽 ≥ 轨道宽+40 **且** 有饥饥兄弟；否则按收起态处理
                //       ⇒ **撤销**我们写过的内联（样式表那条靠
                //       :not([class*='_2H3hWW_collapsed']) 做同一件事，几何段没有类名可用，
                //       只能「每轮重判 + 撤销」，否则收起侧栏会被我们的 width 钉成 280px）。
                //   轨道宽（收起态那条 56px）**优先实测**：见过窄态就把实测值存进
                //   window.__bwRailW，没见过才退回 56（与样式表里那个 56px 同源）。
                //   写入一律内联 !important（与玻璃化注入同一优先级手法），且**先比后写**
                //   （bwSet）：下面的观察器带 attributeFilter:['class','style']，若每轮都重
                //   写同样的值就会「写→变异→再写」永动（4Hz 强制重排）。
                //   红线自查：只写 grid-template-columns / 侧栏列的包含块属性 / 侧栏浮层
                //   定位，**没碰任何 background 通道**；笔电那条 0.92 路径（类名命中时）
                //   一行没改（合成 DOM S13b 实测：侧栏根仍 rgba(255,255,255,0.92)、卡片仍
                //   rgb(249,250,251)、正文列仍 transparent）。
                "function bwRailW(){var w=window.__bwRailW;" +
                "return (w>0&&w<160)?w:56;}" +
                "function bwGeom(){var vw=window.innerWidth,vh=window.innerHeight;" +
                "if(vw>1023||vw<=0||vh<=0)return null;" +
                "var nodes=document.querySelectorAll('div,section,main');" +
                "for(var i=0;i<nodes.length;i++){var f=nodes[i];" +
                "var rf=f.getBoundingClientRect();" +
                "if(rf.width<vw*0.9||rf.height<vh*0.5)continue;" +
                "var cs=getComputedStyle(f);" +
                "if(cs.display!=='grid'&&cs.display!=='inline-grid')continue;" +
                "var tp=(cs.gridTemplateColumns||'').split(' '),tr=[],j,v;" +
                "for(j=0;j<tp.length;j++){v=parseFloat(tp[j]);tr.push(v>0?v:0);}" +
                "if(tr.length<2)continue;" +
                "var col=null,starved=false,ch=f.children,rc;" +
                "for(var c=0;ch&&c<ch.length;c++){rc=ch[c].getBoundingClientRect();" +
                "if(rc.left<=rf.left+2&&rc.height>=vh*0.6&&rc.width>=96&&" +
                "rc.width<=vw*0.9){" +
                "var pcs=getComputedStyle(ch[c]);" +
                "if(pcs.position==='static'||pcs.position==='relative')" +
                "col=ch[c];}" +
                "if(rc.width>0&&rc.width<vw*0.35&&rc.height>=vh*0.5)" +
                "starved=true;}" +
                "if(!col)continue;" +
                "var colW=Math.round(col.getBoundingClientRect().width);" +
                "var rail=bwRailW();" +
                "if(colW<rail&&colW>=40)window.__bwRailW=colW;" +
                "var panel=col,cc=col.children,q;" +
                "for(q=0;cc&&q<cc.length;q++){rc=cc[q].getBoundingClientRect();" +
                "if(rc.width>=rail+40&&rc.height>=vh*0.6){panel=cc[q];break;}}" +
                "return {f:f,col:col,panel:panel,colW:colW,rail:rail," +
                "starved:starved,expanded:(colW>=rail+40&&starved)};}" +
                "return null;}" +
                "var BWK=['position','left','top','bottom','width','max-width'," +
                "'z-index','overflow-y','overflow-x','box-shadow'];" +
                "var BWC=['overflow','backdrop-filter','-webkit-backdrop-filter'," +
                "'filter','transform','contain','will-change'];" +
                "function bwSet(el,k,v){" +
                "if(el.style.getPropertyValue(k)===v&&" +
                "el.style.getPropertyPriority(k)==='important')return;" +
                "el.style.setProperty(k,v,'important');}" +
                "function bwUndo(){var w=window.__bwW;if(!w)return;" +
                "window.__bwW=null;window.__bwSbEl=null;" +
                "try{if(w.f&&w.f.isConnected)" +
                "w.f.style.removeProperty('grid-template-columns');" +
                "if(w.col&&w.col.isConnected){for(var j=0;j<BWC.length;j++)" +
                "w.col.style.removeProperty(BWC[j]);}}catch(e1){}" +
                // 收起侧栏时顺手把底色从 0.92 拉回 0.45（与笔电类名那条
                //   `var a=(narrow&&expanded)?0.92:0.45` 同一取值）：几何段撤销定位后
                //   __bwSbEl 已被清掉、bwPanelBg 找不到对象，否则会把展开态的 0.92
                //   留在收起态的 56px 导航条上。这里继承的是**同一个色相**——bwPanelBg
                //   写的时候就是保留原生色相只改 alpha，所以此刻读到的仍是页面自己的色相。
                "try{if(w.panel&&w.panel.isConnected){for(var k=0;k<BWK.length;k++)" +
                "w.panel.style.removeProperty(BWK[k]);}}catch(e2){}" +
                "try{if(w.panel&&w.panel.isConnected){var pb=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/" +
                ".exec(getComputedStyle(w.panel).backgroundColor);" +
                "if(pb)w.panel.style.setProperty('background-color','rgba('+pb[1]+','+pb[2]+','" +
                "+pb[3]+',0.45)','important');}}catch(e3){}}" +
                "function bwGeomFix(){var g=bwGeom();" +
                "if(!g||!g.expanded){bwUndo();return;}" +
                "if(window.__bwW&&(window.__bwW.f!==g.f||" +
                "window.__bwW.panel!==g.panel))bwUndo();" +
                "var f=g.f,col=g.col,panel=g.panel,rail=g.rail;" +
                "var vw=window.innerWidth;" +
                "var tp=(getComputedStyle(f).gridTemplateColumns||'').split(' ')," +
                "tr=[],j,v;" +
                "for(j=0;j<tp.length;j++){v=parseFloat(tp[j]);tr.push(v>0?v:0);}" +
                "var at=-1;" +
                "for(j=0;j<tr.length;j++){if(Math.abs(tr[j]-g.colW)<=2){at=j;break;}}" +
                "if(at>=0){var nw=[];" +
                "for(j=0;j<tr.length;j++){if(j===at)nw.push(rail+'px');" +
                "else if(j===at+1)nw.push('minmax(0,1fr)');" +
                "else nw.push(tr[j]+'px');}" +
                "bwSet(f,'grid-template-columns',nw.join(' '));}" +
                "for(j=0;j<BWC.length;j++)col.style.setProperty(BWC[j]," +
                "(BWC[j]==='overflow'?'visible':(BWC[j]==='will-change'?" +
                "'auto':'none')),'important');" +
                "var pw=Math.round(panel.getBoundingClientRect().width);" +
                "if(pw<rail+40)pw=280;if(pw>vw*0.9)pw=Math.round(vw*0.85);" +
                "bwSet(panel,'position','fixed');" +
                "bwSet(panel,'left','0px');bwSet(panel,'top','0px');" +
                "bwSet(panel,'bottom','0px');" +
                "bwSet(panel,'width',pw+'px');" +
                "bwSet(panel,'max-width',pw+'px');" +
                "bwSet(panel,'z-index','60');" +
                "bwSet(panel,'overflow-y','auto');" +
                "bwSet(panel,'overflow-x','hidden');" +
                "bwSet(panel,'box-shadow','0 8px 32px rgba(0,0,0,.35)');" +
                // 玻璃化注入可能已把侧栏根写成 transparent（类名 skipBg 在 vm1 失效）。
                // 这里只摘**我们自己写的那一条**（值 transparent + 优先级 important 是它的
                // 指纹），把页面原生色相露出来给下面的 bwPanelBg 调色相用；否则
                // getComputedStyle 读到 rgba(0,0,0,0) 会被判成「黑色 92%」⇒ 侧栏变黑。
                "if(panel.style.getPropertyValue('background-color')===" +
                "'transparent'&&panel.style.getPropertyPriority(" +
                "'background-color')==='important')" +
                "panel.style.removeProperty('background-color');" +
                "window.__bwW={f:f,col:col,panel:panel};" +
                "window.__bwSbEl=panel;}" +
                "function bwPanelBg(){bwGeomFix();" +
                "var sb=document.querySelector(\"[class*='_2H3hWW_root']\");" +
                "if(!sb){sb=window.__bwSbEl;}" +
                "if(!sb)return;" +
                "var m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/" +
                ".exec(getComputedStyle(sb).backgroundColor);if(!m)return;" +
                // 色相不可用（computed 全透明）就不写：没有可保留的色相，硬写会把
                // 它变成近黑。类名命中的宿主由 skipBg 保住原生色相，走不到这条。
                "if(m[4]!==undefined&&parseFloat(m[4])===0)return;" +
                "var narrow=window.innerWidth<=1023;" +
                "var expanded=sb.className.indexOf('_2H3hWW_collapsed')<0;" +
                "if(!document.querySelector(\"[class*='_2H3hWW_root']\"))" +
                "expanded=(getComputedStyle(sb).position==='fixed');" +
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
                // ★ v1.32.16 D2：类名没命中的宿主上面那个观察器根本没挂 ⇒ 展开/收起
                //   侧栏不会重跑几何修复。补一个**几何版**观察器：观察 body 子树的
                //   class/style 变化 + resize，**合并去抖 250ms**（bwGeomFix 每跑一次都要
                //   量一遍盒模型，不能每个 mutation 都量）。配合上面的 bwSet 先比后写，
                //   不会「写→变异→再写」永动。
                "if(!psb&&!window.__bwGeomObs){window.__bwGeomObs=1;" +
                "var bt=null;" +
                "function bwLater(){if(bt)return;" +
                "bt=setTimeout(function(){bt=null;bwPanelBg();},250);}" +
                "new MutationObserver(function(){bwLater();})" +
                ".observe(document.body,{attributes:true,subtree:true," +
                "attributeFilter:['class','style']});" +
                "window.addEventListener('resize',function(){bwLater();});}" +
                "if(window.__bwPanelClose)return;window.__bwPanelClose=1;" +
                "document.addEventListener('pointerdown',function(e){" +
                "if(window.innerWidth>1023)return;" +
                "var sb=document.querySelector(\"[class*='_2H3hWW_root']\");" +
                "if(!sb){sb=window.__bwSbEl;if(!sb)return;" +
                "if(getComputedStyle(sb).position!=='fixed')return;}" +
                "else if(sb.className.indexOf('_2H3hWW_collapsed')>=0)return;" +
                "var r=sb.getBoundingClientRect();" +
                "if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&" +
                "e.clientY<=r.bottom)return;" +
                "var b=document.querySelectorAll('button');" +
                "for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';" +
                "if(a.indexOf('Collapse sidebar')>=0||a.indexOf('收起侧边栏')>=0)" +
                "{b[i].click();return;}}" +
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
                        // ★ v1.32.15-C 实现细节：候选**每轮收集成一批**，循环外只排**一对** rAF 复核
                        // （而不是每个候选各排一对）。原因：首屏时稳定态闸门对所有大元素都是关的，
                        // 候选可达数十个；若每个候选复核通过就各自重跑 apply()，就是 O(N^2) 次
                        // apply()（实测 41 个候选直接把合成 DOM 跑到 OOM），真机上等于 ANR。
                        // ★ QA 探针：qa[] 收集本轮进入内容块候选集的元素，循环结束后整体挂到
                        // window.__qaCb（见下方）。只读诊断，不参与判定。
                        "var qa=[];" +
                        "var cand=[];" +
                        "function _cbn(t){var n=0,ds=t.querySelectorAll(" +
                        "'div,section,main,aside,article,pre,code,table,ul');" +
                        "for(var q=0;q<ds.length;q++){if(ds[q]===t)continue;" +
                        "var rr=ds[q].getBoundingClientRect();" +
                        "if(rr.width>vw*0.5&&rr.height>vh*0.5)n++;}" +
                        "return n;}" +
                        "for(var i=0;i<all.length;i++){var e=all[i];" +
                        // ★ v1.32.16 D3（P3）：visibility:hidden 的子树**根本不渲染**，给它写底色
                        //   只是写脏状态：零 tab 时隐藏的 _emptyTabHost_6nhg2_143（360x671，
                        //   visibility:hidden）被写成 rgb(255,255,255)!important（verify/qa-d1-vm1b.json
                        //   里唯一 alpha=1 的大容器）。判据只看**元素自己的 computed visibility**：
                        //   该属性可继承也可被子节点覆盖（父 hidden + 子显式 visible 仍会渲染），
                        //   往上逐级找 hidden 反而会把这种情况误判成隐藏。跳过 = **完全不碰**
                        //   （不写不透明也不写 transparent，也不动 __dshGlass 标记）；它变可见时一定
                        //   伴随 class/attribute 变化，由已挂的 MutationObserver 或 1500/4000ms 超时
                        //   重跑 apply() 补上。顺手把循环里的 getComputedStyle(e) 提成 csE 复用
                        //   （浮层分支的 ocs 也改用 csE），每个元素反而少一次 getComputedStyle。
                        "var csE=getComputedStyle(e);" +
                        "if(csE.visibility==='hidden')continue;" +
                        "var m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?" +
                        "/.exec(csE.backgroundColor);" +
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
                        // v1.32.15：这里补上聊天根 Dc7zOa_root。全段注入里类名闸门**只保留这一处**（它防的是
                        // "聊天根被 role/几何判成浮层⇒被提到 0.96"，与下面 isLayout 的单向写是两条
                        // 独立防线）。它同样会随上游改名而腐烂，但**失效方向是安全侧**（漏修），
                        // 且不参与透明/不透明的翻转，故保留作保险；反面 isAnchor 已整体换成结构判据。
                        "var isOv=false,ovRole=false;" +
                        "if(cn.indexOf('BynINW_')<0&&cn.indexOf('_2H3hWW_root')<0&&" +
                        "cn.indexOf('Dc7zOa_root')<0){" +
                        "var role=(e.getAttribute&&e.getAttribute('role')||'').toLowerCase();" +
                        "if(role==='menu'||role==='listbox'||role==='dialog'||" +
                        "role==='alertdialog'||role==='tooltip'){isOv=true;ovRole=true;}" +
                        "else{var ocs=csE;" +
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
                        // 结构判据：阅读面板是**全屏定位覆盖层**（自身 absolute/fixed，或祖先链上有
                        // “定位且 ≥90%×90% 视口”的覆盖层）；壁纸通道是 static/relative 常规布局。
                        // 实测该判据下 wouldChange 恰好只有 _tabHost 一个，三项关键容器均不命中。
                        // ⚠ 已登记风险（lead 裁定 a，v1.32.15）：本判据依赖「阅读面板 = **定位**覆盖层」
                        // 这个**当前实测事实**（自身 absolute/fixed，实测 360x671）。若哪天 DSH 把
                        // 面板改成 position:relative 的全屏层，isLayout 会先命中它 ⇒ 面板被写
                        // transparent ⇒ v1.32.12 回归。tester 已把「文档预览面板不透明」列为红线
                        // 断言；放宽 static/relative 白名单之前必须先重测这条。
                        "var big=(w>vw*0.5&&h>vh*0.5);" +
                        // ★ v1.32.14 曾用**类名锚点** isAnchor（BynINW_ / _2H3hWW_root / Dc7zOa_root）
                        // 把布局/滚动容器挡在“取原生色相回写”与 isCB 之外。**该锚点已整体腐烂**
                        // （lead 实测取证，直接采用、勿再重新假设）：三台宿主服务的 bundle
                        // **逐字节相同**，而现行 CSS-module 命名是 《_局部名_哈希5_行号》（
                        // _tabHost_6nhg2_162 / _surface_6nhg2_125 / _split_6nhg2_17，66 个前缀，
                        // 配套 --dsh-dockkit-* 变量），旧方案 《哈希5_局部名》 在 1.47 MB 的 4 个 asset
                        // 里 **0 命中** ⇒ 那道显式排除**恒为 false、等于零** ⇒ dockkit 的布局/
                        // 滚动容器（原生正是不透明白：CSS “._tabHost_6nhg2_162:not(
                        // ._float_6nhg2_156){background:var(--dsw-alias-bg-base)}”）落进 isPanel / isCB
                        // 两条**运行时测量**分支；innerBig 在首屏/流式渲染中途会临时失真
                        // （v1.32.13 FINDING-1 已实测掉到 <=2）⇒ 中途写出 rgb(255,255,255)、下一次
                        // MutationObserver 又抹回 transparent ⇒ **背景反复翻面**；慢宿主（VM 走
                        // tailscale、渲染节奏慢）撞窗口概率高、笔电 loopback 几乎不撞 ⇒ 用户看到的
                        // 正是“只有连工作 VM / vm1 的 DSH Web 才一会儿透明一会儿不透明”。
                        // ★ v1.32.15-A：换成**纯结构判据** isLayout（不再依赖任何类名哈希，换一次
                        // DSH 版本也不再烂）。布局/滚动链 = 自身 position 为 static/relative 的
                        // 常规流、且祖先链上**没有**「定位（absolute/fixed）且 ≥90%×90% 视口」
                        // 覆盖层的那条浅层大容器链 —— 与 isPanel 同源互补（即上面 v1.32.12 的
                        // 对立判据）。祖先上界取 body：html/body 由本注入无条件写 transparent，
                        // body 之上的 fixed 不属于页面布局，不该把整棵子树改判成面板；
                        // 祖先遍历上限也从 8 层放宽到 24 层（新的 dockkit 套层更深）。
                        // ★ v1.32.15-B：**单向写** —— 命中 isLayout 的元素**只允许被设为 transparent**，
                        // 永不写回不透明原生色；“取原生色相回写”只留给 isPanel（定位覆盖层，
                        // 即 v1.32.12 的阅读面板：打开文档预览仍不得透明，不许回归）。
                        // 为此 isLayout 必须带**稳定态闸门**：只有「**我们**上一轮把它写成
                        // transparent」的元素才算布局链 —— 否则首屏 / 流式渲染中途 innerBig 失真
                        // 的容器会被 isCB 抢先写成白、下一轮再被抹回 transparent，正是本次要消灭的
                        // 翻转。React 换节点后标记与内联一起丢 ⇒ 闸门关闭、走保守路径（原生白
                        // 瞬时露出 ≈400ms，属 v1.32.13 QA-A32 已登记的既有行为，不是翻转）。
                        // ★ v1.32.15 D1 修复 C（**拆自锁**）：闸门原先读的是**我们自己写的 inline 值**
                        //   （inline background-color === 'transparent'），而大容器兜底分支写的正是 transparent
                        //   ⇒ 「进入条件」与「写入结果」互为因果 ⇒ **首轮就被锁死**：卡片首轮 a0=1
                        //   （原生不透明）⇒ 幂等闸门（a0<1）不拦 ⇒ 落到兜底分支当轮写 transparent ⇒
                        //   从下一轮起 inline==='transparent' 恒成立 ⇒ isLayout 恒真 ⇒ 再也进不了 isCB
                        //   求值分支（它要求 !isLayout）⇒ 稳定停在错值（真机笔电 8 次采样 0 翻转、
                        //   6 次运行复现；vm1 只因首帧 220px 没过 big 阈值、走了 0.45 分支才没被锁
                        //   ⇒ **首帧高度决定命运**，与 FINDING-1 同一类：瞬态几何决定永久状态）。
                        //   这违反 §11.8 纪律 10「判据之间 MUST NOT 互相以对方的输出为前提」——
                        //   isLayout 读的是我们自己的写入。现改读注入自己打的**所有权标记** e.__dshGlass：
                        //   写 transparent 的两条分支置 1、写不透明 / 浮层 / 0.45 的分支置 0 ⇒ 闸门读的是
                        //   「这个元素的底由注入拥有」这一事实，不再读页面可见的 inline（页面改写
                        //   我们的 inline 也不会把布局链解锁）。标记随换节点丢失，但 inline 同样会丢
                        //   ⇒ 不比现状差；稳定态闸门的原意（防过渡态被 isCB 抢先写白）完整保留。
                        //   **注意**：兜底分支也打标记，所以「锁」本身仍在（这是布局链的设计本意，
                        //   合成 DOM S12 证明去掉它会触碰 v1.32.6 红线）；真正让卡片脱锁的是上面的 A
                        //   （isCode 首轮即命中、天然绕开 isLayout）。实测数据见 GLASS-OVERLAY §11.10。
                        // ⚠ 已登记风险（lead 裁定 d，本轮随 C 收窄）：页面**自己**把布局容器内联写成
                        //   transparent 不再构成锁（我们没写过它 ⇒ 无标记 ⇒ 闸门关）；它仍会被大容器
                        //   兜底分支写 transparent（可见结果不变、壁纸通道优先），但之后若命中 isCode /
                        //   isCB 就能拿到原生底 ⇒ 比原先的「永久锁透明」更合理。
                        // ★ v1.32.16 D2 同款**几何臂**：窄屏补丁的几何段认出的展开态侧栏
                        //   浮层（window.__bwSbEl）在 vm1 这类换了哈希命名的宿主上拿不到
                        //   _2H3hWW_root 这个类名，会被当成布局链写成 transparent，原生色相随后
                        //   再也拿不回来（侧栏一直全透）。这里用同一个对象引用做排除，
                        //   不引入任何类名；收起侧栏时 bwUndo 会把 __bwSbEl 清掉，自然回到原来的
                        //   处理。笔电上类名命中，走的仍是原来那条，行为一行未变。
                        "var isSb=cn.indexOf('_2H3hWW_root')>=0||window.__bwSbEl===e;" +
                        "var ancBigPos=false;" +
                        "var pa=e.parentElement,ph=0;" +
                        "while(pa&&ph<24&&pa!==document.body){" +
                        "var acs=getComputedStyle(pa);" +
                        "if(acs.position==='absolute'||acs.position==='fixed'){" +
                        "var ar=pa.getBoundingClientRect();" +
                        "if(ar.width>=vw*0.9&&ar.height>=vh*0.9){" +
                        "ancBigPos=true;break;}}" +
                        "pa=pa.parentElement;ph++;}" +
                        // ★ v1.32.15 裁定① + D1 修复 A：内容叶子判据 isCode —— 只用**渲染盒树**判，
                        //   不用类名、也不用裸 DOM 深度。isCode = 自身是 PRE，或在**盒树上的直接
                        //   可见子节点**里有 PRE：从直接子节点扫描，遇到 display:contents 的包裹
                        //   层就**下钻**（最多 2 层包裹）。命中 isCode 的元素不算布局链 ⇒ 走 isCB /
                        //   原生色相回写（带 C 的两轮迟滞，但 isCode 免迟滞，见下方 D1 注释）。
                        // 真机为什么必须看盒树（QA-ROUND-v1.32.15-D1 实测，笔电）：卡片
                        //   _block_7gxqk_4 md-code-block（233x410，原生 rgb(249,250,251)）的**DOM 直接
                        //   子节点**是 _bannerWrap_7gxqk_（233x42）+ _content_7gxqk_74（**0x0**），PRE 在
                        //   _content_ 里面 = **孙节点**；0x0 是 Blink 对 display:contents 返回的空矩形
                        //   ⇒ 盒树上 PRE 像直接子节点、DOM 上不是 ⇒ 只按 e.children 判**必然 false**
                        //   （这就是 D1 笔电失败、vm1 凭运气逃过的结构性原因）。
                        // ⛔ MUST NOT 用 0x0 矩形反推「这是 contents 包裹层」：0x0 也可能是**折叠**容器
                        //   （折叠面板/虚拟占位），那样会把折叠容器里的 PRE 误判成内容叶子。判据只读
                        //   getComputedStyle(child).display === 'contents'，它是盒模型事实、不随布局态变化。
                        // ⛔ 下钻深度上限 **2 层**，再深就不再算内容叶子：聊天根里的 pre 在 ≥3 层，
                        //   放宽到整棵子树会把布局容器一起判成内容叶子 ⇒ 写不透明 ⇒ 多层白叠
                        //   ⇒ **复现 v1.32.6「壁纸整层消失」**（§9.3 实测 wouldChange 从 1 变 2 且
                        //   含布局容器）。所以「只看盒树直接子节点 + ≤2 层 contents」就是判据边界。
                        // ⛔ 别顺手简化成 e.querySelector('pre')：当年被否决的正是「后代含 pre/code」。
                        //   实现用递归扫 children 而非 querySelector(':scope > pre')：语义等价且不依赖
                        //   选择器引擎 —— 老 WebView 遇 :scope 会抛 SyntaxError，这段注入没 try/catch，
                        //   一处抛异常整段注入全废（v1.32.11 的教训）。
                        // ⚖ 成本：整段扫描包在 if(big) 里（非 big 元素的 isCode 无意义，两个消费者
                        //   都要 big），且遇到 PRE 立即停；每页 big 元素只有十几个，不会退化成全页遍历。
                        // （措辞纪律：下文凡标「合成」的数字来自合成 DOM 360x671，不是真机。）
                        "var isCode=(e.tagName==='PRE');" +
                        "if(big&&!isCode&&e.children){" +
                        "var lv=[e],dep=0;" +
                        "while(!isCode&&dep<3){var nx=[];" +
                        "for(var gi=0;gi<lv.length;gi++){var ch=lv[gi].children;" +
                        "for(var qk=0;ch&&qk<ch.length;qk++){" +
                        "var kk=ch[qk];" +
                        "if(kk.tagName==='PRE'){isCode=true;break;}" +
                        "if(getComputedStyle(kk).display==='contents')" +
                        "nx.push(kk);}" +
                        "if(isCode)break;}" +
                        "if(isCode)break;lv=nx;dep++;}}" +
                        "var isLayout=big&&!isCode&&e.id!=='dsh-theme-veil'&&!isSb&&" +
                        "(e.__dshGlass===1)&&" +
                        "(function(){var ps=getComputedStyle(e);" +
                        "return ps.position==='static'||" +
                        "ps.position==='relative';})()&&" +
                        "!ancBigPos;" +
                        "var isPanel=false;" +
                        "if(big&&!isLayout&&!isSb&&e.id!=='dsh-theme-veil'){" +
                        "var pcs=getComputedStyle(e);" +
                        "if(pcs.position==='absolute'||pcs.position==='fixed'){" +
                        "isPanel=true;}" +
                        "else if(ancBigPos){isPanel=true;}}" +
                        "if(!m)continue;" +
                        "var a0=(m[4]!==undefined?parseFloat(m[4]):1);" +
                        "var pm=(a0>=1?m:null);" +
                        // ★ v1.32.13「内容块」判据：innerBig = 后代里**自身也超过 50%×50% 视口**的元素
                        // 个数（"里面还套着几层大容器"）。实测布局容器 BynINW_frame/centerCol/Dc7zOa_root
                        // = 70/42/41，而聊天里的大代码块 = **2** ⇒ 20 倍余量，是干净的**结构**判据、
                        // **不依赖 CSS-module 类名**（v1.32.5 教训）。
                        // ⛔ 被实测否决的判据：**"后代含 pre/code"** —— Dc7zOa_root（布局容器，
                        // innerBig=41）后代里也有 pre/code（整棵聊天树含代码块）⇒ 会命中布局容器
                        // ⇒ 多层白叠 ⇒ **复现 v1.32.6「壁纸整层消失」**。只能靠嵌套计数，不能靠语义/颜色。
                        // ★ v1.32.15 修正（本轮合成 DOM 实测出来的，不是推测）：isCB 的求值顺序
                        // 必须**早于**取原生色相 pm，且 MUST NOT 以 pm 非空为前提。原因：pm 只在
                        // a0>=1 时非空，而内容块第一轮会被兜底分支写成 transparent ⇒ 第二轮起
                        // a0=0 ⇒ pm=null ⇒ 若 isCB 要求 pm 则恒为 false ⇒ 而 B 又把「剥内联读原生」
                        // 收窄成 (isPanel||isCB) ⇒ 三者互相咬死成**死锁**，聊天代码块永远停在
                        // transparent（v1.32.13 不回归才怪）。现顺序：isCB 先算（只要求 big 且不在
                        // 布局链/定位面板/侧栏根/veil）→ 再由它解锁剥内联 → pm 由原生色填充。
                        // ★ v1.32.15-C 迟滞：innerBig 是**运行时量**，首屏/局部重渲染/流式生成
                        // 中途会临时失真（v1.32.13 FINDING-1 实测布局容器从 41 掉到 <=2）。
                        // **单轮命中一律不写**：首轮只把元素标成候选，2x requestAnimationFrame
                        // （≈两帧）后**复核**同一判据，仍 <=2 才置 e.__cbOk=1 并重跑 apply()
                        // 落地写入 = **连续两轮成立才允许写不透明**。过渡态只要有一帧
                        // 被后代撑开就不落地；稳定态内容块两帧后仍是 2，代价只是多 ≈32ms。
                        // 一旦 innerBig 变回 >2（或元素被换节点/退出候选集）就**清掉复核标记**，
                        // 下次必须重新连续两轮；已确认过的也不会再排复核 ⇒ apply() 不自激。
                        "var innerBig=-1,isCB=false;" +
                        "if(big&&!isLayout&&!isPanel&&!isSb&&" +
                        "e.id!=='dsh-theme-veil'){" +
                        "if(e.__qaSeq===undefined){window.__qaN=" +
                        "(window.__qaN||0)+1;e.__qaSeq=window.__qaN;}" +
                        "var qrec={cls:cn.slice(0,90),innerBig:-1," +
                        "cbOk:(e.__cbOk===1),nodeSeq:e.__qaSeq,isCode:isCode,isCB:false};" +
                        "e.__qaRec=qrec;qa.push(qrec);" +
                        "innerBig=_cbn(e);qrec.innerBig=innerBig;" +
                        "if(innerBig<=2){" +
                        // ★ v1.32.15 D1（真机 QA 实测，P1）：命中 isCode 的元素**免两轮迟滞**，
                        // 当轮就允许原生不透明回写。理由写死在这里，别让下次又给它加回迟滞：
                        // · FINDING-1 的失真面是「**布局容器**在渲染中途 innerBig 临时掉到 <=2」，
                        //   而 isCode 是**标签结构**判据（自身 PRE 或直接子节点 PRE），不是测量；
                        //   且它排在 isLayout / isPanel 之后，两者已把布局容器与定位面板排除掉。
                        // · 真机 innerBig=1 恰好证明「大后代只有一个 PRE」就是内容叶子的**稳定**
                        //   形态（卡片 233x410 里那个 233x368 的 PRE），不该被迟滞卡住。
                        // · 更关键：聊天列表**虚拟化会换节点**，而 __cbOk 挂在 DOM 节点上 ⇒ 每轮
                        //   都是新节点 ⇒ 永远攒不满「连续两轮」⇒ 兜底分支当轮写 transparent、
                        //   不透明要晚一轮 ⇒ 长期停在 transparent（D1 实测 4 次运行稳定复现）。
                        // · 不会把 FINDING-1 放回来：isCode 元素被写的值是它**自己的原生色相**，
                        //   只取决于它自身的 CSS、不随后代增减而变 ⇒ 早一轮写与晚一轮写**同一个值**，
                        //   没有可翻转的第二值；且 innerBig<=2 与「原生必须真的不透明」两道闸仍在。
                        "isCB=isCode||(e.__cbOk===1);" +
                        "if(!isCB)cand.push(e);" +
                        "}else{e.__cbOk=0;}" +
                        "qrec.isCB=isCB;" +
                        "}else{e.__cbOk=0;}" +
                        // 取**原生**色相 pm（v1.32.12 起）：我们可能已把内联值改成 transparent 或 0.45，
                        // 此时 computed 读不出原色 ⇒ 临时摘掉内联再读，读完按需还原。
                        // 原生确实没有不透明底的（如 OUqwTW_panelBody/_surface_6nhg2_125、#dsh-theme-veil）
                        // 一律判为“不是内容面”，**绝不给无底元素凭空加底**。
                        // veil 按 id 显式排除：连瞬时摘除都不做，不依赖“另一段注入恰好先写”的顺序。
                        // ★ v1.32.15-B：入口从 `big && !isAnchor` 收窄为 `big && !isLayout &&
                        // (isPanel || isCB)` —— 只有定位面板与内容叶子才可能被写不透明，
                        // 布局链与侧栏根（归 bwPanelBg 的 0.92 管）**连瞬时摘内联都不做**，
                        // 否则“原生不透明就不还原”的既有语义会把它们的底色抹掉。
                        // 注意 isCB 已在上面算好（且不以 pm 为前提），这里才能用它当解锁条件。
                        "if(big&&!isLayout&&(isPanel||isCB)&&a0<1&&" +
                        "e.id!=='dsh-theme-veil'){" +
                        "var sv=e.style.getPropertyValue('background-color')," +
                        "sp=e.style.getPropertyPriority('background-color');" +
                        "e.style.removeProperty('background-color');" +
                        "var nx=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?" +
                        "/.exec(getComputedStyle(e).backgroundColor);" +
                        "var na=(nx&&nx[4]!==undefined)?parseFloat(nx[4]):(nx?1:0);" +
                        "if(nx&&na>=1){pm=nx;}else{if(sv)e.style.setProperty(" +
                        "'background-color',sv,sp||'');}}" +
                        // 幂等闸门：非浮层/非面板保持原保守语义（已半透明则不再处理）。
                        // ★ 但**内容块必须放行** —— 否则"还矮时被写成 0.45、长高后被闸门挡住"的实例
                        // （坏态 B）**永远修不回来**。实测同屏 10 个 md-code-block，其中 8 个高度未过
                        // 阈值、按设计就该是 0.45（本轮裁定不动）；放行只对命中 isCB 的生效。
                        // ★ v1.32.15-B：布局链（isLayout）也放行 —— 它只会被写 transparent，重写是
                        // 同值幂等的，不放行反而会把"被 React 换节点后露出原生白"的瞬时露白
                        // 固化下去（那时 a0=1，闸门本就不拦；这里补上是为了 a0 已被写成
                        // 0.45 的历史残留也能被拉回 transparent，方向仍是单向的）。
                        "if(!isOv&&!(big&&isPanel)&&!isCB&&!isLayout&&a0<1)" +
                        "continue;" +
                        "var skipBg=(cn.indexOf('_2H3hWW_root')>=0&&" +
                        "cn.indexOf('_2H3hWW_collapsed')<0||window.__bwSbEl===e)&&" +
                        "vw<=1023;" +
                        // ★ v1.32.16 D2 补一条**几何臂**：窄屏补丁的几何段认出的展开态侧栏
                        //   浮层（window.__bwSbEl，见上方 v1.32.5 那段）也归 bwPanelBg 管，不得被本
                        //   注入写成 transparent——否则它的原生色相丢失，bwPanelBg 只能读到
                        //   rgba(0,0,0,0)（色相不可用 ⇒ 不写，侧栏就一直全透）。笔电上类名命中，
                        //   走的仍是原来那条；__bwSbEl 只在 vw≤1023 且展开时存在，收起或变宽后
                        //   被 bwUndo 清掉，所以这条臂自己会随状态消失，不需要任何类名。
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
                        "'important');e.__dshGlass=0;}" +
                        // ★ v1.32.15-B 布局/滚动链（壁纸唯一通道）：**只允许 transparent**。
                        // 排在浮层之后、isPanel/isCB 之前且与它们互斥：命中布局链的元素
                        // 永远触碰不到"取原生色相回写"，因此即使过渡态测量失真，最坏也
                        // 只是一次**同值幂等**的 transparent 重写，**不可能**再出现
                        // "中途写白、下一轮抹回"的翻面（本次修复的主目标）。
                        // 也不再需要类名锚点：旧的 else if(w>vw*0.5&&h>vh*0.5) 仍保留在面板/
                        // 内容块之后兜底（v1.32.6 红线，一个字符不动）。
                        "else if(isLayout){e.style.setProperty(" +
                        "'background-color','transparent','important');e.__dshGlass=1;}" +
                        // ★ v1.32.12 阅读面板：仅当"大容器 + 全屏定位面板 + 原生确实有不透明底"时，
                        // 用它的**原生色相**恢复不透明实底（实测应用原生就是 rgb(255,255,255)
                        // 不透明纯白阅读页 ⇒ alpha=1 是**还原原生设计**，而非我们另造档位）。
                        // 为何是 1 而不是与浮层同档的 0.96：整页长文阅读面板的唯一职责是长时间
                        // 舒适阅读，与"短暂浮在内容上、需要空间线索"的菜单/浮层诉求不同 ⇒ 不必同档；
                        // 且 0.96 实测在面板空白处**仍可辨认底层聊天正文淡影**（lead 亲自看图确认）。
                        // 安全性与 alpha **正交**：是否命中完全由 isPanel 结构判据 + nativeOpaque
                        // 前置 + veil/布局链/侧栏根显式排除三道护栏决定（v1.32.15 起锚点换为
                        // isLayout 结构判据），改 alpha 不改变任何安全性质。
                        // 排在 transparent 通道分支**之前且互斥**；pm 为 null（原生无底）则落到
                        // 通道分支，行为与 v1.32.11 完全一致。
                        "else if(big&&isPanel&&pm){e.style.setProperty(" +
                        "'background-color','rgb('+pm[1]+','+pm[2]+','+pm[3]+')'," +
                        "'important');e.__dshGlass=0;}" +
                        // ★ v1.32.13 内容块：聊天正文里的大代码块（实测 331x524，原生 rgb(249,250,251)
                        // 不透明浅灰）此前落进大容器分支被抹成 transparent ⇒ 代码透出底层聊天正文
                        // （用户 2026-10-15「修吧」）。判据 isCB = 后代中大容器数 <= 2（见上文推导）；
                        // 给**原生色相**、alpha=1（它是**内容**不是装饰，半透明直接伤代码可读性；
                        // 应用原生本就完全不透明 ⇒ 1.0 是还原原生，与 v1.32.12 阅读面板同构）。
                        // 与 isPanel 分支**互斥**（isCB 计算里已含 !isLayout && !isPanel，且 isPanel 在前）；
                        // pm 为 null（原生无底）则落回通道分支，行为与 v1.32.12 一致。
                        "else if(big&&isCB&&pm){e.style.setProperty(" +
                        "'background-color','rgb('+pm[1]+','+pm[2]+','+pm[3]+')'," +
                        "'important');e.__dshGlass=0;}" +
                        // ★ v1.32.15 D1-C：大容器兜底分支（v1.32.6 红线，写 transparent）也打所有权标记：
                        //   「兜底写过 transparent」本身就是布局链的证据。它们全都打标记，
                        //   链上元素才不会被 isCB 抢走。合成 DOM S12 实测：聊天只有一个大后代
                        //   行时 innerBig≤2，若兜底不打标记，聊天根 / tabHost 会被写成不透明白
                        //   ⇒ 壁纸整层消失（v1.32.6 红线）。写不透明的分支（面板 / 内容块 / 浮层 /
                        //   0.45）一律置 0，保证标记始终等于「我们上一次写的是不是 transparent」。
                        "else if(w>vw*0.5&&h>vh*0.5){e.style.setProperty(" +
                        "'background-color','transparent','important');e.__dshGlass=1;}" +
                        "else if(!skipBg){e.__dshGlass=0;e.style.setProperty(" +
                        "'background-color','rgba('+" +
                        "m[1]+','+m[2]+','+m[3]+',0.45)','important');" +
                        "if(w>vw*0.08&&h>vh*0.03&&" +
                        "!(/BynINW_(sidebarCol|frame)/.test(cn))){" +
                        "e.style.setProperty('backdrop-filter','blur(12px)'," +
                        "'important');e.style.setProperty('-webkit-backdrop-" +
                        "filter','blur(12px)','important');}}}" +
                        // ★ QA 探针（D1 取证用，只读数组、不参与任何判定）：每轮把候选集导出到
                        // window.__qaCb。字段 cls / innerBig / cbOk / nodeSeq / isCode / isCB；
                        // nodeSeq 是注入侧给每个 DOM 节点发的自增身份号，**换节点就会换号**，
                        // 用来区分「同一元素被 React 换成新节点」（虚拟列表回收 ⇒ __cbOk 与 nodeSeq
                        // 一起丢，正是 D1 的指纹）。复核通过时上面那行会把对应记录的 cbOk 置 true。
                        "window.__qaCb=qa;" +
                        // ★ 一批一次复核：两帧后仍 <=2 的候选全部置 e.__cbOk=1，然后**只重跑一次**
                        // apply() 落地。重跑那一轮里它们已是 isCB=true ⇒ 不会再进 cand ⇒ 不会自激。
                        "if(cand.length){requestAnimationFrame(" +
                        "function(){requestAnimationFrame(function(){" +
                        "var ch=false;for(var c=0;c<cand.length;c++){" +
                        "var t2=cand[c];if(t2.isConnected&&_cbn(t2)<=2)" +
                        "{t2.__cbOk=1;ch=true;if(t2.__qaRec)" +
                        "t2.__qaRec.cbOk=true;}}if(ch)apply();" +
                        "});});}" +
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
