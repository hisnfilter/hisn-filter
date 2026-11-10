package org.hisnfilter.android.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import org.hisnfilter.android.HisnApp
import org.hisnfilter.android.ui.MainActivity
import org.hisnfilter.core.Dns
import org.hisnfilter.core.SafeSearchDns
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/**
 * شبكة افتراضية محلية لطلبات أسماء المواقع (DNS) فقط — بقية الاتصالات لا تمر عبرها أصلًا.
 *  - المواقع الإباحية والقمار: يُرد عليها بأنها غير موجودة، في كل التطبيقات والمتصفحات.
 *  - البحث الآمن: قوقل وبنج وDuckDuckGo ويوتيوب (الوضع المقيّد) تُوجَّه لعناوينها الآمنة الرسمية.
 *  - الباقي يُمرَّر لخادم DNS عائلي مجاني (Cloudflare for Families) كطبقة حماية إضافية.
 * لا يُحفظ أي سجل للمواقع، ولا يُرسل شيء لأي جهة غير خادم DNS (كأي اتصال عادي).
 */
class HisnVpnService : VpnService() {
    private var tun: ParcelFileDescriptor? = null
    private var reader: Thread? = null
    // طابور محدود: إن تراكمت الطلبات (ضغط أو عطل في الشبكة) تُسقط الأحدث بدل استنزاف الذاكرة
    private val pool = ThreadPoolExecutor(4, 4, 30, TimeUnit.SECONDS, ArrayBlockingQueue(QUEUE_CAP), ThreadPoolExecutor.DiscardPolicy())
    private val safeCache = ConcurrentHashMap<String, Pair<Long, List<ByteArray>>>()
    @Volatile private var running = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopVpn()
            stopSelf()
            return START_NOT_STICKY
        }
        // خدمة أمامية: لا يقتلها النظام في الخلفية، وتظهر للمستخدم بإشعار هادئ (كما يتطلب أندرويد 14+)
        runCatching {
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(NOTIFICATION_ID, notification())
        }.onFailure { Log.w(TAG, "تعذّر الإشعار الأمامي: ${it.message}") }
        startVpn()
        return START_STICKY
    }

    override fun onRevoke() {
        stopVpn()
        super.onRevoke()
    }

    override fun onDestroy() {
        stopVpn()
        pool.shutdownNow()
        super.onDestroy()
    }

    private fun startVpn() {
        if (tun != null) return
        val fd = Builder()
            .setSession("فلتر حصن")
            .addAddress(CLIENT_IP, 32)
            .addDnsServer(DNS_IP)
            .addRoute(DNS_IP, 32) // لا يدخل الشبكة الافتراضية إلا ما يُرسل لخادم DNS الوهمي
            .setBlocking(true)
            .setMetered(false)
            .establish() ?: return
        tun = fd
        running = true
        reader = Thread({ loop(fd) }, "hisn-dns").apply { start() }
        Log.i(TAG, "الشبكة المحلية تعمل")
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "حجب المواقع", NotificationManager.IMPORTANCE_MIN))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle("فلتر حصن: حجب المواقع يعمل")
            .setContentText("يحجب المواقع الإباحية ويفرض البحث الآمن. لا يُحفظ أي سجل.")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    private fun stopVpn() {
        running = false
        runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
        runCatching { tun?.close() }
        tun = null
        reader?.interrupt()
        reader = null
    }

    private fun loop(fd: ParcelFileDescriptor) {
        val input = FileInputStream(fd.fileDescriptor)
        val output = FileOutputStream(fd.fileDescriptor)
        val buf = ByteArray(32767)
        while (running) {
            val n = try { input.read(buf) } catch (e: Exception) { if (running) Log.w(TAG, "قراءة", e); break }
            if (n <= 0) continue
            val pkt = Dns.parseIpv4Udp(buf, n) ?: continue
            if (pkt.dstPort != 53) continue
            if (pool.isShutdown) break
            try { pool.execute {
                val resp = try { answer(pkt.payload) } catch (e: Exception) { null } ?: return@execute
                val out = Dns.buildIpv4Udp(pkt.dst, pkt.src, 53, pkt.srcPort, resp)
                synchronized(output) { runCatching { output.write(out) } }
            } } catch (e: java.util.concurrent.RejectedExecutionException) {
                break
            }
        }
    }

    private fun answer(query: ByteArray): ByteArray? {
        val q = Dns.parseQuestion(query) ?: return forward(query)
        val app = HisnApp.of(this)
        val p = app.prefs
        if (p.active && app.isBlockedSite(q.name) != null) return Dns.buildResponse(query, q, Dns.RCODE_NXDOMAIN)
        if (p.active && p.safeSearch) {
            val target = SafeSearchDns.target(q.name, p.youtubeRestricted, p.childMode && p.youtubeStrict)
            if (target != null) {
                return when (q.type) {
                    Dns.TYPE_AAAA -> Dns.buildResponse(query, q, 0) // لا عنوان IPv6: يُستخدم IPv4 الآمن
                    // فشل آمن: إن تعذّر حلّ العنوان الآمن لا نمرر الاسم غير الآمن، بل نرد بخطأ مؤقت (SERVFAIL) ليعيد التطبيق المحاولة
                    Dns.TYPE_A -> resolveA(target).takeIf { it.isNotEmpty() }?.let { Dns.buildResponse(query, q, 0, it) } ?: Dns.buildResponse(query, q, Dns.RCODE_SERVFAIL)
                    else -> forward(query)
                }
            }
        }
        return forward(query)
    }

    private fun resolveA(name: String): List<ByteArray> {
        val now = System.currentTimeMillis()
        safeCache[name]?.let { (t, ips) -> if (now - t < 10 * 60_000) return ips }
        val resp = forward(Dns.buildQuery(Random.nextInt(0, 0xFFFF), name, Dns.TYPE_A)) ?: return emptyList()
        val ips = Dns.parseAnswersA(resp)
        if (ips.isNotEmpty()) safeCache[name] = now to ips
        return ips
    }

    /** يمرر الطلب لخادم DNS حقيقي عبر مقبس محمي (لا يعود إلى الشبكة الافتراضية). */
    private fun forward(query: ByteArray): ByteArray? {
        for (server in UPSTREAMS) {
            try {
                DatagramSocket().use { s ->
                    protect(s)
                    s.soTimeout = 3500
                    val addr = InetAddress.getByName(server)
                    s.send(DatagramPacket(query, query.size, addr, 53))
                    val buf = ByteArray(4096)
                    val deadline = System.currentTimeMillis() + 3500
                    // نقبل الرد فقط إن جاء من الخادم نفسه وبالمعرّف نفسه وكان ردًا (QR=1): حماية من ردود مزوّرة
                    while (System.currentTimeMillis() < deadline) {
                        val dp = DatagramPacket(buf, buf.size)
                        s.receive(dp)
                        if (dp.address != addr || dp.port != 53) continue
                        if (!Dns.isResponseTo(buf, dp.length, query)) continue
                        return buf.copyOf(dp.length)
                    }
                }
            } catch (e: Exception) {
                Log.d(TAG, "تعذّر الاتصال بـ $server")
            }
        }
        return null
    }

    companion object {
        private const val TAG = "HisnVpn"
        const val ACTION_STOP = "org.hisnfilter.android.vpn.STOP"
        private const val CHANNEL = "hisn.vpn"
        private const val NOTIFICATION_ID = 7
        private const val QUEUE_CAP = 256
        const val CLIENT_IP = "10.111.0.2"
        const val DNS_IP = "10.111.0.1"
        /** Cloudflare for Families (يحجب البرمجيات الخبيثة والمحتوى الإباحي) ثم احتياطي. */
        val UPSTREAMS = listOf("1.1.1.3", "1.0.0.3", "9.9.9.9")

        fun start(ctx: Context) { ctx.startForegroundService(Intent(ctx, HisnVpnService::class.java)) }
        fun stop(ctx: Context) = ctx.startService(Intent(ctx, HisnVpnService::class.java).setAction(ACTION_STOP))
    }
}

/** بعد إعادة التشغيل أو التحديث: نعيد تشغيل الشبكة المحلية إن كان المستخدم فعّلها. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val app = HisnApp.of(ctx)
        if (app.prefs.vpnWanted && VpnService.prepare(ctx) == null) HisnVpnService.start(ctx)
    }
}
