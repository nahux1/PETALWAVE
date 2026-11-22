package com.petalwave.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.widget.RemoteViews

// widget de la pantalla de inicio: muestra lo que suena y maneja anterior / play-pausa / siguiente
class PlayerWidget : AppWidgetProvider() {
    companion object {
        // último estado (lo actualiza PlayerService cada vez que cambia la canción o se pausa)
        @Volatile private var title = "Petalwave"
        @Volatile private var artist = "tocá para abrir"
        @Volatile private var playing = false
        @Volatile private var art: Bitmap? = null

        fun push(ctx: Context, t: String, a: String, p: Boolean, cover: Bitmap?) {
            title = t; artist = a; playing = p
            // carátula chica: las imágenes grandes no entran en un widget
            art = cover?.let { if (it.width > 256 || it.height > 256) Bitmap.createScaledBitmap(it, 256, 256 * it.height / maxOf(1, it.width), true) else it }
            refresh(ctx)
        }

        fun refresh(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, PlayerWidget::class.java))
            if (ids.isEmpty()) return
            mgr.updateAppWidget(ids, views(ctx))
        }

        private fun views(ctx: Context): RemoteViews {
            val v = RemoteViews(ctx.packageName, R.layout.widget)
            v.setTextViewText(R.id.w_title, title)
            v.setTextViewText(R.id.w_artist, artist)
            v.setImageViewResource(R.id.w_toggle, if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
            val a = art
            if (a != null) v.setImageViewBitmap(R.id.w_cover, a) else v.setImageViewResource(R.id.w_cover, R.drawable.ic_note)
            val open = PendingIntent.getActivity(ctx, 10, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
            v.setOnClickPendingIntent(R.id.w_root, open)
            fun btn(id: Int, cmd: String, code: Int) = v.setOnClickPendingIntent(id, PendingIntent.getBroadcast(ctx, code,
                Intent(ctx, PlayerWidget::class.java).setAction("com.petalwave.app.W_" + cmd), PendingIntent.FLAG_IMMUTABLE))
            btn(R.id.w_prev, "prev", 11); btn(R.id.w_toggle, "toggle", 12); btn(R.id.w_next, "next", 13)
            return v
        }
    }

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        mgr.updateAppWidget(ids, views(ctx))
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        super.onReceive(ctx, intent)
        val act = intent.action ?: return
        if (!act.startsWith("com.petalwave.app.W_")) return
        val cmd = act.removePrefix("com.petalwave.app.W_")
        // con Petalwave abierto (aunque esté de fondo) el botón va directo al reproductor; si no, abre la app y lo hace ahí
        if (MainActivity.alive()) MainActivity.cmd(cmd)
        else try {
            ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("pw_cmd", cmd))
        } catch (_: Exception) { }
    }
}
