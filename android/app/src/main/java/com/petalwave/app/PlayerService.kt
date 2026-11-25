package com.petalwave.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import org.json.JSONObject
import java.net.URL

// servicio en primer plano: mantiene Petalwave sonando con la pantalla apagada y muestra la canción
// en la notificación y en la pantalla bloqueada, con anterior / play-pausa / siguiente y la barra de tiempo
class PlayerService : Service() {
    companion object {
        @Volatile var instance: PlayerService? = null
        // la interfaz avisa qué suena (ver NativeBridge.media)
        fun update(json: String) { instance?.apply(json) }
    }

    private var lock: PowerManager.WakeLock? = null
    private lateinit var session: MediaSession
    private var title = "Petalwave"; private var artist = "sin reproducir"; private var playing = false
    private var pos = 0L; private var dur = 0L; private var art: Bitmap? = null; private var artUrl = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        session = MediaSession(this, "petalwave").apply {
            setCallback(object : MediaSession.Callback() {
                // play y pausa por separado: con "toggle", un "play" que llega mientras ya suena (auriculares,
                // Bluetooth, el sistema) pausaba la canción justo cuando estaba cargando
                override fun onPlay() = MainActivity.cmd("play")
                override fun onPause() = MainActivity.cmd("pause")
                override fun onSkipToNext() = MainActivity.cmd("next")
                override fun onSkipToPrevious() = MainActivity.cmd("prev")
                override fun onSeekTo(p: Long) = MainActivity.cmd("seek:" + (p / 1000.0))
            })
            isActive = true
        }
        if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel("play", "Reproducción", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "salir" -> {
                stopForeground(true); stopSelf()
                android.os.Process.killProcess(android.os.Process.myPid())
                return START_NOT_STICKY
            }
            "toggle", "next", "prev" -> { MainActivity.cmd(intent.action!!); return START_STICKY }
        }
        val n = build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) else startForeground(1, n)
        if (lock == null) {
            lock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "petalwave:play").apply { setReferenceCounted(false); acquire() }
        }
        Thread { App.ctx.startServer() }.start()
        return START_STICKY
    }

    private fun pi(action: String, code: Int) =
        PendingIntent.getService(this, code, Intent(this, PlayerService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE)

    private fun build(): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "play") else Notification.Builder(this)
        fun act(icon: Int, label: String, action: String, code: Int) =
            Notification.Action.Builder(Icon.createWithResource(this, icon), label, pi(action, code)).build()
        b.setSmallIcon(R.drawable.ic_note)
            .setContentTitle(title)
            .setContentText(artist)
            .setLargeIcon(art)
            .setContentIntent(open)
            .setOngoing(playing)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(act(android.R.drawable.ic_media_previous, "Anterior", "prev", 2))
            .addAction(act(if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play, if (playing) "Pausa" else "Play", "toggle", 3))
            .addAction(act(android.R.drawable.ic_media_next, "Siguiente", "next", 4))
            .addAction(act(android.R.drawable.ic_menu_close_clear_cancel, "Salir", "salir", 5))
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
        return b.build()
    }

    private fun apply(json: String) {
        try {
            val j = JSONObject(json)
            title = j.optString("title").ifEmpty { "Petalwave" }
            artist = j.optString("artist").ifEmpty { if (j.optString("title").isEmpty()) "sin reproducir" else "" }
            playing = j.optBoolean("playing")
            pos = (j.optDouble("pos", 0.0) * 1000).toLong()
            dur = (j.optDouble("dur", 0.0) * 1000).toLong()
            val cover = j.optString("cover")
            if (cover != artUrl) {
                artUrl = cover; art = null
                if (cover.isNotEmpty()) Thread {
                    art = try { App.conn(cover).inputStream.use { BitmapFactory.decodeStream(it) } } catch (_: Exception) { null }
                    publish()
                }.start()
            }
            publish()
        } catch (_: Exception) { }
    }

    @Synchronized
    private fun publish() {
        session.setMetadata(MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, dur)
            .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art)
            .build())
        session.setPlaybackState(PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
                PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SEEK_TO)
            .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, pos, if (playing) 1f else 0f, SystemClock.elapsedRealtime())
            .build())
        getSystemService(NotificationManager::class.java).notify(1, build())
        PlayerWidget.push(this, title, artist, playing, art)   // el widget de la pantalla de inicio
    }

    override fun onDestroy() {
        instance = null
        PlayerWidget.push(this, "Petalwave", "tocá para abrir", false, null)
        session.release()
        lock?.release(); lock = null
        super.onDestroy()
    }
}
