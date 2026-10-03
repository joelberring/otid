package se.otid.station.store

import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets

object CanonicalJson {
    fun encode(value: Any?): ByteArray = serialize(value).toByteArray(StandardCharsets.UTF_8)

    private fun serialize(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is Boolean -> if (value) "true" else "false"
        is String -> quote(value)
        is Number -> serializeInteger(value)
        is JSONArray -> buildString {
            append('[')
            repeat(value.length()) { index ->
                if (index > 0) append(',')
                append(serialize(value.get(index)))
            }
            append(']')
        }
        is JSONObject -> buildString {
            append('{')
            value.keys().asSequence().toList().sorted().forEachIndexed { index, key ->
                if (index > 0) append(',')
                append(quote(key))
                append(':')
                append(serialize(value.get(key)))
            }
            append('}')
        }
        else -> fail()
    }

    private fun serializeInteger(value: Number): String {
        val doubleValue = value.toDouble()
        val longValue = value.toLong()
        if (!doubleValue.isFinite() || doubleValue != longValue.toDouble() ||
            longValue !in -MAX_SAFE_INTEGER..MAX_SAFE_INTEGER
        ) {
            fail()
        }
        return longValue.toString()
    }

    private fun quote(value: String): String = buildString(value.length + 2) {
        append('"')
        var index = 0
        while (index < value.length) {
            val character = value[index]
            when (character) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000c' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> when {
                    character.code < 0x20 -> appendUnicodeEscape(character)
                    Character.isHighSurrogate(character) -> {
                        if (index + 1 < value.length && Character.isLowSurrogate(value[index + 1])) {
                            append(character)
                            index += 1
                            append(value[index])
                        } else {
                            appendUnicodeEscape(character)
                        }
                    }
                    Character.isLowSurrogate(character) -> appendUnicodeEscape(character)
                    else -> append(character)
                }
            }
            index += 1
        }
        append('"')
    }

    private fun StringBuilder.appendUnicodeEscape(character: Char) {
        append("\\u")
        append(character.code.toString(16).padStart(4, '0'))
    }

    private fun fail(): Nothing = throw StationStoreFailure(
        StationStoreErrors.INVALID_PACKAGE,
        "Paketpayloaden är inte canonical JSON",
    )

    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
}
