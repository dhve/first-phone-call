package ai.host39.mobile.host39native

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Restarts the relay foreground service after a reboot when the user left
 * hosting enabled. The service restores its connection details from
 * RelayPrefs and mints a relay token natively, so hosting resumes without
 * the app being opened.
 */
class BootCompletedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
    val prefs = RelayPrefs.get(context)
    if (!prefs.getBoolean(RelayPrefs.KEY_HOSTING_ENABLED, false)) return
    RelayForegroundService.startFromPersistedState(context)
  }
}
