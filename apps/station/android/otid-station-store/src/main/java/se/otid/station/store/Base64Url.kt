package se.otid.station.store

/** Dependency-free, unpadded RFC 4648 base64url used by the credential format. */
internal object Base64Url {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

    fun encode(bytes: ByteArray): String {
        val output = StringBuilder((bytes.size * 4 + 2) / 3)
        var index = 0
        while (index + 2 < bytes.size) {
            val value = ((bytes[index].toInt() and 0xff) shl 16) or
                ((bytes[index + 1].toInt() and 0xff) shl 8) or
                (bytes[index + 2].toInt() and 0xff)
            output.append(ALPHABET[value ushr 18])
            output.append(ALPHABET[(value ushr 12) and 63])
            output.append(ALPHABET[(value ushr 6) and 63])
            output.append(ALPHABET[value and 63])
            index += 3
        }
        when (bytes.size - index) {
            1 -> {
                val value = bytes[index].toInt() and 0xff
                output.append(ALPHABET[value ushr 2])
                output.append(ALPHABET[(value and 3) shl 4])
            }
            2 -> {
                val value = ((bytes[index].toInt() and 0xff) shl 8) or
                    (bytes[index + 1].toInt() and 0xff)
                output.append(ALPHABET[value ushr 10])
                output.append(ALPHABET[(value ushr 4) and 63])
                output.append(ALPHABET[(value and 15) shl 2])
            }
        }
        return output.toString()
    }

    fun decode(value: String): ByteArray {
        if (value.length % 4 == 1) throw IllegalArgumentException("Invalid base64url length")
        val output = ByteArray(value.length * 6 / 8)
        var accumulator = 0
        var bits = 0
        var outputIndex = 0
        value.forEach { character ->
            val decoded = decodeCharacter(character)
            if (decoded < 0) throw IllegalArgumentException("Invalid base64url character")
            accumulator = (accumulator shl 6) or decoded
            bits += 6
            if (bits >= 8) {
                bits -= 8
                output[outputIndex++] = (accumulator ushr bits).toByte()
                accumulator = accumulator and ((1 shl bits) - 1)
            }
        }
        if (accumulator != 0 || outputIndex != output.size || encode(output) != value) {
            throw IllegalArgumentException("Non-canonical base64url")
        }
        return output
    }

    private fun decodeCharacter(value: Char): Int = when (value) {
        in 'A'..'Z' -> value.code - 'A'.code
        in 'a'..'z' -> value.code - 'a'.code + 26
        in '0'..'9' -> value.code - '0'.code + 52
        '-' -> 62
        '_' -> 63
        else -> -1
    }
}
