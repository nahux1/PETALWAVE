package com.petalwave.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// botones del widget (anterior / play-pausa / siguiente). Es privado (exported=false): solo los PendingIntent de
// Petalwave llegan acá, así ninguna otra app del teléfono puede manejar la música mandando ese mensaje.
class WidgetButtons : BroadcastReceiver() {
    companion object {
        // clave privada guardada en la app: la pantalla principal solo hace caso a comandos que la traen
        fun key(ctx: Context): String {
            val sp = ctx.getSharedPreferences("petalwave", Context.MODE_PRIVATE)
            return sp.getString("widgetKey", null) ?: java.security.SecureRandom().let { r -> ByteArray(16).also { r.nextBytes(it) } }
                .joinToString("") { "%02x".format(it) }.also { sp.edit().putString("widgetKey", it).apply() }
        }
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        val cmd = intent.getStringExtra("cmd") ?: return
        if (cmd !in setOf("prev", "toggle", "next")) return
        // con Petalwave abierto (aunque esté de fondo) va directo al reproductor; si no, abre la app y lo hace ahí
        if (MainActivity.alive()) MainActivity.cmd(cmd)
        else try {
            ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("pw_cmd", cmd).putExtra("pw_key", key(ctx)))
        } catch (_: Exception) { }
    }
}
