package org.hisnfilter.core

/**
 * عناوين صفحات التطبيق الداخلية (تنظيف فيديو، ومحرك الصوت): تُخدم من ملفات التطبيق نفسه
 * على عنوان https ثابت لا يخرج للشبكة. نفس التخطيط في آيفون وفي اختبار المحاكاة (app-host.mjs):
 *   /pages /audio /ort /models/human ← ملفات dist/web
 *   /models/nudenet/320n.onnx و /models/yamnet/yamnet.onnx ← نماذج الفحص المباشر نفسها (لا نكررها)
 *   /shared/video ← الفيديو المُشارك من تطبيق آخر
 *   /output/video ← الناتج النظيف قبل حفظه (للمعاينة)
 */
object WebRoutes {
    const val HOST = "appassets.androidplatform.net"
    const val ORIGIN = "https://$HOST"
    const val SHARED = "/shared/video"
    const val OUTPUT = "/output/video"

    sealed class Route {
        data class Asset(val name: String, val mime: String) : Route()
        object Shared : Route()
        object Output : Route()
    }

    private val MIME = mapOf(
        "html" to "text/html", "js" to "text/javascript", "mjs" to "text/javascript", "css" to "text/css",
        "wasm" to "application/wasm", "json" to "application/json", "onnx" to "application/octet-stream",
        "bin" to "application/octet-stream", "txt" to "text/plain",
    )
    /** طلب Range ("bytes=a-b") ← [من، إلى] شاملًا، ضمن حجم الملف؛ null إن لم يكن طلبًا جزئيًا صالحًا. */
    fun range(header: String?, size: Long): LongRange? {
        val m = Regex("""bytes=(\d*)-(\d*)""").matchEntire(header?.trim() ?: return null) ?: return null
        val (a, b) = m.destructured
        if (size <= 0) return null
        return when {
            a.isEmpty() && b.isEmpty() -> null
            a.isEmpty() -> { val n = b.toLong().coerceAtMost(size); (size - n)..(size - 1) } // آخر n بايت
            else -> {
                val from = a.toLong()
                if (from >= size) return null
                from..(if (b.isEmpty()) size - 1 else b.toLong().coerceAtMost(size - 1))
            }
        }?.takeIf { it.first <= it.last }
    }

    /** صفحات معزولة: تسمح بتشغيل النماذج على عدة أنوية في WebView (SharedArrayBuffer). */
    val ISOLATION = mapOf(
        "Cross-Origin-Opener-Policy" to "same-origin",
        "Cross-Origin-Embedder-Policy" to "require-corp",
        "Cross-Origin-Resource-Policy" to "same-origin",
    )

    private val ROOTS = listOf("pages/", "audio/", "ort/", "models/human/", "models/uvr/", "cleaner/")

    /** المسار ← ملف داخل التطبيق، أو null (غير موجود/غير مسموح). */
    fun resolve(path: String?): Route? {
        if (path == null || path.contains("..") || path.contains('\\') || path.contains("//")) return null
        if (path == SHARED) return Route.Shared
        if (path == OUTPUT) return Route.Output
        val p = path.removePrefix("/")
        val ext = p.substringAfterLast('.', "").lowercase()
        val mime = MIME[ext] ?: return null
        return when {
            p == "models/nudenet/320n.onnx" -> Route.Asset("320n.onnx", mime)
            p == "models/yamnet/yamnet.onnx" -> Route.Asset("yamnet.onnx", mime)
            ROOTS.any { p.startsWith(it) } && p.length > 1 -> Route.Asset(p, mime)
            else -> null
        }
    }
}
