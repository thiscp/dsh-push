set -e
export JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64
export PATH=$HOME/gradle-8.7/bin:$JAVA_HOME/bin:$PATH
cd ~/work/projects/dsh-push/android-app
echo '--- SRC HASH GATE (HEAD 77389ea: 23a3169 D11 + bd12a59 appVer + c2a5711 + 77389ea bump 83/1.32.17) ---'
W=app/src/main/java/xyz/cpyh/dshpush/WebActivity.kt
P=app/src/main/java/xyz/cpyh/dshpush/PushService.kt
M=app/src/main/java/xyz/cpyh/dshpush/MainActivity.kt
WH=$(sha256sum $W | cut -d" " -f1)
PH=$(sha256sum $P | cut -d" " -f1)
MH=$(sha256sum $M | cut -d" " -f1)
echo "WEB $WH"
echo "PUSH $PH"
echo "MAIN $MH"
if [ "$WH" != "de9a9bd812c833376c96bb96321e9464c1b6dfb3721746ba4d7c5b9d09ec882f" ]; then echo WEB_HASH_MISMATCH; exit 3; fi
if [ "$PH" != "83abcf81607a43ab926f2cab2000c8b846c5d97a5f910a7eaef58ada404f315e" ]; then echo PUSH_HASH_MISMATCH; exit 3; fi
if [ "$MH" != "123241fa53bdcaf07a96716ba7978e956f952ecca1e683426f8a8287933d9555" ]; then echo MAIN_HASH_MISMATCH; exit 3; fi
echo HASH_GATE_OK
echo '--- VERSION IN GRADLE (must be 83 / 1.32.17) ---'
grep -n -E 'versionCode|versionName' app/build.gradle.kts
echo '--- BUILD clean assembleDebug ---'
gradle clean assembleDebug < /dev/null 2>&1 | tail -8
APK=app/build/outputs/apk/debug/app-debug.apk
stat -c %s "$APK"
sha256sum "$APK"
echo '--- DEX LITERAL CHECK ---'
rm -rf /tmp/qa-d10-apkx; mkdir -p /tmp/qa-d10-apkx
cd /tmp/qa-d10-apkx
unzip -o -q ~/work/projects/dsh-push/android-app/$APK 'classes*.dex'
for pat in __bwSbEl __bwBgEl __bwW __bwRailW bwFind bwGeomFix bwAlpha bwPanelBg bwHandle bwFpSb bwFpPlace bwFpExp grid-template-columns MutationObserver __dshGlass isCode isCB innerBig appVer appVerCache getPackageInfo; do
  n=$(cat classes*.dex | tr -c "[:print:]" "\n" | grep -c -- "$pat" || true)
  printf 'DEXHIT %s=%s\n' "$pat" "$n"
done
echo '--- DEX NEGATIVE CHECK (must be 0) ---'
for pat in APP_VER 1.32.15 1.32.16; do
  n=$(cat classes*.dex | tr -c "[:print:]" "\n" | grep -c -- "$pat" || true)
  printf 'DEXNEG %s=%s\n' "$pat" "$n"
done
echo '--- APK VERSION (aapt if present) ---'
BT=$(ls -d /home/user/android-sdk/build-tools/*/ 2>/dev/null | tail -1)
if [ -n "$BT" ] && [ -x "${BT}aapt" ]; then "${BT}aapt" dump badging ~/work/projects/dsh-push/android-app/$APK 2>/dev/null | grep -E "^package|versionCode"; else echo AAPT_MISSING; fi
echo BUILD_DONE
