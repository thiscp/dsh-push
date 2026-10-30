plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "xyz.cpyh.dshpush"
    compileSdk = 34
    defaultConfig {
        applicationId = "xyz.cpyh.dshpush"
        minSdk = 26
        targetSdk = 34
        versionCode = 162
        versionName = "1.34.2"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // 扫码配对（v1.33.53）：只用 zxing 的纯 Java core（600 KB，无 Android 依赖），
    // 相机与预览自己用 Camera2 写。刻意不用 zxing-android-embedded —— 它依赖
    // androidx.appcompat，而本 App 至今没有任何 androidx 依赖，为扫个码拉进整条 androidx
    // 链会让 APK 胖一圈、还得跟现有主题打架。
    implementation("com.google.zxing:core:3.5.3")
}
