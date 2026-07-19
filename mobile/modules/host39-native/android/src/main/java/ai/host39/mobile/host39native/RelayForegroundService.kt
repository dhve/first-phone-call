package ai.host39.mobile.host39native

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.random.Random

/**
 * Foreground service that owns the relay WebSocket so hosting survives the
 * activity being backgrounded. Recovery model:
 *
 * - START_STICKY: after a process kill the service restarts, restores the WS
 *   URL from prefs, and asks JS for a fresh single-use token (tokens are
 *   never persisted). Until the app's JS runtime is up, it waits in the
 *   "waiting-token" state with the notification prompting the user.
 * - Reconnects use exponential backoff (2s doubling to 60s, with jitter) and
 *   also go through a token request, since tokens are single-use.
 * - Heartbeat: replies to relay `ping` envelopes with `pong` immediately (no
 *   JS round trip) and keeps a 30s OkHttp WS ping plus a 90s inactivity
 *   watchdog that forces a reconnect.
 *
 * All other envelopes are forwarded verbatim to JS via RelayBridge.
 */
class RelayForegroundService : Service() {

  private val handler = Handler(Looper.getMainLooper())
  private var client: OkHttpClient? = null
  private var webSocket: WebSocket? = null
  private var url: String? = null
  private var attempts = 0
  private var stopped = false
  private var lastInboundAt = 0L

  private val watchdog = object : Runnable {
    override fun run() {
      if (stopped) return
      val idleMs = System.currentTimeMillis() - lastInboundAt
      if (webSocket != null && lastInboundAt > 0 && idleMs > WATCHDOG_IDLE_MS) {
        webSocket?.cancel()
        webSocket = null
        scheduleReconnect()
      } else {
        handler.postDelayed(this, WATCHDOG_INTERVAL_MS)
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    RelayBridge.service = this
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startInForeground("Starting agent hosting")
    stopped = false

    val intentUrl = intent?.getStringExtra(EXTRA_URL)
    val intentToken = intent?.getStringExtra(EXTRA_TOKEN)

    if (intentUrl != null) {
      url = intentUrl
      prefs().edit().putString(PREF_URL, intentUrl).apply()
    } else if (url == null) {
      // STICKY restart: recover the URL; the token must come fresh from JS.
      url = prefs().getString(PREF_URL, null)
    }

    if (intentToken != null && url != null) {
      connect(intentToken)
    } else {
      RelayBridge.setState("waiting-token")
      updateNotification("Waiting for app to supply a session token")
      RelayBridge.requestToken()
    }
    return START_STICKY
  }

  override fun onDestroy() {
    stopped = true
    handler.removeCallbacksAndMessages(null)
    webSocket?.cancel()
    webSocket = null
    RelayBridge.service = null
    RelayBridge.setState("stopped")
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  /** Called (via RelayBridge) when JS supplies a fresh single-use token. */
  fun onTokenProvided(token: String) {
    handler.post {
      if (!stopped) connect(token)
    }
  }

  /** Send an envelope to the relay. Returns false when not connected. */
  fun send(json: String): Boolean = webSocket?.send(json) ?: false

  private fun connect(token: String) {
    val base = url ?: return
    RelayBridge.setState("connecting")
    updateNotification("Connecting to relay")

    // The relay authenticates the upgrade with a single-use token in the query.
    val separator = if (base.contains('?')) "&" else "?"
    val target = base + separator + "token=" + URLEncoder.encode(token, "UTF-8")

    val httpClient = client ?: OkHttpClient.Builder()
      .pingInterval(HEARTBEAT_SECONDS, TimeUnit.SECONDS)
      .build()
      .also { client = it }

    webSocket?.cancel()
    lastInboundAt = System.currentTimeMillis()
    webSocket = httpClient.newWebSocket(
      Request.Builder().url(target).build(),
      object : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
          attempts = 0
          lastInboundAt = System.currentTimeMillis()
          ws.send(JSONObject().put("type", "hello").put("protocol", PROTOCOL_VERSION).toString())
          handler.removeCallbacks(watchdog)
          handler.postDelayed(watchdog, WATCHDOG_INTERVAL_MS)
        }

        override fun onMessage(ws: WebSocket, text: String) {
          lastInboundAt = System.currentTimeMillis()
          handleMessage(ws, text)
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
          if (webSocket === ws) {
            webSocket = null
            scheduleReconnect()
          }
        }

        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
          if (webSocket === ws) {
            webSocket = null
            scheduleReconnect()
          }
        }
      },
    )
  }

  private fun handleMessage(ws: WebSocket, text: String) {
    val json = try {
      JSONObject(text)
    } catch (e: Exception) {
      return // ignore malformed frames
    }
    when (json.optString("type")) {
      // Heartbeat handled entirely in the service; pong echoes the ping's ts.
      "ping" -> ws.send(
        JSONObject()
          .put("type", "pong")
          .put("ts", json.optLong("ts", System.currentTimeMillis()))
          .toString(),
      )
      "ready" -> {
        RelayBridge.setState("connected")
        updateNotification("Hosting your agent (connected)")
        RelayBridge.onMessage(text)
      }
      else -> RelayBridge.onMessage(text)
    }
  }

  private fun scheduleReconnect() {
    if (stopped) return
    RelayBridge.setState("backoff")
    val exp = min(attempts, 5) // 2s, 4s, 8s, 16s, 32s, 60s cap
    val delay = min(MAX_BACKOFF_MS, BASE_BACKOFF_MS shl exp) + Random.nextLong(500)
    attempts++
    updateNotification("Reconnecting in ${delay / 1000}s")
    handler.postDelayed({
      if (!stopped) {
        RelayBridge.setState("waiting-token")
        RelayBridge.requestToken()
      }
    }, delay)
  }

  private fun createNotificationChannel() {
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Agent hosting",
      NotificationManager.IMPORTANCE_LOW,
    ).apply { description = "Shown while Host39 is hosting your agent" }
    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
      .createNotificationChannel(channel)
  }

  private fun buildNotification(text: String): Notification =
    Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("Host39 Agent")
      .setContentText(text)
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setOngoing(true)
      .build()

  private fun startInForeground(text: String) {
    val notification = buildNotification(text)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun updateNotification(text: String) {
    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
      .notify(NOTIFICATION_ID, buildNotification(text))
  }

  private fun prefs() = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  companion object {
    private const val CHANNEL_ID = "host39-relay"
    private const val NOTIFICATION_ID = 3901
    private const val PREFS_NAME = "host39-relay"
    private const val PREF_URL = "relay_url"
    private const val EXTRA_URL = "url"
    private const val EXTRA_TOKEN = "token"
    private const val PROTOCOL_VERSION = 1
    private const val HEARTBEAT_SECONDS = 30L
    private const val WATCHDOG_INTERVAL_MS = 30_000L
    private const val WATCHDOG_IDLE_MS = 90_000L
    private const val BASE_BACKOFF_MS = 2_000L
    private const val MAX_BACKOFF_MS = 60_000L

    fun start(context: Context, url: String, token: String) {
      val intent = Intent(context, RelayForegroundService::class.java)
        .putExtra(EXTRA_URL, url)
        .putExtra(EXTRA_TOKEN, token)
      context.startForegroundService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, RelayForegroundService::class.java))
    }
  }
}
