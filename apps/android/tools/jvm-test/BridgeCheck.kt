// فحص شامل لخط الكشف المكتوب بـ Kotlin على صور حقيقية والنماذج الحقيقية (عبر جسر بايثون).
// الاستخدام: java ... BridgeCheckKt <مجلد النماذج> صورة1 صورة2 ...
import org.hisnfilter.core.*
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import javax.imageio.ImageIO

class BridgeRunner(models: String) : ModelRunner {
    private val proc = ProcessBuilder("python3", "-I", "tools/onnx_bridge.py", models).redirectError(ProcessBuilder.Redirect.INHERIT).start()
    private val o = DataOutputStream(proc.outputStream.buffered())
    private val i = DataInputStream(proc.inputStream.buffered())
    private fun call(id: Int, f: FloatArray?, n: IntArray?): List<FloatArray> {
        o.writeInt(id); o.writeInt(if (n != null) 1 else 0)
        o.writeInt(4 * (f?.size ?: n!!.size))
        if (f != null) f.forEach { o.writeFloat(it) } else n!!.forEach { o.writeInt(it) }
        o.flush()
        return List(i.readInt()) { val b = i.readInt() / 4; FloatArray(b) { i.readFloat() } }
    }
    override fun nudenet(input: FloatArray) = call(0, input, null)[0]
    override fun blazeface(input: FloatArray) = call(1, input, null)
    override fun faceres(input: FloatArray) = call(2, input, null).let { it[0][0] to it[1] }
    override fun movenet(input: IntArray) = call(3, null, input)[0]
}

fun main(args: Array<String>) {
    val runner = BridgeRunner(args[0])
    val p = FramePipeline(runner)
    val male = PolicySettings.defaults(Viewer.MALE); val female = PolicySettings.defaults(Viewer.FEMALE)
    for (path in args.drop(1)) {
        val img = ImageIO.read(File(path))
        val w = img.width; val h = img.height
        val px = img.getRGB(0, 0, w, h, null, 0, w)
        val t0 = System.nanoTime()
        val r = p.analyze(px, w, h)
        val ms = (System.nanoTime() - t0) / 1_000_000
        val a = r.toAnalysis()
        val faces = r.faces.joinToString { "${it.gender.name.lowercase()}:${"%.2f".format(it.genderScore)}" }
        println("${File(path).name.padEnd(16)} رجل=${Policy.decide(a, male).action}/${Policy.decide(a, male).reason} امرأة=${Policy.decide(a, female).action} عري=${"%.2f".format(a.nudity)} وجوه=[$faces] أجسام=${r.bodies.size} (${ms}ms)")
    }
    // لقطة "شاشة" طويلة مركبة: صورة الرجل ثم المرأة ثم الطبيعة فوق بعض — يجب أن يُغطّى موضع المرأة فقط
    val parts = listOf("man2.jpg", "woman2.jpg", "landscape.jpg").map { ImageIO.read(File(File(args[1]).parentFile, it)) }
    val W = 540
    val scaled = parts.map { im -> val h = im.height * W / im.width; java.awt.image.BufferedImage(W, h, java.awt.image.BufferedImage.TYPE_INT_RGB).also { it.createGraphics().drawImage(im, 0, 0, W, h, null) } }
    val H = scaled.sumOf { it.height }
    val screen = java.awt.image.BufferedImage(W, H, java.awt.image.BufferedImage.TYPE_INT_RGB)
    var y = 0
    val ranges = scaled.map { im -> screen.createGraphics().drawImage(im, 0, y, null); (y until y + im.height).also { y += im.height } }
    val r = p.analyzeScreen(screen.getRGB(0, 0, W, H, null, 0, W), W, H)
    val v = ScreenPolicy.decide(r, male)
    println("المدى: " + ranges.joinToString { "${it.first}-${it.last}" })
    r.people.forEach { println("  شخص ${it.gender} ${"%.2f".format(it.genderScore)} صندوق=${it.box}") }
    println("شاشة ${W}x$H، مربعات=${Tiles.plan(W, H).size}، أغطية=" + v.covers.joinToString { "${it.reason}@y${it.box.cy.toInt()}" })
    val womanCovered = v.covers.any { it.box.cy.toInt() in ranges[1] }
    val manCovered = v.covers.any { it.box.cy.toInt() in ranges[0] }
    println(if (womanCovered && !manCovered) "✓ الشاشة: غُطّيت المرأة وحدها" else "✗ الشاشة: النتيجة غير متوقعة")
}
