package org.hisnfilter.core

/**
 * أدوات DNS للشبكة الافتراضية المحلية (VpnService): لا يمر عبرها إلا طلبات أسماء المواقع،
 * فنحجب المواقع الإباحية والقمار، ونفرض البحث الآمن، ونمرر الباقي لخادم DNS عادي.
 * لا شيء يُحفظ ولا يُرسل لأي جهة غير خادم DNS نفسه.
 */
object Dns {
    const val TYPE_A = 1
    const val TYPE_AAAA = 28
    const val RCODE_SERVFAIL = 2
    const val RCODE_NXDOMAIN = 3

    data class UdpPacket(val src: ByteArray, val dst: ByteArray, val srcPort: Int, val dstPort: Int, val payload: ByteArray)

    data class Question(val id: Int, val name: String, val type: Int, val qclass: Int, val end: Int)

    private fun u16(b: ByteArray, o: Int) = ((b[o].toInt() and 0xFF) shl 8) or (b[o + 1].toInt() and 0xFF)

    /** يقرأ حزمة IPv4/UDP. يُرجع null لأي شيء آخر. */
    fun parseIpv4Udp(p: ByteArray, len: Int): UdpPacket? {
        if (len < 28) return null
        val version = (p[0].toInt() shr 4) and 0xF
        if (version != 4) return null
        val ihl = (p[0].toInt() and 0xF) * 4
        if (p[9].toInt() != 17 || len < ihl + 8) return null // 17 = UDP
        val total = minOf(u16(p, 2), len)
        val udpLen = u16(p, ihl + 4)
        val payloadLen = minOf(udpLen - 8, total - ihl - 8)
        if (payloadLen <= 0) return null
        return UdpPacket(
            p.copyOfRange(12, 16), p.copyOfRange(16, 20),
            u16(p, ihl), u16(p, ihl + 2),
            p.copyOfRange(ihl + 8, ihl + 8 + payloadLen),
        )
    }

    /** يبني حزمة IPv4/UDP (مجموع UDP الاختباري صفر، وهو مسموح في IPv4). */
    fun buildIpv4Udp(src: ByteArray, dst: ByteArray, srcPort: Int, dstPort: Int, payload: ByteArray): ByteArray {
        val total = 20 + 8 + payload.size
        val p = ByteArray(total)
        p[0] = 0x45; p[2] = (total shr 8).toByte(); p[3] = total.toByte()
        p[6] = 0x40 // لا تجزئة
        p[8] = 64; p[9] = 17
        System.arraycopy(src, 0, p, 12, 4); System.arraycopy(dst, 0, p, 16, 4)
        var sum = 0
        for (i in 0 until 20 step 2) sum += u16(p, i)
        while (sum shr 16 != 0) sum = (sum and 0xFFFF) + (sum shr 16)
        val ck = sum.inv() and 0xFFFF
        p[10] = (ck shr 8).toByte(); p[11] = ck.toByte()
        p[20] = (srcPort shr 8).toByte(); p[21] = srcPort.toByte()
        p[22] = (dstPort shr 8).toByte(); p[23] = dstPort.toByte()
        val ul = 8 + payload.size
        p[24] = (ul shr 8).toByte(); p[25] = ul.toByte()
        System.arraycopy(payload, 0, p, 28, payload.size)
        return p
    }

    /** يقرأ اسمًا (مع دعم الضغط) ويُرجع (الاسم، موضع ما بعده). */
    fun readName(m: ByteArray, start: Int): Pair<String, Int> {
        val parts = ArrayList<String>()
        var o = start
        var end = -1
        var jumps = 0
        while (true) {
            if (o >= m.size) throw IllegalArgumentException("DNS: اسم مقطوع")
            val l = m[o].toInt() and 0xFF
            when {
                l == 0 -> { if (end < 0) end = o + 1; break }
                l and 0xC0 == 0xC0 -> {
                    if (end < 0) end = o + 2
                    o = ((l and 0x3F) shl 8) or (m[o + 1].toInt() and 0xFF)
                    if (++jumps > 20) throw IllegalArgumentException("DNS: حلقة ضغط")
                }
                else -> {
                    parts.add(String(m, o + 1, l, Charsets.ISO_8859_1))
                    o += l + 1
                }
            }
        }
        return parts.joinToString(".").lowercase() to end
    }

    fun parseQuestion(m: ByteArray): Question? {
        if (m.size < 12) return null
        val flags = u16(m, 2)
        if (flags and 0x8000 != 0) return null // رد وليس سؤالًا
        if (u16(m, 4) < 1) return null
        return try {
            val (name, after) = readName(m, 12)
            if (after + 4 > m.size) return null
            Question(u16(m, 0), name, u16(m, after), u16(m, after + 2), after + 4)
        } catch (e: IllegalArgumentException) {
            null
        }
    }

    private fun encodeName(name: String): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        for (label in name.trimEnd('.').split('.')) {
            if (label.isEmpty()) continue
            val b = label.toByteArray(Charsets.ISO_8859_1)
            out.write(b.size); out.write(b)
        }
        out.write(0)
        return out.toByteArray()
    }

    fun buildQuery(id: Int, name: String, type: Int): ByteArray {
        val n = encodeName(name)
        val m = ByteArray(12 + n.size + 4)
        m[0] = (id shr 8).toByte(); m[1] = id.toByte()
        m[2] = 0x01 // طلب تكراري
        m[5] = 1
        System.arraycopy(n, 0, m, 12, n.size)
        m[12 + n.size + 1] = type.toByte()
        m[12 + n.size + 3] = 1
        return m
    }

    /**
     * يبني ردًا على سؤال: نفس المعرّف والسؤال، مع إجابات A (عناوين IPv4) أو رمز خطأ.
     * @param answers عناوين IPv4 (4 بايت لكل منها)؛ تُضاف فقط إذا كان السؤال من نوع A.
     */
    fun buildResponse(query: ByteArray, q: Question, rcode: Int, answers: List<ByteArray> = emptyList(), ttl: Int = 300): ByteArray {
        val ans = if (q.type == TYPE_A && rcode == 0) answers else emptyList()
        val out = java.io.ByteArrayOutputStream()
        out.write(query, 0, 2)
        val rd = query[2].toInt() and 0x01
        out.write(0x80 or rd) // QR=1
        out.write(0x80 or rcode) // RA=1
        out.write(0); out.write(1) // سؤال واحد
        out.write(ans.size shr 8); out.write(ans.size)
        out.write(0); out.write(0); out.write(0); out.write(0)
        out.write(query, 12, q.end - 12)
        for (a in ans) {
            out.write(0xC0); out.write(12) // الاسم: مؤشر للسؤال
            out.write(0); out.write(TYPE_A); out.write(0); out.write(1)
            out.write(ttl ushr 24); out.write(ttl ushr 16); out.write(ttl ushr 8); out.write(ttl)
            out.write(0); out.write(4); out.write(a)
        }
        return out.toByteArray()
    }

    /** هل هذه الحزمة ردٌّ على هذا السؤال؟ المعرّف نفسه، وعلم الرد مرفوع، والسؤال نفسه (الاسم والنوع). */
    fun isResponseTo(resp: ByteArray, len: Int, query: ByteArray): Boolean {
        if (len < 12 || query.size < 12) return false
        if (u16(resp, 0) != u16(query, 0)) return false
        if (u16(resp, 2) and 0x8000 == 0) return false
        val q = parseQuestion(query) ?: return true
        return try {
            if (u16(resp, 4) < 1) return false
            val (name, after) = readName(resp, 12)
            name == q.name && after + 4 <= len && u16(resp, after) == q.type
        } catch (e: IllegalArgumentException) { false }
    }

    /** يستخرج عناوين IPv4 من رد DNS. */
    fun parseAnswersA(m: ByteArray): List<ByteArray> {
        if (m.size < 12) return emptyList()
        val qd = u16(m, 4); val an = u16(m, 6)
        var o = 12
        repeat(qd) { o = readName(m, o).second + 4 }
        val out = ArrayList<ByteArray>()
        repeat(an) {
            o = readName(m, o).second
            val type = u16(m, o); val rdLen = u16(m, o + 8)
            if (type == TYPE_A && rdLen == 4) out.add(m.copyOfRange(o + 10, o + 14))
            o += 10 + rdLen
        }
        return out
    }
}

/** قائمة نطاقات: يُطابق النطاق نفسه وكل نطاقاته الفرعية. */
class DomainSet(domains: Collection<String>) {
    private val set = HashSet<String>(domains.size * 2).apply { domains.forEach { add(it.lowercase().trim('.')) } }
    val size get() = set.size

    fun matches(host: String): Boolean {
        var h = host.lowercase().trimEnd('.').removePrefix("www.")
        while (true) {
            if (h in set) return true
            val dot = h.indexOf('.')
            if (dot < 0) return false
            h = h.substring(dot + 1)
            if (h.indexOf('.') < 0) return h in set // لا نحجب نطاقًا أعلى (com) إلا إذا كان مدرجًا صراحة
        }
    }

    companion object {
        fun fromJson(json: String) = DomainSet(MiniJson.parse(json).obj()["domains"].strings())
    }
}

/** البحث الآمن على مستوى DNS: نحوّل أسماء محركات البحث إلى عناوينها "الآمنة" الرسمية. */
object SafeSearchDns {
    private val GOOGLE = Regex("^(www\\.)?google\\.[a-z]{2,3}(\\.[a-z]{2})?$")
    private val YOUTUBE = setOf("www.youtube.com", "m.youtube.com", "youtubei.googleapis.com", "youtube.googleapis.com", "www.youtube-nocookie.com")
    private val BING = setOf("bing.com", "www.bing.com")
    private val DDG = setOf("duckduckgo.com", "www.duckduckgo.com", "start.duckduckgo.com", "html.duckduckgo.com")
    private val YANDEX = Regex("^(www\\.)?yandex\\.(ru|com|com\\.tr|by|kz|ua)$")

    fun target(host: String, youtubeRestricted: Boolean, youtubeStrict: Boolean = false): String? {
        val h = host.lowercase().trimEnd('.')
        return when {
            GOOGLE.matches(h) -> "forcesafesearch.google.com"
            youtubeRestricted && h in YOUTUBE -> if (youtubeStrict) "restrict.youtube.com" else "restrictmoderate.youtube.com"
            h in BING -> "strict.bing.com"
            h in DDG -> "safe.duckduckgo.com"
            YANDEX.matches(h) -> "familysearch.yandex.ru"
            else -> null
        }
    }
}
