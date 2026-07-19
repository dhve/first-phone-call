package ai.host39.mobile.host39native

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS-facing surface of the host39-native module: Keystore ES256 signing,
 * streaming SHA-256, device health, and control of the relay foreground
 * service. Events bridge relay traffic and token requests to JS.
 */
class Host39NativeModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("Host39Native")

    Events(EVENT_MESSAGE, EVENT_STATE, EVENT_TOKEN_REQUEST)

    OnCreate {
      RelayBridge.module = this@Host39NativeModule
    }

    OnDestroy {
      if (RelayBridge.module === this@Host39NativeModule) {
        RelayBridge.module = null
      }
    }

    AsyncFunction("getPublicKeyJwk") { ->
      KeystoreSigner.getPublicKeyJwk()
    }

    AsyncFunction("sign") { dataBase64: String ->
      KeystoreSigner.sign(dataBase64)
    }

    AsyncFunction("sha256File") { path: String ->
      Hashing.sha256File(path)
    }

    AsyncFunction("deviceHealth") { ->
      DeviceHealthReader.read(context)
    }

    AsyncFunction("startRelayService") {
      url: String, token: String, apiBaseUrl: String, deviceId: String, jwt: String ->
      RelayForegroundService.start(context, url, token, apiBaseUrl, deviceId, jwt)
    }

    AsyncFunction("stopRelayService") { ->
      RelayForegroundService.stop(context)
    }

    AsyncFunction("updateHostJwt") { jwt: String ->
      // Persist even when the service is not running so a later boot restart
      // mints with current credentials; a live service also retries with it.
      RelayPrefs.get(context).edit().putString(RelayPrefs.KEY_JWT, jwt).apply()
      RelayBridge.service?.onJwtUpdated(jwt)
    }

    AsyncFunction("provideRelayToken") { token: String ->
      RelayBridge.provideToken(token)
    }

    AsyncFunction("sendRelayMessage") { json: String ->
      RelayBridge.sendToRelay(json)
    }

    Function("getRelayState") { ->
      RelayBridge.state
    }
  }

  fun emitRelayMessage(json: String) {
    sendEvent(EVENT_MESSAGE, mapOf("json" to json))
  }

  fun emitRelayState(state: String) {
    sendEvent(EVENT_STATE, mapOf("state" to state))
  }

  fun emitTokenRequest() {
    sendEvent(EVENT_TOKEN_REQUEST, mapOf<String, Any>())
  }

  companion object {
    const val EVENT_MESSAGE = "onRelayMessage"
    const val EVENT_STATE = "onRelayState"
    const val EVENT_TOKEN_REQUEST = "onRelayTokenRequest"
  }
}
