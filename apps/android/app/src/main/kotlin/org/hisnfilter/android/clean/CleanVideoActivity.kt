package org.hisnfilter.android.clean

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.ext.SdkExtensions
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import org.hisnfilter.android.HisnApp
import org.hisnfilter.core.Viewer
import org.hisnfilter.core.WebRoutes
import org.json.JSONObject
import java.io.InputStream
import kotlin.concurrent.thread

/**
 * تنظيف فيديو من الاستوديو: نفس محرك الإضافة (نفس النماذج ونفس الكود) داخل WebView.
 * يُفتح من التطبيق، أو من زر «مشاركة» في الاستوديو ← «فلتر حصن».
 * الصفحة لا تصل للشبكة: كل ملفاتها من التطبيق، ولا تُرفع أي صورة أو صوت.
 */
class CleanVideoActivity : Activity() {
    private lateinit var web: WebView
    private val saver by lazy { GallerySaver(this) }
    private var sharedUri: Uri? = null
    private var sharedName: String = "video.mp4"
    private var chooser: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.domStorageEnabled = false
            webViewClient = Client()
            webChromeClient = Chrome()
            addJavascriptInterface(Bridge(), "HisnHost")
        }
        setContentView(web)
        open(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        open(intent)
    }

    private fun open(intent: Intent?) {
        sharedUri = sharedVideo(intent)
        sharedName = sharedUri?.let { displayName(it) } ?: "video.mp4"
        web.loadUrl(WebRoutes.ORIGIN + "/pages/clean-video.html" + if (sharedUri != null) "#shared" else "")
    }

    @Suppress("DEPRECATION")
    private fun sharedVideo(intent: Intent?): Uri? {
        if (intent?.action != Intent.ACTION_SEND) return null
        return if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_STREAM)
    }

    private fun displayName(uri: Uri): String? = runCatching {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull()

    override fun onDestroy() {
        chooser?.onReceiveValue(null)
        sepThread.shutdownNow()
        runCatching { separator?.close() }
        web.destroy()
        super.onDestroy()
    }

    // ===== ملفات الصفحة =====

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            if (request.url.host != WebRoutes.HOST) return blocked()
            return when (val r = WebRoutes.resolve(request.url.path)) {
                is WebRoutes.Route.Asset -> runCatching { WebResourceResponse(r.mime, if (r.mime.startsWith("text/")) "utf-8" else null, 200, "OK", WebRoutes.ISOLATION, assets.open(r.name)) }
                    .getOrElse { notFound() }
                WebRoutes.Route.Shared -> sharedUri?.let { uri ->
                    runCatching {
                        val size = sharedSize
                        partial(contentResolver.getType(uri) ?: "video/mp4", size, request.requestHeaders["Range"] ?: request.requestHeaders["range"]) {
                            contentResolver.openInputStream(uri)!!
                        }
                    }.getOrNull()
                } ?: notFound()
                WebRoutes.Route.Output -> saver.current("video")?.let { f ->
                    partial("video/mp4", f.length(), request.requestHeaders["Range"] ?: request.requestHeaders["range"]) { f.inputStream() }
                } ?: notFound()
                null -> notFound()
            }
        }

        // لا تنقّل خارج صفحات التطبيق
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = request.url.host != WebRoutes.HOST

        /** استجابة كاملة أو جزئية (Range) — حتى لا يُحمَّل الفيديو كله، وليعمل التقديم والتأخير في المعاينة. */
        private fun partial(mime: String, size: Long, rangeHeader: String?, open: () -> InputStream): WebResourceResponse {
            val r = WebRoutes.range(rangeHeader, size)
            val headers = mutableMapOf("Accept-Ranges" to "bytes") + WebRoutes.ISOLATION
            val h = headers.toMutableMap()
            if (r == null) {
                h["Content-Length"] = size.toString()
                return WebResourceResponse(mime, null, 200, "OK", h, open())
            }
            val input = open()
            var skip = r.first
            while (skip > 0) { val n = input.skip(skip); if (n <= 0) break; skip -= n }
            h["Content-Range"] = "bytes ${r.first}-${r.last}/$size"
            h["Content-Length"] = (r.last - r.first + 1).toString()
            return WebResourceResponse(mime, null, 206, "Partial Content", h, Bounded(input, r.last - r.first + 1))
        }

        private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), "".byteInputStream())
        private fun blocked() = WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), "".byteInputStream())
    }

    /** يقرأ عددًا محددًا من البايتات فقط. */
    private class Bounded(private val input: InputStream, private var left: Long) : InputStream() {
        override fun read(): Int = if (left <= 0) -1 else input.read().also { if (it >= 0) left-- }
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (left <= 0) return -1
            val n = input.read(b, off, minOf(len.toLong(), left).toInt())
            if (n > 0) left -= n
            return n
        }
        override fun close() = input.close()
    }

    private val sharedSize: Long
        get() = sharedUri?.let { uri ->
            runCatching {
                contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }
                    ?: contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length }
            }.getOrNull()
        } ?: 0L

    // ===== اختيار فيديو من الاستوديو =====

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            chooser?.onReceiveValue(null)
            chooser = callback
            // منتقي الصور والفيديو من النظام: لا يحتاج إذن الوصول للمعرض
            val picker = if (Build.VERSION.SDK_INT >= 33 || SdkExtensions.getExtensionVersion(Build.VERSION_CODES.R) >= 2) {
                Intent(MediaStore.ACTION_PICK_IMAGES).setType("video/*")
            } else {
                Intent(Intent.ACTION_GET_CONTENT).setType("video/*").addCategory(Intent.CATEGORY_OPENABLE)
            }
            return try {
                @Suppress("DEPRECATION")
                startActivityForResult(picker, REQ_PICK)
                true
            } catch (e: Exception) {
                chooser = null
                false
            }
        }
    }

    @Deprecated("Activity API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_PICK) return
        val uri = data?.data
        chooser?.onReceiveValue(if (resultCode == RESULT_OK && uri != null) arrayOf(uri) else null)
        chooser = null
    }

    // ===== الجسر مع الصفحة =====

    private inner class Bridge {
        /** إعدادات المستخدم بنفس أسماء الإضافة (تُكمل الصفحة الباقي بالافتراضي). */
        @JavascriptInterface
        fun settings(): String {
            val p = HisnApp.of(this@CleanVideoActivity).prefs
            return JSONObject()
                .put("viewer", if (p.viewer == Viewer.FEMALE) "female" else "male")
                .put("level", p.level.key)
                .put("removeMusic", p.removeMusic)
                .put("muteSingerAfterMusicRemoval", p.muteSinger)
                .put("allowNasheedsWithoutInstruments", true)
                .toString()
        }

        @JavascriptInterface
        fun sharedName(): String = Uri.encode(sharedName)

        @JavascriptInterface
        fun sharedSize(): String = sharedSize.toString()

        @JavascriptInterface
        fun begin(part: String, mime: String) = saver.begin(part)

        @JavascriptInterface
        fun write(part: String, position: Double, base64: String) = saver.write(part, position.toLong(), base64)

        // ===== فصل الموسيقى بالمعالج الأصلي (أسرع من المتصفح) =====
        @JavascriptInterface
        fun sepBegin(id: String, length: Int) {
            jobs[id] = arrayOf(FloatArray(length), FloatArray(length))
        }

        @JavascriptInterface
        fun sepPush(id: String, offset: Double, left: String, right: String) {
            val job = jobs[id] ?: return
            val o = offset.toInt().coerceIn(0, job[0].size)
            val l = decodePcm(left)
            val r = decodePcm(right)
            l.copyInto(job[0], o, 0, minOf(l.size, job[0].size - o))
            r.copyInto(job[1], o, 0, minOf(r.size, job[1].size - o))
        }

        @JavascriptInterface
        fun sepRun(id: String) {
            val job = jobs.remove(id) ?: return
            sepThread.execute {
                try {
                    val sep = separator ?: NativeSeparator(this@CleanVideoActivity).also { separator = it }
                    var last = 0f
                    val m = sep.music(job[0], job[1]) { p -> if (p - last >= 0.05f || p >= 1f) { last = p; js("window.__hisnSep(${q(id)}, 'p', $p)") } }
                    val step = 44100
                    var o = 0
                    while (o < m[0].size) {
                        val e = minOf(m[0].size, o + step)
                        js("window.__hisnSep(${q(id)}, 'd', $o, ${q(encodePcm(m[0], o, e))}, ${q(encodePcm(m[1], o, e))})")
                        o = e
                    }
                    js("window.__hisnSep(${q(id)}, 'end')")
                } catch (t: Throwable) {
                    js("window.__hisnSep(${q(id)}, 'err', ${q(t.message ?: t.toString())})")
                }
            }
        }

        @JavascriptInterface
        fun finish(name: String) {
            thread(name = "hisn-save") {
                val r = runCatching { saver.finish(name) }
                runOnUiThread {
                    if (isDestroyed) return@runOnUiThread
                    val msg = r.exceptionOrNull()?.message ?: ""
                    web.evaluateJavascript("window.__hisnSaved(${r.isSuccess}, ${JSONObject.quote(msg)})", null)
                    if (r.isSuccess) Toast.makeText(this@CleanVideoActivity, "حُفظ الفيديو النظيف في الاستوديو (Movies/Hisn)", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private val jobs = java.util.concurrent.ConcurrentHashMap<String, Array<FloatArray>>()
    private val sepThread = java.util.concurrent.Executors.newSingleThreadExecutor()
    @Volatile private var separator: NativeSeparator? = null

    /** ينفّذ نصًا في الصفحة من أي خيط (الرسائل الكبيرة تُقسَّم قبل ذلك). */
    private fun js(code: String) = runOnUiThread { if (!isDestroyed) web.evaluateJavascript(code, null) }
    private fun q(s: String) = JSONObject.quote(s)

    companion object {
        private const val REQ_PICK = 41

        /** صوت int16 (base64) ← أرقام عشرية. */
        fun decodePcm(b64: String): FloatArray {
            val bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT)
            val sb = java.nio.ByteBuffer.wrap(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            return FloatArray(sb.remaining()) { sb.get(it) / 32768f }
        }

        fun encodePcm(x: FloatArray, from: Int, to: Int): String {
            val b = java.nio.ByteBuffer.allocate((to - from) * 2).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            for (i in from until to) b.putShort((x[i].coerceIn(-1f, 1f) * 32767f).toInt().toShort())
            return android.util.Base64.encodeToString(b.array(), android.util.Base64.NO_WRAP)
        }
    }
}
