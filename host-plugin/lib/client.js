// dsh-push-host 的浏览器半（v0.3.0）：设置页「手机作答模式」开关 + 「通行证」自助发号面板 + 按推送链接的 hash 切到来源会话。
// v0.2.3：补 hashchange 监听——网页已开着时点另一条推送只做片段跳转、不重载页面。
// v0.2.4：开关与「展开其余 N 个会话」都改用语义锚点 + 中英双标签——这些文案是本地化的，
// 只按英文标签找在中文手机上必然找不到（用户真机实遇）。
// v0.2.5：为点到行而展开的侧栏，到位后自动收回——窄屏下侧栏是抽屉，会盖住对话；
// 只有我们自己开过的才关，用户本来就开着的一律不动。
// 手写模块，格式照抄现成编译产物（window.__ModuleLoader__.load，见
// dsh-client-ui-settings-subagent/lib/client.js）；宿主 client-modules 经
// package.json 的 dsh.client{platform:"web"} + exports "./client" 挂载它。
// 写入通道：settings RPC 只能写 volatile 字段，所以这里只写 push-host 自己的
// askUserMode；宿主延后到 HMR 事务外备份并 configEditor.edit 改 tool-ask-user 的
// mode/timeout（那两个字段不是 volatile，客户端写不了）。
// v0.2.1：展示读宿主的实际态镜像 askUserActual（不拿期望态当展示值）；开关只升不降
// （0.2.0 的 P0 把生产 timed 反向降级成 legacy），已是 timed 时按钮禁用。
window.__ModuleLoader__.load({
	id: "dsh-push-host",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		// 诊断（v0.2.2）：开机瞬间 URL 里到底有没有 hash、切会话走到哪一步，一页之内就能看出来，
		// 不用去猜「是没跑还是没点到」。控制台里读 window.__DSHPUSH_CLIENT__ 即可。
		const DIAG = { v: "0.3.0", hash: "", service: false, tries: 0, opened: false, rowSeen: false, clicks: 0, closed: false, done: false };
		try {
			DIAG.hash = String(location.hash || "");
		} catch {
			// 读不到就当没有：诊断本身绝不能把插件搞崩。
		}
		try {
			window.__DSHPUSH_CLIENT__ = DIAG;
		} catch {
			// window 不可写时丢掉诊断即可。
		}

		/** 本行读写的 settings 命名空间 = push-host 的 profile entry id。 */
		const NS = "push-host";

		/** 浏览器侧所需服务（client fiber inject）。 */
		const inject = ["slots", "configForms"];

		/**
		* 挂载设置行：宿主在提供 `push-host` 命名空间（= 插件已装载）时才出现。
		* @param ctx - 浏览器插件上下文。
		*/
		function apply(ctx) {
			const scope = ctx.configForms.get(NS);
			let disposed = false;
			const listeners = new Set();
			const notify = () => {
				for (const listener of listeners) listener();
			};
			const unsubscribe = scope.subscribe(() => {
				if (!disposed) notify();
			});
			ctx.effect(() => () => {
				disposed = true;
				unsubscribe();
			}, "dsh-push-host: ask-user form subscription");
			ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "push-host-ask-user-mode",
				order: 120,
				label: "手机作答模式",
			}, () => AskUserModeRow(scope, listeners, notify)))), "dsh-push-host: ask-user mode row");
			// v0.3.0：通行证面板——一人一 topic 一对凭据的自助入口（宿主 lib/index.js:PassProvisioner 跑发号）。
			ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "push-host-pass-panel",
				order: 130,
				label: "通行证",
			}, () => PassPanelRow(scope, listeners, notify)))), "dsh-push-host: pass panel row");
			// v0.2.2：把推送链接 hash 里的来源会话切到主视图（与设置行互不相干，各自独立生效）。
			revealFromHash(ctx);
		}

		/**
		* 设置行本体：settings.general.item 的列只叠行，标签、状态、写入全是行自己的。
		* @param scope - 绑定了 `push-host` 的配置表单。
		* @param listeners - 订阅回调集合（宿主配置文档变化时唤醒）。
		* @param notify - 唤醒全部订阅者。
		*/
		function AskUserModeRow(scope, listeners, notify) {
			const [snapshot, setSnapshot] = react.useState(() => scope.getSnapshot());
			const [busy, setBusy] = react.useState(false);
			react.useEffect(() => {
				const update = () => setSnapshot(scope.getSnapshot());
				listeners.add(update);
				update();
				return () => {
					listeners.delete(update);
				};
			}, []);
			const ready = snapshot.status === "ready";
			const value = snapshot.value ?? {};
			// 展示读宿主的实际态镜像；镜像还没回写（''）时暂按期望态兜底。
			const timed = value.askUserActual === "timed" || (value.askUserActual !== "legacy" && value.askUserMode === "timed");
			const status = typeof value.askUserStatus === "string" ? value.askUserStatus : "";
			const writable = ready && snapshot.writable === true && !busy && !timed;
			const setMode = (next) => {
				if (!writable) return;
				setBusy(true);
				Promise.resolve()
					.then(() => scope.mutate([{
						op: "set",
						path: ["askUserMode"],
						value: next
					}], snapshot.revision))
					.catch(() => {})
					.then(() => {
						setBusy(false);
						notify();
					});
			};
			return react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6, padding: "8px 0" } },
				react.createElement("div", { style: { fontWeight: 600 } }, "手机作答模式"),
				react.createElement("div", { style: { fontSize: 13, opacity: 0.75 } }, timed
					? "已开启：ask_user_question 走 timed——提问会推送到手机，超时后手机答案仍可续答。"
					: "未开启：ask_user_question 走 legacy——只有 DSH 网页能作答。"),
				react.createElement("div", { style: { fontSize: 12, opacity: 0.55 } },
					"启用即时热生效、无需重启宿主；新会话立即生效，已开老会话保持旧行为（工具变体钉在会话创建时）。启用前自动备份 cordis.patch.yml。本开关只升不降：要回到 legacy 请手动改 profile 的 cordis.patch.yml。"),
				status !== ""
					? react.createElement("div", { style: { fontSize: 12, color: "#c0392b" } },
						"上次切换失败：" + status + "（若提示 overridden by a home patch，请先移除 home 层或命令行对 tool-ask-user 的同 id 覆盖）")
					: null,
				react.createElement("div", {}, react.createElement("button", {
					type: "button",
					disabled: !writable,
					onClick: () => setMode("timed"),
					style: { padding: "6px 14px", borderRadius: 8, border: "1px solid currentColor", opacity: writable ? 1 : 0.5 },
				}, busy ? "启用中…" : timed ? "已开启（本开关不降级）" : "启用（切到 timed）")));
		}

		/**
		 * 通行证面板（v0.3.0）。请求经 volatile 字段表达（浏览器只能写 volatile），宿主跑完把
		 * provisionResult / provisionList / provisionDone 镜像回来；busy 用「done 是否等于本次 seq」判，
		 * 不靠超时猜（另加 30s 兜底，免得宿主不在时按钮永久卡住）。
		 * @param scope - 绑定了 push-host 的配置表单。
		 * @param listeners - 订阅回调集合。
		 * @param notify - 唤醒全部订阅者。
		 */
		function PassPanelRow(scope, listeners, notify) {
			const [snapshot, setSnapshot] = react.useState(() => scope.getSnapshot());
			const [busy, setBusy] = react.useState(false);
			const [name, setName] = react.useState("");
			const [copied, setCopied] = react.useState(false);
			react.useEffect(() => {
				const update = () => setSnapshot(scope.getSnapshot());
				listeners.add(update);
				update();
				return () => {
					listeners.delete(update);
				};
			}, []);
			const ready = snapshot.status === "ready";
			const value = snapshot.value ?? {};
			const text = (key) => (typeof value[key] === "string" ? value[key] : "");
			const suggested = text("provisionDefault");
			const result = text("provisionResult");
			const done = text("provisionDone");
			const seq = text("provisionSeq");
			react.useEffect(() => {
				if (busy && done !== "" && done === seq) setBusy(false);
			}, [done, seq, busy]);
			const rawList = text("provisionList");
			let passes = [];
			let listError = "";
			if (rawList.indexOf("__err__") === 0) listError = rawList.slice(7);
			else if (rawList) {
				try { passes = JSON.parse(rawList) || []; } catch { passes = []; }
			}
			const writable = ready && snapshot.writable === true && !busy;
			const ask = (action, forcedName) => {
				if (!writable) return;
				const nextSeq = String(Date.now()) + "-" + Math.floor(Math.random() * 1e6).toString(36);
				const ops = [
					{ op: "set", path: ["provisionAction"], value: action },
					{ op: "set", path: ["provisionSeq"], value: nextSeq },
				];
				const typed = typeof forcedName === "string" && forcedName !== "" ? forcedName.trim() : name.trim();
				if (action !== "refresh" && typed !== "") ops.push({ op: "set", path: ["provisionName"], value: typed });
				setBusy(true);
				setCopied(false);
				setTimeout(() => setBusy(false), 30000);
				Promise.resolve()
					.then(() => scope.mutate(ops, snapshot.revision))
					.catch(() => setBusy(false))
					.then(() => notify());
			};
			const copy = () => {
				if (!result) return;
				try {
					navigator.clipboard.writeText(result);
					setCopied(true);
				} catch {
					setCopied(false);
				}
			};
			const btn = (label, onClick, disabled) => react.createElement("button", {
				type: "button", disabled: disabled, onClick: onClick,
				style: { padding: "6px 12px", borderRadius: 8, border: "1px solid currentColor", opacity: disabled ? 0.5 : 1 },
			}, label);
			return react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6, padding: "8px 0" } },
				react.createElement("div", { style: { fontWeight: 600 } }, "通行证"),
				react.createElement("div", { style: { fontSize: 13, opacity: 0.75 } },
					"给手机签发一条专属通道：一个 topic + 一只只读 token。多人各用各的，通知互不串。"),
				react.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" } },
					react.createElement("input", {
						value: name, placeholder: suggested || "dsh-local",
						onChange: (event) => setName(event.target.value),
						disabled: !writable,
						style: { padding: "6px 10px", borderRadius: 8, border: "1px solid currentColor", minWidth: 170, background: "transparent", color: "inherit" },
					}),
					btn(busy ? "处理中…" : "发通行证", () => ask("issue"), !writable),
					btn("刷新列表", () => ask("refresh"), !writable)),
				react.createElement("div", { style: { fontSize: 12, opacity: 0.6 } },
					"名字：小写字母/数字/短横线，2-31 位、开头不能是短横线。发号成功后 topic 与只写 token 会写回本机凭据文件，重启本插件后按新 topic 发布。"),
				result !== "" ? react.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" } },
					react.createElement("textarea", {
						readOnly: true, value: result, rows: 2,
						onFocus: (event) => { try { event.target.select(); } catch {} },
						style: { flex: "1 1 240px", padding: "6px 8px", borderRadius: 8, border: "1px solid currentColor", background: "transparent", color: "inherit", fontFamily: "monospace", fontSize: 12 },
					}),
					btn(copied ? "已复制" : "复制", copy, false)) : null,
				listError !== "" ? react.createElement("div", { style: { fontSize: 12, color: "#c0392b" } }, "列表读取失败：" + listError) : null,
				passes.length > 0 ? react.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
					react.createElement("div", { style: { fontSize: 12, opacity: 0.7 } }, "已签发 " + passes.length + " 条（吊销即让对方手机上的通行证立刻失效）"),
					...passes.map((row) => react.createElement("div", {
						key: row.name,
						style: { display: "flex", gap: 8, alignItems: "center", fontSize: 12, justifyContent: "space-between", flexWrap: "wrap" },
					},
						react.createElement("span", { style: { fontFamily: "monospace", wordBreak: "break-all" } },
							row.name + "  →  " + (row.topics || []).map((t) => t.topic + "(" + t.permission + ")").join(", ")),
						btn("吊销", () => ask("revoke", row.name), !writable)))) : null);
		}


		/**
		 * v0.2.2：推送里的 `#web` 链接把来源会话放在 **URL hash 片段**（`…#session-<uuid>`，服务端
		 * `lib/index.js:webUrl()` 拼），这里把它兑现成「主视图切到那个会话」——用户「进入网页后能直接
		 * 进入推送通知的那个对话吗」。用片段而不是查询参数是实测决定的：`?token=` 入口会 `303 →
		 * Location: ./` 把查询串丢掉，而浏览器跳转会保留 fragment；网页端也没有路由，别处不读 URL。
		 *
		 * 选择器全部语义化，不依赖哈希类名：当前会话 `[data-conversation-session="<id>"]`、侧栏行
		 * `[data-row-key="session:<id>"]`、展开侧栏 `button[aria-label="Open sidebar"]`。目标不在列表
		 * 里（会话未加载/分组收起）就静默放弃，等于本功能之前的行为，MUST NOT 影响页面其它部分。
		 * @param ctx - 浏览器插件上下文（用它的 effect 挂清理，HMR 不留定时器）。
		 */
		/**
		 * v0.2.2：推送里的 `#web` 链接把来源会话放在 **URL hash 片段**（`…#session-<uuid>`，服务端
		 * `lib/index.js:webUrl()` 拼），这里把它兑现成「主视图切到那个会话」。
		 *
		 * 用片段而不是查询参数，两条实测理由（VM1 的 DSH Web，2026-10-17）：`?token=` 入口回的是
		 * `303 → Location: ./`，查询串在这一步被丢掉，而 fragment 跨跳转保留（实测早期 location.hash 仍在）；
		 * 网页客户端没有路由，路径与查询串都没人读。
		 *
		 * 抓手全是语义化选择器（不依赖哈希类名）：当前会话 `[data-conversation-session=…]`、
		 * 侧栏行 `[data-row-key=session:<id>]`（实测点它就能切主视图）、侧栏容器 `[data-slot=sidebar]`。
		 *
		 * 侧栏指纹（实测）：收起时 0 个会话行、按钮标签是 Open sidebar；展开时按钮变 Collapse sidebar，
		 * 且列表**截断**（还有 Show N more sessions 按钮、工作区分组可能 aria-expanded=false）。
		 * 所以每一拍按当前状态决定动作，而不是只点一次就完事：插件 apply 跑得很早，那一下点击可能被
		 * 尚未挂好 handler 的界面吞掉（实测踩过：只点一次 ⇒ rowSeen 始终 false）。按标签判断方向也保证
		 * 重复点击安全——侧栏已开时 Open sidebar 这个按钮就不存在了，不会反过来把它关掉。
		 *
		 * 目标找不到（会话未加载、分组没展开）就静默放弃，最多 20s，等于本功能之前的行为。
		 * @param ctx - 浏览器插件上下文（用它的 effect 挂清理，HMR 不留定时器）。
		 */
		/**
		 * v0.2.2：推送里的 `#web` 链接把来源会话放在 **URL hash 片段**（`…#session-<uuid>`，服务端
		 * `lib/index.js:webUrl()` 拼），这里把它兑现成「主视图切到那个会话」。
		 *
		 * 用片段而不是查询参数，两条实测理由（VM1 的 DSH Web，2026-10-17）：`?token=` 入口回的是
		 * `303 → Location: ./`，查询串在这一步被丢掉，而 fragment 跨跳转保留；网页客户端没有路由，
		 * 路径与查询串都没人读。
		 *
		 * v0.2.3 关键修正（用户真机实遇）：**网页已经开着时再点另一条推送**，App 的 WebActivity 是
		 * singleTask，`onNewIntent` 会 `loadUrl(新链接)`，但新链接与当前页只差一个片段 ⇒ WebView 做的是
		 * **同文档跳转、不重载页面** ⇒ 只在模块加载时跑一次的旧实现根本不会再执行，于是停在用户上一个
		 * 会话。所以这里同时挂 **`hashchange` 监听**：片段一变就重新切。之所以每次都能触发，是因为成功
		 * 之后会把片段抹掉（`replaceState` 不产生 hashchange，不会自激），地址常态是无片段的。
		 *
		 * 抓手全是语义化选择器（不依赖哈希类名）：当前会话 `[data-conversation-session=…]`、侧栏行
		 * `[data-row-key=session:<id>]`（实测点它就能切主视图）。侧栏收起时 0 个会话行、按钮标签是
		 * Open sidebar；展开后按钮变 Collapse sidebar，且列表**截断**（Show N more sessions、
		 * 工作区分组 aria-expanded=false）⇒ 每一拍按当前状态决定一个动作，而不是只点一次：插件 apply
		 * 跑得很早，那一下点击会被尚未挂好 handler 的界面吞掉（实测 rowSeen 恒 false）。按标签判断方向
		 * 也保证重复点安全——侧栏已开时 Open sidebar 这个按钮就不存在了。
		 *
		 * 目标找不到就静默放弃（≤20s），等于本功能之前的行为，MUST NOT 影响页面其余部分。
		 * @param ctx - 浏览器插件上下文（用它的 effect 挂清理：定时器与监听都不留残留）。
		 */
		function revealFromHash(ctx) {
			const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
			// 每次现读 hash：hashchange 之后要读新值，不能只在开头读一次。
			const readTarget = () => {
				const raw = String(location.hash || "").replace(/^#/, "").trim();
				DIAG.hash = String(location.hash || "");
				return SESSION_ID.test(raw) ? raw : "";
			};
			let timer = 0;
			const stop = () => {
				if (timer !== 0) {
					clearInterval(timer);
					timer = 0;
				}
			};
			// 切到某个会话：轮询到「当前会话就是它」为止，到位后抹掉片段。
			const reveal = (target) => {
				stop();
				let tries = 0;
				let done = false;
				// 侧栏是我们为了点到行才展开的：到位后要恢复原状（窄屏下它是抽屉，会盖住对话）。
				// 只有我们自己开过的才关，用户本来就开着的一律不动。
				let openedByUs = false;
				let closeTries = 0;
				let moreClicked = false;
				const groupsTried = new Set();
				const clearHash = () => {
					try {
						history.replaceState(null, "", location.pathname + location.search);
					} catch {
						// 某些 webview 限制 replaceState：抹不掉只是刷新会再切一次，不影响本次跳转。
					}
				};
				// 首选 DSH 客户端自己的服务：`ctx.uiWorkspace.openSession(id)`——bundle 实测 `uiWorkspace`
				// 的 client 服务，DSH 自家插件就用它切主视图。走这条路**侧栏根本不会弹出来**，这正是用户要的
				// 「不弹侧边栏直接切换」。服务缺失或点了没生效时，才退回「展开侧栏 → 点那一行」的老路子。
				// `uiWorkspace` 是**声明依赖才拿得到**的 client 服务：bundle 里 DSH 自家插件一律写
				// `ctx.inject([... , "uiWorkspace"], scope => scope.uiWorkspace.openSession(id))`。直接读
				// `ctx.uiWorkspace` 实测拿不到（v0.2.5 第一版就是这样，service 恒 false 只能走降级）。
				let workspaceApi = null;
				// inject 的回调**不保证同步**跑到（实测第一拍时还没到货）。没有这个标志就会在服务到货前
				// 误判成「服务不可用」而去点侧栏开关——抽屉闪一下，正是用户不要的效果。
				let workspaceProbed = false;
				try {
					ctx.inject(["uiWorkspace"], (scope) => {
						workspaceProbed = true;
						workspaceApi = scope.uiWorkspace ?? null;
					});
				} catch {
					// 注入不了就永远走点侧栏行的降级路子。
				}
				const openViaService = () => {
					try {
						if (workspaceApi === null || typeof workspaceApi.openSession !== "function") return false;
						workspaceApi.openSession(target);
						DIAG.service = true;
						return true;
					} catch {
						return false;
					}
				};
				const step = () => {
					if (done) {
						stop();
						return;
					}
					tries += 1;
					DIAG.tries = tries;
					try {
						if (document.querySelector('[data-conversation-session="' + target + '"]')) {
							// 到位。若侧栏是我们为了点行才展开的，先把它收回去再收尾（窄屏下侧栏是抽屉，
							// 会盖住对话）；用户本来就开着的一律不动。
							const rowsStill = document.querySelectorAll('[data-row-key^="session:"]').length > 0;
							if (openedByUs && rowsStill && closeTries < 4) {
								closeTries += 1;
								// 收起必须按标签找：收起态下侧栏根的第一个按钮就是开关，但**展开态下第一个是
								// New session**（实测 openBtns = New session、Collapse sidebar、New session、Plugins、
								// Search sessions），拿位置当锚点会点错。标签只有 zh/en 两套，配对即完备。
								const back = document.querySelector('button[aria-label="Collapse sidebar"], button[aria-label="收起侧边栏"]')
										?? [].slice.call(document.querySelectorAll('[data-slot="sidebar"] button'))
											.filter((b) => /collapse|收起/i.test(String(b.getAttribute("aria-label"))))[0]
										?? null;
								if (back !== null) {
									DIAG.closed = true;
									back.click();
									return;
								}
							}
							done = true;
							DIAG.done = true;
							stop();
							clearHash();
							return;
						}
						if (tries > 40) {
							stop();
							return;
						}
						// 服务优先：前 8 拍（4 秒）只试 openSession，**绝不碰侧栏**——inject 可能晚一拍到货；
						// openSession 幂等，每拍重点一次没有副作用。8 拍还不成才降级去点侧栏的行。
						if (tries <= 8) {
							if (openViaService()) return;
							// 服务还没确认不可用（inject 未到货，或到货了但这一拍没成）⇒ 这一拍什么都不点，
							// 绝不先开侧栏。只有确认服务不存在才提前降级。
							if (workspaceProbed === false || workspaceApi !== null) return;
						}
						const row = document.querySelector('[data-row-key="session:' + target + '"]');
						if (row !== null) {
							DIAG.rowSeen = true;
							DIAG.clicks += 1;
							row.click();
							return;
						}
						// 展开侧栏那颗按钮的标签是本地化的（en `Open sidebar` / zh 「打开侧边栏」），只按英文
						// 标签找在中文手机上必然为空。首选与语言无关的锚点：收起态下侧栏根里的第一个按钮
						// 就是这颗开关（实测 sameElement:true），且收起态 0 个会话行 ⇒ 「一个行都没有才点它」
						// 既有效又安全（不会反向关掉已展开的侧栏）。
						const rowsPresent = document.querySelectorAll('[data-row-key^="session:"]').length > 0;
						const toggle = rowsPresent ? null : (document.querySelector('[data-slot="sidebar"] button')
								?? document.querySelector('button[aria-label="Open sidebar"], button[aria-label="打开侧边栏"]'));
						if (toggle !== null) {
							DIAG.opened = true;
							openedByUs = true;
							toggle.click();
							return;
						}
						if (!moreClicked) {
							// 同样本地化：en `Show {n} more sessions` / zh 「展开其余 {n} 个会话」；`收起` 是已展开
							// 后的反向按钮，MUST NOT 点，所以只匹配展开这一个方向。
							const more = [].slice.call(document.querySelectorAll('button,[role="button"]')).filter((b) => /show\s*\d+\s*more|展开其余/i.test(String(b.textContent)))[0];
							if (more !== undefined) {
								moreClicked = true;
								more.click();
								return;
							}
						}
						const collapsed = [].slice.call(document.querySelectorAll('[data-row-key^="workspace:"]'))
							.filter((g) => g.getAttribute("aria-expanded") === "false");
						for (const group of collapsed) {
							const key = group.getAttribute("data-row-key") || "";
							if (groupsTried.has(key)) continue;
							groupsTried.add(key);
							group.click();
							return;
						}
					} catch {
						// 任何一次尝试出错都不算失败：继续下一拍，超时自然停。
					}
				};
				timer = setInterval(step, 500);
				step();
			};


		const first = readTarget();
			if (first.length > 0) reveal(first);
			// 网页已开着时点另一条推送：只发生片段跳转，不重载页面 ⇒ 靠这个监听。
			const onHash = () => {
				const target = readTarget();
				if (target.length > 0) reveal(target);
			};
			window.addEventListener("hashchange", onHash);
			// 注意 `ctx.effect(fn)` 里的 fn 是**立即执行**的效果体，**它返回的那个函数**才是清理器
			// （本文件上面那处就是 `ctx.effect(() => () => …)`）。写成 `ctx.effect(() => { 清理… })`
			// 会在挂上监听的同一刻就把监听摘掉——v0.2.3 第一版正是这么坏的（实测 hashchange 不触发）。
			ctx.effect(() => () => {
				stop();
				window.removeEventListener("hashchange", onHash);
			}, "dsh-push-host: reveal session from hash");
		}

		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
