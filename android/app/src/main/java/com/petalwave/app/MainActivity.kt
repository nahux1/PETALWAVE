package com.petalwave.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import org.json.JSONObject
import java.io.File

// la ventana de Petalwave: la misma interfaz de Windows dentro de un WebView, hablando con el servidor interno
class MainActivity : Activity() {
    companion object {
        @Volatile private var current: MainActivity? = null
        // botones de la notificación / auriculares / pantalla bloqueada → la interfaz (evento pw-cmd)
        fun cmd(c: String) {
            val a = current ?: return
            a.runOnUiThread { if (a::web.isInitialized) a.web.evaluateJavascript("document.dispatchEvent(new CustomEvent('pw-cmd',{detail:" + JSONObject.quote(c) + "}))", null) }
        }
    }
    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingShare: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0B0708"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.userAgentString = settings.userAgentString + " PetalwaveAndroid/" + (packageManager.getPackageInfo(packageName, 0).versionName ?: "1")
            overScrollMode = View.OVER_SCROLL_NEVER
            addJavascriptInterface(NativeBridge(), "PetalwaveNative")
            webViewClient = object : WebViewClient() {
                // links de afuera (GitHub, YouTube, Google…) se abren en el navegador del teléfono
                override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                    val u = req.url
                    if (u.host == "127.0.0.1" || u.host == "localhost") return false
                    openExternal(u.toString()); return true
                }
                override fun onPageFinished(view: WebView, url: String) {
                    // window.open (botón "abrir la descarga" de la actualización, etc.) → navegador del teléfono
                    view.evaluateJavascript("window.open=function(u){try{PetalwaveNative.open(String(new URL(u,location.href)))}catch(e){}return null};", null)
                    pendingShare?.let { sendShare(it); pendingShare = null }
                }
            }
            webChromeClient = object : WebChromeClient() {
                // elegir archivos (cookies.txt, wallpaper, letras .lrc)
                override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = cb
                    return try { startActivityForResult(params.createIntent(), 42); true } catch (e: Exception) { fileCallback = null; false }
                }
            }
        }
        val loading = TextView(this).apply {
            text = "❀ Petalwave\n\npreparando…"; setTextColor(Color.parseColor("#F08A8F")); textSize = 18f
            gravity = android.view.Gravity.CENTER; setBackgroundColor(Color.parseColor("#0B0708"))
        }
        setContentView(loading)
        askPermissions()
        handleShare(intent)
        // el servicio mantiene viva la música con la pantalla apagada y arranca el servidor interno
        val svc = Intent(this, PlayerService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc) else startService(svc)
        Thread {
            App.ctx.startServer()
            runOnUiThread {
                if (App.serverReady) { setContentView(web); web.loadUrl("http://127.0.0.1:${App.PORT}/") }
                else loading.text = "No se pudo iniciar Petalwave:\n\n" + (App.serverError ?: "error desconocido")
            }
        }.start()
    }

    private fun askPermissions() {
        if (Build.VERSION.SDK_INT < 23) return
        val want = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 33) {
            want += Manifest.permission.READ_MEDIA_AUDIO; want += Manifest.permission.READ_MEDIA_VIDEO; want += Manifest.permission.POST_NOTIFICATIONS
        } else {
            want += Manifest.permission.READ_EXTERNAL_STORAGE
            if (Build.VERSION.SDK_INT <= 29) want += Manifest.permission.WRITE_EXTERNAL_STORAGE
        }
        val missing = want.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 7)
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, res: IntArray) {
        super.onRequestPermissionsResult(code, perms, res)
        // con permiso nuevo para leer música, volver a buscar canciones
        if (App.serverReady) web.evaluateJavascript("fetch('/api/library/rescan',{method:'POST'})", null)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 42) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
        }
    }

    // compartir un link desde YouTube / YouTube Music / el navegador → va a la pantalla de descargas
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleShare(intent) }
    private fun handleShare(i: Intent?) {
        if (i?.action != Intent.ACTION_SEND) return
        val txt = i.getStringExtra(Intent.EXTRA_TEXT) ?: return
        val url = Regex("https?://\\S+").find(txt)?.value ?: return
        if (App.serverReady && ::web.isInitialized) sendShare(url) else pendingShare = url
    }
    private fun sendShare(url: String) {
        web.evaluateJavascript("(()=>{const u=${JSONObject.quote(url)};document.querySelector('[data-ws=dl]')?.click();setTimeout(()=>{const t=document.getElementById('dlUrl');if(t){t.value=u;t.dispatchEvent(new Event('input'));t.focus();}},300)})()", null)
    }

    // atrás: cierra lo que esté abierto (pantalla completa, menús); si no hay nada, deja Petalwave sonando de fondo
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (!::web.isInitialized || !App.serverReady) { moveTaskToBack(true); return }
        web.evaluateJavascript("(()=>{const open=!document.getElementById('full').hidden||!document.getElementById('modal').hidden||document.querySelector('.ctx:not(#ctx)');document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return !!open})()") { r ->
            if (r != "true") moveTaskToBack(true)
        }
    }

    // la música sigue con la app en segundo plano: no se pausa el WebView
    override fun onPause() { super.onPause() }

    private fun openExternal(url: String) {
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) { }
    }

    inner class NativeBridge {
        @JavascriptInterface fun open(url: String) = runOnUiThread { openExternal(url) }
        @JavascriptInterface fun platform(): String = "android"
        @JavascriptInterface fun media(json: String) = PlayerService.update(json)
    }

    override fun onDestroy() {
        if (current === this) current = null
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }
}
