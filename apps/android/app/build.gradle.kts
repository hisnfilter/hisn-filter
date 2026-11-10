plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val repo = rootDir.resolve("../..")

android {
    namespace = "org.hisnfilter.android"
    compileSdk = 36

    defaultConfig {
        applicationId = providers.gradleProperty("hisn.applicationId").get()
        minSdk = 30 // التقاط الشاشة من خدمة الوصول متاح من أندرويد 11
        targetSdk = 36
        versionCode = providers.gradleProperty("hisn.versionCode").get().toInt()
        versionName = providers.gradleProperty("hisn.versionName").get()
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets["main"].apply {
        java.srcDirs("src/main/kotlin")
        // النماذج والقاموس وقوائم المواقع تُؤخذ من مكانها في المستودع (مصدر واحد للإضافة والتطبيق)
        assets.srcDirs(
            "src/main/assets",
            "../models",
            repo.resolve("apps/extension/static/models/nudenet"),
            repo.resolve("apps/extension/static/models/yamnet"),
            repo.resolve("apps/extension/static/rules"),
            repo.resolve("packages/core/data"),
            // صفحات التطبيق (تنظيف فيديو ومحرك الصوت): تُبنى من كود الإضافة نفسه
            repo.resolve("apps/extension/dist/web"),
        )
    }
    sourceSets["test"].java.srcDirs("src/test/kotlin")

    androidResources { noCompress += listOf("onnx", "wasm", "bin") }
    packaging { jniLibs { useLegacyPackaging = false } }
}

kotlin { jvmToolchain(17) }

// يبني صفحات التطبيق من كود الإضافة قبل كل بناء (يحتاج Node.js و npm install في apps/extension)
val buildWebPages by tasks.registering(Exec::class) {
    workingDir = repo.resolve("apps/extension")
    commandLine("node", "scripts/build.mjs", "web")
    inputs.dir(repo.resolve("apps/extension/src"))
    inputs.dir(repo.resolve("packages/core/src"))
    outputs.dir(repo.resolve("apps/extension/dist/web"))
}
tasks.named("preBuild") { dependsOn(buildWebPages) }

dependencies {
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.22.0")
    testImplementation("junit:junit:4.13.2")
}
