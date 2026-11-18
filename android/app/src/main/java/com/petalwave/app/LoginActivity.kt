package com.petalwave.app

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URL

// iniciar sesión en YouTube / YouTube Music: la página de Google dentro de Petalwave.
// La contraseña se escribe en la página de Google; Petalwave no la ve ni la guarda. Al terminar se guardan
// solo las cookies de youtube.com (cookies.txt del servidor interno) y se borran las del WebView.
class LoginActivity : Activity() {
    companion object {
        const val LOGIN_URL = "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true" +
            "&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Dm%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F"
        @Volatile var onResult: ((String) -> Unit)? = null
    }
    private lateinit var web: WebView
    private var done = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.removeAllCookies(null)   // empezar sin sesiones viejas
        web = WebView(this).apply {
            setBackgroundColor(Color.WHITE)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.saveFormData = false
            // Google rechaza los WebView ("este navegador no es seguro"): se presenta como Chrome para Android
            settings.userAgentString = settings.userAgentString.replace("; wv", "").replace(Regex("Version/\\S+ "), "")
            cm.setAcceptThirdPartyCookies(this, true)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                    val s = req.url.scheme ?: ""
                    return !(s == "https" || s == "http")   // intent://, market://… no se abren acá
                }
                override fun onPageFinished(view: WebView, url: String) { check(url) }
            }
        }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#0B0708")); setPadding(28, 22, 28, 22)
            addView(TextView(context).apply {
                text = "❀ Iniciar sesión con Google"; setTextColor(Color.parseColor("#F08A8F")); textSize = 15f
                layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
            })
            addView(TextView(context).apply {
                text = "Cancelar"; setTextColor(Color.parseColor("#E8D9DA")); textSize = 14f; setPadding(24, 8, 8, 8)
                setOnClickListener { finish() }
            })
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(bar, LinearLayout.LayoutParams(-1, -2))
            addView(FrameLayout(context).apply { addView(web, FrameLayout.LayoutParams(-1, -1)) }, LinearLayout.LayoutParams(-1, 0, 1f))
        }
        setContentView(root)
        web.loadUrl(LOGIN_URL)
    }

    private fun check(url: String) {
        if (done) return
        val host = Uri.parse(url).host ?: return
        if (!host.endsWith("youtube.com")) return
        val cm = CookieManager.getInstance()
        cm.flush()
        val jar = LinkedHashMap<String, String>()
        for (site in listOf("https://www.youtube.com", "https://music.youtube.com", "https://m.youtube.com")) {
            (cm.getCookie(site) ?: "").split(";").forEach {
                val i = it.indexOf('=')
                if (i > 0) jar[it.substring(0, i).trim()] = it.substring(i + 1).trim()
            }
        }
        // sesión completa: SAPISID + __Secure-3PAPISID + SID. Si todavía no, seguir esperando.
        if (!jar.containsKey("SAPISID") || !jar.containsKey("__Secure-3PAPISID") || !jar.containsKey("SID")) return
        done = true
        web.visibility = View.INVISIBLE
        val exp = System.currentTimeMillis() / 1000 + 180L * 24 * 3600
        val txt = StringBuilder("# Netscape HTTP Cookie File\n# Petalwave (Android)\n")
        for ((k, v) in jar) {
            // las __Host- son de un solo dominio; el resto, de todo youtube.com
            if (k.startsWith("__Host-")) txt.append("music.youtube.com\tFALSE\t/\tTRUE\t$exp\t$k\t$v\n")
            else txt.append(".youtube.com\tTRUE\t/\tTRUE\t$exp\t$k\t$v\n")
        }
        Thread {
            val res = try {
                val c = URL("http://127.0.0.1:${App.PORT}/api/cookies").openConnection() as HttpURLConnection
                c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 8000; c.readTimeout = 20000
                c.setRequestProperty("Content-Type", "text/plain; charset=utf-8")
                c.outputStream.use { it.write(txt.toString().toByteArray()) }
                val code = c.responseCode
                val body = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: ""
                if (code < 400) "ok:${jar.size}" else "err:" + body.take(200)
            } catch (e: Exception) { "err:" + (e.message ?: "sin conexión con Petalwave") }
            runOnUiThread {
                CookieManager.getInstance().removeAllCookies(null)   // la sesión queda solo en Petalwave
                onResult?.invoke(res); onResult = null
                finish()
            }
        }.start()
    }

    override fun onDestroy() {
        if (!done) { onResult?.invoke("cancel"); onResult = null; CookieManager.getInstance().removeAllCookies(null) }
        web.destroy()
        super.onDestroy()
    }
}
