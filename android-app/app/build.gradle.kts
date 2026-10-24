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
        versionCode = 140
        versionName = "1.33.34"
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
}
