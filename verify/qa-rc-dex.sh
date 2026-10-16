set -e
APK=~/work/projects/dsh-push/android-app/app/build/outputs/apk/debug/app-debug.apk
sha256sum "$APK"
rm -rf /tmp/qa-rc-dex; mkdir -p /tmp/qa-rc-dex
cd /tmp/qa-rc-dex
unzip -o -q "$APK" classes*.dex
for pat in __bwSbEl __bwBgEl __bwW __bwRailW bwFind bwGeomFix bwAlpha bwPanelBg bwHandle bwFpSb bwFpPlace bwFpExp grid-template-columns MutationObserver __dshGlass isCode isCB innerBig appVer appVerCache getPackageInfo; do
  n=$(cat classes*.dex | tr -c "[:print:]" "\n" | grep -c -- "$pat" || true)
  printf "DEXHIT %s=%s\n" "$pat" "$n"
done
for pat in APP_VER 1.32.15 1.32.16; do
  n=$(cat classes*.dex | tr -c "[:print:]" "\n" | grep -c -- "$pat" || true)
  printf "DEXNEG %s=%s\n" "$pat" "$n"
done
BT=$(ls -d /home/user/android-sdk/build-tools/*/ 2>/dev/null | tail -1 || true)
if [ -n "$BT" ] && [ -x "${BT}aapt" ]; then "${BT}aapt" dump badging "$APK" 2>/dev/null | grep -E "^package:|versionCode" || true; else echo AAPT_MISSING; fi
echo DEX_DONE