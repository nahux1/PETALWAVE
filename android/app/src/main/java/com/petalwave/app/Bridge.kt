package com.petalwave.app

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.media.MediaScannerConnection
import java.io.FileOutputStream

// cosas de Android que el servidor de Python pide (vía Chaquopy)
object Bridge {
    // que el archivo nuevo aparezca en la galería, en "Archivos" y en otras apps de música
    @JvmStatic
    fun scanFile(path: String) {
        MediaScannerConnection.scanFile(App.ctx, arrayOf(path), null, null)
    }

    // carátula de un video: un cuadro del segundo 3
    @JvmStatic
    fun videoFrame(path: String, outJpg: String): Boolean {
        val r = MediaMetadataRetriever()
        return try {
            r.setDataSource(path)
            val bmp = r.getFrameAtTime(3_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: return false
            val side = minOf(bmp.width, bmp.height)
            val sq = Bitmap.createBitmap(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side)
            val small = Bitmap.createScaledBitmap(sq, minOf(side, 512), minOf(side, 512), true)
            FileOutputStream(outJpg).use { small.compress(Bitmap.CompressFormat.JPEG, 85, it) }
            true
        } catch (e: Exception) {
            false
        } finally {
            try { r.release() } catch (_: Exception) { }
        }
    }
}
