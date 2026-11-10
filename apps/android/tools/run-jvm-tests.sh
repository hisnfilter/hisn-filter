#!/usr/bin/env bash
# يشغّل اختبارات الكود المشترك (core) على الحاسوب بلا Android SDK:
#   KOTLINC=/path/to/kotlinc/bin/kotlinc tools/run-jvm-tests.sh
# في Android Studio استخدم بدلًا منه: ./gradlew test
set -euo pipefail
cd "$(dirname "$0")/.."
KOTLINC="${KOTLINC:-kotlinc}"
OUT="$(mktemp -d)"
"$KOTLINC" -nowarn -d "$OUT/t.jar" \
  app/src/main/kotlin/org/hisnfilter/core/*.kt \
  app/src/test/kotlin/org/hisnfilter/core/*.kt \
  tools/jvm-test/org/junit/Junit.kt tools/jvm-test/Runner.kt 2>&1 | grep -v "^warning" || true
KOTLIN_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v "$KOTLINC")")")")"
java -Dstdout.encoding=UTF-8 -cp "$OUT/t.jar:$KOTLIN_HOME/lib/kotlin-stdlib.jar" RunnerKt \
  org.hisnfilter.core.TextFilterTest org.hisnfilter.core.PolicyTest \
  org.hisnfilter.core.VisionTest org.hisnfilter.core.NetworkTest org.hisnfilter.core.AudioTest org.hisnfilter.core.LiveAudioTest org.hisnfilter.core.WebRoutesTest org.hisnfilter.core.SeparationTest org.hisnfilter.core.SkinTest org.hisnfilter.core.TopicsTest
