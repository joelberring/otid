package se.berring.otid.tracking

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** `signal({ kind: "ok" })`: kort vibration och kort ton, som hörs med låst skärm medan tjänsten kör. */
object Signal {
    private const val VIBRATE_MS = 200L
    private const val TONE_MS = 250

    fun ok(context: Context) {
        vibrate(context)
        beep()
    }

    private fun vibrate(context: Context) {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        if (!vibrator.hasVibrator()) throw IllegalStateException("Telefonen kan inte vibrera")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            @Suppress("DEPRECATION")
            vibrator.vibrate(VIBRATE_MS)
            return
        }
        val effect = VibrationEffect.createOneShot(VIBRATE_MS, VibrationEffect.DEFAULT_AMPLITUDE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_NOTIFICATION))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(
                effect,
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT).build()
            )
        }
    }

    // Notisljudets volym: följer telefonens ljudläge (tyst läge ger bara vibration).
    private fun beep() {
        val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 90)
        if (!tone.startTone(ToneGenerator.TONE_PROP_ACK, TONE_MS)) {
            tone.release()
            throw IllegalStateException("Tonen kunde inte spelas")
        }
        Handler(Looper.getMainLooper()).postDelayed({ tone.release() }, TONE_MS + 100L)
    }
}
