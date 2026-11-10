package org.hisnfilter.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/** تخطيط العناوين يطابق ملفات dist/web الحقيقية، ولا يسمح بالخروج منها. */
class WebRoutesTest {
    @Test
    fun pagesAndModels() {
        assertEquals(WebRoutes.Route.Asset("pages/clean-video.html", "text/html"), WebRoutes.resolve("/pages/clean-video.html"))
        assertEquals(WebRoutes.Route.Asset("320n.onnx", "application/octet-stream"), WebRoutes.resolve("/models/nudenet/320n.onnx"))
        assertEquals(WebRoutes.Route.Asset("yamnet.onnx", "application/octet-stream"), WebRoutes.resolve("/models/yamnet/yamnet.onnx"))
        assertEquals(WebRoutes.Route.Asset("audio/df_bg.wasm", "application/wasm"), WebRoutes.resolve("/audio/df_bg.wasm"))
        assertEquals(WebRoutes.Route.Shared, WebRoutes.resolve("/shared/video"))
        assertEquals(WebRoutes.Route.Output, WebRoutes.resolve("/output/video"))
    }

    @Test
    fun refusesEverythingElse() {
        for (p in listOf("/../lexicon.json", "/pages/../lexicon.json", "/lexicon.json", "/models/blazeface.onnx", "/pages/x.exe", "//pages/a.js", null)) {
            assertNull(p, WebRoutes.resolve(p))
        }
    }

    @Test
    fun ranges() {
        assertEquals(0L..99L, WebRoutes.range("bytes=0-99", 1000))
        assertEquals(500L..999L, WebRoutes.range("bytes=500-", 1000))
        assertEquals(900L..999L, WebRoutes.range("bytes=-100", 1000))
        assertEquals(990L..999L, WebRoutes.range("bytes=990-5000", 1000))
        assertNull(WebRoutes.range("bytes=1000-", 1000))
        assertNull(WebRoutes.range("bytes=5-2", 1000))
        assertNull(WebRoutes.range(null, 1000))
        assertNull(WebRoutes.range("items=0-1", 1000))
    }

    /** كل ملف تبنيه الصفحات (dist/web) له مسار صحيح — إن وُجد البناء. */
    @Test
    fun everyBuiltFileIsServed() {
        val web = TestFiles.file("apps/extension/dist/web")
        if (!web.isDirectory) return
        // ملفات الآيفون وحده (المتصفح المحمي وفحص الحماية) لا تُطلب في أندرويد
        val iosOnly = setOf("content-app.js", "content-app.js.map", "pages/detector-app.js", "pages/detector-app.html", "yt-main.js", "yt-main.js.map")
        web.walkTopDown().filter {
            it.isFile && !it.name.endsWith(".LEGAL.txt") && it.name.contains(".") /* الترخيص لا يُطلب من الصفحة */ &&
                it.relativeTo(web).invariantSeparatorsPath !in iosOnly && !it.relativeTo(web).invariantSeparatorsPath.startsWith("pages/selftest/")
        }.forEach { f ->
            val rel = "/" + f.relativeTo(web).invariantSeparatorsPath
            val r = WebRoutes.resolve(rel)
            if (r !is WebRoutes.Route.Asset || r.name != rel.removePrefix("/")) throw AssertionError("$rel → $r")
        }
    }
}
