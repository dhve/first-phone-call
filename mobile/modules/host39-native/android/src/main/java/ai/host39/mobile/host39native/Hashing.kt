package ai.host39.mobile.host39native

import android.net.Uri
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

object Hashing {
  /**
   * Streaming SHA-256 of a file (constant memory, works for multi-GB models).
   * Accepts a plain path or a file:// URI; returns lowercase hex.
   */
  fun sha256File(path: String): String {
    val cleanPath = if (path.startsWith("file://")) {
      Uri.parse(path).path ?: throw IllegalArgumentException("Bad file URI: $path")
    } else {
      path
    }
    val file = File(cleanPath)
    require(file.exists()) { "File not found: $cleanPath" }

    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(1 shl 16)
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
}
