// يشغّل كل دالة عليها @Test في الأصناف المعطاة، ويطبع النتيجة.
import org.junit.Test

fun main(args: Array<String>) {
    var pass = 0; var fail = 0
    for (cn in args) {
        val cls = Class.forName(cn)
        for (m in cls.declaredMethods.filter { it.isAnnotationPresent(Test::class.java) }.sortedBy { it.name }) {
            val t0 = System.nanoTime()
            try {
                m.invoke(cls.getDeclaredConstructor().newInstance())
                pass++
                println("✓ ${cls.simpleName}.${m.name} (${(System.nanoTime() - t0) / 1_000_000}ms)")
            } catch (e: Throwable) {
                fail++
                val c = (e as? java.lang.reflect.InvocationTargetException)?.targetException ?: e
                println("✗ ${cls.simpleName}.${m.name}: $c")
                c.stackTrace.take(4).forEach { println("     at $it") }
            }
        }
    }
    println("\n$pass/${pass + fail} ناجح")
    kotlin.system.exitProcess(if (fail == 0) 0 else 1)
}
