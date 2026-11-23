package com.petalwave.app

import android.app.Activity
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// actualizar Petalwave desde la app: baja el APK nuevo de GitHub, comprueba su huella SHA-256 y abre el instalador de Android.
// Android además verifica que el APK esté firmado con la misma clave que el instalado (si no, no deja actualizar).
object Updater {
    private val okHost = Regex("(^|\\.)github\\.com$|(^|\\.)githubusercontent\\.com$")
    @Volatile private var busy = false
    // solo se aceptan avisos del instalador mientras Petalwave espera SU instalación (la pantalla principal es pública)
    @Volatile private var waiting = false

    fun start(a: Activity, url: String, sha256: String, report: (String) -> Unit) {
        if (busy) return report("error:ya se está actualizando")
        val u = try { URL(url) } catch (_: Exception) { return report("error:dirección inválida") }
        if (u.protocol != "https" || !okHost.containsMatchIn(u.host)) return report("error:la actualización solo se baja de GitHub")
        if (!Regex("^[a-f0-9]{64}$").matches(sha256)) return report("error:la actualización no trae verificación SHA-256")
        // Android pide permiso para "instalar apps desconocidas" una vez
        if (Build.VERSION.SDK_INT >= 26 && !a.packageManager.canRequestPackageInstalls()) {
            a.runOnUiThread {
                try { a.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.packageName))) } catch (_: Exception) { }
            }
            return report("permiso")
        }
        busy = true
        Thread {
            try {
                val dir = File(a.cacheDir, "update").apply { deleteRecursively(); mkdirs() }
                val f = File(dir, "petalwave.apk")
                val conn = u.openConnection() as HttpURLConnection
                conn.instanceFollowRedirects = true; conn.connectTimeout = 15000; conn.readTimeout = 30000
                val total = conn.contentLengthLong
                val md = MessageDigest.getInstance("SHA-256")
                var got = 0L; var last = -1
                conn.inputStream.use { inp -> f.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = inp.read(buf); if (n < 0) break
                        out.write(buf, 0, n); md.update(buf, 0, n); got += n
                        val pct = if (total > 0) (got * 100 / total).toInt() else 0
                        if (pct != last) { last = pct; report("progress:$pct") }
                    }
                } }
                val hex = md.digest().joinToString("") { "%02x".format(it) }
                if (hex != sha256) { f.delete(); throw Exception("el archivo bajado no coincide con el publicado (SHA-256): no se instaló nada") }
                report("installing")
                // instalador de Android (sin pasar por el navegador ni por "Descargas")
                val pi = a.packageManager.packageInstaller
                val sid = pi.createSession(PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL))
                pi.openSession(sid).use { s ->
                    s.openWrite("petalwave", 0, f.length()).use { out -> f.inputStream().use { it.copyTo(out) }; s.fsync(out) }
                    val back = Intent(a, MainActivity::class.java).setAction("com.petalwave.app.INSTALL_STATUS")
                    val flags = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_UPDATE_CURRENT
                    waiting = true
                    s.commit(PendingIntent.getActivity(a, 77, back, flags).intentSender)
                }
                f.delete()
            } catch (e: Exception) {
                report("error:" + (e.message ?: "no se pudo actualizar"))
            } finally { busy = false }
        }.start()
    }

    // el instalador avisa cómo fue: si hace falta que el usuario confirme, se abre la ventana de Android
    fun onStatus(a: Activity, i: Intent, report: (String) -> Unit) {
        if (!waiting) return   // nadie más puede hacerse pasar por el instalador
        when (i.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = i.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                // solo la ventana de confirmación del instalador del sistema (nunca otra cosa que venga adentro)
                if (confirm != null && (confirm.action ?: "").startsWith("android.content.pm.action.CONFIRM_INSTALL"))
                    try { a.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { }
            }
            PackageInstaller.STATUS_SUCCESS -> { waiting = false; report("done") }
            -999 -> {}
            else -> { waiting = false; report("error:" + (i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Android no instaló la actualización")) }
        }
    }
}
