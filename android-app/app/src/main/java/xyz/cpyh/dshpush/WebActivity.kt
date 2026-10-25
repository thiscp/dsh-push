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
    // v1.33.32 Quick Return 顶栏（见注入段 __bwQR）
    private var topBar: View? = null
    private var barFullH = 0
    private var barShown = true

    /** 原生顶栏收起/展开：动画 height（LinearLayout 里 WebView 随之获得/让出空间）。
     *  160ms，Chrome 地址栏同款手感；重复调用幂等。 */
    private fun setBarShown(show: Boolean) {
        if (barShown == show) return
        barShown = show
        val b = topBar ?: return
        if (barFullH == 0) barFullH = b.height
        if (barFullH == 0) return
        b.animate().cancel()
        android.animation.ValueAnimator.ofInt(b.height, if (show) barFullH else 0).apply {
            duration = 160
            addUpdateListener {
                b.layoutParams = b.layoutParams.apply { height = it.animatedValue as Int }
                b.requestLayout()
            }
            start()
        }
    }
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
    // ★ v1.33.41（用户 m07251）：本次进入要落到的会话（空 = 不恢复）。
    //   两个用途：① saveSess 在「还没到位」的窗口里丢弃写盘，防止页面加载初期那个
    //   过渡会话（服务器默认会话/上一次推送的会话）把存盘值覆盖掉——那正是用户报的
    //   「手动切了对话，再进来还是标签那个对话」的一种成因（写盘被抢）；
    //   ② onPageFinished 后复核：时间够久还没落到目标就补一次 `location.hash`，
    //   让 host-plugin 的 revealFromHash 重新切（片段在 replaceState 前后丢过也能救）。
    private var restoreTarget: String = ""
    private var restoreAt: Long = 0L
    //   ③ 但闸门**最多只拦一次**：页面落定前那个过渡会话只会上报一次；若用户在这几秒里
    //   自己切了对话（第二次不同的上报），就必须认页面为准——否则会出现「刚进来马上切走、
    //   结果没存上」的另一半 bug（v1.33.41 实测踩过这一层的设计取舍）。
    private var restoreSkip: Int = 0

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
            // targetSdk 34 = 传统 inset：DecorView 已把状态栏让掉，这里**不能**再 fitsSystemWindows（会双份）。
        }
        // v1.33.43（用户 m08435「顶部的标签栏风格和我们整体有点不搭」+ m08451 圈定
        //   「显示 DSH 网页·笔电 和 关闭按钮那个标签栏」）：旧顶栏是一行裸文字直接浮在
        //   壁纸色上、关闭钮单独一颗胶囊——既没有底板也和主页的卡片语言脱节。
        //   改成**浮动卡片条**：与消息卡片同源（80% 卡底色 + 1dp 主题描边 + 18dp 圆角），
        //   左侧补一枚主题色鲸鱼标（对应主页顶部头像的位置），右侧关闭钮收进同一条卡片里。
        //   ★ v1.33.44（用户 m09845「顶部栏还有一圈灰色的背景」）：首版做成「浮动圆角卡片 +
        //   四周 10dp 外边距」，实机上一圈灰 = 外边距露出的**壁纸**（浅色主题壁纸 #EEEDF3，
        //   而下方网页玻璃是 #F8F7FC，差一档就成了一道灰框）。⇒ 改**通栏**：左右顶到屏幕边、
        //   零外边距，只留 1dp 底部细线。没有缝就没有灰。
        //   ⚠ 动画：setBarShown 是把 topBar 的 height 收/放到 0，通栏后 barBox 仍只做这件事。
        val barBox = FrameLayout(this)
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            // v1.33.32（用户 m03322/m03479 圈定这块原生顶栏）：97.5dp → 48dp。
            // 状态栏 inset 改由 root 的 fitsSystemWindows 承担（bar 不再被顶到状态栏下方），
            // 标题 16sp→13sp，关闭钮去默认 minHeight（实测原 bar 390px=97.5css，其中
            // Button 默认 48dp minHeight + 10/6 padding 占大头）。
            setBackgroundResource(R.drawable.bg_bar)
            // v1.33.44：去掉 elevation —— 圆角卡片那版留下的投影在浅色壁纸上就是一圈灰；
            // 通栏 + 1dp 底线已经足够分层，不需要影子。
            setPadding(dp(14), dp(6), dp(8), dp(6))
        }
        // 主题色鲸鱼标：纯粹的身份标记，和主页顶部那只头像呼应（不吃点击）
        bar.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_stat_whale)
            setColorFilter(c(R.attr.dshAccent))
            alpha = 0.9f
            layoutParams = LinearLayout.LayoutParams(dp(17), dp(17)).apply {
                rightMargin = dp(8)
            }
        })
        val tv = TextView(this).apply {
            text = "DSH 网页"
            textSize = 13.5f
            setTextColor(c(R.attr.dshTextPrimary))
            setTypeface(android.graphics.Typeface.DEFAULT_BOLD)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
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
            minHeight = 0
            minimumHeight = 0
            minWidth = 0
            minimumWidth = 0
            setPadding(dp(13), dp(4), dp(13), dp(4))
            setOnClickListener { finish() }
        })
        // v1.33.44：通栏——零外边距，bar 自己铺满整行宽度
        barBox.addView(bar, FrameLayout.LayoutParams(-1, -2))
        content.addView(barBox)
        topBar = barBox

        // 深色三档：仅所选主题为深色时开，浅色主题保持亮页（v1.12.0）
        val dark = ThemePrefs.KEYS[ThemePrefs.current(this)] in setOf("night", "starry")
        web = WebView(this).apply {
            // v1.33.1：调试浮层开着时顺带打开 WebView 远程调试 + 控制台转发（tag dshweb），
            // 这样能用 USB/adb 从电脑直接连进手机里那个页面读真实 DOM 与生效样式。
            if (DiagPrefs.on(this@WebActivity)) {
                android.webkit.WebView.setWebContentsDebuggingEnabled(true)
                android.util.Log.d("dshweb", "WebView 远程调试已开（chrome://inspect 可连）")
            }
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // v1.33.32：网页 → 原生的单向桥（Quick Return 顶栏，见注入段 __bwQR）。
            // 只暴露一个方法、@JavascriptInterface 注解（API17+ 安全模型），页面自托管无注入面。
            addJavascriptInterface(object {
                @android.webkit.JavascriptInterface
                fun barShow(show: Boolean) {
                    runOnUiThread { setBarShown(show) }
                }

                // v1.33.39（用户 m06190）：页面把「当前停留的对话」报上来，按宿主存盘，
                // 供下次进程被杀后恢复。DSH Web 切会话**不写 URL**（无路由，且 revealFromHash
                // 会 replaceState 抹掉片段），所以只能由页面侧读 DOM 再回传。
                @android.webkit.JavascriptInterface
                fun saveSess(sid: String?) {
                    try {
                        val v = sid ?: return
                        if (v.isEmpty()) return
                        // ★ v1.33.41（用户 m07251）：一旦落到目标会话，立刻解除闸门与复核——
                        //   之后用户再手动切走，写盘必须照常进行（否则会「切了不生效」）。
                        if (restoreTarget.isNotEmpty() && v == restoreTarget) {
                            android.util.Log.d("dshsess", "landed v=$v (gate off)")
                            restoreTarget = ""
                        }
                        // ★ v1.33.41（用户 m07251）：本次进入是「恢复到某会话」时，页面落地前的
                        //   过渡会话**不许覆盖存盘值**。窗口取 8s（页面首屏 + revealFromHash 轮询
                        //   都在这之内完成）；超过窗口就认页面为准，避免卡死在旧值上。
                        if (restoreTarget.isNotEmpty() && v != restoreTarget &&
                            System.currentTimeMillis() - restoreAt < 8000L
                        ) {
                            // 只拦第一次（页面自己渲染出来的过渡会话）。用户手动切走属第二次，
                            // 必须放行，否则「进来后立刻切对话」会存不上（v1.33.41）。
                            if (restoreSkip == 0) {
                                restoreSkip = 1
                                android.util.Log.d("dshsess", "skip save (restoring) v=$v want=$restoreTarget")
                                return
                            }
                            android.util.Log.d("dshsess", "user switch while restoring, accept v=$v")
                            restoreTarget = ""
                        }
                        val u = lastUrl
                        val host = if (u.isEmpty()) "" else DshHosts.hostOf(u)
                        if (host.isEmpty()) return
                        DshHosts.saveLastSess(this@WebActivity, host, v)
                        android.util.Log.d("dshsess", "save host=$host sess=$v")
                    } catch (e: Exception) {
                    }
                }
            }, "bwNative")
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
                    // ★ v1.33.41（用户 m07251）：本次是「恢复到某会话」就复核落地，没到就补切。
                    recheckRestoreTarget()
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
                        // 127：[class*='_frame'] 子串匹配误伤消息流里的附件缩略图卡片 Nhu-QW_frame（类名也含 _frame），
                        // 被钉成 56px|1fr|0 三列后 img（width:100% = 列宽）只剩 56px、cover 居中裁切 ⇒ 缩略图左边被切，
                        // 56 恰等于收起栏宽，看着像"侧栏盖图"（实测卡片 x=212..321 与侧栏 x=0..56 不重叠）。
                        // 加 :has(_sidebarCol) 外壳门控：只有含侧栏列的外壳命中（四态矩阵不受影响），缩略图/会话流自动脱身。
                        // ★ v1.33.29（用户 m02568）：收起态不再保留 56px 轨道——侧栏列压到 0、
                        //   收起态侧栏根整个 display:none，对话界面占满手机宽度；入口改由
                        //   body 级悬浮鲸鱼钮 #bw-whale-fab 承担（见下方 bwFab）。展开态不变：
                        //   侧栏根仍是 fixed 浮层盖在满宽正文上。
                        "[class*='_frame']:has([class*='_sidebarCol']){grid-template-columns:0px minmax(0,1fr) minmax(0,0px)!important}" +
                        "[class*='_sidebarCol'] [class*='_root'][class*='_collapsed']{display:none!important}" +
                        "[class*='_sidebarCol']{position:relative!important;z-index:80!important;overflow:visible!important;backdrop-filter:none!important;" +
                        "-webkit-backdrop-filter:none!important;filter:none!important;transform:none!important;" +
                        "contain:none!important;will-change:auto!important}" +
                        "[class*='_sidebarCol']>*>[class*='_root']:not([class*='_collapsed']){position:fixed!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;" +
                        "left:0;top:0;bottom:0;width:280px!important;max-width:280px!important;" +
                        "z-index:70!important;overflow-y:auto!important;overflow-x:hidden!important;" +
                        "box-shadow:0 8px 32px rgba(0,0,0,.35)!important}" +
                        // 126：右面板是 rightbarCol 里的 absolute 全屏浮层（收起态实测也是 0,0,360,671、底色 transparent），DOM 顺序排在侧栏之后；
                        // 125 把 sidebarCol 抬到 z:80 后，收起态的侧栏反过来压住了右面板的左边缘（用户：「完全遮挡住一部分」，笔电是半透明能透出）。
                        // 笔电原生的绘制顺序是右面板在上、侧栏透过它的半透明底看得见 ⇒ 只在**收起态**把 rightbarCol 抬到 90 复原；
                        // 展开态不抬：侧栏仍压住面板（可点），四态矩阵量到的仍是侧栏自己的 0.92 —— 直抬 90 曾被矩阵拦下（expanded 侧栏 alpha 0.45）。
                        // :has() 判据实测精确：收起态全页只有侧栏根带 _collapsed、展开态一个都没有；老 WebView 不认 :has() 就整条丢弃 = 退回 125 行为。
                        "[class*='_frame']:has([class*='_collapsed']) [class*='_rightbarCol']{position:relative!important;z-index:90!important}" +
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
                //     · 饥饿 = 同一框架里存在宽 <35% 视口、高 ≥50% 视口的兄弟列
                //       （= 正文列被吃掉，即 lead 说的「检测有个兄弟块在吃宽度」）；
                //     · 展开态 = 侧栏列宽 ≥ 轨道宽+40 **且** 有饥饿兄弟；否则按收起态处理
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
                // ★ v1.32.17 D10：把「**发现侧栏**」和「**修挤压**」拆开。bwFind() 只量盒模型、
                //   一个属性都不写，返回**一次扫描**的结果给三个消费者共用：修挤压的 bwGeomFix、
                //   调底色的 bwPanelBg、以及玻璃化注入里读 window.__bwSbEl 的 isSb / skipBg 两条臂
                //   ——全程只扫一遍 DOM，不再出现「几何段跑完又撤销々顺扊把发现结果也撤掉」。
                //   为什么必须拆开（真机 verify/QA-ROUND-v1.32.16.md §2.2）：挤压的来源是**页面自己**
                //   写在 frame 上的内联 grid-template-columns；撤销时 removeProperty 摘掉的正是那一条
                //   （内联只有一个命名空间），摘掉后落回页面样式表的「单列 360px + 侧栏覆盖
                //   层」⇒ 挤压已解除，但旧的 bwGeom() 那时因「轨道 <2 条」直接 return null
                //   ⇒ __bwSbEl 永远是 null ⇒ 底色那条整个不跑 ⇒ vm1 展开态侧栏停在
                //   rgba(249,250,251,0.45)，拿不到笔电那侧的 0.92（D10）。
                //   判据**只有盒模型/几何 + DOM 结构**，不读任何类名（§11.7 那张 18 处
                //   [class*='…'] 前缀表就是腐烂现场，D2 的教训已在 §11.11）：
                //   ① 候选：贴左缘(left≤2)、高 ≥60% 视口、宽 ∈[96px,90%vw]、computed visibility
                //      非 hidden，取**最窄**的那个（同宽取文档序更靠后的，即列里面的侧栏根、
                //      不是列本身）；收起态轨道 56px 落在 96px 下限之外 ⇒ 天然发现不到，
                //      正好用来判「没有侧栏可调」并把上次写过的那个元素拉回 0.45；
                //   ② 从候选往上找**外壳**：第一个 display 为 grid/flex 且有 ≥2 个高子元素的祖先；
                //      候选到外壳之间的那一跳 = 它所在的**列**；
                //   ③ 这一列必须贴左缘，且必须有**兄弟列**高 ≥60% 视口、比侧栏更宽（正文在右）
                //      或窄到 <35% 视口（正文被吃掉）。这条是合成套件逼出来的：去掉它之前
                //      S1 / S2 / S4 / S6 / S8 里的聊天根（整页只有正文这一列，根旁边没兄弟）会被
                //      当成侧栏写上 0.92 ——壁纸直接消失（v1.32.6 红线）；
                //   ④ 修挤压要的 col / starved 直接复用②③的结果（col 还得是①里那个 ≥2 轨道
                //      的 grid 外壳 f 的亲儿子才有意义），不再单独扫一遍 frame 的子节点。
                "function bwRailW(){var w=window.__bwRailW;return (w>0&&w<160)?w:56;}" +
                //   闸 A（v1.32.18，笔电宿主回归）：① 的候选必须**真有侧栏内容**。
                //   真机读数（emulator-5554 打开笔电宿主，同一前端 bundle，只差 apk）：
                //   D11 把①的上限放宽到 vw+2 后，页面自己那层**全屏空覆盖层** BynINW_overlayLayer
                //   （360x671，只有一个 0x0 的 display:contents 子节点）通过了①，被认成侧栏；
                //   ② 又把 col 取成它自己，③ 里 56px 的收起轨道过了新的 40px 下限被当成饥饿兄弟，
                //   于是 expanded=true，把**聊天列那一轨**钉成 56px（frame 内联 56px 56px minmax(0,1fr)，
                //   计算值 56/56/248，centerCol 56x671，正文一字一行）。对照臂（D11 之前 efde4c2）
                //   __bwW=null、页面自己的 56px minmax(0,1fr) minmax(0,0) 计算 56/304/0、centerCol 304x671。
                //   判据用内容而不是类名/宽度：空覆盖层没有可见文字，真侧栏必有会话列表文字。
                "function bwSbContent(el){if(!el)return false;" +
                "var t=el.innerText||'';if(t.trim().length>=8)return true;" +
                "var k=el.querySelectorAll('*'),c=0;" +
                "for(var y=0;y<k.length&&c<2;y++){var q=k[y];" +
                "if(q.innerText&&q.innerText.trim().length>1){var rr=q.getBoundingClientRect();" +
                "if(rr.width>0&&rr.height>0)c++;}}return c>=2;}" +
                "function bwFind(){var vw=window.innerWidth,vh=window.innerHeight;" +
                "if(vw>1023||vw<=0||vh<=0)return null;" +
                "var nodes=document.querySelectorAll('div,section,main');" +
                "var f=null,tr=null,sb=null,sbW=1e9;" +
                "var i,n,r,cs,j,tp,vv,q,c,col=null,shell=null,p,pp,d=0,kids,tc,kr,rc2;" +
                "for(i=0;i<nodes.length;i++){n=nodes[i];r=n.getBoundingClientRect();" +
                "if(r.width<=0||r.height<=0)continue;" +
                //   外壳 f：宽 ≥90% 视口、高 ≥50% 视口、display 为 grid、used 轨道 ≥2 条
                //   （文档序第一个）——只有这种外壳才能靠改轨道宽度解除挤压。
                "if(!f&&r.width>=vw*0.9&&r.height>=vh*0.5){cs=getComputedStyle(n);" +
                "if(cs.display==='grid'||cs.display==='inline-grid'){" +
                "tp=(cs.gridTemplateColumns||'').split(' ');vv=[];" +
                "for(j=0;j<tp.length;j++){q=parseFloat(tp[j]);vv.push(q>0?q:0);}" +
                "if(vv.length>=2){f=n;tr=vv;}}}" +
                // ① 侧栏候选（可见性只看它自己的 computed——visibility 可继承也
                //   可覆盖，D3）。★ v1.32.17 D11：宽度带上限从 90%vw 放宽到 vw+2，并加
                //   **高度天花板 1.25vh**。真机 vm1 撤销挤压后侧栏是**页面自己的满屏宽覆盖层**
                //   （hHd-Xa_root 360x671 = 1.00vh），而正文子树 wSkVaW_viewArea / EvIC1a_frame /
                //   EvIC1a_root / EvIC1a_scroll 是 353x2922 = **4.35vh**（verify/qa-d10-diag.json 的
                //   diag.cands 全量实测，10 个候选一个不落。只放宽上限的话「取最窄」会先撞上 353
                //   的正文 ⇒ 0.92 写到聊天根 = v1.32.6 壁纸红线；加上 1.25vh 天花板正好把 4.35vh
                //   的正文挡在外面、把 1.00vh 的侧栏放进来。
                "if(r.left<=2&&r.height>=vh*0.6&&r.height<=vh*1.25&&r.width>=96&&" +
                "r.width<=vw+2&&r.width<=sbW){" +
                "cs=getComputedStyle(n);" +
                "if(cs.visibility!=='hidden'&&bwSbContent(n)){sb=n;sbW=r.width;}}}" +
                "if(!sb)return null;" +
                //   ② 往上找外壳（grid/flex + ≥2 个高子元素），顺扊拿到它所在的列
                "p=sb;pp=sb.parentElement;" +
                "while(pp&&d++<12){cs=getComputedStyle(pp);" +
                "if(cs.display==='grid'||cs.display==='inline-grid'||cs.display==='flex'||" +
                "cs.display==='inline-flex'){" +
                "kids=pp.children;tc=0;" +
                "for(c=0;kids&&c<kids.length;c++){kr=kids[c].getBoundingClientRect();" +
                "if(kr.height>=vh*0.6&&kr.width>0)tc++;}" +
                "if(tc>=2){shell=pp;col=p;break;}}" +
                "p=pp;pp=pp.parentElement;}" +
                "if(!shell)return null;" +
                //   ③ 列贴左缘 + 必须有「正文」兄弟列（更宽或饥饿）
                "var fr=col.getBoundingClientRect();" +
                "if(fr.left>shell.getBoundingClientRect().left+2)return null;" +
                "var sib=shell.children,ok=false,starved=false;" +
                "for(c=0;sib&&c<sib.length;c++){if(sib[c]===col)continue;" +
                "rc2=sib[c].getBoundingClientRect();" +
                "if(rc2.height<vh*0.6)continue;" +
                "if(rc2.width>sbW||rc2.width<vw*0.35)ok=true;" +
                //   「饥饿兄弟列」必须有真实的盒子（宽 ≥40px）。真机两个数字：被挤的正文列
                //     pI_x6G_centerCol 是 **80x671 @x=280**（verify/qa-v132-16-d2-ab-baseline.json 的
                //     d2.centerCol，≥ 40 ✓ 修挤压那条照旧生效）；而新形态下唯一能凑进「饥饿」的是
                //     那根 8px 宽的拖拽把手（pI_x6G_handle 8x671 @x=276）——它不是列。没这条下限时
                //     放宽后的①会把满屏宽的 pI_x6G_overlayLayer 选成侧栏、把把手当成饥饿兄弟
                //     列，接着就会把一层透明覆盖层钉成浮层。只加在「饥饿」分支：另一个
                //     分支是兄弟列比侧栏更宽（侧栏本身 ≥96，更宽就肯定 ≥96），加下限是恒真。
                "if(rc2.width>=40&&rc2.width<vw*0.35&&rc2.height>=vh*0.5)starved=true;}" +
                "if(!ok)return null;" +
                //   ④ col 只有在「外壳正是那个 ≥2 轨道的 grid」时才用得上（改轨道宽度）
                "var col2=(shell===f)?col:null;" +
                "var colW=col2?Math.round(fr.width):0;" +
                "var rail=bwRailW();" +
                "if(colW<rail&&colW>=40)window.__bwRailW=colW;" +
                "var sbW2=Math.round(sb.getBoundingClientRect().width);" +
                "return {f:f,tr:tr,col:col2,starved:starved,colW:colW,rail:rail,sb:sb," +
                "expanded:(colW>=rail+40&&starved),sbExpanded:(sbW2>=rail+40)};}" +
                // 写入项与撤销项成对：BWK=钉成浮层要写的定位属性，BWC=侧栏列上必须中和的包含块属性
                //   （backdrop-filter / transform / contain / will-change 会把 fixed 后代变成「困在列里」的
                //   包含块，样式表那条早就踩过）。bwSet 一律**先比后写**——观察器 attributeFilter 含 style，
                //   重写同一个值就会「写→变异→再写」空转（真机 §4 稳态 setProperty=0 就是靠这个）。
                "var BWK=['position','left','top','bottom','width','max-width'," +
                "'z-index','overflow-y','overflow-x','box-shadow'];" +
                "var BWC=['overflow','backdrop-filter','-webkit-backdrop-filter'," +
                "'filter','transform','contain','will-change'];" +
                "function bwSet(el,k,v){" +
                "if(el.style.getPropertyValue(k)===v&&" +
                "el.style.getPropertyPriority(k)==='important')return;" +
                "el.style.setProperty(k,v,'important');}" +
                // bwUndo 只撤销**布局**写入。★ v1.32.17 D10：不再清 __bwSbEl——它现在归发现段
                //   （bwFind）所有，是「这个宿主上哪个元素是侧栏」的答案，与有没有钉成浮层无关；
                //   底色也不在这里改：收起时 bwPanelBg 每轮都会把它拉回 0.45（见 bwAlpha 的 reset 分支）。
                "function bwUndo(){var w=window.__bwW;if(!w)return;window.__bwW=null;" +
                "try{if(w.f&&w.f.isConnected)" +
                "w.f.style.removeProperty('grid-template-columns');" +
                "if(w.col&&w.col.isConnected){for(var j=0;j<BWC.length;j++)" +
                "w.col.style.removeProperty(BWC[j]);}}catch(e1){}" +
                "try{if(w.panel&&w.panel.isConnected){for(var k=0;k<BWK.length;k++)" +
                "w.panel.style.removeProperty(BWK[k]);}}catch(e2){}}" +
                // ★ v1.32.17 D10：底色单独成函数，**只认元素、不认写入**。expanded 由调用方给
                //   （类名宿主用 collapsed 类名判，几何宿主用「侧栏宽 ≥ 轨道宽+40」判）；认不出侧栏
                //   时（收起成 56px 轨道就落在 96px 下限之外）对**上次写过的那个元素**回写 0.45，
                //   与笔电 `var a=(narrow&&expanded)?0.92:0.45` 同一取值。色相一律沿用元素自己的
                //   （此刻读到的仍是页面原生色相或我们上一轮写的同一个色相），只改 alpha。
                "function bwAlpha(el,expanded){" +
                "if(!el||!el.isConnected)return;" +
                "var r=el.getBoundingClientRect();" +
                "if(r.width<=0||r.height<window.innerHeight*0.5)return;" +
                //   玻璃化注入可能先把它写成 transparent（值 transparent + 优先级 important 是我们的
                //   指纹）：摘掉自己那一条，把页面原生色相露出来，否则读到 rgba(0,0,0,0) 会被调成近黑。
                "if(el.style.getPropertyValue('background-color')==='transparent'&&" +
                "el.style.getPropertyPriority('background-color')==='important')" +
                "el.style.removeProperty('background-color');" +
                "var m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/" +
                ".exec(getComputedStyle(el).backgroundColor);if(!m)return;" +
                //   色相不可用（computed 全透明）就不写：没有可保留的色相，硬写会变成 rgba(0,0,0,.92)。
                "if(m[4]!==undefined&&parseFloat(m[4])===0)return;" +
                "var v='rgba('+m[1]+','+m[2]+','+m[3]+','+(expanded?0.92:0.45)+')';" +
                "window.__bwBgEl=el;" +
                "if(el.style.getPropertyValue('background-color')===v&&" +
                "el.style.getPropertyPriority('background-color')==='important')return;" +
                "el.style.setProperty('background-color',v,'important');}" +
                // ★ v1.32.17 D11 第二条臂：**指纹臂**。真机证明「按宽度认侧栏」在新形态上
                //   不成立——撤销挤压后侧栏与正文列**都是 360 宽**（侧栏是盖在正文列上的
                //   覆盖层），判据②③也认不出它：frame 的直接子是 display:contents 的包装
                //   （盒子 0x0，真机 sbAncestry 实测），②那条「外壳 ≥2 个高子元素」数出来是 0；
                //   侧栏列的兄弟列 centerCol 与它**等宽**，既不更宽也不饥饿，③也不成立（两条
                //   都在合成场景 S16 里逐条证过，不是假设）。但玻璃化注入早就把侧栏认出了——
                //   它给侧栏根写的是**我们自己的指纹对**：background-color: rgba(r,g,b,0.45) !important
                //   且 backdrop-filter: blur(...) !important（真机 qa-d10-d10.json 的 d10.bgEl：
                //   hHd-Xa_root 360x671 x=0 static flex，bgInline=rgba(249,250,251,0.45) important）。
                //   QA 原话「色对、alpha 不对」——元素早就选对了，只差把 alpha 抬上去。这条臂就
                //   按这个指纹找元素：贴左缘、高 ≥60%vh、宽 ∈[40px,vw]、可见、且**内联**同时
                //   带那两条 important。只读内联（不读 computed）⇒ 只可能是我们自己写的，不是
                //   页面样式表；alpha 只认 0.45 / 0.92 两个取值（我们自己的两档），别的都不算。
                //   零类名。
                "function bwFpSb(vw,vh){" +
                "var nodes=document.querySelectorAll('div,section,main');" +
                "var best=null,bw=1e9,i,n,r,st,bg,q,parts,a;" +
                "for(i=0;i<nodes.length;i++){n=nodes[i];r=n.getBoundingClientRect();" +
                "if(r.left>2||r.width<40||r.width>vw||r.height<vh*0.6)continue;" +
                "st=n.style;" +
                "if(st.getPropertyPriority('background-color')!=='important')continue;" +
                "if(st.getPropertyPriority('backdrop-filter')!=='important'&&" +
                "st.getPropertyPriority('-webkit-backdrop-filter')!=='important')continue;" +
                "bg=st.getPropertyValue('background-color');" +
                "if(bg.indexOf('rgba(')!==0&&bg.indexOf('rgb(')!==0)continue;" +
                "if(st.getPropertyValue('backdrop-filter').indexOf('blur')<0&&" +
                "st.getPropertyValue('-webkit-backdrop-filter').indexOf('blur')<0)continue;" +
                "q=bg.indexOf(')');if(q<0)continue;" +
                "parts=bg.substring(bg.indexOf('(')+1,q).split(',');" +
                "if(parts.length<3)continue;a=parts.length>3?parseFloat(parts[3]):1;" +
                "if(a!==0.45&&a!==0.92)continue;" +
                "if(getComputedStyle(n).visibility==='hidden')continue;" +
                //   再要它自己的 display 是 flex/grid 容器：侧栏根在两台宿主上都是
                //   flex（真机 d10.bgEl.disp=flex、笔电 _2H3hWW_root 同构），而正文里那些会搭
                //   到指纹的大代码块是 block ——S11 里 chatBigPRE 就是被这条挡下来的
                //   （它 r1-r2 瞬间搭了 0.45 指纹，r3 起才被归成代码块写回原生不透明）。
                "var cds=getComputedStyle(n).display;" +
                "if(cds!=='flex'&&cds!=='inline-flex'&&cds!=='grid'&&cds!=='inline-grid'){continue;}" +
                "if(r.width<bw){best=n;bw=r.width;}}" +
                "return best;}" +
                //   页面自己认的侧栏边界：那根拖拽把手（真机 pI_x6G_handle 8x671 @x=276，内联
                //   left:280px）。判据：细（宽 ≤24）、高（≥50%vh）、绝对/固定定位、left 落在
                //   [40px, 92%vw]。它只用来**否决**「看起来展开但其实没到页面自己声明的边界」，
                //   从不单独用来**认定**侧栏 ⇒ 判不准的方向是漏修（停在 0.45），不是错修。
                "function bwHandle(vw,vh){" +
                "var nodes=document.querySelectorAll('div,button,span');" +
                "var i,n,r,cs;" +
                "for(i=0;i<nodes.length;i++){n=nodes[i];r=n.getBoundingClientRect();" +
                "if(r.width>0&&r.width<=24&&r.height>=vh*0.5&&r.left>=40&&r.left<=vw*0.92){" +
                "cs=getComputedStyle(n);" +
                "if(cs.position==='absolute'||cs.position==='fixed')return n;}}" +
                "return null;}" +
                //   指纹臂还必须落在侧栏的**结构位置**上，否则只凭一对内联样式
                //   就会把正文里搭错的元素抬成 0.92（S11 的 chatBigPRE 就是例子）。
                //   位置判据：往上找到一个 grid/flex 外壳，它的**有效列**（把
                //   display:contents 的包装展平——那种包装盒子是 0x0，真机 frame 的直接子
                //   元素全是它们，不展平就永远数不到子列）里，一个含着候选、一个不含
                //   且高 ≥60%vh，且含候选那列贴左缘。展平只在这条臂里做，结构臂
                //   （bwFind，修挤压唯一能用的那条）一行未改 ⇒ D2 真机 PASS 的路径不变。
                "function bwHas(root,n){var ch=root.children,i,c;" +
                "if(!ch)return false;" +
                "for(i=0;i<ch.length;i++){c=ch[i];if(c===n)return true;if(bwHas(c,n))return true;}" +
                "return false;}" +
                "function bwCols(sh,depth){var res=[],ch=sh.children,i,c,sub,j;" +
                "if(!ch)return res;" +
                "for(i=0;i<ch.length;i++){c=ch[i];" +
                "if(depth<3&&getComputedStyle(c).display==='contents'){" +
                "sub=bwCols(c,depth+1);for(j=0;j<sub.length;j++)res.push(sub[j]);continue;}" +
                "res.push(c);}return res;}" +
                "function bwFpPlace(el,vw,vh){var p=el,d=0,pp,cs,cols,i,mine=null,other=null,r,sl;" +
                "while(p.parentElement&&d++<12){pp=p.parentElement;cs=getComputedStyle(pp);" +
                "if(cs.display==='grid'||cs.display==='inline-grid'||cs.display==='flex'||" +
                "cs.display==='inline-flex'){" +
                "cols=bwCols(pp,0);mine=null;other=null;" +
                "for(i=0;i<cols.length;i++){if(cols[i]===el){mine=cols[i];continue;}" +
                "if(bwHas(cols[i],el)){mine=cols[i];continue;}" +
                "r=cols[i].getBoundingClientRect();" +
                "if(r.height>=vh*0.6&&r.width>0)other=cols[i];}" +
                "if(mine&&other){r=mine.getBoundingClientRect();" +
                "sl=pp.getBoundingClientRect().left;if(r.left<=sl+2)return true;}}" +
                "p=pp;}return false;}" +
                //   指纹臂的展开判据：宽 ≥ 收起轨道+40（纯几何，同 D10 那条）；若页面上有那根
                //   把手，还要求侧栏**盖到**它（宽 ≥ 把手 left-8）。收起态把手 left 会跟着缩到
                //   轨道宽，所以这条只在判成展开时兜底，不会把收起态误判成展开。
                "function bwFpExp(el){" +
                "var rail=bwRailW();" +
                "var w=Math.round(el.getBoundingClientRect().width);" +
                "if(w<rail+40)return false;" +
                "var h=bwHandle(window.innerWidth,window.innerHeight);" +
                "if(h){var hl=Math.round(h.getBoundingClientRect().left);" +
                "if(w<hl-8)return false;}" +
                "return true;}" +
                // 修挤压：只在「外壳是 grid + 有在流内的贴左缘侧栏列 + 有饥饿兄弟列 + 列宽 ≥ 轨道+40」
                //   四条同时成立时才动列宽，其余一律撤销（撤销会把**页面自己**写的内联 grid-template-
                //   columns 一起摘掉——内联只有一个命名空间，这正是真机上解除挤压的机制，见 §11.11）。
                "function bwGeomFix(g){" +
                "if(!g||!g.f||!g.col||!g.expanded){bwUndo();return;}" +
                "if(window.__bwW&&(window.__bwW.f!==g.f||window.__bwW.panel!==g.sb))bwUndo();" +
                "var colEl0=document.querySelector(\"[class*='_sidebarCol']\");" +
                "var colW0=colEl0?Math.round(colEl0.getBoundingClientRect().width):0;" +
                //   钉过一次之后列就永久塌成 rail（56），之后每拍量到的都是窄值 ⇒ 必须把见过的
                //   最宽列宽缓存起来（≥96 才记、取最大可躲开展开动画的中间帧）。
                "if(colW0>=96&&(!window.__bwColW||colW0>window.__bwColW))window.__bwColW=colW0;" +
                "var f=g.f,col=g.col,panel=g.sb,rail=g.rail,tr=g.tr||[],vw=window.innerWidth;" +
                "var j,at=-1,nw;" +
                //   闸 B（v1.32.18）：轨道下标**按侧栏在外壳里的元素子节点序号**定，不按宽度猜。
                //   按宽度猜在两条轨道同宽时会钉错列；笔电宿主上被钉成 56px 的是 centerCol 那一轨，
                //   而侧栏（覆盖层）是外壳的第 4 个元素子节点、外壳只有 3 条轨道 ⇒ 序号越界，
                //   直接撤销不钉（宁可不修，不可错修）。只有侧栏不是外壳直接子元素时才退回按宽度找。
                "var nd2=f.firstChild,ci=0,ix=-1;" +
                "while(nd2){if(nd2===panel){ix=ci;break;}if(nd2.nodeType===1)ci++;nd2=nd2.nextSibling;}" +
                "if(ix>=0){if(ix>=tr.length){bwUndo();return;}at=ix;}" +
                "else{for(j=0;j<tr.length;j++){if(Math.abs(tr[j]-g.colW)<=2){at=j;break;}}}" +
                "if(at>=0){nw=[];for(j=0;j<tr.length;j++){if(j===at)nw.push(rail+'px');" +
                "else if(j===at+1)nw.push('minmax(0,1fr)');else nw.push(tr[j]+'px');}" +
                "bwSet(f,'grid-template-columns',nw.join(' '));}" +
                "for(j=0;j<BWC.length;j++)bwSet(col,BWC[j],(BWC[j]==='overflow'?'visible':" +
                "(BWC[j]==='will-change'?'auto':'none')));" +
                // ★ v1.33.2：覆盖层宽度取「侧栏列」的宽度，不取被量到的那个覆盖层根的宽度。
                //   真机对照：笔电走写死哈希的 CSS 规则，宽度沿用页面自己的 280px ≈ 78%；VM1/
                //   工作机哈希不同落到这条 JS 臂，量到的是满屏覆盖层根（336 CSS）被夹成
                //   0.85vw=306px ≈ 85% ⇒ 用户看到的「铺满屏幕」。v1.33.1 曾改成「在流内就不做
                //   覆盖层」，真机反而坏了：360 CSS 上页面自己的轨道是 280+80，正文只剩 80px，
                //   于是正文先透出来再整块消失（用户 19:55 两张图）。覆盖层本身是对的，
                //   错的是宽度来源。*_sidebarCol 这个后缀跨构建稳定（BynINW_ / pI_x6G_ 都一样）。
                "var pw=Math.round(panel.getBoundingClientRect().width);" +
                "var cwC=window.__bwColW||colW0;if(cwC>=96&&cwC<=vw*0.88)pw=cwC;" +
                "if(pw<rail+40)pw=280;if(pw>vw*0.9)pw=Math.round(vw*0.85);" +
                "bwSet(panel,'position','fixed');bwSet(panel,'left','0px');" +
                "bwSet(panel,'top','0px');bwSet(panel,'bottom','0px');" +
                "bwSet(panel,'width',pw+'px');bwSet(panel,'max-width',pw+'px');" +
                "bwSet(panel,'z-index','60');bwSet(panel,'overflow-y','auto');" +
                "bwSet(panel,'overflow-x','hidden');" +
                "bwSet(panel,'box-shadow','0 8px 32px rgba(0,0,0,.35)');" +
                "window.__bwW={f:f,col:col,panel:panel};}" +
                // 入口：一次 bwFind() 喂两个消费者（修挤压、底色），再加指纹臂兜底；
                //   结果发布到 window.__bwSbEl 给玻璃化注入的 isSb / skipBg 两条臂用。
                //   优先级：**类名锚点最优**（笔电样式表生效的宿主一行未变）→ 其次结构臂
                //   （bwFind ①②③④，覆盖「侧栏在流内吃宽度」那类形态，也是修挤压唯一能用的
                //   形态）→ 最后**指纹臂**（D11，覆盖「侧栏是满屏宽覆盖层」那类形态）。
                //   __bwSbEl 每轮都发布，与有没有钉浮层、有没有撤销无关。
                "function bwPrefix(){if(window.__bwPre!==undefined)return window.__bwPre;" +
                "var c=document.querySelector(\"[class*='_sidebarCol']\");" +
                "var m=c?String(c.className).match(/([A-Za-z0-9_-]+?)_sidebarCol/):null;" +
                "window.__bwPre=m?m[1]:'';return window.__bwPre;}" +
                // v1.33.1：锚点不再写死笔电那一份构建的哈希（_2H3hWW_）。每个部署的 CSS 模块哈希都不同
                //   （实测 VM1 是 hHd-Xa_、笔电是 _2H3hWW_，同一版 0.2.0-rc.2 也不同），写死会让别的宿主
                //   打不中锚点、掉进结构臂，被改成 fixed + 0.85vw 覆盖层 = 用户报的「侧栏铺满屏幕」。
                //   改成从本机构建的 *_sidebarCol 反推前缀，所有宿主都走笔电那条「一行未变」的路。
                // ★ v1.33.5：CDP 连进模拟器实测——360 CSS 下页面**自己**就把 *_sidebarCol 给成 360 宽
                //   （窄屏设计如此），且 pI_x6G_frame 这时已不是多轨道网格 ⇒ bwFind 找不到外壳 ⇒
                //   pinned=0，前面几版改的宽度分支全都没执行到。正文在 *_overlayLayer（absolute,
                //   z=20）里、本来就是满宽，所以只要把侧栏与它的列一起夹到 0.78vw，右边就露出正文
                //   （CDP 当场试改已验证：col 360→281、root→280、overlayLayer 仍 360）。
                //   与有没有外壳、走哪条臂无关 —— 只看「解析出的侧栏是不是几乎占满宽度」。
                // ★ v1.33.9：CDP 把布局链摊开才发现**前面几版靶子选错了**。实测 frame=pI_x6G_frame
                //   是 display:grid、tracks="280px 80px 0px"：侧栏自然宽只有 280，真正的问题是
                //   页面自己给正文轨道只留 80px（centerCol 80、里面 viewArea 只有 73）。所以拿
                //   「侧栏 ≥0.9vw」当判据从一开始就不成立，改成盯**正文列宽度**（也正是四态矩阵
                //   的断言）：正文 < 0.8vw 就把侧栏轨道压成 0、正文轨道吃满 minmax(0,1fr)，再把
                //   侧栏列改成 fixed 覆盖层 0.78vw —— 这就是笔电那类宿主的形态（侧栏浮在正文上、
                //   正文满宽、立绘透得出来）。幂等由判据本身保证：改完正文就 ≥0.8vw，下一拍返回 0。
                //   撤销只在**自己确实动过手**（prev 非空）时做，否则会把 bwGeomFix 写的轨道清掉。
                "function bwNarrow(sb,exp,vw){" +
                "var prev=window.__bwNarrowEl||[];" +
                "function clr(e){try{e.style.removeProperty('grid-template-columns');" +
                "e.style.removeProperty('position');e.style.removeProperty('left');" +
                "e.style.removeProperty('top');e.style.removeProperty('bottom');" +
                "e.style.removeProperty('width');e.style.removeProperty('max-width');" +
                "e.style.removeProperty('z-index');}catch(e7){}}" +
                "function undo(){for(var z=0;z<prev.length;z++){if(prev[z]&&prev[z].isConnected)clr(prev[z]);}" +
                "window.__bwNarrowEl=[];window.__bwNarrow=0;window.__bwFpW=null;return 0;}" +
                "function skip(){return prev.length?undo():0;}" +
                "if(vw>1023)return skip();" +
                "var col=document.querySelector(\"[class*='_sidebarCol']\");" +
                "var ctr=document.querySelector(\"[class*='_centerCol']\");" +
                "if(!col||!col.isConnected||!ctr||!ctr.isConnected)return skip();" +
                "var frame=col.parentElement;if(!frame||!frame.isConnected)return skip();" +
                "var fcs=getComputedStyle(frame);if(fcs.display.indexOf('grid')<0)return skip();" +
                //   ★ v1.33.10 修振荡：判据 MUST 只看**展开态**，不能看我刚写出来的宽度——
                //   上一版「正文够宽且侧栏够窄就撤销」，而这个状态正是我上一步写出来的，
                //   于是 应用→下一拍撤销→再应用，周期就是注入段重跑的节奏（用户报 ~500ms
                //   来回闪）。现在：展开就一律维持（bwSet 值相同即空操作，天然幂等），
                //   收起或超过 1023 宽才撤销。
                //   两种形态仍分开治：并排（多轨道）压轨道 0px+minmax(0,1fr)；覆盖层（单轨道）
                //   只把列 fixed 摘出流。两者最后都是 0.78vw 半透明覆盖层 = 笔电形态。
                //   ★ v1.33.10 划清职责边界：**只在页面自己没把侧栏设成覆盖层时才动手**。笔电那类
                //   宿主已被注入 CSS 规则（写死其哈希）把侧栏根设成 fixed，我再去改它的列就会和
                //   那条规则打架（矩阵实测：笔电/expanded 聊天列 56 / 0）。判据用解析出的侧栏
                //   根自己的 computed position —— 与哈希无关。
                "if(!exp)return skip();" +
                "var rp=sb?getComputedStyle(sb).position:'';" +
                "if(rp==='fixed'||rp==='absolute')return skip();" +
                //   ★ v1.33.10 再修：**不要按「子元素序号 = 轨道序号」去压轨道**——frame 有 5 个子
                //   元素却只有 3 条轨道（overlayLayer/handle 是绝对定位不占轨道），索引错位会把
                //   正文那条轨道压成 0（四态矩阵当场拦下：笔电/expanded 聊天列 0 < 0.8vw）。
                //   VM 展开时 frame 本来就是单轨道、正文列已满宽，所以只需要把侧栏列摘出流；
                //   轨道交给页面与 bwGeomFix，不去猜索引。
                "var nw=Math.round(vw*0.78);" +
                "bwSet(col,'position','fixed');bwSet(col,'left','0px');bwSet(col,'top','0px');" +
                "bwSet(col,'bottom','0px');bwSet(col,'width',nw+'px');bwSet(col,'max-width',nw+'px');" +
                "bwSet(col,'z-index','60');" +
                "window.__bwNarrowEl=[frame,col];window.__bwNarrow=nw;window.__bwFpW=col;return nw;}" +
                "function bwPanelBg(){if(Date.now()<(window.__dshScrolling||0)){window.__bwBgPend=1;return;}bwFab();var g=bwFind();bwGeomFix(g);var pre=bwPrefix();" +
                //   注意：DSH 的 bundle 里**外壳与侧栏根是两个不同哈希命名空间**（笔电外壳 BynINW_*
                //   但侧栏根 _2H3hWW_*；VM1 是 pI_x6G_* / hHd-Xa_*），所以推导前缀只能当兜底：
                //   先认已知的笔电锚点（那条路一行未变，遮罩 alpha 才不会被算错），再退到推导值。
                "var sb=document.querySelector(\"[class*='_2H3hWW_root']\");" +
                "if(!sb&&pre)sb=document.querySelector(\"[class*='\" + pre + \"_root']\");" +
                "var exp;" +
                "if(sb){exp=sb.className.indexOf('_collapsed')<0;}" +
                "else{sb=g?g.sb:null;exp=!!g&&g.sbExpanded;" +
                "if(!sb){sb=bwFpSb(window.innerWidth,window.innerHeight);" +
                // ★ v1.33.4：工作VM/VM1 的侧栏是挂在 body 下的**满屏宽 portal 覆盖层**（真机浮层实测
                //   sb=hHd-Xa_root@360 exp=1 pinned=0）——配不上外壳轨道，结构臂与 bwFpPlace 都判 false，
                //   于是整个几何段直接放弃，100% 宽是页面自己的。这种形态要的是**只夹宽度、不动轨道**：
                //   宽度取 min(实测, 0.78vw)，位置与层叠交回页面，正文列本来就没被挤。
                "if(sb&&!bwFpPlace(sb,window.innerWidth,window.innerHeight)){" +
                "var vw0=window.innerWidth;" +
                "var nw0=Math.min(Math.round(sb.getBoundingClientRect().width),Math.round(vw0*0.78));" +
                "if(window.__bwFpW&&window.__bwFpW!==sb){try{window.__bwFpW.style.removeProperty('width');" +
                "window.__bwFpW.style.removeProperty('max-width');}catch(e9){}window.__bwFpW=null;}" +
                "if(nw0>=96){bwSet(sb,'width',nw0+'px');bwSet(sb,'max-width',nw0+'px');window.__bwFpW=sb;}" +
                "sb=null;}" +
                "exp=!!sb&&bwFpExp(sb);}}" +
                "window.__bwNarrow=0;" +
                "window.__bwSbEl=sb||null;" +
                "window.__bwDbg='pre='+(pre||'-')+' sb='+(sb?String(sb.className).slice(0,18)+'@'+" +
                "Math.round(sb.getBoundingClientRect().width):'-')+' exp='+(exp?1:0)+' pinned='+(window.__bwW?1:0) +" +
                "' vw='+window.innerWidth+' narrow='+(window.__bwFpW?Math.round(window.__bwFpW.getBoundingClientRect().width):0);" +
                "if(!sb){bwAlpha(window.__bwBgEl,false);return;}" +
                //   展开/收起：类名宿主沿用原来的 collapsed 类名判据；几何宿主读「侧栏宽 ≥
                //   轨道宽+40」（真机撤销定位后侧栏 position 仍是 static，既不能用 position 判、
                //   也没有 collapsed 类名可读）；指纹臂用同一条宽度判据 + 把手边界兜底。
                //   ⚠️ v1.33.14：撤回 v1.33.13 的「压掉侧栏毛玻璃」。那次是拿**浅色主题**的模拟器对比
                //   得出的结论（两边底色都是 rgba(249,250,251,.92)），而用户手机是 WebView 的**算法暗化**
                //   （系统 night=yes 后 prefers-color-scheme 仍是 light ⇒ 模拟器复现不出来）。真机对照
                //   09:05（去毛玻璃）比 22:37 笔电（有毛玻璃）更糟：正文太扎眼 ⇒ 恢复毛玻璃。
                "bwAlpha(sb,exp&&window.innerWidth<=1023);}" +
                // ★ v1.33.29（用户 m02568）：悬浮鲸鱼钮。收起态侧栏整个隐藏后它是唯一入口；
                //   展开态钮仍在（z-120 压在浮层上），再点一下收起。图标克隆页面自己的
                //   侧栏 logo（原本那个鲸鱼图标），克隆不到退回 🐳。点击=给页面自己的
                //   sidebar toggle 派发完整 pointer/mouse/click 事件序列——「点浮层外收起」
                //   在生产已证明对这个钮 .click() 有效；展开态那个钮随收起轨道 display:none，
                //   合成事件不看 isTrusted/可见性，只看冒泡。
                "function bwToggle(){var b=document.querySelectorAll('button,[role=button],a');" +
                "for(var i=0;i<b.length;i++){var a=(b[i].getAttribute('aria-label')||'')+' '+(b[i].title||'');" +
                "if(/right|右/i.test(a))continue;" +
                "if(/Open sidebar|Collapse sidebar|Toggle sidebar|展开侧边栏|收起侧边栏|打开侧边栏|切换侧边栏/i.test(a)){" +
                "var el=b[i],r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;" +
                "var o={bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y," +
                "screenX:x,screenY:y,button:0,pointerId:1,pointerType:'touch',isPrimary:true};" +
                "try{el.dispatchEvent(new PointerEvent('pointerdown',Object.assign({buttons:1},o)));}catch(e1){}" +
                "try{el.dispatchEvent(new MouseEvent('mousedown',Object.assign({buttons:1},o)));}catch(e2){}" +
                "try{el.dispatchEvent(new PointerEvent('pointerup',Object.assign({buttons:0},o)));}catch(e3){}" +
                "try{el.dispatchEvent(new MouseEvent('mouseup',Object.assign({buttons:0},o)));}catch(e4){}" +
                "el.dispatchEvent(new MouseEvent('click',Object.assign({detail:1},o)));return true;}}" +
                "return false;}" +
                // v1.33.30：钮可自由拖动，松手自动吸附左/右边框并半隐，位置存 localStorage（bwFabPos），
                //   点露出的部分=展开侧栏；侧栏展开时钮全显。
                // v1.33.31：吸附半隐改露 1/3（15px，藏 29px）+ 透明度 .5（悬浮球设计通行做法：
                //   吸附态降透明度进一步减干扰，触摸即恢复，见鸿蒙 FloatBall opacityHide=0.5 / 微信浮窗）；
                //   拖动中恢复全显全透，跟手。
                // v1.33.42（用户 m08310）：1/3 露出（15px）在真机上常点不到 → 改**露 1/2（22px，藏 22px）**。
                //   左右对称：左吸附 left=-22、右吸附 left=vw-22，可见半圆宽度 22px = 44px 钮的一半。
                //   只改这两个坐标与初始 cssText，拖动/吸附/半透逻辑不变。
                //   （注意：本段是超长 "+" 链，Kotlin psi2ir 对链深敏感——加行要**合并成少条长字面量**，
                //   1.33.30 首版拆 33 行曾把编译器栈炸穿 StackOverflowError。）
                "function bwFabGet(){var p=null;try{p=JSON.parse(localStorage.getItem('bwFabPos'));}catch(e1){}if(!p||(p.side!=='left'&&p.side!=='right')||typeof p.y!=='number')p=window.__bwFabPos;if(!p||(p.side!=='left'&&p.side!=='right')||typeof p.y!=='number')p={side:'left',y:0.5};return p;}" +
                "function bwFabSave(p){window.__bwFabPos=p;try{localStorage.setItem('bwFabPos',JSON.stringify(p));}catch(e2){}}" +
                "function bwFabOpen(){var s=document.querySelector(\"[class*='_sidebarCol'] [class*='_root']:not([class*='_collapsed'])\");return !!(s&&s.getBoundingClientRect().width>0);}" +
                "function bwFabPlace(f,p,anim){var vw=window.innerWidth,vh=window.innerHeight;var cy=Math.min(Math.max(p.y*vh,64),vh-64);var op='1';var x=p.side==='right'?(bwFabOpen()?vw-50:vw-22):(bwFabOpen()?6:-22);if(!bwFabOpen()){op='.5';}f.style.transition=anim?'left .18s ease-out,top .18s ease-out,opacity .18s ease-out':'none';f.style.left=x+'px';f.style.top=Math.round(cy)-22+'px';f.style.transform='none';f.style.opacity=op;}" +
                "function bwFab(){var f=document.getElementById('bw-whale-fab');if(!f&&document.body){f=document.createElement('button');f.id='bw-whale-fab';f.type='button';f.setAttribute('aria-label','Toggle sidebar');f.textContent='🐳';" +
                "f.style.cssText='position:fixed;left:-22px;top:50%;z-index:120;width:44px;height:44px;border-radius:50%;padding:0;border:1px solid rgba(255,255,255,.25);background:rgba(18,24,40,.55);color:#fff;font-size:22px;display:flex;align-items:center;justify-content:center;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);touch-action:none;box-shadow:0 4px 16px rgba(0,0,0,.35)';" +
                "f.addEventListener('pointerdown',function(e){if(e.isPrimary===false||(e.button!=null&&e.button!==0))return;f.__bwDown={x:e.clientX,y:e.clientY,l0:parseFloat(f.style.left)||0,t0:parseFloat(f.style.top)||0,moved:false};try{f.setPointerCapture(e.pointerId);}catch(e3){}f.style.transition='none';f.style.opacity='1';});" +
                "f.addEventListener('pointermove',function(e){var d=f.__bwDown;if(!d)return;var dx=e.clientX-d.x,dy=e.clientY-d.y;if(!d.moved&&dx*dx+dy*dy<64)return;d.moved=true;f.__bwMoved=1;var vw=window.innerWidth,vh=window.innerHeight;f.style.left=Math.min(Math.max(d.l0+dx,0),vw-44)+'px';f.style.top=Math.min(Math.max(d.t0+dy,0),vh-44)+'px';});" +
                "f.addEventListener('pointerup',function(e){var d=f.__bwDown;f.__bwDown=null;if(!d||!d.moved)return;var vw=window.innerWidth,vh=window.innerHeight;var cx=parseFloat(f.style.left)+22,cy=parseFloat(f.style.top)+22;var p={side:cx<vw/2?'left':'right',y:cy/vh};bwFabSave(p);bwFabPlace(f,p,true);setTimeout(function(){f.__bwMoved=0;},350);});" +
                "f.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();if(f.__bwMoved){f.__bwMoved=0;return;}if(Date.now()<(window.__bwFabSuppress||0))return;bwToggle();});document.body.appendChild(f);}" +
                //   logo 可能比注入晚渲染：每轮 bwPanelBg 试克隆一次，成功为止（img/svg 都整节点克隆）。
                "if(f&&!f.__bwLogo){var sc=document.querySelector(\"[class*='_sidebarCol']\");" +
                "var lg=sc?(sc.querySelector('img')||sc.querySelector('svg')):null;" +
                "if(lg){f.textContent='';var c=lg.cloneNode(true);" +
                "c.removeAttribute('class');c.removeAttribute('style');" +
                "c.style.width='24px';c.style.height='24px';c.style.display='block';" +
                "c.style.pointerEvents='none';f.appendChild(c);f.__bwLogo=1;}}" +
                "if(f){f.style.display=window.innerWidth>1023?'none':'flex';" +
                "if(!f.__bwDown)bwFabPlace(f,bwFabGet(),false);}}" +
                "window.__bwPanelBg=bwPanelBg;bwPanelBg();" +
                "setTimeout(bwPanelBg,300);setTimeout(bwPanelBg,1200);" +
                "var psb=document.querySelector(\"[class*='_2H3hWW_root']\");" +
                "if(!psb&&bwPrefix())psb=document.querySelector(\"[class*='\" + bwPrefix() + \"_root']\");" +
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
                // v1.33.29：点悬浮鲸鱼钮本身不算「点浮层外」——钮自己的 click 负责切换；
                // 不豁免会「本处理器收起 + 钮再展开」双切换互相抵消。
                "if(e.target&&e.target.closest&&e.target.closest('#bw-whale-fab'))return;" +
                "var sb=document.querySelector(\"[class*='_2H3hWW_root']\");" +
                "if(!sb){sb=window.__bwSbEl;if(!sb)return;" +
                "if(getComputedStyle(sb).position!=='fixed')return;}" +
                "else if(sb.className.indexOf('_2H3hWW_collapsed')>=0)return;" +
                "var r=sb.getBoundingClientRect();" +
                "if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&" +
                "e.clientY<=r.bottom)return;" +
                "var b=document.querySelectorAll('button');" +
                // v1.33.30：收起动作会让右缘吸附的悬浮钮滑到手指正下方，Android 按**松手点**
                // 派发 click 会把它再展开（闪一下回到展开）。给 500ms 抑制窗让这记 click 作废。
                "window.__bwFabSuppress=Date.now()+500;" +
                "for(var i=0;i<b.length;i++){var a=b[i].getAttribute('aria-label')||'';" +
                "if(a.indexOf('Collapse sidebar')>=0||a.indexOf('收起侧边栏')>=0)" +
                "{b[i].click();return;}}" +
                // ★ v1.33.32（用户 m03322/m03479）：原生顶栏 Quick Return——
                //   下滑（读消息往下走）收起原生顶栏把屏幕让给对话，上滑立刻回来。
                //   业界通行做法（Chrome Android 地址栏、NN/G「部分常驻头部」：
                //   下滑动画出、上滑动画回、阈值几个像素防手抖）。判据只认**主聊天滚动容器**
                //   （clientHeight≥400 的大滚动区），代码块/侧栏小滚动区不触发；
                //   顶部 120px 内不收起（刚进页面/回到顶栏意图明确）。
                //   JS→原生走 addJavascriptInterface 的 bwNative.barShow（targetSdk34 无桥接风险，
                //   页面是自己人）。原生侧动画见 setBarShown。
                //   切换后 450ms 冷却锁（lock）+ **连续两帧同向**判定（prev）：栏收起/展开会改
                //   WebView 高度 25px，聊天页的"钉在底部"会自动补偿 scrollTop——这记**布局回声
                //   滚动**（实测单跳 ±25、延迟 ~490ms）若被当作用户手势，在页面底部会 hide↔show
                //   来回自激成"果冻波动"（用户 1.33.32 实测报的 bug，探针抓到无触摸自振 8 次）。
                //   回声是**孤立单跳**，真滑动是**每 ~50ms 一串同向增量**——要求本帧和上一帧
                //   增量同向过阈值才切换，回声天然被拒；锁兜住动画期间的连发。
                //   ⚠ 本段是超长 "+" 链，Kotlin psi2ir 对链深敏感（1.33.30 拆 33 行炸过栈）——
                //   新增代码必须**合并成尽量少的长字面量**（这里整块只占 2 个操作数）。
                "},true);if(!window.__bwQR&&window.bwNative){window.__bwQR=1;var lastPos=new WeakMap(),lastD=new WeakMap(),hidden=false,t0=Date.now(),lock=0,qrT=null;function setBar(s){if(hidden===!s)return;hidden=!s;lock=Date.now()+450;try{bwNative.barShow(s);}catch(e){}}" +
                // 页面（重）加载 ⇒ 原生栏复位为显示（直调，不走 setBar 的幂等门），防 JS/原生状态错位。
                // 加载后 2.5s 宽限：聊天页会自动滚到底（一次 0→8000 的传送式跳变），
                // 那不是"用户下滑读消息"，不该把栏收走（实测 m03657 截图就是这么丢的）。
                // 看门狗（用户 m03906）：新建对话没有内容 → 页面不可滚 → 没有"上滑"手势，
                // 栏一旦收起就永远回不来。每 800ms 查一次：全页找不到可滚的主容器
                // （clientHeight≥400 且 scrollHeight>clientHeight+50）而栏正收起 → 立刻复位。
                "try{bwNative.barShow(true);}catch(e){}document.addEventListener('scroll',function(e){var t=e.target;if(!t||t.nodeType!==1)return;if(t.clientHeight<400)return;var y=t.scrollTop,p=lastPos.get(t),pd=p===undefined?0:y-p,prev=lastD.get(t)||0;lastPos.set(t,y);lastD.set(t,pd);if(p===undefined)return;if(Date.now()-t0<2500||Date.now()<lock)return;if(y>p+12&&prev>12&&y>120)setBar(false);else if(y<p-12&&prev<-12)setBar(true);},true);function bwQrChk(){if(!hidden)return;if(Date.now()<window.__dshScrolling)return;qrT=(qrT||0)+1;if(qrT%4)return;var c=window.__bwScroller;if(c&&c.isConnected&&c.clientHeight>=400&&c.scrollHeight>c.clientHeight+50)return;var all=document.querySelectorAll('*'),best=null;for(var i=0;i<all.length;i++){var e=all[i];if(e.clientHeight>=400&&e.scrollHeight>e.clientHeight+50&&(!best||e.clientHeight>best.clientHeight))best=e;}window.__bwScroller=best;if(!best)setBar(true);}setInterval(bwQrChk,800);" +
                // ★ v1.33.39（用户 m06190）：把「用户当前停留的对话」回报给原生，供下次恢复。
                //   DSH Web 切会话**不改 URL**（没有路由；host-plugin 的 revealFromHash 还会
                //   replaceState 把片段抹掉），所以唯一可靠钩子是 DOM：DSH 客户端在会话容器上
                //   挂了 data-conversation-session="session-<uuid>"（全页唯一一个）。
                //   1s 轮询一次单条 querySelector（实测 1237 节点页 <0.1ms），值变了才上报；
                //   页面 hidden 时跳过，不烧后台 CPU。首屏 600ms 另补一拍——属性在首渲染后才出现。
                "if(!window.__bwSess){window.__bwSess=1;var __bwLs='';" +
                "function bwSess(){try{if(document.hidden)return;" +
                "var e=document.querySelector('[data-conversation-session]');" +
                "var v=e?String(e.getAttribute('data-conversation-session')||''):'';" +
                "if(!v||v===__bwLs)return;__bwLs=v;" +
                "if(window.bwNative&&bwNative.saveSess)bwNative.saveSess(v);}catch(e1){}}" +
                // ★ v1.33.41（用户 m07251）：切完马上就关掉窗口时，1s 那一拍还没轮到，
                //   存盘值就停在上一个会话——再进来自然弹回旧对话。补两件事：
                //   ① 轮询间隔 1000→400ms（单条 querySelector，实测 <0.1ms，可忽略）；
                //   ② 页面 hidden / 卸载前**立刻冲一次**（visibilitychange、pagehide、
                //      beforeunload 三个都挂，任一先到就写），保证「切完即走」也能落盘。
                "function bwSessFlush(){try{var e=document.querySelector('[data-conversation-session]');" +
                "var v=e?String(e.getAttribute('data-conversation-session')||''):'';" +
                "if(!v||v===__bwLs)return;__bwLs=v;" +
                "if(window.bwNative&&bwNative.saveSess)bwNative.saveSess(v);}catch(e2){}}" +
                "document.addEventListener('visibilitychange',function(){if(document.hidden)bwSessFlush();});" +
                "window.addEventListener('pagehide',bwSessFlush);" +
                "window.addEventListener('beforeunload',bwSessFlush);" +
                "setTimeout(bwSess,600);setInterval(bwSess,400);}}" +
                // ★ v1.33.46（用户 m10371「为什么当前对话输入框变大了呢，其他对话是正常的」）：
                //   DSH 网页把每个会话的草稿存 localStorage `dsh.conversation.<sid>`
                //   （形如 {"draft":{"text":"\n\n\n",...}}）。**text 是纯空白（多个 \n）时
                //   输入框按行数把卡片撑高**——实测 1 行 98px、2 行 114、3 行 138、4 行 162，
                //   而占位文字只有一行，看起来就是"这个对话的输入框莫名变大了"。
                //   实测复现链：`Input.insertText("\n\n\n")` → 卡片 162；刷新后仍 162（草稿已落盘）。
                //   修法双保险（都实测过）：
                //   ① 启动时把**所有**纯空白草稿的 text 归一成 ""（治本，刷新后不再复发）；
                //   ② 当前输入框是纯空白且卡片 >110px 时，给编辑器上 max-height:36px 钳回单行
                //      （治标，兜住本拍 DOM 还没重新量高的情形；一碰键盘/输入就 release）。
                //   注意：①只认"非空但全是空白"的 text——真正的空串别动（那是正常态）；
                //   ②只在不含图片/按钮/装饰节点时才钳（有附件时高度是合理的）。
                "if(!window.__bwCmp){window.__bwCmp=1;var __bwCmpT=0;" +
                "function bwCmpClean(){var n=0;try{for(var i=0;i<localStorage.length;i++){" +
                "var k=localStorage.key(i);if(!k||k.indexOf('dsh.conversation.')!==0)continue;" +
                "var raw=localStorage.getItem(k);if(!raw)continue;var o=null;" +
                "try{o=JSON.parse(raw);}catch(e){continue;}if(!o||!o.draft)continue;" +
                "var d=o.draft,txt=(typeof d==='string')?d:(d.text||'');" +
                "if(typeof txt!=='string')continue;" +
                "if(txt!==''&&txt.replace(/\\s/g,'')===''){if(typeof d==='string'){o.draft='';}" +
                "else{d.text='';}localStorage.setItem(k,JSON.stringify(o));n++;}}}catch(e){}return n;}" +
                "function bwCmpBox(){return document.querySelector('[contenteditable=true]');}" +
                "function bwCmpCard(t){var z=t.parentElement,g=0;while(z&&g<8){" +
                "if(String(z.className||'').indexOf('_card')>=0)return z;z=z.parentElement;g++;}return null;}" +
                "function bwCmpFree(t){if(t&&t.style.maxHeight){t.style.maxHeight='';t.style.overflowY='';}}" +
                "function bwCmpFix(){var t=bwCmpBox();if(!t)return;if(__bwCmpT){bwCmpFree(t);return;}" +
                "if(String(t.innerText||'').replace(/\\s/g,'')!==''){bwCmpFree(t);return;}" +
                "if(t.querySelector('img,button,[data-lexical-decorator]')){bwCmpFree(t);return;}" +
                "var cb=bwCmpCard(t);if(!cb)return;" +
                "if(cb.getBoundingClientRect().height>110){if(t.style.maxHeight!=='36px'){" +
                "t.style.maxHeight='36px';t.style.overflowY='hidden';}}else{bwCmpFree(t);}}" +
                "function bwCmpMark(){__bwCmpT=1;bwCmpFree(bwCmpBox());}" +
                "document.addEventListener('pointerdown',function(e){var t=bwCmpBox();" +
                "if(t&&e.target&&(e.target===t||t.contains(e.target)))bwCmpMark();},true);" +
                "document.addEventListener('keydown',function(e){var t=bwCmpBox();" +
                "if(t&&e.target&&(e.target===t||t.contains(e.target)))bwCmpMark();},true);" +
                "document.addEventListener('input',function(e){var t=bwCmpBox();" +
                "if(t&&e.target&&(e.target===t||t.contains(e.target)))bwCmpMark();},true);" +
                "bwCmpClean();bwCmpFix();setTimeout(bwCmpFix,400);setTimeout(bwCmpFix,1500);" +
                "setInterval(bwCmpFix,700);}" +
                "})();", null)
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
                        // ★ v1.33.36 滚动期静默（用户 m04813「对话长时滑动卡顿」）：实测一次 apply()
                        //   对 919 个元素逐个 getComputedStyle + offsetWidth/offsetHeight 再写内联样式，
                        //   是**读写交错**的强制布局抖动；而长对话滚动时 React 虚拟列表不停回收/复用
                        //   节点 ⇒ MutationObserver 每批都触发 apply()。3 次甩动内实测 6 个 long task、
                        //   最长 748ms、getComputedStyle 被调 31516 次 ⇒ 主线程整块卡死，就是用户手感。
                        //   对策：滚动中不跑全量扫描（记 pending），滚动停下 240ms 后补跑一次。
                        //   语义不变——静止态最终一定收敛到同一结果，只是把工作挪出滚动帧。
                        "if(!window.__dshScrollT){window.__dshScrollT=1;window.__dshScrolling=0;" +
                        "window.__dshScrollPend=0;document.addEventListener('scroll',function(){" +
                        "window.__dshScrolling=Date.now()+220;" +
                        "if(window.__dshScrollTimer)clearTimeout(window.__dshScrollTimer);" +
                        "window.__dshScrollTimer=setTimeout(function(){window.__dshScrolling=0;" +
                        "if(window.__dshScrollPend){window.__dshScrollPend=0;" +
                        "try{apply();}catch(e0){}}" +
                        "if(window.__bwBgPend){window.__bwBgPend=0;" +
                        "try{if(window.__bwPanelBg)window.__bwPanelBg();}catch(e1){}}},240);},true);}" +
                        "function apply(){window.__dshApply=apply;if(!document.body)return;" +
                        // 只**推迟**不取消：滚动结束后 240ms 由上面的定时器补跑一轮，静止态收敛不变。
                        "if(Date.now()<window.__dshScrolling){window.__dshScrollPend=1;return;}" +
                        "document.documentElement.style.setProperty(" +
                        "'background-color','transparent','important');" +
                        "document.body.style.setProperty('background-color'," +
                        "'transparent','important');" +
                        "var vw=window.innerWidth,vh=window.innerHeight;" +
                        // ★ v1.33.36：祖先链缓存按**本轮代数**失效——apply() 每跑一轮就换代，
                        //   同一轮内同一个祖先只量一次（原来 4486 个节点 × ~10 层 = 3.5 万次
                        //   getComputedStyle，占单轮总量的 97%）。跨轮必须重算：滚动/展开会改布局。
                        "window.__abpGen=(window.__abpGen||0)+1;" +
                        // 浮层底色回退色（v1.32.11）：真实指令菜单表层 Z9Jnlq_menu 的
                        // computed background 是 **transparent**（它的底色来自样式表/伪元素），
                        // 所以它连下面的正则分支都进不去（!m 或 alpha<1 直接 continue），
                        // 这正是"菜单太透、文字发花"的机制。命中的浮层若自身没有可用色相，
                        // 就按页面文字亮度选深/浅纱（与 #dsh-theme-veil 同一判据）。
                        "var bm=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(" +
                        "getComputedStyle(document.body).color)||[];" +
                        "var blum=bm[1]?(0.299*bm[1]+0.587*bm[2]+0.114*bm[3])/255:0;" +
                        // （v1.32.21 曾整段停用，v1.32.22 又启用为**半透明遮罩**；bm / blum 就是给它选深浅的,
                        //   浅色主题给白遮罩、深色主题给深遮罩，别写死。）
                        // v1.32.20：0.96 也不行（用户真机 13:39 截图实测）。0.96 压在**亮壁纸/白正文**上，
                        // 4% 透光仍能看到底层内容淡影；再叠加浮层自带的 0.5px 白描边，整块读成"底色没涂到
                        // 边、内沿一圈颜色不一样"。浮层是短暂覆盖物、不需要空间线索，与阅读面板同理
                        // （v1.32.12 那里实测 0.96 仍留淡影才定成 1）=> alpha=1。
                        // ★ v1.32.22：浮层要的是**深色遮罩**，不是实色也不是全透。四档真合成实测（模拟器浅灰壁纸=
                        //   最坏情形）：原生 0 遮罩时背后正文的边缘能量 26.90，0.45→18.15（−32%）、0.60→16.36
                        //   （−39%）、0.72→15.45（−43%）——拐点在 0.45~0.60，再往上只是把壁纸压成暗块。取 **0.60**：
                        //   自己的条目读得清、背后只剩淡影、壁纸仍是可辨的色块。alpha 也别到 1：v1.32.20 实测
                        //   实色会把原生发丝线顶成一条硬色差。
                        "var ovFallback=blum>0.5?'rgba(18,24,40,0.60)':" +
                        "'rgba(255,255,255,0.60)';" +
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
                        // ★ v1.33.38 性能（用户 m05233「操作和体验更丝滑」，续 1.33.37）：
                        //   把主循环里逐元素的 `e.offsetWidth/e.offsetHeight` **提前成一次批量读**。
                        //   实测（笔电 loopback、1237 候选元素）：offsetWidth+offsetHeight 走 WebView
                        //   绑定层单次约 0.19ms，1226 次合计 **235ms**，而 apply() 整轮只有 450ms
                        //   ⇒ 几何读占了一半以上；纯计算/写入/样式读都不是瓶颈
                        //   （把 setProperty 变空函数 452ms、把 getComputedStyle 换常量 431ms，几乎不变）。
                        //   对照组：同样 1237 个元素 `getBoundingClientRect()` 一趟只要 **139ms**（一次拿两值），
                        //   而且**四舍五入后与 offsetWidth/offsetHeight 逐位相同**——实测 1237 元素
                        //   dw=0 dh=0，`big` 判定 dclass=0（wh-equiv.mjs）。
                        //   ⚠ 但 rect 含 transform、offsetWidth 不含（这条 1.33.37 的注释里已记）；
                        //   本页实测无缩放型 transform，故统一用 rect（判据阈值一个字不改）。
                        //   getComputedStyle 一趟 1237 个只要 7ms，用它做闸门几乎零成本。
                        //   预读还顺带消除循环内「读-写-读」交错：所有几何都在任何写入之前取完。
                        //   ⚠ 陷阱：**别**在预读里加 `getComputedStyle(e).transform` 判是否有 transform
                        //   再决定用 rect 还是 offsetWidth——实测 gcs 取 transform 这一趟 1237 个要
                        //   **110~122ms**，而 rect 全量只要 **142ms**（v1.33.38 pre-variants.mjs：
                        //   plain 268 / rectonly 142 / mix 267 / gcs 单独 115），加了判据等于没省。
                        //   实测本页 transform 元素共 **11 个且全为 translate**（matrix 的 a、d 都是 1，
                        //   即无缩放；tf-scan.mjs），其中 8 个连 rect 与 offsetWidth 都逐位相同。
                        //   结论：直接全量 rect。
                        // ★ v1.33.38 第二批：**并集只量一次**。_cbn 的 cbSet 原来另起一趟
                        //   querySelectorAll(1131 个) + 逐个 rect（≈130ms/轮，惰性但每轮都要付）。
                        //   实测两个集合高度重叠：主循环 1237 个、cbSet 集合 1131 个，
                        //   **并集只有 1257 个**（set-overlap.mjs：nA=1237 nB=1131 nU=1257 onlyB=20）。
                        //   所以预读改成遍历并集、把 w/h 记在元素自己的 expando 上（注入里
                        //   __dshGlass / __cbOk / __abpGen 都是同样做法），两边各取所需。
                        //   判据**一个字不改**：cbSet 仍用原来的选择器与阈值，只是不再重复量。
                        "var gw=new Array(all.length),gh=new Array(all.length);" +
                        "var gu=document.querySelectorAll('div,main,section,header,aside,nav," +
                        "button,textarea,input,ul,li,article,pre,code,table');" +
                        "for(var gi=0;gi<gu.length;gi++){var g0=gu[gi];" +
                        "var gr0=g0.getBoundingClientRect();" +
                        "g0.__dshGW=Math.round(gr0.width);g0.__dshGH=Math.round(gr0.height);}" +
                        "for(var gj=0;gj<all.length;gj++){" +
                        "gw[gj]=all[gj].__dshGW;gh[gj]=all[gj].__dshGH;}" +
                        // ★ v1.33.37 性能（用户 m05233「操作和体验更丝滑」）：_cbn 原来对**每个**
                        //   候选元素各跑一次 `t.querySelectorAll(DSQ)` 再逐个 getBoundingClientRect，
                        //   是 apply() 里最贵的一段。实测（笔电 loopback、1237 节点 / 41 个 big）：
                        //   _cbn 合计 **1339~1547ms**，占单轮 apply() 的 90%+；CPU profile 里
                        //   getBoundingClientRect 独占 56.2%、apply 自身 26.6%、_cbn 3.3%。
                        //   等价改写：**一轮只量一次**「所有 DSQ 元素里够大的那些」（cbSet），
                        //   之后 _cbn(t) 就退化成数 cbSet 里 t 的后代个数。
                        //   逐位等价性已用真机实测（cbn-equiv2.mjs）：41 个 big 元素两版结果
                        //   **mismatch=0**（旧 1369ms → 新 3ms）。判据本身一个字没改，只是
                        //   把「同一批几何量」从 O(候选数 × 后代数) 降到 O(全部元素数)。
                        //   ⚠ MUST 用 getBoundingClientRect（与旧实现同一个度量），不要图快换
                        //   offsetWidth：带 transform 的盒子两者不等价（0.5px 舍入 + transform 缩放）。
                        //   再做**惰性化**：cbSet 只在第一次真的要算 _cbn 时才建（首屏/无 big 元素时
                        //   整段零成本）。代价一次 ~134ms，收益 1339ms。
                        "var cbSet=null;" +
                        "function _cbn(t){var n=0;" +
                        "if(!cbSet){cbSet=[];" +
                        // v1.33.38：几何已在上面并集预读里量过（挂在 __dshGW/__dshGH 上），
                        //   这里只挑，不再各量一次 rect。
                        "var cbAll=document.querySelectorAll(" +
                        "'div,section,main,aside,article,pre,code,table,ul');" +
                        "for(var cbi=0;cbi<cbAll.length;cbi++){" +
                        "var cbA=cbAll[cbi];" +
                        "if(cbA.__dshGW>vw*0.5&&cbA.__dshGH>vh*0.5)cbSet.push(cbA);}}" +
                        "for(var q=0;q<cbSet.length;q++){var x=cbSet[q];" +
                        "if(x!==t&&t.contains(x))n++;}return n;}" +
                        // v1.32.23 底部输入框卡片：MUST 在循环外一次性定位（放循环内 var 会被提到
                        //   _cbn 的函数作用域里，外层引用不到 ⇒ 整段注入 ReferenceError 当场全废，
                        //   实测症状：卡片实底 a=1、veil 不存在、侧栏 alpha=1、矩阵 collapsed 态 FAIL）。
                        //   为什么单独降它：它与整页 veil 各 0.45，逐层探针 effectiveOpaque 69.8%
                        //   （与用户真机截图沿卡片顶边 L 144->231 反推的 0.70 一致）⇒ 底部实底、立绘腿脚
                        //   被冲掉。降到 0.15 后 53.3%，与聊天区 45% 接近但仍留一点卡片轮廓。
                        //   判据 MUST NOT 依赖 hash 类名（每次构建都变），也 MUST NOT 依赖布局位置
                        //   （bottom>72%vh 实测冷启动那一轮卡片还没落位 ⇒ 判据 false ⇒ 停在 0.45，而布局
                        //   位移不是 DOM 变动，不会再触发第二轮）。这里从整页唯一的 contenteditable 往上走，
                        //   取第一个「宽>半屏、高在 8%~50% 视口」的祖先：36px 输入行被 8% 下限挡掉，
                        //   98px 卡片正好命中。多行输入把卡片顶过 50% 视口时 cbmEl=null，退回原语义。
                        "var cbmEl=null,cbmT=document.querySelector('[contenteditable=true]');" +
                        "if(cbmT){var cbmZ=cbmT.parentElement,cbmG=0;" +
                        "while(cbmZ&&cbmG<8){if(String(cbmZ.className||'').indexOf('_card')>=0)" +
                        "{cbmEl=cbmZ;break;}cbmZ=cbmZ.parentElement;cbmG++;}" +
                        "if(!cbmEl){cbmZ=cbmT.parentElement;cbmG=0;" +
                        "while(cbmZ&&cbmG<8){var cbmR=cbmZ.getBoundingClientRect();" +
                        "if(cbmR.width>vw*0.5&&cbmR.height>48&&cbmR.height<240)" +
                        "{cbmEl=cbmZ;break;}cbmZ=cbmZ.parentElement;cbmG++;}}}" +
                        "for(var i=0;i<all.length;i++){var e=all[i];" +
                        // v1.32.27 清残留（**循环体内**独立语句）：键盘态曾把输入行误当卡片写成 rgba(0,0,0,0.15)，
                        //   这里把它清回原生（放在循环开头，后续分支会重新决定要不要上色）。
                        "if(cbmT&&e!==cbmEl&&e.contains&&e.contains(cbmT)&&" +
                        "(e.__dshWhy==='bg45'||e.__dshWhy==='bg15')){" +
                        "e.style.removeProperty('background-color');e.__dshWhy='clr';}" +
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
                        // v1.33.38：改用循环前批量预读的几何（见上方 gw/gh 注释）。
                        "var w=gw[i],h=gh[i];" +
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
                        // ★ v1.32.25：**含聊天输入框的元素一律不是浮层**。真机实测：键盘弹起时 WebView 会
                        //   resize（视口降到 ~300 CSS 高），页面把 composer 改成 position:fixed + 高 z 贴到键盘上
                        //   —— 它下面有 +/权限/模型/发送 4 个可交互子项，正好命中上面那条几何臂 ⇒ 被判成浮层
                        //   ⇒ 要么加 .dshOv（盖上 0.60 遮罩），要么被 ovRole 分支放行而保留**原生不透明白**，
                        //   两种都让输入框变成一块实板（v90 把 seat 白纸拿掉后这层才露出来，用户 19:21/19:23 截图）。
                        //   判据用「包含输入框」而不是类名：键盘态下 React 可能把 composer 挪进新 wrapper/portal，
                        //   但无论套几层，**祖先里总有那个 contenteditable** ⇒ 一次覆盖全部祖先。
                        "cn.indexOf('Dc7zOa_root')<0&&" +
                        "!(cbmT&&e.contains&&e.contains(cbmT))){" +
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
                        // ★ v1.32.16 D2 同款**几何臂**：窄屏补丁认出的侧栏元素
                        //   （window.__bwSbEl）在 vm1 这类换了哈希命名的宿主上拿不到
                        //   _2H3hWW_root 这个类名，会被当成布局链写成 transparent，原生色相
                        //   随后再也拿不回来（侧栏一直全透）。这里用同一个对象引用做排除，
                        //   不引入任何类名。
                        //   ★ v1.32.17 D10 改了它的**来源**：__bwSbEl 现在由 bwFind() 的**纯几何
                        //   发现**每轮都写（与有没有钉成浮层、有没有撤销挤压无关）；收起成
                        //   56px 轨道时落在 96px 下限之外 ⇒ 发现不到 ⇒ 自动置 null，本臂随之
                        //   失效。笔电上类名命中，走的仍是原来那条，行为一行未变。
                        "var isSb=cn.indexOf('_2H3hWW_root')>=0||window.__bwSbEl===e;" +
                        // ★ v1.33.36 性能（用户 m04813「对话长时滑动卡顿」）：这段祖先链上溯
                        //   **原来对每个元素无条件跑**（最多 24 层、每层一次 getComputedStyle）。
                        //   实测一次 apply() 的 getComputedStyle 总量 36144 次里，**这一段独占
                        //   35138 次（97%）**——因为长对话有 4486 个节点、祖先链深度 ~10，
                        //   而每层 getComputedStyle 都会强制一次样式解析。它就是长任务的主因。
                        //   两个事实让它可以安全收窄：
                        //   · ancBigPos 的**唯一两个消费者**（isLayout / isPanel）都在 `big&&` 里，
                        //     非 big 元素根本不会读它 ⇒ 非 big 元素**完全不必算**。big 元素
                        //     （>50%x50% 视口）一屏只有个位数，成本直接降三个数量级。
                        //   · 同一次 apply 里同一祖先会被几十个后代重复上溯 ⇒ 按祖先节点做
                        //     **一轮内缓存**（__abpGen 记本轮代数，视口尺寸变了就换代）。
                        //   语义完全不变：算出来的布尔值与原实现逐位相同，只是不再重复算。
                        "var ancBigPos=false;" +
                        "if(big){var pa=e.parentElement,ph=0;" +
                        "while(pa&&ph<24&&pa!==document.body){" +
                        "if(pa.__abpGen===window.__abpGen){" +
                        "if(pa.__abpV){ancBigPos=true;break;}pa=pa.parentElement;ph++;continue;}" +
                        "var acs=getComputedStyle(pa);" +
                        "var hit=false;" +
                        "if(acs.position==='absolute'||acs.position==='fixed'){" +
                        "var ar=pa.getBoundingClientRect();" +
                        "if(ar.width>=vw*0.9&&ar.height>=vh*0.9)hit=true;}" +
                        "pa.__abpGen=window.__abpGen;pa.__abpV=hit?1:0;" +
                        "if(hit){ancBigPos=true;break;}" +
                        "pa=pa.parentElement;ph++;}}" +
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
                        // v1.32.23 输入框卡片专用放行：它不属于浮层/面板/内容块/布局链任何一类，一旦按上面
                        //   的 0.45 分支写过，a0 就永远 <1 ⇒ 被这道幂等闸门 continue 掉，之后怎么改 alpha 都
                        //   落不到它身上（实测：手动把内联改成哨兵色后 2.8s 无人重写，判据全过也不生效）。
                        //   放行只对 cbmEl 这一个元素生效，重写是同值幂等的，不会引起抖动。
                        "var isCbm=(e===cbmEl);" +
                        "if(!isOv&&!(big&&isPanel)&&!isCB&&!isLayout&&!isCbm&&a0<1)" +
                        "continue;" +
                        "var skipBg=(cn.indexOf('_2H3hWW_root')>=0&&" +
                        "cn.indexOf('_2H3hWW_collapsed')<0||window.__bwSbEl===e)&&" +
                        "vw<=1023;" +
                        //   ★ v1.32.16 D2 补一条**几何臂**：窄屏补丁认出的侧栏元素（window.__bwSbEl，
                        //   见上方 v1.32.5 那段）归 bwPanelBg 管，不得被本注入写成 transparent——
                        //   否则它的原生色相丢失，bwPanelBg 只能读到 rgba(0,0,0,0)（色相不可用 ⇒
                        //   不写，侧栏就一直全透）。
                        //   ★ v1.32.17 D10：__bwSbEl 的来源换成 bwFind() 的纯几何发现（贴左缘、
                        //   高 ≥60% 视口、宽 ∈[96px,90%vw]、可见、且所在列有「正文」兄弟列），
                        //   每轮都写、不再由 bwUndo 清空；收起成 56px 轨道时自动置 null，本臂
                        //   随状态消失，不需要任何类名。笔电上类名命中，走的仍是原来那条。
                        // ★ v1.32.11 复修（QA P1）：分支顺序反了。原先无条件先判
                        // `if(w>vw*0.5&&h>vh*0.5) -> transparent`，浮层分支排在它后面 ⇒
                        // 菜单一旦变高（实测 257x392，vw=360/vh=671 ⇒ 392>335.5）就落进大容器分支
                        // 被写成 transparent，`else if(isOv)` 永远轮不到 ⇒ 用户看到的就是
                        // "菜单还是全透、正文立绘照旧叠印"。我上轮只测到矮菜单（257x172，未过阈值）
                        // 才误以为已修好 —— 阈值上下两种几何都必须测。
                        // 修法：浮层判定提到大容器之前，两者**互斥**；且 role 命中的浮层
                        // （真菜单正是 role=listbox）**豁免全部几何判定**（含大容器分支），
                        // 因为面积阈值会把真实菜单判成"大容器"而废掉它。
                        // ★ v1.32.19（用户真机反馈「上传文件窗口背景没铺全」）：v1.32.11 把浮层判定提到
                        //   大容器之前时，几何豁免只给了 **role 命中**的浮层（当时假定「真菜单正是
                        //   role=listbox」）。实测 composer 的「+」菜单（_surface_ri079_1 Z9Jnlq_menu）
                        //   **role 属性为空**，只能走几何臂命中 isOv（absolute + z=100 + 8 个可交互子项，
                        //   逐条件实测全过），而它 265x343 = 73.6%vw x 51.1%vh 恰好越过 50% 阈值 ⇒
                        //   `ovRole||!(>50%)` 整体为假 ⇒ 浮层分支被跳过 ⇒ 落到大容器分支写
                        //   `transparent !important`（实测内联如此且 __dshGlass=1）。再手动触发变异让
                        //   apply() 重跑，底色仍是 transparent ⇒ 不是时机问题，是这条豁免漏了几何臂浮层。
                        //   修法：几何臂浮层同样豁免，但**只豁免非近全屏**（>90%x90% 除外）——近全屏定位
                        //   面板继续走 isPanel 的「取原生色相」（v1.32.12 文档预览面板红线；实测该面板
                        //   360x671=100%x100%，不受本改动影响）。壁纸通道是 static/relative，永远进不了
                        //   isOv ⇒ v1.32.6「壁纸整层消失」红线不受影响。
                        //   ⚠ 阈值上下两种几何都要测（v1.32.11 就是只测了矮菜单 257x172 才误判修好）：矮菜单
                        //   走 !(>50%) 那条臂，高菜单走这条新臂，两条都要模拟器截图为证。
                        // ★ v1.32.21（用户真机反馈「还是边沿色差、等几百 ms 才填充好」，并指出「本来就不会把
                        //   正文透上来」）：**浮层一律不再补底色**。色差与延迟两个毛病同源，都来自这次补色：
                        //   ① 补的底色与浮层自带的 0.5px 白发丝线不配套 ⇒ 读成「内沿一圈颜色不一样」；
                        //   ② 补色要等全量 apply() 一轮（真机更慢）⇒ 读成「等几百 ms 才填好」。
                        //   浮层自身那层在 DSH Web 里是干净的：正文会不会透上来取决于背后壁纸亮度，而用户
                        //   真机实测不读正文 ⇒ 补色是净负收益，撤掉。
                        //   分支本身**必须保留**：它把浮层从 isLayout/isPanel/isCB 三条通道里摘出去（互斥），
                        //   否则那三条会给菜单写 transparent 或原生色相，反而更糟。只留 __dshGlass=0 认领。
                        //   回滚点：v1.32.20（commit 18a768d）里有完整补色实现（alpha=1 + 去发丝线 + 快速通道）。
                        // ★ v1.32.22：分支保留（它把浮层从 isLayout/isPanel/isCB 三条通道摘出去，删了更糟），
                        //   分支体只补一层**深色遮罩**：原生底色本来就透明（实测 rgba(0,0,0,0)），透明页 + 壁纸
                        //   之下菜单自己挡不住背后正文（用户真机 14:24 截图：「深度求索中」「已压缩59条历史」整排透
                        //   上来）。原生那层只有约 18% 减光，挡壁纸够、挡字不够 ⇒ 补到 0.60。
                        //   原生底色若不透明（oa>=1）就**不动它**：那是 DSH Web 自己已经铺好的浮层，别盖。
                        //   发丝描边这次**保留**：0.60 的半透底与它是配套的（v1.32.20 的硬色差来自 alpha=1）。
                        "if(isOv&&(ovRole||!(w>vw*0.5&&h>vh*0.5)||!(w>vw*0.9&&h>vh*0.9))){" +
                        "var oa=(m[4]!==undefined?parseFloat(m[4]):1);" +
                        "e.__dshWhy='ov';" +
                        "if(oa<1)e.classList.add('dshOv');" +
                        "e.__dshGlass=0;}" +
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
                        // v1.32.23 输入框卡片单独降到 0.15：实测它与整页 veil 各 0.45，逐层探针算出 effectiveOpaque
                        //   69.8%（与用户真机截图沿卡片顶边 L 144->231 反推的 0.70 一致）——底部因此呈实底，
                        //   立绘的腿脚被冲掉。降到 0.15 后为 53.3%，与聊天区的 45% 接近但仍留一点卡片轮廓。
                        //   判据用 div[contenteditable=true]（实测整页唯一，261x36，bottom=587），不依赖每次构建
                        //   都会变的 hash 类名；聊天气泡不含它，不会被误降。h<vh*0.5 排除整页大容器。
                        // ★ v1.32.26：键盘态下**输入框的祖先**（输入行/卡片/root/seat…）一律不再走 0.45 通道：
                        //   实测真机键盘弹起后输入行被写成 rgba(灰,0.45) ⇒ 一条灰带（v91 只挡了浮层通道，挡不住这条）。
                        //   卡片自己（cbmEl）仍走 0.15，见下面那两行。
                        // ★ v1.33.45（用户 m10025「输入框有时候感觉颜色变深了」）：卡片原来 alpha 固定 0.15，
                        //   于是**卡片实际颜色完全由它背后是什么决定**——背后是浅色页面时接近 248，
                        //   背后滚到立绘的深蓝头发/裙子时掉到 226，肉眼看就是"输入框时不时变深一块"。
                        //   笔电实例实测（模拟器 1440x3168，卡片 321x98，5 个滚动位置取卡片下带亮度）：
                        //     0.15 + blur12            spread 21.9（226~248）
                        //     0.15 + blur20 bright1.20 spread  6.3
                        //     0.20 + blur20 bright1.25 spread  5.9  ← 采用
                        //   两个杠杆缺一不可：抬 alpha 让白底占比变大，backdrop-filter 里加 brightness(>1)
                        //   把透上来的暗背景整体提亮（只加 blur 没用，实测 12/28/44px 三档 spread 都是 ~16）。
                        //   目标不是"更白"，而是**让卡片恒定落在它最亮时的样子**，从而不再随滚动忽深忽浅。
                        //   __dshWhy 仍记 'bg15'（下游清理逻辑按这个标记认卡片，改名会漏清）。
                        "else if(!skipBg&&!(cbmT&&e!==cbmEl&&e.contains&&e.contains(cbmT))){e.__dshGlass=0;" +
                        "var ga=0.45;" +
                        "if(isCbm){ga=0.20;e.__dshWhy='bg15';}" +
                        "e.style.setProperty('background-color','rgba('+" +
                        "m[1]+','+m[2]+','+m[3]+','+ga+')','important');" +
                        "if(e.__dshWhy!=='bg15')e.__dshWhy='bg45';" +
                        "if(isCbm){" +
                        "e.style.setProperty('backdrop-filter'," +
                        "'blur(20px) brightness(1.25)','important');" +
                        "e.style.setProperty('-webkit-backdrop-filter'," +
                        "'blur(20px) brightness(1.25)','important');}" +
                        "else if(w>vw*0.08&&h>vh*0.03&&" +
                        "!(/BynINW_(sidebarCol|frame)/.test(cn))){" +
                        "e.style.setProperty('backdrop-filter','blur(12px)'," +
                        "'important');e.style.setProperty('-webkit-backdrop-" +
                        "filter','blur(12px)','important');}}}" +
                        // ★ v1.32.27 清残留：cbmEl 原来用 vh*0.08 这个**随视口变化**的阈值分辨卡片/输入行 ——
                        //   真机键盘弹起 vh 690→363 时阈值 55px→29px，36px 的输入行先被当成卡片 ⇒ 被写成
                        //   rgba(0,0,0,0.15)（它原生是黑色）＝用户看到的那条灰带（v92 HUD 实拍：row why=bg15）。
                        //   现在卡片改走 _card 类名锚点、几何兜底改绝对像素阈值；输入行的祖先不再上色，
                        //   但**同一会话里已经被写上去的那层要主动清掉**，否则要等页面重载才恢复。
                        //   清残留放在**循环体内开头**（见 for 之后那三行）：不能写成 else if ——
                        //   0.45 分支后面的第三个 } 是 for 的花括号，else if 挂在那里就是「没有 if 的 else」
                        //   ⇒ 整段注入 SyntaxError 全废（矩阵会报「侧栏 alpha 1」，本轮第一版就这么死的）。
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
                        // ★ v1.33.37：复核用的是**两帧后**的几何，必须丢掉本轮快照重新量
                        //   （cbSet 在 apply() 闭包里，这里直接置 null 即可让它惰性重建）。
                        "cbSet=null;" +
                        "var ch=false;for(var c=0;c<cand.length;c++){" +
                        "var t2=cand[c];if(t2.isConnected&&_cbn(t2)<=2)" +
                        "{t2.__cbOk=1;ch=true;if(t2.__qaRec)" +
                        "t2.__qaRec.cbOk=true;}}if(ch)apply();" +
                        "});});}" +
                        "var v=document.getElementById('dsh-theme-veil');" +
                        "if(!v){v=document.createElement('div');v.id='dsh-theme-veil';" +
                        "document.body.appendChild(v);}" +
                        "var mm=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/.exec(" +
                        "getComputedStyle(document.body).color)||[];" +
                        "var lum=mm[1]?(0.299*mm[1]+0.587*mm[2]+0.114*mm[3])/255:0;" +
                        "v.style.cssText='position:fixed;inset:0;z-index:-1;" +
                        "pointer-events:none;background:'+(lum>0.5?" +
                        "'rgba(18,24,40,0.45)':'rgba(255,255,255,0.45)');}" +
                        // ★ v1.32.22 浮层遮罩改成**打标记 + CSS**，不在 JS 里写色：
                        //   实测菜单插入时 addedNodes 里同时有外层定位壳(absolute z=100)与真正的
                        //   _surface_…_menu，两者都会被判成浮层；各写一层 0.60 会叠成 0.84（比实测
                        //   最好的 0.60 深一大截）。`:has()` 让 CSS 自己只给**最内层**上色，外层壳
                        //   一旦有了带标记的后代就自动退让——快速通道先给壳上色、全量轮再收敛到内层，
                        //   颜色始终一致，过渡也看不出来。深浅色交给 media，JS 不必再算亮度。
                        // ★ v1.32.24 底部「实底」的真因**不在卡片**：页面自己的 composerSeat 带一条
                        //   linear-gradient(color(srgb 0 0 0 / 0) 0px, rgb(255,255,255) 36px)——36px 之后
                        //   就是**纯白不透明**，把输入框那一片整个盖成白纸。模拟器逐点实测（强制重绘后）：
                        //   卡片内联底色 0.15 与 0.45 在底部 72540 个采样点里 **0 个不同**（白盖白＝看不见，
                        //   所以 v1.32.23 调的 alpha 在真机上毫无效果）；把这条渐变置 none 后**31787 个点变化**，
                        //   底部均值 L 244.0→232.3、细节透出比 0.729→0.791。用户真机同指纹：越靠下越白
                        //   （透出比 0.334→0.257→0.179）。⇒ 用**样式表**干掉它，比逐个写内联稳：
                        //   React 换节点/重渲染后依然生效，也不必再给它挂 observer。
                        "var os=document.getElementById('dsh-ov-style');" +
                        "if(!os){os=document.createElement('style');os.id='dsh-ov-style';" +
                        "document.head.appendChild(os);" +
                        "os.textContent='.dshOv:not(.dshOv .dshOv){background-color:rgba(18,24,40,0.60)!important}@media (prefers-color-scheme:light){.dshOv:not(.dshOv .dshOv){background-color:rgba(255,255,255,0.60)!important}}[class*=composerSeat]{background-image:none!important}';}" +
                        "apply();setTimeout(apply,1500);setTimeout(apply,4000);" +
// ★ v1.32.22 快速通道：遮罩要**当帧**上，否则又变成用户抱怨过的「等几百 ms 才填充好」。
//   页内 rAF 实测（v1.32.20）：全量 apply() 一轮本身要 ~780ms，防抖跳不跳都救不了，必须在
//   观察器回调里**同步**补。判据两选一：可交互子项数（与主循环同源）**或**类名线索——菜单
//   刚插入时子项还是 0 个（实测条目 t=442ms 才落地），而类名在插入瞬间就已就位。
//   hasOv 的尺寸闸必须与 fastOv **完全一致**，否则 BFS 先返回 265x0 的外层定位壳、整轮空转。
                        "function hasOv(n){" +
                        "if(n.nodeType!==1)return null;var q=[n],i,c;" +
                        "for(i=0;i<q.length&&i<120;i++){c=q[i];" +
                        "var st=getComputedStyle(c);var z=parseInt(st.zIndex,10);" +
                        "if((st.position==='fixed'||st.position==='absolute')" +
                        "&&z>=10&&c.offsetWidth>100&&c.offsetHeight>80)return c;" +
                        "if(i<40)for(var k=0;k<c.children.length;k++)" +
                        "q.push(c.children[k]);}return null;}" +
                        "function fastOv(e){" +
                        // v1.32.25 同一道闸：快速通道只处理**新增**节点，键盘态下 composer 常被 React 重新挂进
                        //   新的 fixed wrapper（addedNodes 里就是它）⇒ 这里也要把「含输入框」的整棵子树排掉，
                        //   否则快速通道会当帧把 .dshOv 打上去（比全量轮更快，用户一眼就看到灰板）。
                        "if(e.querySelector&&e.querySelector('[contenteditable=true]'))return;" +
                        //   再加一条按名字的保险：wrapper 可能是「先插入、后把 composer 搬进来」（插入那一刻查不到
                        //   输入框），但它的类名/ID 一定带 composerSeat/composerStack（hash 前缀不算数）。
                        "if(/composerSeat|composerStack/.test(String(e.className)+String(e.id)))return;" +
                        "if(!e.isConnected)return;" +
                        "var r=e.getBoundingClientRect();" +
                        "if(!(r.width>100&&r.height>80))return;" +
                        "if(r.width>innerWidth*0.9&&r.height>innerHeight*0.9)return;" +
                        "var ic=e.querySelectorAll('button,a,li,[role=menuitem]," +
                        "[role=option],[tabindex]').length;" +
                        "var cn=(String(e.className)+' '+String(e.id)).toLowerCase();" +
                        "if(ic<3&&!/menu|surface|overlay|dialog|popover|dropdown|" +
                        "popup|sheet|listbox/.test(cn))return;" +
                        // 壁纸唯一通道与侧栏**必须跳过**（与主循环同一道类名闸）：侧栏是我们自己改成
                        // position:fixed + z-index:60 的，尺寸与子项数全都过闸，不排就会被盖成实底
                        // （实测 geom-matrix 报「侧栏 alpha 1 不在 [0.4,0.5]」就是这个）。
                        "if(/byninw_|2h3hww_root|dc7zoa_root|dsh-theme-veil|dsh-diag/.test(cn))return;" +
                        // 原生底色已不透明就别盖（那是 DSH Web 自己铺好的浮层）。
                        "var mm=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/.exec(" +
                        "getComputedStyle(e).backgroundColor)||[];" +
                        "if(mm.length&&mm[4]!==undefined&&parseFloat(mm[4])>=1)return;" +
                        "if(mm.length&&mm[4]===undefined)return;" +
                        // 只打标记，颜色由 #dsh-ov-style 决定：当帧就能上到外层壳，全量轮再收敛到内层。
                        "e.classList.add('dshOv');e.__dshGlass=0;}" +
                        "var t=null;new MutationObserver(function(ms){" +
                        "var hit=null;" +
                        "for(var i=0;i<ms.length&&!hit;i++){" +
                        "var an=ms[i].addedNodes;" +
                        "for(var k=0;k<an.length;k++){" +
                        "hit=hasOv(an[k]);if(hit)break;}}" +
                        "if(hit){fastOv(hit);[150,400].forEach(function(d){" +
                        "setTimeout(function(){fastOv(hit);},d);});}" +
                        "clearTimeout(t);t=setTimeout(apply,hit?0:400);" +
                        "}).observe(document.body," +
                        "{childList:true,subtree:true});" +
                        // v1.32.23 自愈补跑：apply() 只被 DOM 变动驱动，而「编辑器晚挂 / 布局位移」都不一定
                        //   带来能触发第二轮的变动（实测冷启动卡片因此停在 0.45）。这里在 700ms / 2500ms 各补一轮（守卫极便宜，见下），但先用
                        //   一个只读 [style] 的廉价守卫判断 0.15 是否已落地——已落地就不跑那 ~780ms 的全量轮。
                        //   守卫只认「有没有元素的内联底色含 ,0.15)」，本页只有输入框卡片会被写成 0.15。
                        "function cbmDone(){var dd=document.querySelectorAll('[style]');" +
                        "for(var xi=0;xi<dd.length;xi++){" +
                        "var bv=dd[xi].style.getPropertyValue('background-color')||'';" +
                        "if(bv.indexOf(',0.15)')>=0)return true;}" +
                        "return false;}" +
                        "setTimeout(function(){if(!cbmDone())apply();},700);" +
                        // ★ v1.32.28 诊断 HUD 改为**可选**（默认关；主界面「调试浮层」按钮切换）：
                        //   键盘态这类问题模拟器常复现不了（模拟器软键盘盖在页面上、不 resize），
                        //   打开后页面自己把「谁在画 / 走哪个分支 / 有没有被 .dshOv 标记 / 视口多高」
                        //   打在左上角，用户截图即可定位。所有分支都写了 __dshWhy：
                        //   ov=浮层通道、bg15=卡片 0.15、bg45=0.45 通道、其余分支未标记。
                        //   开关值在注入时烘进字符串（随页面加载定态）；主界面切完回到本页由 onResume
                        //   里的 __dshDiagSet 热改，不必重开页面。
                        "var dshDiagOn=" + DiagPrefs.on(this@WebActivity) + ";" +
                        "window.__dshDiagSet=function(v){dshDiagOn=!!v;dshDiag();};" +
                        "function dshDiag(){try{" +
                        "var H=document.getElementById('dsh-diag');" +
                        "if(!dshDiagOn){if(H&&H.parentNode)H.parentNode.removeChild(H);return;}" +
                        "if(!H){H=document.createElement('div');H.id='dsh-diag';" +
                        "H.style.cssText='position:fixed;left:6px;top:6px;z-index:2147483000;" +
                        "background:rgba(0,0,0,0.78);color:#fff;font:11px/1.4 monospace;padding:6px 8px;" +
                        "border-radius:6px;max-width:332px;white-space:pre;pointer-events:none';" +
                        "if(document.body)document.body.appendChild(H);}" +
                        "if(!H.parentNode)return;var o=[];" +
                        "o.push('vh='+innerHeight+' vv='+(window.visualViewport?Math.round(visualViewport.height):'-')+' vw='+innerWidth);" +
                        "o.push(window.__bwDbg||'bw:-');" +
                        "function bgg(x){return x?getComputedStyle(x).backgroundColor:'-';}" +
                        "function nm(x){return x?String(x.className).slice(0,20):'-';}" +
                        "var ov=document.querySelectorAll('.dshOv');" +
                        "o.push('dshOv='+ov.length+':'+Array.prototype.map.call(ov,function(z){" +
                        "return String(z.className).replace('dshOv','').slice(0,12);}).join('|').slice(0,48));" +
                        "var ce=document.querySelector('[contenteditable=true]');" +
                        "if(ce){var card=ce.closest('[class*=_card]');" +
                        "o.push('card '+bgg(card)+' why='+(card?card.__dshWhy:'-')+' m='+(card?card.classList.contains('dshOv'):'-'));" +
                        "var row=ce.parentElement;" +
                        "o.push('row  '+bgg(row)+' why='+(row?row.__dshWhy:'-')+' '+nm(row));" +
                        "o.push('inp  '+bgg(ce)+' why='+(ce.__dshWhy||'-'));" +
                        "var z=ce.parentElement,g=0;while(z&&g<4){o.push('a'+g+' '+bgg(z)+' why='+(z.__dshWhy||'-')+' '+nm(z));z=z.parentElement;g++;}}" +
                        "H.textContent=o.join(String.fromCharCode(10));" +
                        "}catch(e2){}}" +
                        "dshDiag();setInterval(dshDiag,1000);})();", null)
                }
            }
            // 上传与下载（v1.19.0）：
            // WebChromeClient——<input type=file> 弹系统文件选择器，顺带恢复 JS alert/confirm
            webChromeClient = object : WebChromeClient() {
                // 调试浮层开着时把网页 console 引到 logcat（tag dshweb），关掉就完全静默
                override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                    if (DiagPrefs.on(this@WebActivity))
                        android.util.Log.d("dshweb", (m.sourceId()?.substringAfterLast('/') ?: "") + " " + m.lineNumber() + " " + m.message())
                    return true
                }
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

        val url0 = intent?.getStringExtra("url") ?: ""
        if (url0.isEmpty()) { finish(); return }
        // ★ v1.33.39（用户 m06190）：重新进入时回到「用户最后手动进入的对话」。
        //   旧行为：进程被系统回收后由任务快照重建（savedInstanceState != null），
        //   onCreate 拿到的还是**当初那条推送通知**的 intent ⇒ 总是弹回推送的会话，
        //   把用户后来自己切过去的那个对话丢掉。
        //   判据只用 savedInstanceState：!= null ⇒ 这是「回来」，用存盘的会话重写片段；
        //   == null ⇒ 新点一次通知（进程已死也是新任务栈）⇒ 必须尊重 intent，仍进推送会话。
        //   活着时点通知走 onNewIntent，不经过这里，也不受影响。
        //   重写方式沿用 host-plugin 既有的 `#session-<uuid>` 协议（client.js revealFromHash
        //   认这个形态，切完自己 replaceState 抹掉），所以不需要新增页面侧钩子。
        // ★ v1.33.40（用户 m06924）：「进入哪台 DSH」选择器也要落到该设备上次的对话。
        //   它与「看这条消息」的区别靠 intent extra revive=true 传递。注意 hosts 里存的
        //   URL **本来就带 #session-<uuid>**（推送时 host-plugin 的 webUrl(sessionId) 拼的，
        //   那是「最后一次推送」的会话，不是「最后一次停留」的），所以 revive 时不能因为
        //   「已有片段」就跳过，必须整段改写——restoreSessUrl 保证只换 fragment。
        //   消息卡片的链接（MainActivity 的另外两处 openWebUrl）不传 revive，精确落点不受影响。
        val revive = intent?.getBooleanExtra("revive", false) == true
        val wantRestore = savedInstanceState != null || revive
        val url = if (wantRestore) restoreSessUrl(url0) else url0
        // ★ v1.33.41（用户 m07251）：把「本次应该落到的会话」记下来，供 saveSess 的写盘
        //   窗口闸与 onPageFinished 的落地复核使用（见 restoreTarget 定义处）。
        //   ⚠ 只在「确实要恢复」时设：点推送进来看的是那条消息的会话，用户随后马上切走
        //   必须立刻能存盘，不能被闸门误拦。
        restoreTarget = if (wantRestore) sessOfUrl(url) else ""
        restoreAt = System.currentTimeMillis()
        restoreSkip = 0
        applyInstanceLabel(url)
        lastUrl = url
        web?.loadUrl(url)
    }

    /** 从 URL 片段里取出会话 id（v1.33.41）。没有片段/形态不合法返回空串。 */
    private fun sessOfUrl(url: String): String {
        val raw = url.substringAfter('#', "").trim()
        if (raw.isEmpty()) return ""
        return if (Regex("^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE).matches(raw)) raw else ""
    }

    /** ★ v1.33.41（用户 m07251）：落地复核与兜底补切。
     *  场景：本次进入本应落到 restoreTarget，但页面自己先渲染出别的会话（服务器默认会话 /
     *  上一次推送的会话），且 host-plugin 的 revealFromHash 因片段被抹掉/侧栏判定失败而没切过去。
     *  做法：两拍（2.5s、7s）读 DOM 的 data-conversation-session；还不是目标就 `location.hash`
     *  补一次——revealFromHash 挂了 hashchange 监听，片段一变就重新切（切完它自己 replaceState）。
     *  只在本 Activity 明确要恢复时才动手，正常打开/推送落点完全不受影响。 */
    private fun recheckRestoreTarget() {
        val want = restoreTarget
        if (want.isEmpty()) return
        val js = "(function(){var e=document.querySelector('[data-conversation-session]');" +
            "var v=e?String(e.getAttribute('data-conversation-session')||''):'';" +
            "if(v==='" + want + "'){return 'ok';}" +
            "try{location.hash='" + want + "';}catch(e1){}" +
            "return v||'none';})()"
        for (delay in longArrayOf(2500L, 7000L)) {
            ui.postDelayed({
                try {
                    web?.evaluateJavascript(js) { r ->
                        android.util.Log.d("dshsess", "recheck want=$want got=$r")
                    }
                } catch (e: Exception) {
                }
            }, delay)
        }
    }

    /** 把「上次停留的会话」拼回 URL 片段（v1.33.39，用户 m06190）。
     *  只换/加 fragment，绝不动 path 与 query（DSH Web 的 token 在路径里）。
     *  取不到存盘值或形态不合法就原样返回——退化为旧行为，不会打不开页面。 */
    private fun restoreSessUrl(url: String): String {
        return try {
            val host = DshHosts.hostOf(url)
            val sid = DshHosts.lastSess(this, host)
            if (sid.isEmpty() || !Regex("^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE).matches(sid))
                return url
            val base = url.substringBefore('#')
            android.util.Log.d("dshsess", "restore host=$host sess=$sid")
            // 已有片段就整段替换（DSH 页面常态是无片段，这里只是兜底）
            base + "#" + sid
        } catch (e: Exception) {
            url
        }
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
        var u = intent?.getStringExtra("url") ?: ""
        if (u.isNotEmpty()) {
            // ★ v1.33.40（用户 m06924）：窗口已活着时从「进入哪台 DSH」切到另一台，
            //   同样要落到那台设备上次停留的对话。hosts 里的 URL 自带 #session- 片段，
            //   所以 revive 时无条件改写（restoreSessUrl 只换 fragment）；
            //   消息卡片那两处调用不传 revive，精确落点一律不动。
            val revive = intent?.getBooleanExtra("revive", false) == true
            if (revive) u = restoreSessUrl(u)
            // ★ v1.33.41（用户 m07251）：只有 revive（=从实例选择器进来）才设落地目标，
            //   窗口复用这条路同样要过写盘闸与落地复核。点消息卡片的精确落点不设闸。
            restoreTarget = if (revive) sessOfUrl(u) else ""
            restoreAt = System.currentTimeMillis()
            restoreSkip = 0
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
        // 调试浮层开关（v1.32.28）：主界面「调试浮层」按钮切完回到本页即时生效，不必重开页面。
        // 老注入里没有 __dshDiagSet 时整个表达式是空操作。
        web?.evaluateJavascript(
            "window.__dshDiagSet&&window.__dshDiagSet(" + DiagPrefs.on(this) + ")", null)
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
