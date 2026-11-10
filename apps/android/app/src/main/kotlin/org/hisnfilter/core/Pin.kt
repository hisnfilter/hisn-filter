package org.hisnfilter.core

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * رمز القفل: لا يُحفظ الرمز نفسه، بل بصمة PBKDF2-SHA256 (150 ألف تكرار) مع ملح عشوائي —
 * نفس طريقة الإضافة. الحساب يأخذ جزءًا من الثانية، فيُستدعى خارج خيط الواجهة.
 */
object Pin {
    const val ITERATIONS = 150_000
    val VALID = Regex("^[0-9]{4,8}$")

    data class Hashed(val hash: String, val salt: String)

    fun hash(pin: String, saltHex: String? = null): Hashed {
        val salt = saltHex?.let { hexToBytes(it) } ?: ByteArray(16).also { SecureRandom().nextBytes(it) }
        val spec = PBEKeySpec(pin.toCharArray(), salt, ITERATIONS, 256)
        val bytes = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        spec.clearPassword()
        return Hashed(bytesToHex(bytes), bytesToHex(salt))
    }

    /** بلا رمز محفوظ: مسموح. المقارنة بزمن ثابت. */
    fun verify(pin: String, hash: String?, salt: String?): Boolean {
        if (hash.isNullOrEmpty() || salt.isNullOrEmpty()) return true
        if (!VALID.matches(pin)) return false
        val got = hash(pin, salt).hash
        return MessageDigest.isEqual(got.toByteArray(), hash.toByteArray())
    }

    fun bytesToHex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
    fun hexToBytes(s: String) = ByteArray(s.length / 2) { s.substring(2 * it, 2 * it + 2).toInt(16).toByte() }
}
