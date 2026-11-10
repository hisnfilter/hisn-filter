package org.hisnfilter.core

/**
 * يقرأ حالات السياسة المشتركة (packages/core/data/policy-cases.json) ويشغّلها على Policy.decide.
 * المصدر نفسه يُشغَّل في JS، فأي اختلاف بين المنصات يظهر هنا. يُستعمل في الاختبارات وفي «فحص الحماية».
 */
object PolicyCases {
    data class Failure(val name: String, val expected: String, val got: String)

    fun run(json: String): List<Failure> {
        val root = MiniJson.parse(json) as Map<*, *>
        val out = ArrayList<Failure>()
        for (c in root["cases"] as List<*>) {
            c as Map<*, *>
            val name = c["name"] as String
            val viewer = if (c["viewer"] == "female") Viewer.FEMALE else Viewer.MALE
            var s = PolicySettings.defaults(viewer)
            (c["settings"] as? Map<*, *>)?.forEach { (k, v) ->
                s = when (k) {
                    "level" -> s.copy(level = Level.of(v as String))
                    "blurAdultWomen" -> s.copy(blurAdultWomen = v as Boolean)
                    "blurMen" -> s.copy(blurMen = v as Boolean)
                    "blurCoveredWomen" -> s.copy(blurCoveredWomen = v as Boolean)
                    "blurGirls" -> s.copy(blurGirls = v as Boolean)
                    "childMode" -> s.copy(childMode = v as Boolean)
                    "blockScaryTopics" -> s.copy(blockScaryTopics = v as Boolean)
                    else -> s
                }
            }
            val img = c["image"] as Map<*, *>
            fun d(k: String) = (img[k] as? Number)?.toDouble() ?: 0.0
            val people = (img["people"] as? List<*>)?.map { p ->
                p as Map<*, *>
                Person(
                    gender = when (p["gender"]) { "female" -> Gender.FEMALE; "male" -> Gender.MALE; else -> Gender.UNKNOWN },
                    genderScore = (p["genderScore"] as? Number)?.toDouble() ?: 1.0,
                    adult = p["adult"] as? Boolean,
                    area = (p["area"] as? Number)?.toDouble() ?: 1.0,
                    covered = p["covered"] as? Boolean ?: false,
                    cartoon = p["cartoon"] as? Boolean ?: false,
                    thighSkin = (p["thighSkin"] as? Number)?.toDouble(),
                )
            } ?: emptyList()
            val scene = img["scene"] as? Map<*, *>
            val a = ImageAnalysis(
                analyzed = img["analyzed"] as? Boolean ?: false,
                nudity = d("nudity"), sexual = d("sexual"), people = people,
                sceneWoman = (scene?.get("woman") as? Number)?.toDouble() ?: 0.0,
                sceneSexual = (scene?.get("sexual") as? Number)?.toDouble() ?: 0.0,
                sceneCovered = (scene?.get("covered") as? Number)?.toDouble() ?: 0.0,
                sceneScary = (scene?.get("scary") as? Number)?.toDouble() ?: 0.0,
                hasScene = scene != null,
                partial = img["partial"] as? Boolean ?: false,
            )
            val r = Policy.decide(a, s)
            val exp = c["expect"] as Map<*, *>
            val expected = "${exp["action"]}/${exp["reason"]}"
            val got = "${r.action.name.lowercase()}/${r.reason}"
            if (expected != got) out.add(Failure(name, expected, got))
        }
        return out
    }
}
