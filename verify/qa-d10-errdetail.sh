cd ~/work/projects/dsh-push/android-app
export JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64
export PATH=$HOME/gradle-8.7/bin:$JAVA_HOME/bin:$PATH
echo '--- GRADLE ERROR DETAIL ---'
gradle assembleDebug < /dev/null 2>&1 | grep -E -A14 'What went wrong|^e: |^w: .*WebActivity|FAILURE:' | head -80
echo '--- KOTLIN FILE PRESENT ---'
ls -l app/src/main/java/xyz/cpyh/dshpush/WebActivity.kt
grep -n 'function bwFind' app/src/main/java/xyz/cpyh/dshpush/WebActivity.kt | head -3
echo ERR_DETAIL_DONE
