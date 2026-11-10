package org.hisnfilter.core

/**
 * محرك فلترة النصوص — منقول من packages/core/src/textFilter.js بنفس الأنماط والعتبات،
 * ويقرأ نفس القاموس (packages/core/data/lexicon.json).
 */
class TextFilter(lexicon: Map<String, Any?>) {
    data class Range(val start: Int, var end: Int)
    data class ExplicitScore(val score: Double, val total: Int, val distinct: Int, val terms: List<String>)

    private class Weighted(val re: Regex, val byTerm: Map<String, Int>)

    private val reArabic: Regex
    private val reArabicPhrases: Regex
    private val reFranco: Regex
    private val reEnglish: Regex
    private val spacedTerms: Set<String>
    private val enAllow: Set<String>
    private val explicitAr: Weighted
    private val explicitEn: Weighted
    // الشتائم العامة (وضع الطفل فقط)
    private val reInsultAr: Regex?
    private val reInsultEn: Regex?
    @Volatile var insults = false

    init {
        val mask = lexicon["mask"].obj()
        val explicit = lexicon["explicit"].obj()
        val ar = mask["ar"].strings()
        val en = mask["en"].strings()
        reArabic = compileArabic(ar)
        reArabicPhrases = compileArabicPhrases(mask["ar_phrases"].strings())
        reFranco = compileLatin(mask["franco"].strings(), leet = false)
        reEnglish = compileLatin(en, leet = true)
        enAllow = (mask["en_allow"] as? List<*>)?.map { (it as String).lowercase() }?.toSet() ?: emptySet()
        spacedTerms = (ar + en)
            .map { Normalize.deLeet(Normalize.normalizeTerm(it.removeSuffix("*"))).replace(Regex("(?U)\\s+"), "") }
            .filter { it.length >= 3 }
            .toCollection(LinkedHashSet())
        explicitAr = compileWeighted(explicit["ar"].obj(), AR_LETTER, AR_PREFIX)
        explicitEn = compileWeighted(explicit["en"].obj(), "a-z", "")
        val ins = lexicon["insults"] as? Map<*, *>
        reInsultAr = (ins?.get("ar_phrases") as? List<*>)?.map { it as String }?.takeIf { it.isNotEmpty() }?.let { compileArabicPhrases(it) }
        reInsultEn = (ins?.get("en") as? List<*>)?.map { it as String }?.takeIf { it.isNotEmpty() }?.let { compileLatin(it, leet = true) }
    }

    /** مواضع الألفاظ الفاحشة في النص الأصلي (end غير شاملة)، والمتداخل يُدمج. */
    fun findProfanity(text: String): List<Range> {
        val norm = Normalize.normalize(text)
        val ranges = ArrayList<Range>()
        fun wordAt(s: String, start: Int, end: Int): String {
            var a = start; var b = end
            while (a > 0 && s[a - 1] in 'a'..'z') a--
            while (b < s.length && s[b] in 'a'..'z') b++
            return s.substring(a, b)
        }
        fun collect(re: Regex, haystack: String) {
            for (m in re.findAll(haystack)) {
                if (m.value.isEmpty()) continue
                if (enAllow.isNotEmpty() && wordAt(haystack, m.range.first, m.range.last + 1) in enAllow) continue
                ranges.add(Range(norm.map[m.range.first], norm.map[m.range.last] + 1))
            }
        }
        collect(reArabicPhrases, norm.text)
        collect(reArabic, norm.text)
        collect(reFranco, norm.text)
        collect(reEnglish, Normalize.deLeet(norm.text))
        if (insults) {
            reInsultAr?.let { collect(it, norm.text) }
            reInsultEn?.let { collect(it, Normalize.deLeet(norm.text)) }
        }
        for (seg in Normalize.collapseSpacedLetters(norm)) {
            val joined = Normalize.deLeet(seg.text)
            for (term in spacedTerms) {
                if (joined.indexOf(term) != -1 && joined.length - term.length <= 2) {
                    ranges.add(Range(seg.map.first(), seg.map.last() + 1))
                    break
                }
            }
        }
        return merge(ranges)
    }

    fun hasProfanity(text: String) = findProfanity(text).isNotEmpty()

    fun censor(text: String, mask: Char = '*'): String {
        val ranges = findProfanity(text)
        if (ranges.isEmpty()) return text
        val sb = StringBuilder(text.length)
        var cursor = 0
        for (r in ranges) {
            sb.append(text, cursor, r.start)
            for (i in r.start until r.end) sb.append(if (Normalize.isSpace(text[i])) text[i] else mask)
            cursor = r.end
        }
        sb.append(text, cursor, text.length)
        return sb.toString()
    }

    fun explicitScore(text: String): ExplicitScore {
        val norm = Normalize.normalize(text).text
        val words = norm.split(WS).count { it.isNotEmpty() }.coerceAtLeast(1)
        val found = LinkedHashMap<String, Int>()
        val counts = HashMap<String, Int>()
        for (w in listOf(explicitAr, explicitEn)) {
            for (m in w.re.findAll(norm)) {
                val key = m.groupValues[1].replace(WS, " ")
                // تكرار الكلمة نفسها لا يرفع الدرجة بلا حد
                val c = (counts[key] ?: 0) + 1
                counts[key] = c
                if (c <= 2) found[key] = (found[key] ?: 0) + (w.byTerm[key] ?: 1)
            }
        }
        val profane = findProfanity(text).size
        val total = profane * 4 + found.values.sum()
        return ExplicitScore(total.toDouble() / words * 100, total, found.size + if (profane > 0) 1 else 0, found.keys.toList())
    }

    fun isExplicit(text: String, level: String = "medium"): Boolean {
        val (minTotal, minDensity, minDistinct) = when (level) {
            "light" -> Triple(12, 14, 3)
            "strict" -> Triple(5, 6, 2)
            else -> Triple(8, 9, 2)
        }
        val r = explicitScore(text)
        return r.total >= minTotal && r.score >= minDensity && r.distinct >= minDistinct
    }

    companion object {
        private const val AR_LETTER = "\\u0621-\\u064A"
        private const val AR_PREFIX = "(?:وال|فال|بال|لل|ال|يا|و|ف)"
        private const val AR_SUFFIX = "(?:ها|هم|هن|كم|كن|ات|ين|ون|وا|نا|ني|ه|ك)"
        private const val EN_SUFFIX = "(?:s|es|ed|ing|er|ers|y)"
        private val WS = Regex("(?U)\\s+")

        fun fromJson(json: String) = TextFilter(MiniJson.parse(json).obj())

        private fun esc(s: String) = buildString {
            for (c in s) {
                if (c in ".*+?^\${}()|[]\\") append('\\')
                append(c)
            }
        }

        private fun re(p: String) = Regex("(?U)$p")

        private fun compileArabic(terms: List<String>): Regex {
            val parts = terms.map { raw ->
                val wild = raw.endsWith("*")
                val term = esc(Normalize.normalizeTerm(raw.removeSuffix("*")))
                val prefix = if (term.length <= 2) "" else "$AR_PREFIX?"
                "$prefix$term${if (wild) "$AR_SUFFIX?" else ""}"
            }
            return re("(?<![$AR_LETTER])(?:${parts.joinToString("|")})(?![$AR_LETTER])")
        }

        private fun compileArabicPhrases(phrases: List<String>): Regex {
            val parts = phrases.map { p -> Normalize.normalizeTerm(p).split(WS).joinToString("\\s+") { esc(it) } }
            return re("(?<![$AR_LETTER])(?:${parts.joinToString("|")})(?![$AR_LETTER])")
        }

        private fun compileLatin(terms: List<String>, leet: Boolean): Regex {
            val parts = terms.map { raw ->
                val wild = raw.endsWith("*")
                val term = raw.removeSuffix("*").lowercase()
                val body = term.split(WS).joinToString("\\s+") { esc(it) }
                if (wild) "$body[a-z]*" else body + if (leet) "$EN_SUFFIX?" else ""
            }
            val boundary = if (leet) "a-z" else "a-z0-9"
            return re("(?<![$boundary])(?:${parts.joinToString("|")})(?![$boundary])")
        }

        private fun compileWeighted(dict: Map<String, Any?>, letters: String, prefix: String): Weighted {
            val terms = dict.filterKeys { !it.startsWith("_") }
                .map { (k, w) -> Normalize.normalizeTerm(k) to (w as Number).toInt() }
            val byTerm = terms.toMap()
            val alt = terms.sortedByDescending { it.first.length }
                .joinToString("|") { t -> t.first.split(WS).joinToString("\\s+") { esc(it) } }
            val pre = if (prefix.isNotEmpty()) "$prefix?" else ""
            return Weighted(re("(?<![$letters])$pre($alt)(?![$letters])"), byTerm)
        }

        private fun merge(ranges: MutableList<Range>): List<Range> {
            if (ranges.isEmpty()) return emptyList()
            ranges.sortBy { it.start }
            val out = arrayListOf(ranges[0].copy())
            for (r in ranges.drop(1)) {
                val last = out.last()
                if (r.start <= last.end) last.end = maxOf(last.end, r.end) else out.add(r.copy())
            }
            return out
        }
    }
}
