package org.hisnfilter.core

/**
 * قارئ JSON صغير بلا مكتبات خارجية (يعمل على أندرويد وعلى الحاسوب في الاختبارات).
 * الناتج: Map<String, Any?> أو List<Any?> أو String أو Double أو Boolean أو null.
 */
object MiniJson {
    fun parse(text: String): Any? {
        val p = Parser(text)
        p.ws()
        val v = p.value()
        p.ws()
        require(p.i == text.length) { "JSON: محارف زائدة عند ${p.i}" }
        return v
    }

    private class Parser(val s: String) {
        var i = 0

        fun ws() {
            while (i < s.length && s[i].isWhitespace()) i++
        }

        fun value(): Any? {
            require(i < s.length) { "JSON: نهاية غير متوقعة" }
            return when (val c = s[i]) {
                '{' -> obj()
                '[' -> arr()
                '"' -> str()
                't' -> lit("true", true)
                'f' -> lit("false", false)
                'n' -> lit("null", null)
                else -> if (c == '-' || c.isDigit()) num() else error("JSON: محرف غير متوقع '$c' عند $i")
            }
        }

        fun lit(word: String, v: Any?): Any? {
            require(s.startsWith(word, i)) { "JSON: كلمة غير صحيحة عند $i" }
            i += word.length
            return v
        }

        fun num(): Double {
            val start = i
            while (i < s.length && (s[i].isDigit() || s[i] in "+-.eE")) i++
            return s.substring(start, i).toDouble()
        }

        fun str(): String {
            i++ // "
            val sb = StringBuilder()
            while (true) {
                require(i < s.length) { "JSON: نص غير مغلق" }
                val c = s[i++]
                when (c) {
                    '"' -> return sb.toString()
                    '\\' -> {
                        when (val e = s[i++]) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> {
                                sb.append(s.substring(i, i + 4).toInt(16).toChar())
                                i += 4
                            }
                            else -> error("JSON: هروب غير معروف \\$e")
                        }
                    }
                    else -> sb.append(c)
                }
            }
        }

        fun arr(): List<Any?> {
            i++
            val out = ArrayList<Any?>()
            ws()
            if (s[i] == ']') { i++; return out }
            while (true) {
                ws(); out.add(value()); ws()
                when (s[i++]) {
                    ',' -> continue
                    ']' -> return out
                    else -> error("JSON: متوقع , أو ] عند ${i - 1}")
                }
            }
        }

        fun obj(): Map<String, Any?> {
            i++
            val out = LinkedHashMap<String, Any?>()
            ws()
            if (s[i] == '}') { i++; return out }
            while (true) {
                ws()
                val k = str()
                ws()
                require(s[i++] == ':') { "JSON: متوقع : عند ${i - 1}" }
                ws()
                out[k] = value()
                ws()
                when (s[i++]) {
                    ',' -> continue
                    '}' -> return out
                    else -> error("JSON: متوقع , أو } عند ${i - 1}")
                }
            }
        }
    }
}

@Suppress("UNCHECKED_CAST")
internal fun Any?.obj(): Map<String, Any?> = this as Map<String, Any?>

@Suppress("UNCHECKED_CAST")
internal fun Any?.list(): List<Any?> = this as List<Any?>

internal fun Any?.strings(): List<String> = list().map { it as String }
