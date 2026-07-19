package ai.host39.mobile.host39native

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

/**
 * ES256 (ECDSA P-256 + SHA-256) device identity key held in the Android
 * Keystore. The private key is non-exportable; signatures come out as raw
 * (r || s) base64url so they verify directly with WebCrypto/jose.
 */
object KeystoreSigner {
  private const val ALIAS = "host39-device-key"
  private const val ANDROID_KEYSTORE = "AndroidKeyStore"

  private fun keyStore(): KeyStore =
    KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

  @Synchronized
  private fun ensureKeyPair(): KeyStore {
    val ks = keyStore()
    if (!ks.containsAlias(ALIAS)) {
      val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
      generator.initialize(
        KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
          .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
          .setDigests(KeyProperties.DIGEST_SHA256)
          .build(),
      )
      generator.generateKeyPair()
    }
    return ks
  }

  fun getPublicKeyJwk(): Map<String, String> {
    val ks = ensureKeyPair()
    val publicKey = ks.getCertificate(ALIAS).publicKey as ECPublicKey
    return mapOf(
      "kty" to "EC",
      "crv" to "P-256",
      "x" to base64Url(fixed32(publicKey.w.affineX)),
      "y" to base64Url(fixed32(publicKey.w.affineY)),
      "alg" to "ES256",
    )
  }

  fun sign(dataBase64: String): String {
    val ks = ensureKeyPair()
    val privateKey = ks.getKey(ALIAS, null) as PrivateKey
    val data = Base64.decode(dataBase64, Base64.DEFAULT)
    val der = Signature.getInstance("SHA256withECDSA").run {
      initSign(privateKey)
      update(data)
      sign()
    }
    return base64Url(derToRaw(der))
  }

  /** Left-pad or trim a big-endian coordinate/int to exactly 32 bytes. */
  private fun fixed32(value: BigInteger): ByteArray = fixed32(value.toByteArray())

  private fun fixed32(bytes: ByteArray): ByteArray {
    var b = bytes
    while (b.size > 32 && b[0] == 0.toByte()) {
      b = b.copyOfRange(1, b.size)
    }
    require(b.size <= 32) { "Coordinate longer than 32 bytes" }
    return if (b.size == 32) b else ByteArray(32 - b.size) + b
  }

  /** Convert a DER ECDSA signature (SEQUENCE of two INTEGERs) to raw r || s. */
  private fun derToRaw(der: ByteArray): ByteArray {
    var idx = 0
    require(der[idx++].toInt() and 0xFF == 0x30) { "Not a DER sequence" }
    val seqLen = der[idx++].toInt() and 0xFF
    if (seqLen == 0x81) idx++ // long-form length; P-256 sigs fit one extra byte
    require(der[idx++].toInt() and 0xFF == 0x02) { "Expected INTEGER (r)" }
    val rLen = der[idx++].toInt() and 0xFF
    val r = der.copyOfRange(idx, idx + rLen)
    idx += rLen
    require(der[idx++].toInt() and 0xFF == 0x02) { "Expected INTEGER (s)" }
    val sLen = der[idx++].toInt() and 0xFF
    val s = der.copyOfRange(idx, idx + sLen)
    return fixed32(r) + fixed32(s)
  }

  private fun base64Url(bytes: ByteArray): String =
    Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}
