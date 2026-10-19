# config.local.ps1 - local infra overrides for dsh-app-verify.ps1 / bw-iter.ps1.
# Copy to config.local.ps1 and fill in. Values here override script param defaults
# (but also override same-named command-line args - keep this file as the single source).
# Rule: reach devices over their Tailscale IP, never over LAN. LAN addresses drift (a laptop
# went <lan-laptop> -> <lan-laptop>) and its firewall drops new connections to the LAN address,
# so ssh/scp just time out. Tailscale fixes both. Keep the LAN IP only as a documented fallback.
$EmuIp       = "<tailnet-laptop>"           # emulator host = the LAPTOP, by tailscale IP (fallback: LAN <lan-laptop>)
$EmuUser     = "user"                    # ssh user on emulator host
$EmuRoot     = "G:\Android"              # SDK + APK staging root on emulator host
$Vm1         = "user@<tailnet-vm1>"      # build host ssh target
$Aliyun      = "aliyun"                  # ssh alias for APK distribution host
$Ntfy        = "https://ntfy.cpyh.xyz"   # ntfy server base
$Topic       = "dsh"                     # ntfy topic (production mirrors to real phone!)
$ReadToken   = "tk_REPLACE_READ"
$WriteToken  = "tk_REPLACE_WRITE"
# DSH Web link used by bw-iter.ps1 browser smoke test (token rotates on DSH restart)
$DshWebUrl   = "http://<tailnet-windows>:3080/?token=REPLACE_WITH_CURRENT_WEB_TOKEN"

# node.exe for verify/geom-matrix.mjs (10th check: column widths, both hosts, both states).
# Leave unset to use node from PATH. DSH also ships a runtime node.exe.
$Node       = "C:\path\to\node.exe"
