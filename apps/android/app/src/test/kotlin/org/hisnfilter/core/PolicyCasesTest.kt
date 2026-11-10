package org.hisnfilter.core

import org.junit.Assert.assertEquals
import org.junit.Test

/** الحالات المشتركة مع JS: packages/core/data/policy-cases.json */
class PolicyCasesTest {
    @Test
    fun sharedCasesAgreeWithJs() {
        val failures = PolicyCases.run(TestFiles.text("packages/core/data/policy-cases.json"))
        assertEquals(failures.joinToString("\n") { "${it.name}: متوقع ${it.expected} وجاء ${it.got}" }, 0, failures.size)
    }
}
