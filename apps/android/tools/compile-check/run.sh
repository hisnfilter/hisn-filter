#!/usr/bin/env bash
# فحص ترجمة كود أندرويد بلا Android Studio: يترجم كل ملفات Kotlin مقابل android.jar
# مع بدائل صغيرة لواجهة ONNX Runtime وملف R. لا يبني APK؛ فقط يتأكد أن الكود سليم.
#   ANDROID_JAR=/path/to/android.jar KOTLINC=/path/to/kotlinc tools/compile-check/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="$(mktemp -d)"
javac -nowarn -d "$OUT/stubs" $(find tools/compile-check/stubs -name "*.java")
"${KOTLINC:-kotlinc}" -jvm-target 17 -cp "$ANDROID_JAR:$OUT/stubs" -d "$OUT/app.jar" $(find app/src/main/kotlin -name "*.kt")
echo "✓ الكود يُترجم"
