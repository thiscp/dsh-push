# STATUS task-20：gradle 提速对照（三组）+ build-install.ps1 -BuildHost

前提（Lead 已修正 TEAM-START `14da17c`/`534d3f4`）：**台式机无 JDK/SDK → 构建一律在测试机1 `user@<tailnet-vm1>`**；台式机仓是唯一真源，scp 覆盖到 `/home/user/work/projects/dsh-push/android-app/`，不在那台 commit。SDK 用 `local.properties` 的 `sdk.dir=/home/user/android-sdk`（同时给 `ANDROID_HOME`）。

## gradle 前后对照（测试机1 实跑）
| # | gradle.properties | 清 `app/build` | 结果 |
|---|---|---|---|
| round 1 基线 | 原样（`-Xmx1536m`+2 行） | 是 | **BUILD SUCCESSFUL in 29s** |
| round 2 提速(冷) | `+parallel +caching +configuration-cache +jvmargs=-Xmx4g` | 是 | **BUILD SUCCESSFUL in 55s**（首次要存配置缓存，反而慢） |
| round 3 提速(稳态) | 同上，不清 build 目录 | 否 | **BUILD SUCCESSFUL in 1s（wall s）** |

结论：配置缓存稳态下也**没有**比基线快（round 3 = 1s vs 基线 29s），**已按规则砍掉 configuration-cache 与 -Xmx4g，只留 parallel=true + caching=true**；砍后未再补测（如实记录）。

## 模拟器物理配置（2026-10-13 晚，Lead 已改）
`wm size` → `Physical size: 1440x3168`（无 Override 行）；`wm density` → `Physical density: 640`（无 Override 行）；CDP `innerWidth=360 / dpr=4` ✓。分辨率由 AVD `config.ini` 物理保证，**wm override 一律 reset**；备份 `config.ini.bak-1440` 在笔电 AVD 目录下。截图走 sdcard+pull，swiftshader 下慢属正常。
## build-install.ps1 实跑（2026-10-13，改造后）
`verify\build-install.ps1` + `verify\emu-do.ps1`（笔电侧助手）：**在构建机** `user@<tailnet-vm1>` 跑 gradle（`ANDROID_HOME=/home/user/android-sdk`）→ 回传 apk → 笔电装机 → 起 App。实测每一步：
| 步 | 结果 |
|---|---|
| remote gradle | `BUILD SUCCESSFUL in 676ms`（配置缓存复用，35 tasks 中 34 up-to-date） |
| 回传 apk | 10734 KB，md5 `C79BC431A9D63421381DE087C99F3472`，3s |
| `adb install -r` | `Performing Streamed Install` / **`Success`**，1s |
| `am start -a VIEW -d <url> <pkg>` | **失败**：`Error: Activity not started, unable to resolve Intent { act=VIEW dat=… pkg=xyz.cpyh.dshpush }` |
| 回退 `adb root` + `am start -n xyz.cpyh.dshpush/.WebActivity --es url "<url>"` | **成功**：`Starting: Intent { cmp=xyz.cpyh.dshpush/.WebActivity (has extras) }`，8s |

结论：**起 App 必须走 WebActivity + `--es url` 回退**（VIEW intent 对这个包解析不了，WebActivity 未导出所以要 `adb root`）。token 每次现场从 `web.log` 取（本轮 `-OgndPTGax…`）。