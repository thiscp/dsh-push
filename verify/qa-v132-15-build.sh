set -e
export JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64
export PATH=$HOME/gradle-8.7/bin:$JAVA_HOME/bin:$PATH
cd ~/work/projects/dsh-push/android-app
echo "--- SRC HASH GATE (must match laptop HEAD db385d5) ---"
sha256sum app/src/main/java/xyz/cpyh/dshpush/WebActivity.kt
sha256sum app/src/main/java/xyz/cpyh/dshpush/PushService.kt
echo "--- BUILD clean assembleDebug ---"
gradle clean assembleDebug < /dev/null 2>&1 | tail -20
APK=app/build/outputs/apk/debug/app-debug.apk
stat -c %s "$APK"
sha256sum "$APK"
echo "--- DEX LITERAL CHECK ---"
rm -rf /tmp/qa-apkx; mkdir -p /tmp/qa-apkx
cd /tmp/qa-apkx
unzip -o -q ~/work/projects/dsh-push/android-app/$APK 'classes*.dex'
for pat in ancBigPos __cbOk isLayout isCode isPanel innerBig Dc7zOa_root BynINW_ 1.32.15; do
  n=$(cat classes*.dex | tr -c '[:print:]' '\n' | grep -c -- "$pat" || true)
  printf "DEXHIT %s=%s\n" "$pat" "$n"
done
echo "BUILD_DONE"
