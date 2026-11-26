import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.chaquo.python")
}

// la misma interfaz de Windows (index.html + ui/) y el puente de YouTube Music, copiados dentro del paquete de Python
val root = rootDir.parentFile
val pyPkg = file("src/main/python/petalwave")
val syncWww by tasks.registering(Copy::class) {
    from(root) { include("index.html", "version.json") }
    from(File(root, "ui")) { into("ui") }
    from(File(root, "build/icon.png"))
    into(File(pyPkg, "www"))
}
val syncBridge by tasks.registering(Copy::class) {
    from(File(root, "src/ytm_bridge.py"))
    into(pyPkg)
}
tasks.named("preBuild") { dependsOn(syncWww, syncBridge) }
// las tareas de Chaquopy leen esa carpeta: que esperen a la copia
tasks.matching { it.name.contains("Python") }.configureEach { dependsOn(syncWww, syncBridge) }

// firma: android/keystore.properties (no se sube a GitHub)
val ks = Properties().apply { val f = rootProject.file("keystore.properties"); if (f.exists()) f.inputStream().use { load(it) } }

android {
    namespace = "com.petalwave.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.petalwave.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 20
        versionName = "1.16.0"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }
    signingConfigs {
        create("release") {
            if (ks.isNotEmpty()) {
                storeFile = rootProject.file(ks.getProperty("storeFile"))
                storePassword = ks.getProperty("storePassword")
                keyAlias = ks.getProperty("keyAlias")
                keyPassword = ks.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (ks.isNotEmpty()) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

// motor nativo (beta) y Android Auto: Media3 de Google (ExoPlayer + sesiÃ³n de medios)
dependencies {
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-session:1.4.1")
}

chaquopy {
    defaultConfig {
        version = "3.12"
        buildPython(System.getenv("PETALWAVE_BUILD_PYTHON") ?: "python")
        pip {
            install("yt-dlp")
            install("ytmusicapi")
            install("mutagen")
        }
        // la interfaz (www/) tiene que estar en archivos de verdad para que el servidor la sirva
        extractPackages("petalwave")
        pyc { src = false }
    }
}
