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
        // el motor nativo avisa su estado a la interfaz (canción, play/pausa, posición)
        fun nativeEvent(json: String) { current?.hostMsg("nstate:$json") }
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
    private var pendingCmd: String? = null
    private var pendingGo: String? = null                         // atajo del ícono (mix, descubrí, me gusta, ¿qué suena?)                       // botón del widget con la app cerrada
    private var camRequest: android.webkit.PermissionRequest? = null   // cámara (QR) o micrófono (¿qué suena?) pendiente
    private var camRes: Array<String> = emptyArray()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        // solo en la versión de prueba (debug): permitir inspeccionar la interfaz desde la PC. La publicada no lo tiene.
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
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
                    pendingGo?.let { g -> pendingGo = null; view.postDelayed({ hostMsg("go:$g") }, 1200) }
                }
            }
            webChromeClient = object : WebChromeClient() {
                // cámara (solo para leer códigos QR de playlists compartidas, y solo desde la interfaz de Petalwave)
                override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                    runOnUiThread {
                        // cámara (leer QR) y micrófono ("¿qué suena?"): solo para la interfaz de Petalwave y pidiendo permiso a Android
                        val ours = request.origin?.host == "127.0.0.1"
                        val res = request.resources.filter { it == android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE }
                        if (!ours || res.isEmpty()) { request.deny(); return@runOnUiThread }
                        val perms = res.map { if (it == android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE) Manifest.permission.CAMERA else Manifest.permission.RECORD_AUDIO }
                        val missing = perms.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
                        if (missing.isEmpty()) request.grant(res.toTypedArray())
                        else { camRequest?.deny(); camRequest = request; camRes = res.toTypedArray(); requestPermissions(missing.toTypedArray(), 8) }
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
            text = "❀"; setTextColor(Color.parseColor("#F08A8F")); textSize = 64f
            gravity = android.view.Gravity.CENTER; setBackgroundColor(Color.parseColor("#0B0708"))
            animate().rotationBy(3600f).setDuration(40000).setInterpolator(android.view.animation.LinearInterpolator()).start()
        }
        setContentView(loading)
        askPermissions()
        handleShare(intent)
        pendingCmd = trustedCmd(intent)
        pendingGo = goOf(intent)
        // el servicio mantiene viva la música con la pantalla apagada y arranca el servidor interno
        if (getSharedPreferences("petalwave", MODE_PRIVATE).getBoolean("native", false)) startService(Intent(this, NativeService::class.java))
        else { val svc = Intent(this, PlayerService::class.java); if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc) else startService(svc) }
        Thread {
            App.ctx.startServer()
            runOnUiThread {
                if (App.serverReady) { setContentView(web); App.setTokenCookie { web.loadUrl("http://127.0.0.1:${App.PORT}/") } }
                else { loading.animate().cancel(); loading.rotation = 0f; loading.textSize = 16f; loading.text = "No se pudo iniciar Petalwave:\n\n" + (App.serverError ?: "error desconocido") }
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
            if (res.isNotEmpty() && res.all { it == PackageManager.PERMISSION_GRANTED }) r?.grant(camRes) else r?.deny()
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
        goOf(intent)?.let { hostMsg("go:$it") }
        if (intent.action == "com.petalwave.app.INSTALL_STATUS") Updater.onStatus(this, intent) { m -> hostMsg("upd:$m") }
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
    private fun goOf(i: Intent?): String? = i?.getStringExtra("pw_go")?.takeIf { it in setOf("mix", "disc", "liked", "recognize", "search") }
    private fun trustedCmd(i: Intent?): String? {
        val c = i?.getStringExtra("pw_cmd") ?: return null
        if (c !in setOf("prev", "toggle", "next")) return null
        return if (i.getStringExtra("pw_key") == WidgetButtons.key(this)) c else null
    }

    // ExoPlayer se maneja desde el hilo principal; si el servicio todavía no arrancó, se lo arranca y se reintenta
    private fun withNative(fn: (NativeService) -> Unit) {
        runOnUiThread {
            val s = NativeService.instance
            if (s != null) { try { fn(s) } catch (_: Exception) { } ; return@runOnUiThread }
            startService(Intent(this, NativeService::class.java))
            web.postDelayed({ NativeService.instance?.let { try { fn(it) } catch (_: Exception) { } } }, 600)
        }
    }

    fun hostMsg(m: String) {
        if (::web.isInitialized) runOnUiThread { web.evaluateJavascript("window.__pwHost&&window.__pwHost(" + JSONObject.quote(m) + ")", null) }
    }

    private fun openExternal(url: String) {
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) { }
    }

    inner class NativeBridge {
        @JavascriptInterface fun open(url: String) = runOnUiThread { openExternal(url) }
        @JavascriptInterface fun platform(): String = "android"
        // batería para el modo ahorro: {"level":0.0-1.0,"charging":true|false}
        @JavascriptInterface fun battery(): String = try {
            val bm = getSystemService(android.os.BatteryManager::class.java)
            val lvl = bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY) / 100.0
            val chg = if (Build.VERSION.SDK_INT >= 23) bm.isCharging else false
            "{\"level\":$lvl,\"charging\":$chg}"
        } catch (_: Exception) { "{\"level\":1,\"charging\":true}" }
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
        // actualizar desde la app (ver Updater): baja el APK de GitHub, verifica el SHA-256 y abre el instalador
        // ---------- motor nativo (beta) ----------
        // la preferencia queda guardada en Android: con el motor nativo no hace falta el servicio viejo
        // cambiar de motor: se apaga el otro servicio (si no, quedaban dos notificaciones)
        @JavascriptInterface fun nativeEngine(on: Boolean) = runOnUiThread {
            getSharedPreferences("petalwave", MODE_PRIVATE).edit().putBoolean("native", on).apply()
            if (on) { stopService(Intent(this@MainActivity, PlayerService::class.java)); startService(Intent(this@MainActivity, NativeService::class.java)) }
            else {
                NativeService.instance?.cmd("stop"); stopService(Intent(this@MainActivity, NativeService::class.java))
                val svc = Intent(this@MainActivity, PlayerService::class.java); if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc) else startService(svc)
            }
        }
        // solo en la versión de prueba: ver qué mostraría Android Auto en una carpeta
        @JavascriptInterface fun nBrowseTest(parent: String): String {
            if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE == 0) return ""
            val s = NativeService.instance ?: return "sin servicio"
            return try { org.json.JSONArray(s.childrenFor(parent).map { (it.mediaMetadata.title ?: "").toString() + (if (it.mediaMetadata.isBrowsable == true) " ▸" else "") + " | " + (it.localConfiguration?.uri ?: "") }).toString() } catch (e: Exception) { "error: " + e.message }
        }
        @JavascriptInterface fun nativeOn(): Boolean = getSharedPreferences("petalwave", MODE_PRIVATE).getBoolean("native", false)
        @JavascriptInterface fun nPlay(json: String) = withNative { it.play(json) }
        @JavascriptInterface fun nSync(json: String) = withNative { it.sync(json) }
        @JavascriptInterface fun nCmd(c: String) = withNative { it.cmd(c) }
        @JavascriptInterface fun nEq(json: String) = withNative { it.setEq(json) }
        @JavascriptInterface fun nFft(): String = NativeService.instance?.fftCsv() ?: ""
        @JavascriptInterface fun nQueue(): String = NativeService.instance?.let { s -> var r = ""; val l = java.util.concurrent.CountDownLatch(1); runOnUiThread { r = s.queueIds(); l.countDown() }; l.await(2, java.util.concurrent.TimeUnit.SECONDS); r } ?: ""
        @JavascriptInterface fun installUpdate(url: String, sha256: String) = Updater.start(this@MainActivity, url, sha256) { m -> hostMsg("upd:$m") }
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
