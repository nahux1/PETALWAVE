package com.petalwave.app

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaMuxer
import java.nio.ByteBuffer

// une el video H.264 y el audio AAC que baja yt-dlp en un solo .mp4, con las herramientas de Android (sin ffmpeg)
object Muxer {
    @JvmStatic
    fun merge(videoPath: String, audioPath: String, outPath: String): Boolean {
        val vx = MediaExtractor(); val ax = MediaExtractor()
        var mux: MediaMuxer? = null
        try {
            vx.setDataSource(videoPath); ax.setDataSource(audioPath)
            mux = MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val vt = (0 until vx.trackCount).first { vx.getTrackFormat(it).getString("mime")!!.startsWith("video/") }
            val at = (0 until ax.trackCount).first { ax.getTrackFormat(it).getString("mime")!!.startsWith("audio/") }
            vx.selectTrack(vt); ax.selectTrack(at)
            val vOut = mux.addTrack(vx.getTrackFormat(vt))
            val aOut = mux.addTrack(ax.getTrackFormat(at))
            mux.start()
            val buf = ByteBuffer.allocate(4 * 1024 * 1024)
            val info = MediaCodec.BufferInfo()
            for ((ex, track) in listOf(vx to vOut, ax to aOut)) {
                while (true) {
                    info.offset = 0
                    info.size = ex.readSampleData(buf, 0)
                    if (info.size < 0) break
                    info.presentationTimeUs = ex.sampleTime
                    info.flags = if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
                    mux.writeSampleData(track, buf, info)
                    ex.advance()
                }
            }
            mux.stop()
            return true
        } catch (e: Exception) {
            e.printStackTrace()
            return false
        } finally {
            try { mux?.release() } catch (_: Exception) { }
            vx.release(); ax.release()
        }
    }
}
