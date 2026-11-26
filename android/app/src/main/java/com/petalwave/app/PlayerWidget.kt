package com.petalwave.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.widget.RemoteViews

// widgets de la pantalla de inicio: el chico (una fila) y el grande (carátula de fondo, con ♥ y aleatorio)
class PlayerWidget : AppWidgetProvider() {
    companion object {
        // último estado (lo actualiza PlayerService cada vez que cambia la canción, se pausa, se toca ♥ o aleatorio)
        @Volatile private var title = "Petalwave"
        @Volatile private var artist = "tocá para abrir"
        @Volatile private var playing = false
        @Volatile private var liked = false
        @Volatile private var shuffle = false
        @Volatile private var art: Bitmap? = null
        @Volatile private var artBig: Bitmap? = null

        fun push(ctx: Context, t: String, a: String, p: Boolean, cover: Bitmap?, lk: Boolean = false, sh: Boolean = false) {
            title = t; artist = a; playing = p; liked = lk; shuffle = sh
            // carátulas chicas: las imágenes grandes no entran en un widget (hay un límite de memoria)
            fun fit(b: Bitmap?, px: Int) = b?.let { if (it.width > px || it.height > px) Bitmap.createScaledBitmap(it, px, px * it.height / maxOf(1, it.width), true) else it }
            art = fit(cover, 256); artBig = fit(cover, 480)
            refresh(ctx)
        }

        fun refresh(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val small = mgr.getAppWidgetIds(ComponentName(ctx, PlayerWidget::class.java))
            if (small.isNotEmpty()) mgr.updateAppWidget(small, views(ctx, false))
            val big = mgr.getAppWidgetIds(ComponentName(ctx, PlayerWidgetBig::class.java))
            if (big.isNotEmpty()) mgr.updateAppWidget(big, views(ctx, true))
        }

        fun views(ctx: Context, big: Boolean): RemoteViews {
            val v = RemoteViews(ctx.packageName, if (big) R.layout.widget_big else R.layout.widget)
            v.setTextViewText(R.id.w_title, title)
            v.setTextViewText(R.id.w_artist, artist)
            v.setImageViewResource(R.id.w_toggle, if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
            val a = if (big) artBig else art
            if (a != null) v.setImageViewBitmap(R.id.w_cover, a) else v.setImageViewResource(R.id.w_cover, R.drawable.ic_note)
            val open = PendingIntent.getActivity(ctx, 10, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
            v.setOnClickPendingIntent(R.id.w_root, open)
            // los botones van al receptor privado WidgetButtons (otras apps no pueden mandarle nada)
            fun btn(id: Int, cmd: String, code: Int) = v.setOnClickPendingIntent(id, PendingIntent.getBroadcast(ctx, code,
                Intent(ctx, WidgetButtons::class.java).putExtra("cmd", cmd), PendingIntent.FLAG_IMMUTABLE))
            btn(R.id.w_prev, "prev", 11); btn(R.id.w_toggle, "toggle", 12); btn(R.id.w_next, "next", 13)
            if (big) {
                v.setImageViewResource(R.id.w_like, if (liked) R.drawable.ic_heart_on else R.drawable.ic_heart)
                v.setImageViewResource(R.id.w_shuffle, if (shuffle) R.drawable.ic_shuffle_on else R.drawable.ic_shuffle)
                btn(R.id.w_like, "like", 14); btn(R.id.w_shuffle, "shuffle", 15)
            }
            return v
        }
    }

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        mgr.updateAppWidget(ids, views(ctx, false))
    }
}

// el grande comparte el estado con el chico
class PlayerWidgetBig : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        mgr.updateAppWidget(ids, PlayerWidget.views(ctx, true))
    }
}
