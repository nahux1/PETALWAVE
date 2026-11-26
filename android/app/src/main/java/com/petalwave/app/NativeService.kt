package com.petalwave.app

import android.media.audiofx.Equalizer
import android.media.audiofx.Visualizer
import android.net.Uri
import android.os.Bundle
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

// motor nativo de Petalwave (beta) y Android Auto: ExoPlayer (Media3) dentro de un servicio de medios.
// - la interfaz (WebView) le manda la canción actual con las de antes y después (ver NativeBridge en MainActivity)
// - sigue sonando sola aunque Android duerma la app, y muestra la notificación con los controles
// - Android Auto ve un menú "Petalwave" (me gusta, recién agregadas, playlists, canciones) y reproduce sin abrir la app
class NativeService : MediaLibraryService() {
    companion object {
        @Volatile var instance: NativeService? = null
        const val BASE = "http://127.0.0.1:${App.PORT}"
        // canción de Petalwave → elemento de Media3 (el audio y la carátula los sirve el servidor interno, sin clave)
        fun item(t: JSONObject): MediaItem {
            val id = t.optString("id")
            val yt = t.optString("ytId")
            // radios (rd_) y capítulos de podcast (pc_): los sirve /cast/<clave> (la imagen, /cast/<clave>i)
            val cast = id.startsWith("rd_") || id.startsWith("pc_")
            val uri = if (cast) "$BASE/cast/${id.substring(3)}" else if (id.startsWith("yt_")) "$BASE/stream/${id.removePrefix("yt_")}" else "$BASE/media/$id"
            val art = if (cast) "$BASE/cast/${id.substring(3)}i" else if (id.startsWith("yt_")) "$BASE/ytcover/${id.removePrefix("yt_")}" else "$BASE/cover/$id"
            val md = MediaMetadata.Builder()
                .setTitle(t.optString("title").ifEmpty { "Petalwave" })
                .setArtist(t.optString("artist"))
                .setAlbumTitle(t.optString("album"))
                .setArtworkUri(Uri.parse(art))
                .setIsPlayable(true).setIsBrowsable(false)
                .setExtras(Bundle().apply { putString("ytId", yt) })
                .build()
            return MediaItem.Builder().setMediaId(id).setUri(uri).setMediaMetadata(md).build()
        }
    }

    lateinit var player: ExoPlayer
    private lateinit var session: MediaLibrarySession
    private var eq: Equalizer? = null
    private var viz: Visualizer? = null
    private val fft = ByteArray(128)
    private val io = Executors.newSingleThreadExecutor()
    private val lists = HashMap<String, List<MediaItem>>()   // lo último que vio Android Auto en cada carpeta

    override fun onCreate() {
        super.onCreate()
        instance = this
        Thread { App.ctx.startServer() }.start()   // Android Auto puede abrir solo el servicio: el servidor tiene que estar
        player = ExoPlayer.Builder(this)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true)   // auriculares desconectados → pausa
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        player.addListener(object : Player.Listener {
            override fun onEvents(p: Player, events: Player.Events) { MainActivity.nativeEvent(state()) }
            override fun onAudioSessionIdChanged(id: Int) { attachFx(id) }
        })
        attachFx(player.audioSessionId)   // ExoPlayer ya creó su sesión de audio: el aviso de "cambió" no llega para la primera
        session = MediaLibrarySession.Builder(this, player, Callback()).build()
        tick.run()
    }
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private val tick: Runnable = object : Runnable {
        override fun run() { if (player.isPlaying) MainActivity.nativeEvent(state()); handler.postDelayed(this, 1000) }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession = session

    // si la app se cierra deslizándola y no suena nada, se cierra el servicio
    override fun onTaskRemoved(rootIntent: android.content.Intent?) {
        if (!player.playWhenReady || player.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        instance = null
        handler.removeCallbacks(tick)
        try { viz?.release() } catch (_: Exception) { }
        try { eq?.release() } catch (_: Exception) { }
        session.release(); player.release()
        io.shutdown()
        super.onDestroy()
    }

    // ---------- estado para la interfaz ----------
    fun state(): String {
        val cur = player.currentMediaItem
        return JSONObject()
            .put("id", cur?.mediaId ?: "")
            .put("idx", player.currentMediaItemIndex)
            .put("playing", player.isPlaying)
            .put("want", player.playWhenReady)
            .put("buffering", player.playbackState == Player.STATE_BUFFERING)
            .put("ended", player.playbackState == Player.STATE_ENDED)
            .put("pos", player.currentPosition / 1000.0)
            .put("dur", if (player.duration > 0) player.duration / 1000.0 else 0.0)
            .put("buf", player.bufferedPosition / 1000.0)
            .put("err", player.playerError?.message ?: "")
            .toString()
    }
    fun queueIds(): String {
        val a = JSONArray(); for (i in 0 until player.mediaItemCount) a.put(player.getMediaItemAt(i).mediaId)
        return JSONObject().put("ids", a).put("idx", player.currentMediaItemIndex).toString()
    }

    // ---------- órdenes de la interfaz ----------
    // empezar: lista (con las de antes y después) y cuál suena
    fun play(json: String) {
        val j = JSONObject(json)
        val arr = j.getJSONArray("items")
        val items = (0 until arr.length()).map { item(arr.getJSONObject(it)) }
        player.setMediaItems(items, j.optInt("index", 0), (j.optDouble("startAt", 0.0) * 1000).toLong())
        player.prepare()
        player.playWhenReady = j.optBoolean("autoplay", true)
    }
    // la cola cambió (agregar, quitar, mover): se reemplaza todo menos la canción que está sonando (sin cortes)
    fun sync(json: String) {
        val j = JSONObject(json)
        val arr = j.getJSONArray("items")
        val idx = j.optInt("index", 0)
        val items = (0 until arr.length()).map { item(arr.getJSONObject(it)) }
        val cur = player.currentMediaItemIndex
        if (player.mediaItemCount == 0 || cur < 0 || idx !in items.indices || player.currentMediaItem?.mediaId != items[idx].mediaId) return play(json)
        if (cur + 1 < player.mediaItemCount) player.removeMediaItems(cur + 1, player.mediaItemCount)
        if (cur > 0) player.removeMediaItems(0, cur)
        player.addMediaItems(0, items.subList(0, idx))
        player.addMediaItems(idx + 1, items.subList(idx + 1, items.size))
    }
    fun cmd(c: String) {
        when {
            c == "play" -> player.play()
            c == "pause" -> player.pause()
            c == "toggle" -> if (player.isPlaying) player.pause() else player.play()
            c == "next" -> player.seekToNextMediaItem()
            c == "prev" -> player.seekToPreviousMediaItem()
            c == "stop" -> { player.stop(); player.clearMediaItems() }
            c.startsWith("seek:") -> player.seekTo((c.substring(5).toDoubleOrNull() ?: 0.0).times(1000).toLong())
            c.startsWith("vol:") -> player.volume = (c.substring(4).toFloatOrNull() ?: 1f).coerceIn(0f, 1f)
            c.startsWith("repeat:") -> player.repeatMode = if (c.endsWith("one")) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
        }
    }

    // ---------- ecualizador y visualizador de Android ----------
    private var eqWanted: String? = null
    private fun attachFx(sid: Int) {
        if (sid == C.AUDIO_SESSION_ID_UNSET) return
        try { eq?.release() } catch (_: Exception) { }
        eq = try { Equalizer(0, sid) } catch (_: Exception) { null }
        eqWanted?.let { setEq(it) }
        try { viz?.release() } catch (_: Exception) { }
        viz = null
        // el visualizador de Android necesita el permiso de micrófono (el mismo de "¿qué suena?"); sin él, sin barras
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            viz = try {
                Visualizer(sid).apply {
                    captureSize = 256
                    setDataCaptureListener(object : Visualizer.OnDataCaptureListener {
                        override fun onWaveFormDataCapture(v: Visualizer?, w: ByteArray?, r: Int) {}
                        override fun onFftDataCapture(v: Visualizer?, f: ByteArray?, r: Int) {
                            if (f == null) return
                            // magnitudes 0-255 de las primeras 128 bandas
                            for (k in 0 until minOf(128, f.size / 2)) {
                                val re = f[2 * k].toInt(); val im = f[2 * k + 1].toInt()
                                fft[k] = minOf(255, (Math.sqrt((re * re + im * im).toDouble()) * 2.2).toInt()).toByte()
                            }
                        }
                    }, Visualizer.getMaxCaptureRate() / 2, false, true)
                    enabled = true
                }
            } catch (_: Exception) { null }
        }
    }
    fun fftCsv(): String { val sb = StringBuilder(); for (b in fft) { if (sb.isNotEmpty()) sb.append(','); sb.append(b.toInt() and 0xff) }; return sb.toString() }

    // los 10 ajustes de Petalwave (31 Hz – 16 kHz) se llevan a las bandas que tenga el teléfono (suelen ser 5)
    fun setEq(json: String) {
        eqWanted = json
        val e = eq ?: return
        try {
            val j = JSONObject(json)
            val on = j.optBoolean("on", true)
            val freqs = doubleArrayOf(31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0)
            val bands = j.optJSONArray("bands")
            val pre = j.optDouble("preamp", 0.0); val bass = j.optDouble("bass", 0.0); val treble = j.optDouble("treble", 0.0)
            val (lo, hi) = e.bandLevelRange.let { it[0].toInt() to it[1].toInt() }
            for (b in 0 until e.numberOfBands) {
                val fc = e.getCenterFreq(b.toShort()) / 1000.0
                // interpolación logarítmica entre las dos bandas de Petalwave más cercanas
                var db = 0.0
                if (bands != null && bands.length() == 10) {
                    val x = Math.log(fc.coerceIn(31.0, 16000.0))
                    var i = 0; while (i < 8 && Math.log(freqs[i + 1]) < x) i++
                    val t = ((x - Math.log(freqs[i])) / (Math.log(freqs[i + 1]) - Math.log(freqs[i]))).coerceIn(0.0, 1.0)
                    db = bands.optDouble(i, 0.0) * (1 - t) + bands.optDouble(i + 1, 0.0) * t
                }
                if (fc < 200) db += bass; if (fc > 5000) db += treble
                db += pre
                e.setBandLevel(b.toShort(), (db * 100).toInt().coerceIn(lo, hi).toShort())
            }
            e.enabled = on
        } catch (_: Exception) { }
    }

    // ---------- Android Auto: qué se ve en el auto ----------
    private fun api(path: String): JSONObject =
        App.conn(path).inputStream.bufferedReader().use { JSONObject(it.readText()) }

    private fun folder(id: String, title: String) = MediaItem.Builder().setMediaId(id)
        .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setIsBrowsable(true).setIsPlayable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED).build()).build()

    fun childrenFor(parent: String): List<MediaItem> = children(parent)
    private fun children(parent: String): List<MediaItem> {
        if (parent == "root") return listOf(folder("liked", "♥ Me gusta"), folder("recent", "Recién agregadas"), folder("pls", "Playlists"), folder("all", "Todas las canciones"))
        val lib = api("/api/library").getJSONArray("tracks")
        val byId = HashMap<String, JSONObject>()
        for (i in 0 until lib.length()) { val t = lib.getJSONObject(i); byId[t.optString("id")] = t }
        val pls = api("/api/playlists").getJSONArray("items")
        fun track(id: String): JSONObject? = byId[id] ?: if (id.startsWith("yt_")) JSONObject().put("id", id).put("title", "canción online") else null
        val list: List<MediaItem> = when {
            parent == "pls" -> (0 until pls.length()).map { pls.getJSONObject(it) }.filter { it.optString("id") != "liked" }
                .map { folder("pl:" + it.optString("id"), it.optString("name")) }
            parent == "liked" || parent.startsWith("pl:") -> {
                val pid = if (parent == "liked") "liked" else parent.removePrefix("pl:")
                val p = (0 until pls.length()).map { pls.getJSONObject(it) }.firstOrNull { it.optString("id") == pid }
                val ids = p?.optJSONArray("tracks") ?: JSONArray()
                (0 until ids.length()).mapNotNull { track(ids.getString(it)) }.map { item(it) }
            }
            parent == "recent" -> byId.values.sortedByDescending { it.optLong("added") }.take(100).map { item(it) }
            parent == "all" -> byId.values.filter { !it.optBoolean("video") }.sortedBy { it.optString("title").lowercase() }.take(500).map { item(it) }
            else -> emptyList()
        }
        lists[parent] = list
        return list
    }

    private inner class Callback : MediaLibrarySession.Callback {
        // quién puede manejar la música: Petalwave, el sistema (notificación, pantalla bloqueada, Bluetooth) y Android Auto
        override fun onConnect(s: MediaSession, c: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
            val ok = c.packageName == packageName || c.isTrusted || c.packageName in setOf(
                "com.google.android.projection.gearhead",   // Android Auto
                "com.google.android.googlequicksearchbox",   // Asistente de Google
                "com.android.systemui", "com.google.android.wearable.app")
            return if (ok) super.onConnect(s, c) else MediaSession.ConnectionResult.reject()
        }

        override fun onGetLibraryRoot(s: MediaLibrarySession, b: MediaSession.ControllerInfo, p: LibraryParams?): ListenableFuture<LibraryResult<MediaItem>> =
            Futures.immediateFuture(LibraryResult.ofItem(folder("root", "Petalwave"), p))

        override fun onGetChildren(s: MediaLibrarySession, b: MediaSession.ControllerInfo, parentId: String, page: Int, pageSize: Int, p: LibraryParams?): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            val f = SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()
            io.execute {
                try {
                    val all = children(parentId)
                    val from = (page * pageSize).coerceAtMost(all.size); val to = (from + pageSize).coerceAtMost(all.size)
                    f.set(LibraryResult.ofItemList(ImmutableList.copyOf(all.subList(from, to)), p))
                } catch (e: Exception) { f.set(LibraryResult.ofError(LibraryResult.RESULT_ERROR_IO)) }
            }
            return f
        }

        override fun onGetItem(s: MediaLibrarySession, b: MediaSession.ControllerInfo, mediaId: String): ListenableFuture<LibraryResult<MediaItem>> {
            val hit = lists.values.asSequence().flatten().firstOrNull { it.mediaId == mediaId }
            return Futures.immediateFuture(if (hit != null) LibraryResult.ofItem(hit, null) else LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE))
        }

        // elegir una canción en el auto: suena esa y siguen las de la misma carpeta
        override fun onSetMediaItems(s: MediaSession, c: MediaSession.ControllerInfo, items: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            if (items.size == 1) {
                val id = items[0].mediaId
                val list = lists.values.firstOrNull { l -> l.any { it.mediaId == id } }
                if (list != null) return Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(list, list.indexOfFirst { it.mediaId == id }, startPositionMs))
            }
            return Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(resolve(items), startIndex, startPositionMs))
        }

        override fun onAddMediaItems(s: MediaSession, c: MediaSession.ControllerInfo, items: MutableList<MediaItem>): ListenableFuture<MutableList<MediaItem>> =
            Futures.immediateFuture(resolve(items).toMutableList())

        // los elementos que llegan desde afuera vienen sin dirección: se completan con los de Petalwave
        private fun resolve(items: List<MediaItem>): List<MediaItem> = items.map { m ->
            if (m.localConfiguration != null) m
            else lists.values.asSequence().flatten().firstOrNull { it.mediaId == m.mediaId } ?: item(JSONObject().put("id", m.mediaId).put("title", m.mediaMetadata.title?.toString() ?: ""))
        }
    }
}
