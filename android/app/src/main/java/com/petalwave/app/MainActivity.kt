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
        fun alive(): Boolean { val a = current; return a != null && a::web.isInitialized && App.serverReady }
        fun cmd(c: String) {
            val a = current ?: return
            a.runOnUiThread { if (a::web.isInitialized) a.web.evaluateJavascript("document.dispatchEvent(new CustomEvent('pw-cmd',{detail:" + JSONObject.quote(c) + "}))", null) }
        }
    }
    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingShare: String? = null
    private var pickId: String? = null
    private var pendingCmd: String? = null                       // botón del widget con la app cerrada
    private var camRequest: android.webkit.PermissionRequest? = null   // la cámara para leer códigos QR

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0B0708"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            // seguridad: la interfaz no necesita leer archivos del teléfono por file:// ni content://
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            if (Build.VERSION.SDK_INT >= 26) settings.safeBrowsingEnabled = true
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
                    pendingCmd?.let { c -> pendingCmd = null; view.postDelayed({ cmd(c) }, 2500) }
                }
            }
            webChromeClient = object : WebChromeClient() {
                // cámara (solo para leer códigos QR de playlists compartidas, y solo desde la interfaz de Petalwave)
                override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                    runOnUiThread {
                        val wantsCam = request.resources.contains(android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                        val ours = request.origin?.host == "127.0.0.1"
                        if (!wantsCam || !ours) { request.deny(); return@runOnUiThread }
                        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) request.grant(arrayOf(android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                        else { camRequest?.deny(); camRequest = request; requestPermissions(arrayOf(Manifest.permission.CAMERA), 8) }
                    }
                }
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
        pendingCmd = trustedCmd(intent)
        // el servicio mantiene viva la música con la pantalla apagada y arranca el servidor interno
        val svc = Intent(this, PlayerService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc) else startService(svc)
        Thread {
            App.ctx.startServer()
            runOnUiThread {
                if (App.serverReady) { setContentView(web); App.setTokenCookie { web.loadUrl("http://127.0.0.1:${App.PORT}/") } }
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
        if (code == 8) {
            val r = camRequest; camRequest = null
            if (res.isNotEmpty() && res[0] == PackageManager.PERMISSION_GRANTED) r?.grant(arrayOf(android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else r?.deny()
            return
        }
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
        if (requestCode == 43) {
            val id = pickId ?: return
            pickId = null
            val path = if (resultCode == RESULT_OK) data?.data?.let { treeToPath(it) } else null
            if (data?.data != null && path == null) runOnUiThread { android.widget.Toast.makeText(this, "Esa carpeta no se puede usar: elegí una de la memoria del teléfono o de la tarjeta SD", android.widget.Toast.LENGTH_LONG).show() }
            hostMsg("picked:$id:" + (path ?: ""))
        }
    }

    // compartir un link desde YouTube / YouTube Music / el navegador → va a la pantalla de descargas
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); handleShare(intent)
        trustedCmd(intent)?.let { cmd(it) }
    }
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

    // carpeta elegida en el explorador del teléfono (content://…/tree/primary:Music/Rock) → ruta de archivo
    private fun treeToPath(uri: Uri): String? {
        return try {
            val doc = android.provider.DocumentsContract.getTreeDocumentId(uri)   // "primary:Music/Rock" o "1A2B-3C4D:Musica"
            if (uri.authority != "com.android.externalstorage.documents") return null
            val i = doc.indexOf(':')
            val vol = if (i >= 0) doc.substring(0, i) else doc
            val rel = if (i >= 0) doc.substring(i + 1) else ""
            val base = if (vol.equals("primary", true)) android.os.Environment.getExternalStorageDirectory().absolutePath else "/storage/$vol"
            val f = File(if (rel.isEmpty()) base else "$base/$rel")
            if (f.isDirectory) f.absolutePath else null
        } catch (_: Exception) { null }
    }

    // comandos del widget con la app cerrada: solo si traen la clave privada de Petalwave
    // (la pantalla principal es pública porque la abre el lanzador; sin esto cualquier app podía manejar la música)
    private fun trustedCmd(i: Intent?): String? {
        val c = i?.getStringExtra("pw_cmd") ?: return null
        if (c !in setOf("prev", "toggle", "next")) return null
        return if (i.getStringExtra("pw_key") == WidgetButtons.key(this)) c else null
    }

    private fun hostMsg(m: String) {
        if (::web.isInitialized) runOnUiThread { web.evaluateJavascript("window.__pwHost&&window.__pwHost(" + JSONObject.quote(m) + ")", null) }
    }

    private fun openExternal(url: String) {
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) { }
    }

    inner class NativeBridge {
        @JavascriptInterface fun open(url: String) = runOnUiThread { openExternal(url) }
        @JavascriptInterface fun platform(): String = "android"
        // "wifi", "datos" o "sin" (para las descargas inteligentes: por defecto solo con WiFi)
        @JavascriptInterface fun net(): String = try {
            val cm = getSystemService(android.net.ConnectivityManager::class.java)
            val caps = cm.getNetworkCapabilities(cm.activeNetwork)
            when {
                caps == null -> "sin"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET) -> "wifi"
                cm.isActiveNetworkMetered -> "datos"
                else -> "wifi"
            }
        } catch (_: Exception) { "wifi" }
        @JavascriptInterface fun media(json: String) = PlayerService.update(json)
        // iniciar sesión con Google (ver LoginActivity); el resultado vuelve a la interfaz como "login:ok|err|cancel"
        // elegir carpeta con el explorador de archivos del teléfono; la ruta vuelve como "picked:<id>:<ruta>"
        @JavascriptInterface fun pickFolder(id: String) = runOnUiThread {
            pickId?.let { hostMsg("picked:$it:") }
            pickId = id
            try { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), 43) }
            catch (e: Exception) { pickId = null; hostMsg("picked:$id:") }
        }
        // guarda una imagen PNG en Imágenes/Petalwave y, si se pide, abre "compartir"
        @JavascriptInterface fun saveImage(b64: String, name: String, share: Boolean): String = try {
            val bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT)
            val safe = name.replace(Regex("[^\\w.-]"), "_").ifEmpty { "petalwave.png" }
            val uri: Uri = if (Build.VERSION.SDK_INT >= 29) {
                val cv = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, safe)
                    put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png")
                    put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, android.os.Environment.DIRECTORY_PICTURES + "/Petalwave")
                }
                val u = contentResolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv) ?: throw Exception("no se pudo crear la imagen")
                contentResolver.openOutputStream(u)!!.use { it.write(bytes) }
                u
            } else {
                val bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                Uri.parse(android.provider.MediaStore.Images.Media.insertImage(contentResolver, bmp, safe, "Petalwave") ?: throw Exception("no se pudo guardar"))
            }
            if (share) runOnUiThread {
                startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Compartir"))
            }
            "ok"
        } catch (e: Exception) { "no se pudo guardar la imagen: " + (e.message ?: "error") }
        @JavascriptInterface fun login() = runOnUiThread {
            LoginActivity.onResult = { r -> hostMsg("login:" + r) }
            startActivity(Intent(this@MainActivity, LoginActivity::class.java))
        }
    }

    override fun onDestroy() {
        if (current === this) current = null
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }
}
