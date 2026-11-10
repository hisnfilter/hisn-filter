package org.hisnfilter.core

/**
 * موضوعات غير مناسبة للأطفال (السحر والجن والرعب والهالوين) — منقول من packages/core/src/topics.js،
 * والقوائم نفسها من packages/core/data/topics.json.
 */
class Topics(lex: Map<String, Any?>) {
    private fun n(s: String) = Normalize.normalize(s).text
    private val arWords = lex["arWords"].strings().map(::n).toSet()
    private val arPhrases = lex["arPhrases"].strings().map(::n)
    private val en = Regex("\\b(" + lex["en"].strings().joinToString("|") { Regex.escape(it).replace(" ", "\\E\\s*\\Q") } + ")\\b", RegexOption.IGNORE_CASE)
    // كلمات مميزة تُطابق حتى داخل كلمة أخرى (وسم مثل @spirithalloween)
    private val enAny = (lex["enAny"] as? List<*>)?.map { it as String }?.takeIf { it.isNotEmpty() }?.let { l -> Regex("(" + l.joinToString("|") { Regex.escape(it) } + ")", RegexOption.IGNORE_CASE) }
    private val religious = lex["religious"].strings().map(::n).toSet()
    private val strong = lex["strong"].strings().map(::n).toSet()

    /** صيغ الكلمة بعد حذف السوابق المحتملة (و، ف، ب، ل، ك — حتى حرفين — ثم ال أو لل). */
    private fun variants(tok: String): List<String> {
        val out = arrayListOf(tok)
        for (i in 0..2) {
            if (i > tok.length) break
            if (i > 0 && "وفبلك".indexOf(tok[i - 1]) < 0) break
            val rest = tok.substring(i)
            if (i > 0) out.add(rest)
            for (al in listOf("ال", "لل")) if (rest.startsWith(al)) out.add(rest.substring(al.length))
        }
        return out.filter { it.length >= 2 }
    }

    fun isScary(text: String?): Boolean = terms(text).isNotEmpty()

    fun terms(text: String?): List<String> {
        if (text.isNullOrBlank()) return emptyList()
        val t = n(text)
        val toks = t.split(Regex("[^\\u0621-\\u064a]+")).filter { it.isNotEmpty() }
        val bare = toks.flatMap(::variants).toSet()
        val found = LinkedHashSet<String>()
        for (w in arWords) if (w in bare) found.add(w)
        for (p in arPhrases) if (t.contains(p)) found.add(p)
        val e = en.find(t)?.groupValues?.get(1) ?: enAny?.find(t)?.groupValues?.get(1)
        if (e != null) found.add(e)
        if (found.isEmpty()) return emptyList()
        val rel = religious.any { it in bare }
        if (rel && found.none { it in strong } && e == null) return emptyList()
        return found.toList()
    }

    companion object {
        fun fromJson(json: String) = Topics(MiniJson.parse(json).obj())
    }
}
