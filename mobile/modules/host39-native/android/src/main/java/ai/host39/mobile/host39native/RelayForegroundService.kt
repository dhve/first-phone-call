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
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.random.Random

/**
 * Foreground service that owns the relay WebSocket so hosting survives the
 * activity being backgrounded. Recovery model:
 *
 * - START_STICKY: after a process kill the service restarts and restores the
 *   WS URL, API base URL, device id, and JWT from RelayPrefs (encrypted).
 *   Relay tokens are single-use and never persisted; instead the service
 *   mints a fresh one itself with POST /devices/:id/relay-session using the
 *   stored JWT, so hosting resumes without the app being opened. A
 *   BOOT_COMPLETED receiver does the same after a reboot.
 * - JS is still asked for a token in parallel (onRelayTokenRequest); when the
 *   app is open it answers faster and with fresher credentials. If the stored
 *   JWT is rejected (401/403) native minting latches off until JS provides a
 *   token or a new JWT, and the notification asks the user to open the app.
 * - Reconnects use exponential backoff (2s doubling to 60s, with jitter) and
 *   go through the same token acquisition, since tokens are single-use.
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
  private var apiBaseUrl: String? = null
  private var deviceId: String? = null
  private var jwt: String? = null
  private var attempts = 0
  private var stopped = false
  /** Set when the stored JWT was rejected; blocks native minting until JS re-provisions. */
  private var authFailed = false
  private var minting = false
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

    val prefs = RelayPrefs.get(this)
    val explicitStart = intent?.hasExtra(EXTRA_URL) == true

    if (explicitStart) {
      // Fresh start from JS: adopt and persist the full connection state.
      url = intent?.getStringExtra(EXTRA_URL)
      apiBaseUrl = intent?.getStringExtra(EXTRA_API_BASE_URL)
      deviceId = intent?.getStringExtra(EXTRA_DEVICE_ID)
      jwt = intent?.getStringExtra(EXTRA_JWT)
      authFailed = false
      prefs.edit()
        .putString(RelayPrefs.KEY_WS_URL, url)
        .putString(RelayPrefs.KEY_API_BASE_URL, apiBaseUrl)
        .putString(RelayPrefs.KEY_DEVICE_ID, deviceId)
        .putString(RelayPrefs.KEY_JWT, jwt)
        .putBoolean(RelayPrefs.KEY_HOSTING_ENABLED, true)
        .apply()
    } else {
      // STICKY or boot restart: recover everything persisted. The token must
      // be minted fresh (single-use), natively or by JS.
      if (url == null) url = prefs.getString(RelayPrefs.KEY_WS_URL, null)
      if (apiBaseUrl == null) apiBaseUrl = prefs.getString(RelayPrefs.KEY_API_BASE_URL, null)
      if (deviceId == null) deviceId = prefs.getString(RelayPrefs.KEY_DEVICE_ID, null)
      if (jwt == null) jwt = prefs.getString(RelayPrefs.KEY_JWT, null)
    }

    val intentToken = intent?.getStringExtra(EXTRA_TOKEN)
    if (intentToken != null && url != null) {
      connect(intentToken)
    } else {
      acquireToken()
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
      if (!stopped) {
        authFailed = false
        connect(token)
      }
    }
  }

  /** Called (via RelayBridge) when JS re-authenticated and has a fresh JWT. */
  fun onJwtUpdated(newJwt: String) {
    handler.post {
      jwt = newJwt
      authFailed = false
      RelayPrefs.get(this).edit().putString(RelayPrefs.KEY_JWT, newJwt).apply()
      if (!stopped && webSocket == null) acquireToken()
    }
  }

  /** Send an envelope to the relay. Returns false when not connected. */
  fun send(json: String): Boolean = webSocket?.send(json) ?: false

  /**
   * Get a fresh single-use relay token: ask JS (fast path while the app is
   * open) and, when possible, mint one natively with the stored JWT so a
   * restart without a live JS bridge still reconnects.
   */
  private fun acquireToken() {
    if (stopped) return
    RelayBridge.setState("waiting-token")
    RelayBridge.requestToken()

    if (authFailed) {
      updateNotification("Session expired. Open the Host39 app to sign in again")
      return
    }
    val api = apiBaseUrl
    val device = deviceId
    val auth = jwt
    if (api == null || device == null || auth == null || url == null) {
      updateNotification("Waiting for app to supply a session token")
      return
    }
    if (minting) return
    minting = true
    updateNotification("Requesting a relay session")

    val request = Request.Builder()
      .url("$api/devices/${URLEncoder.encode(device, "UTF-8")}/relay-session")
      .header("Authorization", "Bearer $auth")
      .post(ByteArray(0).toRequestBody(null))
      .build()
    httpClient().newCall(request).enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        handler.post {
          minting = false
          if (!stopped) scheduleReconnect()
        }
      }

      override fun onResponse(call: Call, response: Response) {
        val code = response.code
        val token = if (response.isSuccessful) {
          try {
            JSONObject(response.body?.string() ?: "").optString("token", "")
          } catch (e: Exception) {
            ""
          }
        } else {
          response.body?.close()
          ""
        }
        response.close()
        handler.post {
          minting = false
          if (stopped) return@post
          when {
            token.isNotEmpty() -> connect(token)
            code == 401 || code == 403 -> {
              // The stored JWT is no longer valid. Stop native retries; JS
              // re-provisions via provideRelayToken or updateHostJwt.
              authFailed = true
              RelayBridge.setState("waiting-token")
              updateNotification("Session expired. Open the Host39 app to sign in again")
              RelayBridge.requestToken()
            }
            else -> scheduleReconnect()
          }
        }
      }
    })
  }

  private fun httpClient(): OkHttpClient =
    client ?: OkHttpClient.Builder()
      .pingInterval(HEARTBEAT_SECONDS, TimeUnit.SECONDS)
      .build()
      .also { client = it }

  private fun connect(token: String) {
    val base = url ?: return
    RelayBridge.setState("connecting")
    updateNotification("Connecting to relay")

    // The relay authenticates the upgrade with a single-use token in the query.
    val separator = if (base.contains('?')) "&" else "?"
    val target = base + separator + "token=" + URLEncoder.encode(token, "UTF-8")

    webSocket?.cancel()
    lastInboundAt = System.currentTimeMillis()
    webSocket = httpClient().newWebSocket(
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
      if (!stopped) acquireToken()
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

  companion object {
    private const val CHANNEL_ID = "host39-relay"
    private const val NOTIFICATION_ID = 3901
    private const val EXTRA_URL = "url"
    private const val EXTRA_TOKEN = "token"
    private const val EXTRA_API_BASE_URL = "apiBaseUrl"
    private const val EXTRA_DEVICE_ID = "deviceId"
    private const val EXTRA_JWT = "jwt"
    private const val PROTOCOL_VERSION = 1
    private const val HEARTBEAT_SECONDS = 30L
    private const val WATCHDOG_INTERVAL_MS = 30_000L
    private const val WATCHDOG_IDLE_MS = 90_000L
    private const val BASE_BACKOFF_MS = 2_000L
    private const val MAX_BACKOFF_MS = 60_000L

    fun start(
      context: Context,
      url: String,
      token: String,
      apiBaseUrl: String,
      deviceId: String,
      jwt: String,
    ) {
      val intent = Intent(context, RelayForegroundService::class.java)
        .putExtra(EXTRA_URL, url)
        .putExtra(EXTRA_TOKEN, token)
        .putExtra(EXTRA_API_BASE_URL, apiBaseUrl)
        .putExtra(EXTRA_DEVICE_ID, deviceId)
        .putExtra(EXTRA_JWT, jwt)
      context.startForegroundService(intent)
    }

    /** Boot-time restart: the service restores everything from RelayPrefs. */
    fun startFromPersistedState(context: Context) {
      context.startForegroundService(Intent(context, RelayForegroundService::class.java))
    }

    fun stop(context: Context) {
      RelayPrefs.get(context).edit()
        .putBoolean(RelayPrefs.KEY_HOSTING_ENABLED, false)
        .remove(RelayPrefs.KEY_JWT)
        .apply()
      context.stopService(Intent(context, RelayForegroundService::class.java))
    }
  }
}
