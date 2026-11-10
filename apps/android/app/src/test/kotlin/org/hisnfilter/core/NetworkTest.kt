package org.hisnfilter.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkTest {
    private val client = byteArrayOf(10, 111, 0, 2)
    private val dnsIp = byteArrayOf(10, 111, 0, 1)

    @Test
    fun dnsRoundTrip() {
        val q = Dns.buildQuery(0x1234, "www.Example.com", Dns.TYPE_A)
        val pkt = Dns.buildIpv4Udp(client, dnsIp, 40000, 53, q)
        val udp = Dns.parseIpv4Udp(pkt, pkt.size)
        assertNotNull(udp)
        assertEquals(53, udp!!.dstPort)
        assertEquals(40000, udp.srcPort)
        // مجموع رأس IPv4 الاختباري صحيح: مجموع الكلمات كلها = 0xFFFF
        var sum = 0
        for (i in 0 until 20 step 2) sum += ((pkt[i].toInt() and 0xFF) shl 8) or (pkt[i + 1].toInt() and 0xFF)
        while (sum shr 16 != 0) sum = (sum and 0xFFFF) + (sum shr 16)
        assertEquals(0xFFFF, sum)
        val question = Dns.parseQuestion(udp.payload)!!
        assertEquals("www.example.com", question.name)
        assertEquals(Dns.TYPE_A, question.type)
        assertEquals(0x1234, question.id)

        val resp = Dns.buildResponse(udp.payload, question, 0, listOf(byteArrayOf(216.toByte(), 239.toByte(), 38, 120)))
        val ips = Dns.parseAnswersA(resp)
        assertEquals(1, ips.size)
        assertEquals(listOf(216, 239, 38, 120), ips[0].map { it.toInt() and 0xFF })
        assertEquals(0x80, resp[2].toInt() and 0x80) // رد

        val nx = Dns.buildResponse(udp.payload, question, Dns.RCODE_NXDOMAIN)
        assertEquals(Dns.RCODE_NXDOMAIN, nx[3].toInt() and 0x0F)
        assertTrue(Dns.parseAnswersA(nx).isEmpty())
        // ردود ليست أسئلة لا تُقرأ كأسئلة
        assertEquals(null, Dns.parseQuestion(resp))
    }

    @Test
    fun compressedNamesInAnswers() {
        // رد فيه CNAME ثم A، والأسماء مضغوطة بمؤشرات
        val q = Dns.buildQuery(7, "www.google.com", Dns.TYPE_A)
        val question = Dns.parseQuestion(q)!!
        val base = Dns.buildResponse(q, question, 0, listOf(byteArrayOf(1, 2, 3, 4), byteArrayOf(5, 6, 7, 8)))
        assertEquals(2, Dns.parseAnswersA(base).size)
    }

    @Test
    fun domainSet() {
        val adult = DomainSet.fromJson(TestFiles.text("apps/extension/static/rules/adult-domains.json"))
        assertTrue(adult.size > 40000)
        val sample = MiniJson.parse(TestFiles.text("apps/extension/static/rules/adult-domains.json")).obj()["domains"].strings()[100]
        assertTrue(adult.matches(sample))
        assertTrue(adult.matches("cdn.$sample"))
        assertTrue(adult.matches("WWW.$sample."))
        for (ok in listOf("google.com", "www.youtube.com", "quran.com", "ar.wikipedia.org", "x.com", "reddit.com", "com", "instagram.com")) {
            assertFalse("حُجب بالخطأ: $ok", adult.matches(ok))
        }
        val gambling = DomainSet.fromJson(TestFiles.text("apps/extension/static/rules/gambling-domains.json"))
        assertTrue(gambling.size > 1000)
    }

    @Test
    fun safeSearch() {
        assertEquals("forcesafesearch.google.com", SafeSearchDns.target("www.google.com", true))
        assertEquals("forcesafesearch.google.com", SafeSearchDns.target("www.google.com.sa", true))
        assertEquals("forcesafesearch.google.com", SafeSearchDns.target("google.ae", true))
        assertEquals(null, SafeSearchDns.target("mail.google.com", true))
        assertEquals("restrictmoderate.youtube.com", SafeSearchDns.target("m.youtube.com", true))
        assertEquals(null, SafeSearchDns.target("m.youtube.com", false))
        assertEquals("strict.bing.com", SafeSearchDns.target("www.bing.com", true))
        assertEquals("safe.duckduckgo.com", SafeSearchDns.target("duckduckgo.com", true))
    }

    @Test
    fun urlBar() {
        assertEquals("www.example.com", Apps.hostFromUrlBar("https://www.example.com/a?b=1"))
        assertEquals("example.com", Apps.hostFromUrlBar("example.com"))
        assertEquals(null, Apps.hostFromUrlBar("search something"))
        assertEquals(null, Apps.hostFromUrlBar("hello"))
    }

    @Test
    fun pin() {
        val h = Pin.hash("4826")
        assertEquals(64, h.hash.length)
        assertFalse(h.hash.contains("4826"))
        assertTrue(Pin.verify("4826", h.hash, h.salt))
        assertFalse(Pin.verify("4827", h.hash, h.salt))
        assertFalse(Pin.verify("", h.hash, h.salt))
        assertTrue(Pin.verify("anything", null, null))
        // نفس بصمة الإضافة (Web Crypto PBKDF2-SHA256، 150 ألف تكرار) لنفس الملح
        val salt = "000102030405060708090a0b0c0d0e0f"
        assertEquals("9ecc326de8fb6b8682a02fcabac2020267f019e0062b6ca0894da5eee6ed17f7", Pin.hash("4826", salt).hash)
    }
}

class DnsResponseCheckTest {
    @org.junit.Test
    fun acceptsOnlyMatchingResponses() {
        val q = Dns.buildQuery(0x1234, "example.com", Dns.TYPE_A)
        val qq = Dns.parseQuestion(q)!!
        val ok = Dns.buildResponse(q, qq, 0, listOf(byteArrayOf(1, 2, 3, 4)))
        org.junit.Assert.assertTrue(Dns.isResponseTo(ok, ok.size, q))
        org.junit.Assert.assertFalse("سؤال وليس ردًا", Dns.isResponseTo(q, q.size, q))
        val otherId = ok.copyOf().also { it[0] = 0x55 }
        org.junit.Assert.assertFalse("معرّف مختلف", Dns.isResponseTo(otherId, otherId.size, q))
        val q2 = Dns.buildQuery(0x1234, "other.com", Dns.TYPE_A)
        org.junit.Assert.assertFalse("اسم مختلف", Dns.isResponseTo(ok, ok.size, q2))
    }
}
