set -e
export JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64
export PATH=$HOME/gradle-8.7/bin:$JAVA_HOME/bin:$PATH
cd ~/work/projects/dsh-push/android-app
echo '--- SRC HASH GATE (must match laptop HEAD 4a039ab) ---'
W=app/src/main/java/xyz/cpyh/dshpush/WebActivity.kt
P=app/src/main/java/xyz/cpyh/dshpush/PushService.kt
WH=$(sha256sum $W | cut -d' ' -f1)
PH=$(sha256sum $P | cut -d' ' -f1)
echo "WEB $WH"
echo "PUSH $PH"
if [ "$WH" != "9cd33fdf28e92504e36a2c213fa89d45d44e98081ae80095efe9be2e4aa8117b" ]; then echo WEB_HASH_MISMATCH; exit 3; fi
if [ "$PH" != "0ee98aabcfb9f21d998b3d108c5a0e416e0342a6179bd51ef2f5ac15cb59cc49" ]; then echo PUSH_HASH_MISMATCH; exit 3; fi
echo HASH_GATE_OK
echo '--- BUILD clean assembleDebug ---'
gradle clean assembleDebug < /dev/null 2>&1 | tail -20
APK=app/build/outputs/apk/debug/app-debug.apk
stat -c %s "$APK"
sha256sum "$APK"
echo '--- DEX LITERAL CHECK ---'
rm -rf /tmp/qa-d1-apkx; mkdir -p /tmp/qa-d1-apkx
cd /tmp/qa-d1-apkx
unzip -o -q ~/work/projects/dsh-push/android-app/$APK 'classes*.dex'
for pat in __qaCb __qaN __qaSeq __qaRec isCode isCB ancBigPos isLayout isPanel innerBig 1.32.15; do
  n=$(cat classes*.dex | tr -c '[:print:]' '\n' | grep -c -- "$pat" || true)
  printf 'DEXHIT %s=%s\n' "$pat" "$n"
done
echo BUILD_DONE
