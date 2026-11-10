package org.hisnfilter.android.audio

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.webkit.WebMessage
import android.webkit.WebMessagePort
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.hisnfilter.core.WebRoutes
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * محرك إزالة الموسيقى مع إبقاء الكلام (DeepFilterNet3) — نفس محرك الإضافة، يعمل في WebView خفي
 * داخل التطبيق (بلا شبكة: ملفاته من التطبيق). يستقبل صوتًا 48kHz أحاديًا ويُرجعه نظيفًا،
 * ويخبر إن كان الصوت الباقي غناءً.
 */
class CleanEngine(
    private val ctx: Context,
    private val onAudio: (ShortArray) -> Unit,
    private val onSinging: (Boolean) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var web: WebView? = null
    private var port: WebMessagePort? = null
    @Volatile var ready = false
        private set
    @Volatile var failed: String? = null
        private set

    init { main.post { create() } }

    @SuppressLint("SetJavaScriptEnabled")
    private fun create() {
        try {
            web = WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                        val r = if (request.url.host == WebRoutes.HOST) WebRoutes.resolve(request.url.path) else null
                        return if (r is WebRoutes.Route.Asset) runCatching { WebResourceResponse(r.mime, null, 200, "OK", WebRoutes.ISOLATION, ctx.assets.open(r.name)) }.getOrNull()
                            ?: notFound() else notFound()
                    }

                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true

                    override fun onPageFinished(view: WebView, url: String) {
                        if (port == null) connect(view)
                    }
                }
                loadUrl(WebRoutes.ORIGIN + "/pages/audio-engine-app.html")
            }
        } catch (t: Throwable) {
            // مثلًا: WebView غير مثبت أو معطّل في الجهاز
            failed = t.message ?: "WebView"
            Log.w(TAG, "تعذّر تشغيل المحرك", t)
        }
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), "".byteInputStream())

    private fun connect(view: WebView) {
        val (mine, theirs) = view.createWebMessageChannel()
        mine.setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
            override fun onMessage(p: WebMessagePort, message: WebMessage) {
                val d = message.data ?: return
                when {
                    d == "R" -> ready = true
                    d.startsWith("E") -> { failed = d.substring(1); ready = false }
                    d == "S1" -> onSinging(true)
                    d == "S0" -> onSinging(false)
                    d.startsWith("D") -> onAudio(decode(d.substring(1)))
                }
            }
        }, main)
        port = mine
        view.postWebMessage(WebMessage("hisn-engine", arrayOf(theirs)), Uri.parse(WebRoutes.ORIGIN))
    }

    /** يرسل دفعة (من أي خيط). */
    fun process(pcm: ShortArray, n: Int = pcm.size) {
        if (!ready) return
        val bytes = ByteBuffer.allocate(n * 2).order(ByteOrder.LITTLE_ENDIAN)
        for (i in 0 until n) bytes.putShort(pcm[i])
        val msg = "D" + Base64.encodeToString(bytes.array(), Base64.NO_WRAP)
        main.post { runCatching { port?.postMessage(WebMessage(msg)) } }
    }

    fun close() {
        ready = false
        main.post {
            runCatching { port?.postMessage(WebMessage("X")) }
            runCatching { port?.close() }
            port = null
            web?.destroy()
            web = null
        }
    }

    companion object {
        private const val TAG = "HisnEngine"

        fun decode(b64: String): ShortArray {
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            val out = ShortArray(bytes.size / 2)
            ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(out)
            return out
        }
    }
}
