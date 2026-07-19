package ai.host39.mobile.host39native

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager

object DeviceHealthReader {
  /** Battery percent + charging, thermal status, and network connectivity. */
  fun read(context: Context): Map<String, Any> {
    val battery = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
    val level = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    val charging = battery.isCharging

    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    val thermal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      when (power.currentThermalStatus) {
        PowerManager.THERMAL_STATUS_NONE -> "none"
        PowerManager.THERMAL_STATUS_LIGHT -> "light"
        PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
        PowerManager.THERMAL_STATUS_SEVERE -> "severe"
        PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
        PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
        PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
        else -> "unknown"
      }
    } else {
      // No thermal API below Android 10; report none so gating stays usable.
      "none"
    }

    val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork)
    val online = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true

    return mapOf(
      "batteryLevel" to if (level in 0..100) level else 100,
      "charging" to charging,
      "thermal" to thermal,
      "online" to online,
    )
  }
}
