package org.hisnfilter.core

/**
 * تطبيع النص قبل مقارنته بالقاموس — منقول حرفيًا من packages/core/src/normalize.js
 * حتى تعطي الإضافة والتطبيق نفس النتيجة على نفس النص.
 * map[i] = موضع الحرف i من النص المطبَّع في النص الأصلي.
 */
class Normalized(val text: String, val map: IntArray)

object Normalize {
    private const val TATWEEL = 'ـ'

    private fun isDiacritic(c: Char) =
        c in 'ؐ'..'ؚ' || c in 'ً'..'ٟ' || c == 'ٰ' || c in 'ۖ'..'ۭ'

    private fun isInvisible(c: Char) =
        c in '​'..'‏' || c in '‪'..'‮' || c in '⁠'..'⁤' || c == '﻿' || c == '­'

    private val ARABIC = mapOf(
        'آ' to 'ا', 'أ' to 'ا', 'إ' to 'ا', 'ٱ' to 'ا',
        'ى' to 'ي', 'ة' to 'ه', 'ؤ' to 'و', 'ئ' to 'ي',
        'ک' to 'ك', 'ی' to 'ي', 'گ' to 'ق', 'چ' to 'ج', 'ڤ' to 'ف', 'پ' to 'ب',
    )

    private val LEET = mapOf(
        '0' to 'o', '1' to 'i', '3' to 'e', '4' to 'a', '5' to 's',
        '7' to 't', '@' to 'a', '$' to 's', '!' to 'i', '|' to 'i',
    )

    fun normalize(input: String): Normalized {
        val chars = StringBuilder(input.length)
        val map = IntArray(input.length)
        var n = 0
        for (i in input.indices) {
            var ch = input[i]
            if (ch == TATWEEL || isDiacritic(ch) || isInvisible(ch)) continue
            ch = ARABIC[ch] ?: if (ch in '٠'..'٩') '0' + (ch - '٠') else ch
            chars.append(ch.lowercaseChar())
            map[n++] = i
        }
        // تكرار الحرف 3 مرات أو أكثر يُختصر لحرف واحد، والتكرار مرتين يبقى
        val out = StringBuilder(n)
        val outMap = IntArray(n)
        var m = 0
        var i = 0
        while (i < n) {
            var j = i
            while (j < n && chars[j] == chars[i]) j++
            val keep = if (j - i >= 3) 1 else j - i
            for (k in 0 until keep) {
                out.append(chars[i])
                outMap[m++] = map[i + k]
            }
            i = j
        }
        return Normalized(out.toString(), outMap.copyOf(m))
    }

    fun deLeet(text: String): String {
        val sb = StringBuilder(text.length)
        for (c in text) sb.append(LEET[c] ?: c)
        return sb.toString()
    }

    fun normalizeTerm(term: String): String = normalize(term).text.trim()

    fun isSpace(c: Char) = Character.isWhitespace(c) || Character.isSpaceChar(c) || c == '﻿'

    private const val SEP_CHARS = ".-_*+~|/\\·•،,؛:'\"`^=()[]{}<>"

    fun isSeparator(c: Char) = isSpace(c) || SEP_CHARS.indexOf(c) >= 0

    /** يضم الحروف المكتوبة منفصلة للتحايل ("ك.ل.م.ة"، "f u c k") — 3 حروف مفردة أو أكثر. */
    fun collapseSpacedLetters(norm: Normalized): List<Normalized> {
        val text = norm.text
        val tokens = ArrayList<IntArray>()
        var start = -1
        for (i in 0..text.length) {
            val sep = i == text.length || isSeparator(text[i])
            if (!sep && start == -1) start = i
            if (sep && start != -1) {
                tokens.add(intArrayOf(start, i))
                start = -1
            }
        }
        val segments = ArrayList<Normalized>()
        val run = ArrayList<IntArray>()
        fun flush() {
            if (run.size >= 3) {
                segments.add(
                    Normalized(
                        run.joinToString("") { text[it[0]].toString() },
                        IntArray(run.size) { norm.map[run[it][0]] },
                    )
                )
            }
            run.clear()
        }
        for (t in tokens) if (t[1] - t[0] == 1) run.add(t) else flush()
        flush()
        return segments
    }
}
