package com.petalwave.app

import android.app.Application
import android.os.Environment
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

// arranca Python y el servidor interno de Petalwave (una sola vez por proceso)
class App : Application() {
    companion object {
        const val PORT = 37373
        lateinit var ctx: App
        @Volatile var serverReady = false
        @Volatile var serverError: String? = null

        fun musicDir(): File = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC), "Petalwave")
        fun videoDir(): File = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Petalwave")
    }

    override fun onCreate() {
        super.onCreate()
        ctx = this
        if (!Python.isStarted()) Python.start(AndroidPlatform(this))
    }

    @Synchronized
    fun startServer() {
        if (serverReady) return
        try {
            val py = Python.getInstance()
            val version = packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.0"
            val scan = listOf(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC).absolutePath,
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).absolutePath,
            )
            py.getModule("petalwave.server").callAttr(
                "start", File(filesDir, "data").absolutePath, musicDir().absolutePath, videoDir().absolutePath, version, PORT,
                py.builtins.callAttr("list", scan.toTypedArray()),
            )
            // esperar a que responda
            for (i in 0 until 100) {
                try {
                    val c = URL("http://127.0.0.1:$PORT/api/status").openConnection() as HttpURLConnection
                    c.connectTimeout = 500; c.readTimeout = 2000
                    if (c.responseCode == 200) { serverReady = true; return }
                } catch (_: Exception) { }
                Thread.sleep(150)
            }
            serverError = "el servidor interno no respondió"
        } catch (e: Throwable) {
            serverError = e.toString()
        }
    }
}
