package xyz.cpyh.dshpush

import android.Manifest
import android.animation.ObjectAnimator
import android.app.Activity
import android.app.AlertDialog
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : Activity() {
    private lateinit var statusText: TextView
    private lateinit var markAllBtn: Button
    private lateinit var msgList: LinearLayout
    private lateinit var emptyBox: LinearLayout
    private lateinit var tokenCard: LinearLayout
    private lateinit var tokenInput: EditText
    private lateinit var tokenState: TextView
    // v1.33.35：用户手动打开的卡片不被 refresh() 的「有证即隐藏」关掉（推送到达会触发 refresh）
    private var tokenCardPinned = false
    // v1.34.2：设备清单弹窗（点头像唤起，只列未吊销的）
    private var devicesDialog: AlertDialog? = null
    // v1.34.3：从清单里点「加一台」去扫码的，回来自动把清单再开一次（用户：扫完还得自己
    // 再点头像，看着像「没加上」）
    private var reopenDevicesAfterScan = false
    private lateinit var headerPet: ImageView
    private var starsView: View? = null
    private var breathX: ObjectAnimator? = null
    private var breathY: ObjectAnimator? = null
    private var twinkle: ObjectAnimator? = null

    private var lastMaxTs = -1L

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun c(attr: Int): Int {
        val tv = TypedValue()
        theme.resolveAttribute(attr, tv, true)
        return if (tv.resourceId != 0) resources.getColor(tv.resourceId, theme) else tv.data
    }
    private fun prefs() = getSharedPreferences(PushService.PREF, MODE_PRIVATE)
    // v1.34.0：有设备清单也算「已配置」——多设备后凭据的权威来源是清单，老偏好只是兼容旧版本
    private fun hasToken() =
        Devices.subs(this).isNotEmpty() ||
            !prefs().getString(PushService.KEY_TOKEN, "").isNullOrEmpty()

    /**
     * 是不是「从桌面点图标进来」这种最朴素的启动意图：ACTION_MAIN + CATEGORY_LAUNCHER，且不带任何
     * extra。通知、常驻通知动作、深链都会带 extra 或压根没有 action（显式组件意图），不会误判。
     */
    private fun isBareLauncherIntent(i: Intent?): Boolean {
        if (i == null || i.action != Intent.ACTION_MAIN) return false
        if (!i.hasCategory(Intent.CATEGORY_LAUNCHER)) return false
        val b = i.extras
        return b == null || b.isEmpty
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // 主题必须在 super.onCreate 前就位；不能放 attachBaseContext——
        // Android 16 上 Activity.setTheme 走 getWindow().setTheme，那时 window 还没创建（v1.7.0 闪退根因）
        setTheme(ThemePrefs.themeRes(this))
        super.onCreate(savedInstanceState)

        // 「桌面点图标回到上次的现场」（v1.32.35）。实测机制（dumpsys activity activities）：
        // MainActivity 从 singleTask 改成默认 standard 之后，桌面图标启动会把一个**新的** MainActivity
        // 叠在任务栈上（#0 Main → #1 Web → #2 Main 新），于是用户从 DSH 网页被带回主页——网页其实
        // 还在下面没被销毁。所以这里识别「光秃秃的启动器意图」并且自己不是任务根时直接 finish()，
        // 让下面那个 Activity 露出来 = 回到上次的现场。必须放在 setContentView 之前，否则会先画出
        // 主页再消失。通知/服务路径不受影响：它们是显式组件意图（action 为空）且自带
        // CLEAR_TOP|SINGLE_TOP，走的是复用根实例那条路（那时 isTaskRoot 为真，不会 finish）。
        if (savedInstanceState == null && !isTaskRoot && isBareLauncherIntent(intent)) {
            finish()
            return
        }

        val root = FrameLayout(this)

        // 壁纸：随主题场景（v1.23.1 起立绘独立叠加层——layer-list item 定尺在 nodpi 位图+
        // CENTER_CROP 下不可靠，实测立绘恒按源图像素渲染，屏高不同占比就不同）
        val wp = TypedValue()
        theme.resolveAttribute(R.attr.dshWallpaper, wp, true)
        root.addView(ImageView(this).apply {
            setImageResource(if (wp.resourceId != 0) wp.resourceId else R.drawable.bg_whale)
            scaleType = ImageView.ScaleType.CENTER_CROP
        }, FrameLayout.LayoutParams(-1, -1))
        // 立绘构图自适应：高度恒取屏高 52%——脸落在消息卡片下缘可见空带、主体偏右下合三分法、
        // 脚部完整；左右交替构图避免与中央宠物区打架（真机 vs 模拟器构图对比，真机为基准）
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
        root.addView(View(this).apply { setBackgroundColor(c(R.attr.dshScrim)) },
            FrameLayout.LayoutParams(-1, -1))
        // 深夜/星空主题：星点独立图层，界面可见时缓慢闪烁（v1.8.0，v1.10.0 扩到 starry）
        starsView = if (ThemePrefs.KEYS[ThemePrefs.current(this)] in setOf("night", "starry"))
            ImageView(this).apply { setImageResource(R.drawable.bg_stars) }.also {
                root.addView(it, FrameLayout.LayoutParams(-1, -1))
            } else null

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(28), dp(18), dp(12))
        }

        // 顶栏：小头像 + 标题 + 副题（v1.33.35 起：点头像开/关凭证卡片，长按=打开替换不清空）
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        headerPet = ImageView(this).apply {
            setImageResource(R.drawable.pet_idle)
            // v1.33.35：点头像开/关凭证卡片，长按=打开卡片换新证（**不再直接清空**——
            // 用户「长按头像直接提示清空了凭证必须重新输入。应该不清空吧…可以进去替换」）。
            // 清空改为卡片内显式按钮 + 确认框。
            // v1.34.2：用户「已连接设备的框能只在点开头像时显示吗…下次可以点头像再次扫码进行」
            // ⇒ 点一下弹设备清单（含「加一台」「换通行证」），长按仍直接开凭证卡片。
            setOnClickListener { showDevices() }
            setOnLongClickListener { openTokenCard(); true }
        }
        header.addView(headerPet, LinearLayout.LayoutParams(dp(46), dp(46)))
        header.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), 0, 0, 0)
            addView(TextView(context).apply {
                text = getString(R.string.app_name)
                textSize = 21f
                setTextColor(c(R.attr.dshTextPrimary))
                setTypeface(android.graphics.Typeface.DEFAULT_BOLD)
            })
            addView(TextView(context).apply {
                text = getString(R.string.subtitle)
                textSize = 12f
                setTextColor(c(R.attr.dshTextSecondary))
                setPadding(0, dp(2), 0, 0)
            })
        }, LinearLayout.LayoutParams(0, -2, 1f))
        // 多 DSH 常驻入口（v1.29.0）：自己挑进哪台；卡片按钮仍指向各自推送来源
        header.addView(pill(Button(this)).apply {
            text = getString(R.string.hosts_btn)
            setOnClickListener { showHosts() }
        }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) })
        // 设置入口（v1.32.29）：主页只留常用操作，其余（换主题 / 后台服务 / 电池白名单 /
        // 保活体检 / 调试浮层）收进这个菜单——用户「主页的按钮太多了，能只保留常用的吗，
        // 其他的可以做个设置菜单放里面」。换主题原先这颗胶囊就搬进菜单第 4 项。
        header.addView(pill(Button(this)).apply {
            text = "设置"
            setOnClickListener { showSettings() }
        }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) })
        content.addView(header)

        // 状态卡片（全局网页胶囊已于 v1.9.5 退役：入口收敛到常驻通知与卡片自带按钮）
        // v1.32.33：两颗胶囊改成**竖排文字**贴在正文右侧——用户「现在的按钮是里面文字是水平
        // 布局的，能否改为垂直布局，如我图中红色位置这样的布局。以此来把上面那行的空间也节省
        // 出来」。竖排用字符间插 \n 实现（无需自定义 View）；正文因此独占整高，不再需要首行。
        // 配套把几行正文改短，否则窄列会让长行折行、把省下的空间又吃回去（实测见 HANDOVER）。
        statusText = TextView(this).apply { textSize = 13f; setTextColor(c(R.attr.dshTextPrimary)) }
        markAllBtn = pill(Button(this)).apply {
            text = "全\n部\n已\n读"
            visibility = View.GONE
            setOnClickListener {
                val n = PushService.markAllRead(this@MainActivity)
                toast("已全部标为已读（$n 条）")
                // 列表与按钮可见性的刷新交给 markAllRead 里的 listener 回调，不自己再调
            }
        }
        // 清空消息记录（v1.9.9）：只清列表与空状态，通知栏已弹的通知不动
        val clearBtn = pill(Button(this)).apply {
            text = "清\n空\n消\n息"
            setOnClickListener { confirmClearMsgs() }
        }
        // 竖排胶囊必须**同时硬定宽高**：Button 样式自带 minHeight=48dp 与 minWidth=88dp，
        // 光靠 setMinimumHeight/Width 压不住（v1.32.33 装机实测胶囊 352px 宽、正文列只剩
        // 416px，每行都折行，反而比上一版高 201px）。这里给确切宽度 28dp（12sp 一个字 + 内边距）。
        for (p in arrayOf(markAllBtn, clearBtn)) {
            p.setPadding(dp(2), dp(2), dp(2), dp(2))
            p.setLineSpacing(0f, 0.92f)   // 只有 setter 方法，没有 lineSpacingMultiplier 可写属性（v1.32.34 编译报错）
        }
        val pillW = dp(28)
        val pillCol = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(markAllBtn, LinearLayout.LayoutParams(pillW, -2))
            addView(clearBtn, LinearLayout.LayoutParams(pillW, -2).apply { leftMargin = dp(6) })
        }
        val statusBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(statusText, LinearLayout.LayoutParams(0, -2, 1f))
            addView(pillCol, LinearLayout.LayoutParams(-2, -2).apply {
                leftMargin = dp(10)
                gravity = Gravity.CENTER_VERTICAL   // 竖排胶囊垂直居中贴着正文
            })
        }
        content.addView(card(statusBar, dp(14)))

        // 通行证卡片：首次启动（或换令牌时）出现，保存后隐藏
        tokenInput = EditText(this).apply {
            hint = getString(R.string.token_hint)
            textSize = 14f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            setTextColor(c(R.attr.dshTextPrimary))
            setSingleLine(true)
        }
        val tokenBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(TextView(context).apply {
                text = getString(R.string.token_title)
                textSize = 15f
                setTextColor(c(R.attr.dshTextPrimary))
                setTypeface(android.graphics.Typeface.DEFAULT_BOLD)
            })
            // v1.33.35：打开卡片先看当前凭证状态，替换还是清空一目了然
            tokenState = TextView(context).apply {
                textSize = 12f
                setTextColor(c(R.attr.dshTextSecondary))
                setPadding(0, dp(4), 0, 0)
            }
            addView(tokenState, LinearLayout.LayoutParams(-1, -2))
            addView(tokenInput, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, dp(10), 0, 0)
                addView(pill(Button(context)).apply {
                    text = getString(R.string.token_save)
                    setOnClickListener { saveToken() }
                })
                addView(pill(Button(context)).apply {
                    text = "扫码配对"
                    setOnClickListener { startScan() }
                    layoutParams = LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) }
                })
                addView(pill(Button(context)).apply {
                    text = "清空凭证"
                    setOnClickListener { confirmClearToken() }
                    layoutParams = LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) }
                })
            }, LinearLayout.LayoutParams(-2, -2))
        }
        tokenCard = card(tokenBox, dp(14))
        tokenCard.visibility = if (hasToken()) View.GONE else View.VISIBLE
        content.addView(tokenCard)

        // v1.34.2：设备清单不再常驻首页（用户「已连接设备的框能只在点开头像时显示吗」），
        // 改成点头像弹出 showDevices()。这里不留任何占位控件。

        msgList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        // 空状态：睡觉鲸鱼娘 + 鱼片文案
        emptyBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, dp(36), 0, dp(24))
            addView(ImageView(context).apply {
                setImageResource(R.drawable.pet_sleeping)
            }, LinearLayout.LayoutParams(dp(150), dp(150)))
            addView(TextView(context).apply {
                text = getString(R.string.empty)
                textSize = 14f
                setTextColor(c(R.attr.dshTextSecondary))
                setPadding(0, dp(10), 0, 0)
            })
        }

        val scroll = ScrollView(this).apply {
            isVerticalScrollBarEnabled = false
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                addView(msgList)
                addView(emptyBox)
            })
        }
        content.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))

        // 底部操作行已于 v1.32.30 退役：「清空消息」进状态卡片右侧，「调试浮层」进「设置」
        // 菜单——用户「把清空消息放在主页的状态框内的右侧，调试浮层也放设置里面」。

        // 底部署名
        content.addView(TextView(this).apply {
            text = getString(R.string.attribution)
            textSize = 10f
            setTextColor(c(R.attr.dshTextSecondary))
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(4))
        })

        root.addView(content, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        // 进入/换主题转场：550ms 淡入+轻微放大，看得见但不拖沓（v1.8.1）
        root.alpha = 0f
        root.scaleX = 0.96f; root.scaleY = 0.96f
        root.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(550)
            .setInterpolator(AccelerateDecelerateInterpolator()).start()

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        startForegroundService(Intent(this, PushService::class.java))
        // 常驻通知「DSH 入口」动作进来的（v1.29.0）：布局完再弹选择器
        if (intent?.getBooleanExtra(PushService.EXTRA_SHOW_HOSTS, false) == true) {
            root.post { showHosts() }
        }
    }

    // singleTask 复用同一实例时，常驻通知的「DSH 入口」动作走这里
    override fun onNewIntent(i: Intent?) {
        super.onNewIntent(i)
        setIntent(i)
        if (i?.getBooleanExtra(PushService.EXTRA_SHOW_HOSTS, false) == true) {
            window.decorView.post { showHosts() }
        }
    }

    // ---------- 多 DSH 实例选择器（v1.29.0） ----------

    private fun showHosts() {
        val hosts = DshHosts.all(this)
        if (hosts.isEmpty()) {
            AlertDialog.Builder(this)
                .setTitle(R.string.hosts_title)
                .setMessage(R.string.hosts_empty)
                .setPositiveButton(R.string.hosts_add) { _, _ -> showHostInput("") }
                .setNegativeButton("知道了", null)
                .show()
            return
        }
        val labels = hosts.map { "${it.name}\n${it.id} · ${ago(it.lastSeen)}" }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle(R.string.hosts_title)
            .setItems(labels) { _, i -> openWebUrl(hosts[i].url, revive = true) }
            .setNeutralButton(R.string.hosts_manage) { _, _ -> showHostManage(hosts) }
            .setPositiveButton(R.string.hosts_add) { _, _ -> showHostInput("") }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun showHostManage(hosts: List<DshHosts.Host>) {
        AlertDialog.Builder(this)
            .setTitle(R.string.hosts_manage)
            .setItems(hosts.map { it.name }.toTypedArray()) { _, i -> showHostItem(hosts[i]) }
            .setNegativeButton("返回", null)
            .show()
    }

    private fun showHostItem(h: DshHosts.Host) {
        AlertDialog.Builder(this)
            .setTitle("${h.name} · ${h.id}")
            .setItems(arrayOf("重命名", "更新链接", "删除")) { _, which ->
                when (which) {
                    0 -> showHostRename(h)
                    1 -> showHostInput(h.url)
                    else -> {
                        DshHosts.remove(this, h.id)
                        toast("已删除 ${h.name}")
                    }
                }
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun showHostRename(h: DshHosts.Host) {
        val et = inputBox(h.name)
        AlertDialog.Builder(this)
            .setTitle("给它起个名字")
            .setView(padded(et))
            .setPositiveButton("保存") { _, _ ->
                val nm = et.text.toString().trim()
                if (nm.isNotEmpty()) {
                    DshHosts.rename(this, h.id, nm)
                    toast("改名成功")
                }
            }
            .setNegativeButton("取消", null)
            .show()
    }

    // 手动添加或更新链接：从没推送过的实例、或 token 轮换后链接过期时用
    private fun showHostInput(prefill: String) {
        val et = inputBox(prefill)
        et.hint = "https://主机:端口/?token=…"
        AlertDialog.Builder(this)
            .setTitle(R.string.hosts_add)
            .setView(padded(et))
            .setPositiveButton("保存") { _, _ ->
                val u = et.text.toString().trim()
                when {
                    u.isEmpty() -> toast("先粘一条链接")
                    // DSH 网页链接必带 ?token=：不带的多半是下载链接（v1.29.1）
                    !u.contains("token=") -> toast("这条链接没带 ?token=，打开会 401，请复制完整链接")
                    else -> {
                        DshHosts.upsert(this, u, null)
                        toast("已登记 ${DshHosts.hostOf(u)}")
                    }
                }
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun inputBox(text: String) = EditText(this).apply {
        setText(text)
        textSize = 14f
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        setSingleLine(true)
        setTextColor(c(R.attr.dshTextPrimary))
    }

    private fun padded(v: View) = FrameLayout(this).apply {
        setPadding(dp(16), dp(8), dp(16), 0)
        addView(v)
    }

    // "最近出现"的相对时间：一眼看出哪台在活跃
    private fun ago(ts: Long): String {
        if (ts <= 0L) return "时间未知"
        val d = System.currentTimeMillis() / 1000 - ts
        return when {
            d < 60 -> "刚刚"
            d < 3600 -> "${d / 60} 分钟前"
            d < 86400 -> "${d / 3600} 小时前"
            else -> "${d / 86400} 天前"
        }
    }

    // v1.33.35：凭证卡片的开/关/清空。开卡只展示状态不碰配置（长按头像误触不再丢凭证——
    // 用户「应该不清空吧，如果用户长按了头像，可以进去替换」）；清空是卡片里的显式按钮。
    private fun openTokenCard() {
        tokenCardPinned = true
        tokenState.text = if (hasToken())
            "当前凭证已生效：topic " + PushService.topicOf(this) + "（粘贴新证保存即替换）"
        else "还没配凭证：把插件给的 dshpush://… 整条粘进来"
        tokenCard.visibility = View.VISIBLE
    }

    private fun closeTokenCard() {
        tokenCardPinned = false
        tokenInput.setText("")
        tokenCard.visibility = View.GONE
    }

    private fun confirmClearToken() {
        AlertDialog.Builder(this)
            .setTitle("清空凭证")
            .setMessage("清空后大肥鱼会停收推送，直到粘入新凭证。")
            .setPositiveButton("确定") { d, _ ->
                // 清令牌时把 v1.33.0 的 topic/base 一起清掉，免得下次粘老通行证还留着旧频道
                prefs().edit().putString(PushService.KEY_TOKEN, "")
                    .remove(PushService.KEY_TOPIC).remove(PushService.KEY_BASE).apply()
                // v1.34.0：设备清单也一起清（只是不想收某一台的话，用上面清单里的「吊销」）
                Devices.all(this).forEach { Devices.remove(this, it.id) }
                tokenInput.setText("")
                startForegroundService(Intent(this, PushService::class.java).setAction("reload"))
                toast(getString(R.string.token_cleared))
                refresh()
                d.dismiss()
            }
            .setNegativeButton("取消") { d, _ -> d.dismiss() }
            .show()
    }

    // v1.33.0：通行证可以是插件面板给的 dshpush://v1?base=…&topic=…&token=…（一人一频道），
    // 也可以是老的一串 tk_…（退回默认中继 + topic dsh，行为与 v1.32.x 完全一致）。
    private fun saveToken() {
        val raw = tokenInput.text.toString().trim()
        val (cfg, err) = PushService.parsePass(raw)
        if (cfg == null) { toast(err); return }
        applyPass(cfg)
    }

    /**
     * 把一条已经解析好的通行证落盘（v1.33.53 从 saveToken 里抽出来，扫码和手输共用一条路径）。
     *
     * 扫码那条路会多带 web/name：直接塞进实例列表，用户点「DSH 入口」就能看到这台机器并进去，
     * 不用再去网页里的设置页找链接。
     */
    private fun applyPass(cfg: PassCfg) {
        val oldTopic = PushService.topicOf(this)
        val ed = prefs().edit()
        ed.putString(PushService.KEY_TOKEN, cfg.token)
        // 通行证里没写 topic/base 就把它俩清掉：从 v1 链接换回老的一串 tk_ 时若留着旧 topic，
        // 手机会继续盯别人的频道 —— 那是比写死更难查的故障。
        if (cfg.base == null) ed.remove(PushService.KEY_BASE) else ed.putString(PushService.KEY_BASE, cfg.base)
        if (cfg.topic == null) ed.remove(PushService.KEY_TOPIC) else ed.putString(PushService.KEY_TOPIC, cfg.topic)
        val newTopic = cfg.topic ?: PushService.DEFAULT_TOPIC
        if (newTopic != oldTopic) ed.remove("lastTs")  // 换频道就别带旧游标，免得漏掉新频道最近的消息
        // 扫码配对的额外两项：网页入口直接进实例列表（与推送里的 #web 走同一条路），
        // 这样「DSH 入口」里马上就有这台机器可选。
        val web = cfg.web
        if (!web.isNullOrEmpty()) {
            DshHosts.upsert(this, web, cfg.name)
            ed.putString(PushService.KEY_WEB, web)
        }
        ed.apply()
        // ★ v1.34.0：配对 = 往设备清单里登记一台（不再覆盖上一台）。
        // 同一个 base+topic 重复扫码是「更新」，吊销过的那台会被顺带恢复。
        val added = Devices.upsert(
            this,
            name = cfg.name ?: "",
            base = cfg.base ?: PushService.BASE,
            topic = newTopic,
            token = cfg.token,
            web = web ?: "",
        )
        tokenCardPinned = false
        tokenCard.visibility = View.GONE
        startForegroundService(Intent(this, PushService::class.java).setAction("reload"))
        val who = cfg.name?.takeIf { it.isNotBlank() }
        toast(
            when {
                // 同名同频道 = 同一台在重出码，不是新增：说清楚，别让用户以为加了两台
                who != null && !added -> who + " 本来就在清单里，已更新它的通行证"
                who != null -> "收好，" + who + " 的推送来了我喊你"
                newTopic != PushService.DEFAULT_TOPIC -> "通行证收好，大肥鱼盯着 $newTopic"
                else -> "通行证收好，大肥鱼出发"
            }
        )
        refresh()
    }

    // 扫码配对（v1.33.53）：拿回来的是一条完整的 dshpush:// 载荷，走与手输完全相同的落盘路径。
    // 扫到不相干的二维码时 ScanPairActivity 已经拦下来了，这里只处理合法的。
    private fun startScan() {
        try {
            startActivityForResult(Intent(this, ScanPairActivity::class.java), REQ_SCAN)
        } catch (e: Exception) {
            toast("打不开扫码界面")
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_SCAN) return
        val raw0 = data?.getStringExtra(ScanPairActivity.EXTRA_PASS)?.trim().orEmpty()
        android.util.Log.i(
            ScanPairActivity.TAG,
            "定点结果 result=$resultCode 载荷长度=" + raw0.length
        )
        if (resultCode != RESULT_OK) { reopenDevicesAfterScan = false; return }
        val raw = raw0
        if (raw.isEmpty()) { reopenDevicesAfterScan = false; return }
        val (cfg, err) = PushService.parsePass(raw)
        if (cfg == null) { reopenDevicesAfterScan = false; toast(err); return }
        // 让用户在通行证框里看见到底收下了什么（扫错机器时能立刻发现）。
        tokenInput.setText(raw)
        applyPass(cfg)
        // v1.34.3：从设备清单来的，配完直接把清单弹回来，新登记的那台当场看得见
        if (reopenDevicesAfterScan) {
            reopenDevicesAfterScan = false
            window.decorView.postDelayed({ showDevices() }, 300)
        }
    }

    // 卡片自带链接直达：各条消息指向自己那台机器的 DSH Web（v1.9.4）；
    // v1.9.8 起落 App 内置 WebActivity 单实例窗口，重复点击复用不叠窗
    // revive（v1.33.40，用户 m06924）：true = 这次是「进这台设备」而不是「看这条消息」，
    // WebActivity 要把该设备上次停留的对话拼回 URL 片段。消息卡片的链接自带
    // #session-<uuid>（host-plugin 的 webUrl(sessionId)），必须保持精确落点，所以只有
    // 实例选择器传 true。
    private fun openWebUrl(url: String, revive: Boolean = false) {
        try {
            startActivity(Intent(this, WebActivity::class.java)
                .putExtra("url", url)
                .putExtra("revive", revive))
        } catch (e: Exception) {
            toast("打不开这个链接")
        }
    }

    // ---------- 设置菜单（v1.32.29） ----------
    // 用户「主页的按钮太多了，能只保留常用的吗，其他的可以做个设置菜单放里面」：
    // 主页只留「清空消息 / 调试浮层」，其余操作收在这里（顶栏「设置」进来）。
    // 服务是否在跑直接读 PushService.state（它是 @Volatile 的现值，比查进程表可靠）。
    private fun serviceRunning(): Boolean {
        val s = PushService.state
        return s != "未启动" && s != "已停止"
    }

    private fun showSettings() {
        val pm = getSystemService(PowerManager::class.java)
        val batOk = pm.isIgnoringBatteryOptimizations(packageName)
        val running = serviceRunning()
        val labels = arrayOf(
            if (running) "后台服务：运行中（" + PushService.state + "）- 点按停止"
            else "后台服务：未运行 - 点按启动",
            "电池优化白名单：" + (if (batOk) "已加入" else "未加入（vivo 上服务容易被杀）"),
            "保活体检（只读，不改系统设置）",
            getString(R.string.theme_btn),
            "调试浮层：" + (if (DiagPrefs.on(this)) "已开" else "已关") + "（DSH 页面左上角诊断信息）",
        )
        AlertDialog.Builder(this)
            .setTitle("设置")
            .setItems(labels) { _, which ->
                when (which) {
                    0 -> if (running) {
                        stopService(Intent(this, PushService::class.java))
                        toast("服务已停止")
                    } else {
                        startForegroundService(Intent(this, PushService::class.java))
                        toast("服务已启动")
                    }
                    1 -> openBatteryWhitelist()
                    2 -> showCheckup()
                    3 -> showThemePicker()
                    else -> {
                        val on = !DiagPrefs.on(this)
                        DiagPrefs.set(this, on)
                        toast(if (on) "调试浮层已开：DSH 页面左上角会显示诊断信息" else "调试浮层已关")
                    }
                }
                refresh()
            }
            .setNegativeButton("返回", null)
            .show()
    }

    private fun showThemePicker() {

        AlertDialog.Builder(this)
            .setTitle(R.string.theme_title)
            .setSingleChoiceItems(ThemePrefs.NAMES, ThemePrefs.current(this)) { d, which ->
                ThemePrefs.set(this, which)
                d.dismiss()
                // 通知/渠道色跟随新主题，界面立即重建换装
                startForegroundService(Intent(this, PushService::class.java).setAction("reload"))
                recreate()
            }
            .setNegativeButton("算了") { d, _ -> d.dismiss() }
            .show()
    }

    // 清空消息：确认后 msgs 置空、lastMaxTs 复位（否则下次渲染会把新消息当"旧"跳过入场动画）
    private fun confirmClearMsgs() {
        val n = try {
            JSONArray(prefs().getString("msgs", "[]") ?: "[]").length()
        } catch (e: Exception) { 0 }
        AlertDialog.Builder(this)
            .setTitle("清空消息")
            .setMessage("清空全部 $n 条消息？")
            .setPositiveButton("确定") { d, _ ->
                prefs().edit().putString("msgs", "[]").apply()
                lastMaxTs = -1L
                refresh()
                d.dismiss()
            }
            .setNegativeButton("取消") { d, _ -> d.dismiss() }
            .show()
    }

    // 保活体检（v1.14.0）：能程序检测的直接给 ✓/✗，OriginOS 私有开关只给直达+一句话说明。
    // 全程只读——不改任何系统设置，"去开/去设置"只是跳系统页；每次打开都实时重查状态。
    private fun showCheckup() {
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(2), 0, dp(2), 0)
        }
        body.addView(sectionTitle("自动检测"))
        body.addView(checkRow("通知权限",
            getSystemService(NotificationManager::class.java).areNotificationsEnabled(),
            { openNotifSettings() }))
        body.addView(checkRow("电池白名单",
            getSystemService(PowerManager::class.java)
                .isIgnoringBatteryOptimizations(packageName),
            { openBatteryWhitelist() }))
        body.addView(sectionTitle("vivo 手动体检（App 测不到，只能自己去翻）"))
        body.addView(manualRow("自启动", "不开启的话杀掉后台就再也收不到推送",
            { tryOpen(comp("com.iqoo.secure",
                    "com.iqoo.secure.ui.appmanage.BgStartUpManagerActivity"),
                comp("com.vivo.settings",
                    "com.vivo.settings.AutoStartPermissionActivity")) }))
        body.addView(manualRow("后台高耗电", "允许大肥鱼后台耗电，否则省电模式先杀它",
            { tryOpen(comp("com.iqoo.secure",
                    "com.iqoo.secure.ui.phoneoptimize.PowerSaverSettingActivity")) }))
        body.addView(manualRow("睡眠待机优化", "夜里断网元凶：睡眠时它会断数据，推送整晚不来",
            { tryOpen(comp("com.iqoo.secure",
                    "com.iqoo.secure.ui.phoneoptimize.BatterySaverSettingsActivity")) }))
        body.addView(manualRow("最近任务锁", "在最近任务里下拉/长按卡片加锁，滑清时不被清掉", null))
        body.addView(TextView(this).apply {
            text = "跳转尽力而为：跳不到对应页面就落到本应用详情页，手动找一下。"
            textSize = 11f
            setTextColor(c(R.attr.dshTextSecondary))
            setPadding(0, dp(12), 0, 0)
        })
        val scroll = ScrollView(this).apply {
            isVerticalScrollBarEnabled = false
            addView(body)
        }
        AlertDialog.Builder(this)
            .setTitle("大肥鱼保活体检")
            .setView(scroll)
            .setNegativeButton("知道了") { d, _ -> d.dismiss() }
            .show()
    }

    // 体检小节标题
    private fun sectionTitle(s: String): View = TextView(this).apply {
        text = s
        textSize = 13f
        setTextColor(c(R.attr.dshAccent))
        setTypeface(android.graphics.Typeface.DEFAULT_BOLD)
        setPadding(0, dp(12), 0, dp(2))
    }

    // 自动检测行：项目名 + 实时状态 + 去开/去查看
    private fun checkRow(name: String, ok: Boolean, go: () -> Unit): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(5), 0, dp(5))
        }
        row.addView(TextView(this).apply {
            text = name
            textSize = 14f
            setTextColor(c(R.attr.dshTextPrimary))
        }, LinearLayout.LayoutParams(0, -2, 1f))
        row.addView(TextView(this).apply {
            text = if (ok) "✔ 已开" else "✘ 未开"
            textSize = 13f
            setTextColor(if (ok) cOk() else cBad())
        }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) })
        row.addView(pill(Button(this)).apply {
            text = if (ok) "去查看" else "去开"
            setOnClickListener { go() }
        }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) })
        return row
    }

    // 手动项行：项目名（带"去设置"）一行 + 下面一句话说明；go=null 就是纯说明项
    private fun manualRow(name: String, hint: String, go: (() -> Unit)?): View {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(5), 0, dp(5))
        }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        top.addView(TextView(this).apply {
            text = name
            textSize = 14f
            setTextColor(c(R.attr.dshTextPrimary))
        }, LinearLayout.LayoutParams(0, -2, 1f))
        if (go != null) {
            top.addView(pill(Button(this)).apply {
                text = "去设置"
                setOnClickListener { go() }
            }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) })
        }
        col.addView(top, LinearLayout.LayoutParams(-1, -2))
        col.addView(TextView(this).apply {
            text = hint
            textSize = 11f
            setTextColor(c(R.attr.dshTextSecondary))
            setPadding(0, dp(3), 0, 0)
        })
        return col
    }

    // vivo/OriginOS 私有设置页的跳转候选（各机型组件名不同，真机验收哪个跳歪了改这里）
    private fun comp(pkg: String, cls: String): Intent =
        Intent().setComponent(ComponentName(pkg, cls))

    // 尽力跳转：按顺序试，谁起来算谁，全失败落本应用详情页（永不崩）。
    // 故意不用 resolveActivity 预筛：targetSdk 34 的包可见性会让它对外部组件报 null，
    // 反而把本来能跳成的页跳没了；startActivity 不受可见性限制，抛异常一律接住。
    private fun tryOpen(vararg cands: Intent) {
        for (i in cands) {
            try {
                startActivity(i)
                return
            } catch (e: Exception) { }
        }
        toast("找不到对应设置页，已落到应用详情页，手动找一下")
        openAppDetails()
    }

    // 通知权限页（ACTION_APP_NOTIFICATION_SETTINGS 是 API 26，minSdk 26 安全）
    private fun openNotifSettings() {
        tryOpen(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
    }

    // 电池优化白名单页（v1.14.0 从按钮里抽出来，体检对话框共用同一条跳转链）
    private fun openBatteryWhitelist() {
        tryOpen(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    // 所有跳转的最终兜底：本应用详情页
    private fun openAppDetails() {
        try {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", packageName, null)))
        } catch (e: Exception) {
            toast("系统设置打不开，手动去应用信息里找")
        }
    }

    // 体检状态色：主题里声明了 dshOk/dshBad 就用，没声明自动退回 强调色/警示色（v1.14.0）
    private fun cOk(): Int = cNamed("dshOk", c(R.attr.dshAccent))
    private fun cBad(): Int = cNamed("dshBad", c(R.attr.dshWarn))
    private fun cNamed(name: String, fallback: Int): Int {
        val id = resources.getIdentifier(name, "attr", packageName)
        if (id == 0) return fallback
        val tv = TypedValue()
        if (!theme.resolveAttribute(id, tv, true) || tv.type == TypedValue.TYPE_NULL)
            return fallback
        return if (tv.resourceId != 0) resources.getColor(tv.resourceId, theme) else tv.data
    }

    // v1.18.0：markAllRead 退役——已读改为逐条显式（PushService.markRead）；
    // v1.32.9 以「全部已读」显式按钮形态回归（PushService.markAllRead，见状态卡片）

    // 未读卡片标题：文字前两点宽的"● "，圆点着强调色（v1.9.9）
    private fun unreadTitle(s: String): CharSequence {
        val t = "● $s"
        return SpannableString(t).apply {
            setSpan(ForegroundColorSpan(c(R.attr.dshAccent)), 0, 2,
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }

    private fun pill(b: Button): Button = b.apply {
        textSize = 12f
        setBackgroundResource(R.drawable.bg_pill)
        setTextColor(c(R.attr.dshAccent))
        stateListAnimator = null
        setPadding(0, dp(10), 0, dp(10))
    }

    private fun card(inner: View, pad: Int): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = resources.getDrawable(R.drawable.bg_card, theme)
            setPadding(pad, pad, pad, pad)
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) }
            addView(inner)
        }

    private val msgListener = object : MsgListener {
        override fun onNewMsg() { runOnUiThread { refresh() } }
    }

    companion object {
        // 兜底标志：进程级只弹一次——换主题 recreate 不再重复弹旧记录（v1.7.3）
        private var crashChecked = false
        /** 扫码配对的请求码（v1.33.53）。 */
        private const val REQ_SCAN = 907
    }

    override fun onResume() {
        super.onResume()
        if (!PushService.listeners.contains(msgListener)) PushService.listeners.add(msgListener)
        refresh()
        statusText.postDelayed({ refresh() }, 500)
        // v1.33.0：状态卡在页面停留期间也要跟着刷——保存通行证发的 reload 是异步意图，
        // 只靠这一次 refresh() 会把旧状态一直钉在屏上（真机实测）。
        statusText.removeCallbacks(statusTicker)
        statusText.postDelayed(statusTicker, 2000)
        // v1.18.0：取消"看过 1.2s 自动已读"——已读改由「已读」按钮/「打开 DSH」显式触发
        startAmbient()
        if (!crashChecked) {
            crashChecked = true
            val raw = prefs().getString(App.KEY_CRASH, "") ?: ""
            val ts = raw.substringBefore('|').toLongOrNull() ?: 0
            val seen = prefs().getString(App.KEY_SEEN, "") ?: ""
            if (raw.isNotEmpty() && ts > 0L && seen != ts.toString() &&
                System.currentTimeMillis() - ts < 6 * 3600_000L) {
                try {
                    startActivity(Intent(this, CrashReportActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS))
                } catch (_: Exception) { }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        statusText.removeCallbacks(statusTicker)   // v1.33.0：状态卡计时器不进后台
        PushService.listeners.remove(msgListener)
        stopAmbient()
    }

    // 氛围动画：顶栏呼吸 + 深夜星闪，只在界面可见时跑（v1.8.0）
    private fun startAmbient() {
        if (breathX == null) {
            breathX = ObjectAnimator.ofFloat(headerPet, "scaleX", 1f, 1.05f).apply {
                duration = 1250; repeatMode = ObjectAnimator.REVERSE
                repeatCount = ObjectAnimator.INFINITE
                interpolator = AccelerateDecelerateInterpolator(); start()
            }
            breathY = ObjectAnimator.ofFloat(headerPet, "scaleY", 1f, 1.05f).apply {
                duration = 1250; repeatMode = ObjectAnimator.REVERSE
                repeatCount = ObjectAnimator.INFINITE
                interpolator = AccelerateDecelerateInterpolator(); start()
            }
        }
        starsView?.let { s ->
            if (twinkle == null) {
                twinkle = ObjectAnimator.ofFloat(s, "alpha", 0.35f, 1f).apply {
                    duration = 1600; repeatMode = ObjectAnimator.REVERSE
                    repeatCount = ObjectAnimator.INFINITE; start()
                }
            }
        }
    }

    private fun stopAmbient() {
        breathX?.cancel(); breathY?.cancel(); breathX = null; breathY = null
        if (::headerPet.isInitialized) { headerPet.scaleX = 1f; headerPet.scaleY = 1f }
        twinkle?.cancel(); twinkle = null
        starsView?.alpha = 1f
    }

    /** 最近一次刷新数出的未读数，给状态卡的轻量刷新用（v1.33.0）。 */
    private var lastUnread = 0

    private fun refresh() {
        val pm = getSystemService(PowerManager::class.java)
        val batteryOk = pm.isIgnoringBatteryOptimizations(packageName)
        if (hasToken() && !tokenCardPinned) tokenCard.visibility = View.GONE

        msgList.removeAllViews()
        val arr = try {
            JSONArray(getSharedPreferences("dshpush", MODE_PRIVATE).getString("msgs", "[]") ?: "[]")
        } catch (e: Exception) { JSONArray() }
        emptyBox.visibility = if (arr.length() == 0) View.VISIBLE else View.GONE
        // 未读条数在渲染循环里数出来，循环结束后写进状态卡片（v1.9.9）
        var unread = 0
        val fmtToday = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
        val fmtFull = SimpleDateFormat("MM-dd HH:mm", Locale.getDefault())
        var maxTs = lastMaxTs
        for (i in 0 until arr.length()) {
            val m = arr.getJSONObject(i)
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
            }
            // 未读判定：老消息没这字段，optBoolean 默认 true 即视为已读（v1.9.9）
            val unreadNow = !m.optBoolean("read", true)
            if (unreadNow) unread++
            val ts = m.optLong("ts")
            val time = if (System.currentTimeMillis() / 1000L - ts < 86400)
                fmtToday.format(Date(ts * 1000)) else fmtFull.format(Date(ts * 1000))
            row.addView(TextView(this).apply {
                text = if (unreadNow) unreadTitle(m.optString("title")) else m.optString("title")
                textSize = 15f
                setTextColor(c(R.attr.dshTextPrimary))
                setTypeface(android.graphics.Typeface.DEFAULT_BOLD)
            })
            row.addView(TextView(this).apply {
                // v1.34.0：多设备之后，「这条是谁发来的」必须能看出来。
                // dev 是 Devices.id；记录被清掉时查不到就只显示时间，不占位。
                val devId = m.optString("dev", "")
                val who = if (devId.isEmpty()) "" else
                    (Devices.byId(this@MainActivity, devId)?.label ?: "")
                text = if (who.isEmpty()) time else "$time · $who"
                textSize = 11f
                setTextColor(c(R.attr.dshTextSecondary))
                setPadding(0, dp(3), 0, 0)
            })
            row.addView(TextView(this).apply {
                text = m.optString("body")
                textSize = 13f
                setTextColor(c(R.attr.dshTextSecondary))
                setPadding(0, dp(6), 0, 0)
            })
            val callId = m.optString("callId", "")
            val answered = m.optString("answered", "")
            val webUrl = m.optString("web", "")
            if (answered.isNotEmpty()) {
                // 已答/过期态：收起作答按钮，徽章+网页直达保留，整卡压暗（v1.9.6）
                val actRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                }
                actRow.addView(pill(Button(this)).apply {
                    // 自由直答答案可能很长，徽章截断到 40 字（v1.11.0）
                    text = if (answered == "__expired") "已过期"
                           else "已答：" + answered.take(40)
                    isClickable = false
                    if (answered == "__expired") setTextColor(c(R.attr.dshTextSecondary))
                })
                if (webUrl.isNotEmpty()) {
                    actRow.addView(pill(Button(this)).apply {
                        text = "DSH 网页"
                        setOnClickListener {
                            PushService.markRead(this@MainActivity, m.optInt("mid", 0), ts)
                            openWebUrl(webUrl)
                        }
                    }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) })
                }
                // 已答但还没读过：也给个「已读」按钮（v1.18.0）
                if (unreadNow) {
                    actRow.addView(pill(Button(this)).apply {
                        text = "已读"
                        setOnClickListener {
                            PushService.markRead(this@MainActivity, m.optInt("mid", 0), ts)
                        }
                    }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) })
                }
                row.addView(actRow, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
            } else {
            if (callId.isNotEmpty()) {                // 应用内直答：卡片上直接排选项按钮，点了广播提交（v1.9.1）
                val opts = m.optJSONObject("opts")
                val qid = opts?.optString("qid") ?: ""
                val labels = opts?.optJSONArray("labels") ?: JSONArray()
                if (qid.isNotEmpty() && labels.length() > 0) {
                    val optRow = LinearLayout(this).apply {
                        orientation = LinearLayout.HORIZONTAL
                    }
                    for (li in 0 until labels.length()) {
                        val lb = labels.getString(li)
                        optRow.addView(pill(Button(this)).apply {
                            text = lb
                            setOnClickListener {
                                sendBroadcast(Intent(this@MainActivity, AnswerReceiver::class.java)
                                    .putExtra("callId", callId).putExtra("qid", qid)
                                    .putExtra("label", lb).putExtra("nid", m.optInt("nid", 0)))
                                row.removeView(optRow)
                            }
                        }, LinearLayout.LayoutParams(0, -2, 1f).apply {
                            if (li < labels.length() - 1) rightMargin = dp(6)
                        })
                    }
                    row.addView(optRow, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
                }
            }
            // 卡片动作行：肥鱼快答（有 callId）+ DSH 网页（该条消息自带的链接，v1.9.4）
            // + 已读（未读时必给，v1.18.0——任务结束消息没 callId 没网页也能标已读）
            if (callId.isNotEmpty() || webUrl.isNotEmpty() || unreadNow) {
                val actRow = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                }
                if (callId.isNotEmpty()) {
                    actRow.addView(pill(Button(this)).apply {
                        text = "肥鱼快答"
                        setOnClickListener {
                            startActivity(Intent(this@MainActivity, QuickAnswerActivity::class.java)
                                .putExtra("callId", callId))
                        }
                    })
                }
                if (webUrl.isNotEmpty()) {
                    actRow.addView(pill(Button(this)).apply {
                        text = "DSH 网页"
                        setOnClickListener {
                            PushService.markRead(this@MainActivity, m.optInt("mid", 0), ts)
                            openWebUrl(webUrl)
                        }
                    }, LinearLayout.LayoutParams(-2, -2).apply {
                        if (callId.isNotEmpty()) leftMargin = dp(8)
                    })
                }
                if (unreadNow) {
                    actRow.addView(pill(Button(this)).apply {
                        text = "已读"
                        setOnClickListener {
                            PushService.markRead(this@MainActivity, m.optInt("mid", 0), ts)
                        }
                    }, LinearLayout.LayoutParams(-2, -2).apply {
                        if (callId.isNotEmpty() || webUrl.isNotEmpty()) leftMargin = dp(8)
                    })
                }
                row.addView(actRow, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
            }
            }
            val entry = card(row, dp(14))
            // 已答或已读都整卡淡化（v1.17.0）：已答带徽章，已读只淡化不加徽章
            if (answered.isNotEmpty() || m.optBoolean("read", true)) entry.alpha = 0.6f
            msgList.addView(entry)
            // 新到消息淡入上滑入场，旧卡片不动（v1.8.0）
            if (lastMaxTs >= 0 && ts > lastMaxTs) {
                entry.alpha = 0f
                entry.translationY = dp(24).toFloat()
                entry.animate().alpha(1f).translationY(0f)
                    .setDuration(250).setStartDelay(minOf(i * 60L, 300L)).start()
            }
            if (ts > maxTs) maxTs = ts
        }
        lastMaxTs = maxTs

        lastUnread = unread
        renderStatus(unread, batteryOk)
    }

    /**
     * 状态卡片文案（v1.33.0 从 refresh() 里抽出来）：抽出来是为了能被单独刷。粘贴通行证后服务要
     * 一两秒才连上，而 reload 是异步意图 —— refresh() 抢在前面渲染一次就会把旧状态钉在屏上
     * （真机实测：粘完显示「等待通行证」，直到冷启动才变「已连接」）。停留时每 2 秒只刷这张卡，
     * 不重建消息列表。
     */
    /**
     * 设备清单弹窗（v1.34.2）。
     *
     * 用户原话：「已连接设备的框能只在点开头像时显示吗，还有吊销后的设备就不要显示了，
     * 下次可以点头像再次扫码进行」。所以首页不再挂那张常驻卡片，改由头像唤起。
     *
     * - 只列**未吊销**的设备（吊销掉的直接不出现，留档在 prefs 里，见 Devices.revoke）
     * - 每行：名字 + 「topic · 连接状态」，右边一颗「吊销」
     * - 底部：扫码／从相册加一台、换通行证
     */
    private fun showDevices() {
        val ctx = this
        val subs = Devices.all(ctx).filter { !it.revoked }
        val revoked = Devices.all(ctx).count { it.revoked }

        val box = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(6), dp(18), dp(2))
        }

        if (subs.isEmpty()) {
            box.addView(TextView(ctx).apply {
                text = "还没有配对过设备。" +
                    "点下面「加一台」扫那台机器插件页上的二维码，就能收它的推送。"
                textSize = 13f
                setTextColor(c(R.attr.dshTextSecondary))
                setLineSpacing(0f, 1.25f)
            })
        }
        for (d in subs.sortedBy { it.addedAt }) {
            val raw = PushService.stateOfTopic(d.topicKey)
            val st = if (raw.isEmpty()) "连接中…" else raw
            val row = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(9), 0, dp(9))
            }
            val col = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                addView(TextView(ctx).apply {
                    text = d.label
                    textSize = 15f
                    setTextColor(c(R.attr.dshTextPrimary))
                    setTypeface(android.graphics.Typeface.DEFAULT_BOLD)
                })
                addView(TextView(ctx).apply {
                    text = "${d.topic} · $st" + if (d.web.isNotEmpty()) " · 点这里进它的网页" else ""
                    textSize = 11f
                    setTextColor(c(R.attr.dshTextSecondary))
                    setPadding(0, dp(3), 0, 0)
                })
            }
            col.setOnClickListener {
                dismissDevices()
                if (d.web.isNotEmpty()) openWebUrl(d.web)
                else toast("这台还没推过网页链接，等它推一条就能进")
            }
            row.addView(col, LinearLayout.LayoutParams(0, -2, 1f))
            row.addView(pill(Button(ctx)).apply {
                text = "吊销"
                setOnClickListener { confirmRevoke(d) }
            }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) })
            box.addView(row)
        }

        if (revoked > 0) {
            box.addView(TextView(ctx).apply {
                text = "已吊销 $revoked 台（不在上面显示）；要恢复就重新扫它的码。"
                textSize = 11f
                setTextColor(c(R.attr.dshTextSecondary))
                setPadding(0, dp(8), 0, 0)
            })
        }

        val addRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(14), 0, 0)
        }
        addRow.addView(pill(Button(ctx)).apply {
            text = "＋ 加一台（扫码/相册）"
            setOnClickListener {
                reopenDevicesAfterScan = true
                dismissDevices()
                startScan()
            }
        }, LinearLayout.LayoutParams(-2, -2))
        addRow.addView(pill(Button(ctx)).apply {
            text = "换通行证"
            setOnClickListener {
                dismissDevices()
                openTokenCard()
            }
        }, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) })
        box.addView(addRow)

        val scroll = ScrollView(ctx).apply {
            isFillViewport = false
            addView(box)
        }
        devicesDialog = AlertDialog.Builder(ctx)
            .setTitle("设备")
            .setView(scroll)
            .setNegativeButton("关闭", null)
            .create()
        devicesDialog?.show()
    }

    private fun dismissDevices() {
        runCatching { devicesDialog?.dismiss() }
        devicesDialog = null
    }

    /** 吊销前问一句：这是个会让人「推送突然没了」的动作，误触很难自查 */
    private fun confirmRevoke(d: Devices.Dev) {
        android.app.AlertDialog.Builder(this)
            .setTitle("吊销这台设备？")
            .setMessage(
                (if (d.name.isNotBlank()) d.name else d.topic) +
                    " 之后推过来的消息都不会进这台手机；记录留着，想看谁被吊销了就翻这份清单。" +
                    "要恢复就重新扫一次它的配对码。"
            )
            .setNegativeButton("算了", null)
            .setPositiveButton("吊销") { _, _ ->
                Devices.revoke(this, d.id)
                // 让 Service 按新的清单重连（会掐掉它的订阅）
                runCatching {
                    startForegroundService(
                        Intent(this, PushService::class.java).setAction("reload")
                    )
                }
                toast("已吊销，不再收它的推送")
                refresh()
                // 清单里立刻消失（v1.34.2）：先关掉旧弹窗，还剩别的设备就重新列一遍
                dismissDevices()
                if (Devices.all(this).any { !it.revoked }) window.decorView.postDelayed({ showDevices() }, 150)
            }
            .show()
    }

    private fun renderStatus(unread: Int, batteryOk: Boolean) {
        // 未读计数回到正文首行（v1.32.33：胶囊改竖排后不再有首行）；vivo 上 emoji 渲染差，
        // 故用实心圆点（v1.9.9）。正文右侧要让给两颗竖排胶囊（约 224px），所以几行文案改短，
        // 避免折行把省出的垂直空间吃回去：服务器去掉 https://、白名单去掉「电池优化」前缀与
        // 长说明（完整说法在顶栏「设置」菜单里）。
        statusText.text = buildString {
            if (unread > 0) append("● ${unread} 条未读\n")
            append("""
                状态：${PushService.state}（v${PushService.appVer(this@MainActivity)}）
                服务器：${PushService.baseOf(this@MainActivity).replace("https://", "")}（topic ${PushService.topicOf(this@MainActivity)}）
                通行证：${if (hasToken()) "已配置 ✔（点头像换）" else "未配置 ✘（下面填一张）"}
                白名单：${if (batteryOk) "已加入 ✔" else "未加入 ✘（vivo 易杀）"}
            """.trimIndent())
            // 多设备（v1.34.0）：一台以上才补这行，单机时不必占字
            val n = Devices.subs(this@MainActivity).size
            if (n > 1) append("\n设备：$n 台在线（点头像看清单）")
        }
        statusText.setTextColor(if (batteryOk) c(R.attr.dshTextPrimary) else c(R.attr.dshWarn))
        // 一键全部已读（v1.32.9）：仅在有未读时出现；点完 unread 归零，listener 再刷时自己隐藏
        markAllBtn.visibility = if (unread > 0) View.VISIBLE else View.GONE
    }

    /** 停留时每 2 秒刷一次状态卡；onPause 停表，不把定时器留到后台。 */
    private val statusTicker = object : Runnable {
        override fun run() {
            try {
                val pm = getSystemService(PowerManager::class.java)
                renderStatus(lastUnread, pm.isIgnoringBatteryOptimizations(packageName))
            } catch (e: Exception) { /* 刷新失败保持原文案，下一拍再来 */ }
            statusText.postDelayed(this, 2000)
        }
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()
}
