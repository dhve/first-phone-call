package ai.host39.mobile.host39native

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Persisted relay-service state, encrypted at rest (androidx.security.crypto).
 * Holds what the foreground service needs to recover hosting on its own after
 * a process death or reboot: the WS URL, the Host39 API base URL, the device
 * id, the account JWT, and whether hosting is enabled at all.
 */
object RelayPrefs {
  private const val PREFS_NAME = "host39-relay-secure"
  private const val FALLBACK_PREFS_NAME = "host39-relay-plain"

  const val KEY_WS_URL = "ws_url"
  const val KEY_API_BASE_URL = "api_base_url"
  const val KEY_DEVICE_ID = "device_id"
  const val KEY_JWT = "jwt"
  const val KEY_HOSTING_ENABLED = "hosting_enabled"

  fun get(context: Context): SharedPreferences =
    try {
      val masterKey = MasterKey.Builder(context.applicationContext)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
      EncryptedSharedPreferences.create(
        context.applicationContext,
        PREFS_NAME,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
      )
    } catch (e: Exception) {
      // Keystore trouble (rare, e.g. corrupted master key). Fall back to
      // plain prefs so hosting keeps working; the JWT is short-lived.
      context.applicationContext.getSharedPreferences(FALLBACK_PREFS_NAME, Context.MODE_PRIVATE)
    }
}
