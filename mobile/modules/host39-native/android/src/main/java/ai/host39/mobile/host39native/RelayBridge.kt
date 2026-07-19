package ai.host39.mobile.host39native

/**
 * In-process bridge between the expo module (JS side) and the relay
 * foreground service. Both run in the app process; this singleton lets the
 * service emit events to JS and lets JS push tokens/messages to the service.
 */
object RelayBridge {
  @Volatile var module: Host39NativeModule? = null
  @Volatile var service: RelayForegroundService? = null
  @Volatile var state: String = "stopped"
    private set

  fun setState(newState: String) {
    state = newState
    module?.emitRelayState(newState)
  }

  /** Forward a relay envelope (JSON) up to JS. */
  fun onMessage(json: String) {
    module?.emitRelayMessage(json)
  }

  /** Ask JS for a fresh single-use relay token (reconnect / STICKY restart). */
  fun requestToken() {
    module?.emitTokenRequest()
  }

  /** JS answers a token request. */
  fun provideToken(token: String) {
    service?.onTokenProvided(token)
  }

  /** JS sends an envelope to the relay. Returns false when not connected. */
  fun sendToRelay(json: String): Boolean = service?.send(json) ?: false
}
