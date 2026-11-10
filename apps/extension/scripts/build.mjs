// يبني الإضافة لمتصفحات Chrome و Firefox و Safari في dist/<المتصفح>.
// التشغيل: npm run build
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "../../packages/core");
const pkg = JSON.parse(readFileSync(join(root, "package.json")));
const VERSION = pkg.version;

const alias = {
    "@hisn/core/lexicon.json": join(core, "data/lexicon.json"),
    "@hisn/core": join(core, "src/index.js"),
};

function manifest(target) {
    const base = {
        manifest_version: 3,
        name: "فلتر حصن",
        short_name: "حصن",
        version: VERSION,
        description: "حماية مجانية على جهازك: تضبيب العورات وصور النساء، وحجب الألفاظ والمواقع الإباحية. بلا خادم ولا بيانات.",
        default_locale: undefined,
        icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
        permissions: ["storage", "declarativeNetRequest", "contextMenus"],
        host_permissions: ["<all_urls>"],
        action: {
            default_title: "فلتر حصن",
            default_popup: "pages/popup.html",
            default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png" },
        },
        options_ui: { page: "pages/settings.html", open_in_tab: true },
        content_scripts: [
            {
                matches: ["<all_urls>"],
                js: ["content.js"],
                run_at: "document_start",
                all_frames: true,
                match_about_blank: true,
            },
        ],
        web_accessible_resources: [
            {
                // صفحة الحجب يجب أن تكون متاحة حتى يحوّل إليها المتصفح
                resources: [
                    "pages/blocked.html", "pages/blocked.js", "pages/common.css",
                    // محرك تنظيف الصوت: وحدة الصوت في الصفحة، وإطار المحرك، ونموذجه
                    "audio/relay-worklet.js", "pages/audio-engine.html", "audio/engine-frame.js", "audio/df_bg.wasm",
                ],
                matches: ["<all_urls>"],
            },
        ],
        content_security_policy: {
            extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
        },
    };
    delete base.default_locale;
    if (target !== "safari") {
        // يقرأ قائمة ترجمات يوتيوب من سياق الصفحة لكتم الألفاظ المنطوقة (Safari: من الترجمة الظاهرة فقط)
        base.content_scripts.push({
            matches: ["*://www.youtube.com/*", "*://m.youtube.com/*"],
            js: ["yt-main.js"],
            run_at: "document_idle",
            world: "MAIN",
        });
    }
    if (target === "chrome") {
        // صفحات الإضافة معزولة: تسمح بتشغيل النماذج على عدة أنوية (أسرع بعدة مرات في الفحص وتنظيف الفيديو)
        base.cross_origin_embedder_policy = { value: "require-corp" };
        base.cross_origin_opener_policy = { value: "same-origin" };
        base.permissions.push("offscreen");
        base.background = { service_worker: "background.js", type: "module" };
        base.minimum_chrome_version = "116";
    } else if (target === "safari") {
        // Safari (آيفون وماك): صفحة خلفية غير دائمة تستضيف محرك الكشف (لا يوجد offscreen)
        base.permissions = base.permissions.filter((p) => p !== "contextMenus");
        base.background = { scripts: ["background.js"], type: "module", persistent: false };
        base.browser_specific_settings = { safari: { strict_min_version: "17.0" } };
    } else {
        base.background = { scripts: ["background.js"], type: "module" };
        base.browser_specific_settings = {
            gecko: {
                id: "hisn-filter@hisnfilter.org",
                strict_min_version: "128.0",
                data_collection_permissions: { required: ["none"] },
            },
            gecko_android: { strict_min_version: "128.0" },
        };
    }
    return base;
}

async function buildTarget(target) {
    const out = join(root, "dist", target);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const common = {
        bundle: true,
        alias,
        define: { __TARGET__: JSON.stringify(target) },
        legalComments: "linked",
        logLevel: "warning",
        target: { chrome: "chrome116", firefox: "firefox128", safari: "safari17" }[target],
        loader: { ".json": "json" },
    };
    // سكربت الصفحة: كتلة واحدة فورية
    await build({ ...common, entryPoints: { content: join(root, "src/content/index.js") }, outdir: out, format: "iife" });
    if (target !== "safari") {
        await build({ ...common, entryPoints: { "yt-main": join(root, "src/content/yt-main.js") }, outdir: out, format: "iife" });
    }
    // تنظيف الصوت
    await build({ ...common, entryPoints: { "audio/relay-worklet": join(root, "src/audio/relay-worklet.js") }, outdir: out, format: "esm" });
    // فصل الموسيقى لتنظيف الفيديو (عامل مستقل)
    await build({ ...common, entryPoints: { "cleaner/separate-worker": join(root, "src/cleaner/separate-worker.js") }, outdir: out, format: "iife" });
    await build({ ...common, entryPoints: { "audio/engine-frame": join(root, "src/audio/engine-frame.js") }, outdir: out, format: "iife" });
    cpSync(join(root, "node_modules/@lofcz/deepfilternet-web/dist/df_bg.wasm"), join(out, "audio/df_bg.wasm"));
    // الخلفية
    await build({
        ...common,
        entryPoints: { background: join(root, target === "chrome" ? "src/background/index.js" : "src/background/firefox.js") },
        outdir: out,
        format: "esm",
    });
    if (target === "chrome") {
        await build({ ...common, entryPoints: { offscreen: join(root, "src/detector/offscreen.js") }, outdir: out, format: "esm" });
        writeFileSync(
            join(out, "offscreen.html"),
            '<!doctype html><meta charset="utf-8"><title>Hisn detector</title><script type="module" src="offscreen.js"></script>\n'
        );
    }
    // الصفحات
    await build({
        ...common,
        entryPoints: {
            "pages/settings": join(root, "src/pages/settings.js"),
            "pages/popup": join(root, "src/pages/popup.js"),
            "pages/selftest": join(root, "src/pages/selftest.js"),
            "pages/onboarding": join(root, "src/pages/onboarding.js"),
            "pages/blocked": join(root, "src/pages/blocked.js"),
            "pages/clean-video": join(root, "src/pages/clean-video.js"),
        },
        outdir: out,
        format: "iife",
    });
    for (const f of ["settings.html", "popup.html", "selftest.html", "onboarding.html", "blocked.html", "audio-engine.html", "clean-video.html", "common.css", "guides"]) {
        cpSync(join(root, "src/pages", f), join(out, "pages", f), { recursive: true });
    }
    cpSync(join(root, "static/icons"), join(out, "icons"), { recursive: true });
    cpSync(join(root, "static/rules"), join(out, "rules"), { recursive: true });
    cpSync(join(root, "static/models"), join(out, "models"), { recursive: true });
    // Safari على الآيفون: ذاكرة الإضافة محدودة، ونموذج المشهد كبير — التطبيق نفسه يشغّله بكود الجوال
    if (target === "safari") rmSync(join(out, "models/clip"), { recursive: true, force: true });
    mkdirSync(join(out, "ort"), { recursive: true });
    // ملفات WASM مع ملفات التحميل الخاصة بها (يطلبها onnxruntime عند تحديد wasmPaths)
    for (const f of [
        "ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs",
        "ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs",
    ]) {
        cpSync(join(root, "node_modules/onnxruntime-web/dist", f), join(out, "ort", f));
    }
    for (const f of ["LICENSE", "NOTICE.md"]) {
        const p = join(root, "../..", f);
        if (existsSync(p)) cpSync(p, join(out, f));
    }
    writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest(target), null, 2));
    console.log(`✓ ${target} → dist/${target}`);
}

/**
 * صفحات التطبيق (أندرويد وآيفون): تنظيف فيديو من الاستوديو داخل WebView بنفس النماذج.
 * النماذج لا تُنسخ هنا: التطبيق يقدّمها من ملفاته (هي نفسها التي يستخدمها في الفحص المباشر).
 */
async function buildWeb() {
    const out = join(root, "dist", "web");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(join(out, "pages"), { recursive: true });
    const common = { bundle: true, alias, define: { __TARGET__: '"web"' }, legalComments: "linked", logLevel: "warning", target: ["chrome110", "safari16.4"], loader: { ".json": "json" } };
    await build({
        ...common,
        entryPoints: {
            "pages/clean-video": join(root, "src/web/clean-video-app.js"),
            // محرك تنظيف الصوت المباشر في أندرويد
            "pages/audio-engine-app": join(root, "src/web/audio-engine-app.js"),
            "cleaner/separate-worker": join(root, "src/cleaner/separate-worker.js"),
            // المتصفح المحمي في تطبيق الآيفون: محرك الكشف (صفحة مخفية) وسكربت الصفحة
            "pages/detector-app": join(root, "src/web/detector-app.js"),
            "content-app": join(root, "src/web/content-app.js"),
            // يعمل في سياق صفحة يوتيوب (يحقنه التطبيق في عالم الصفحة): الترجمات ومسارات الصوت
            "yt-main": join(root, "src/content/yt-main.js"),
        },
        outdir: out,
        format: "iife",
    });
    for (const f of ["clean-video.html", "audio-engine-app.html", "detector-app.html", "common.css"]) cpSync(join(root, "src/pages", f), join(out, "pages", f));
    // صور «فحص الحماية» في التطبيق (صور الاختبار نفسها)
    mkdirSync(join(out, "pages/selftest"), { recursive: true });
    for (const f of ["woman.jpg", "man.jpg", "landscape.jpg", "belly.jpg"]) cpSync(join(root, "test/e2e/site", f), join(out, "pages/selftest", f));
    mkdirSync(join(out, "audio"), { recursive: true });
    cpSync(join(root, "node_modules/@lofcz/deepfilternet-web/dist/df_bg.wasm"), join(out, "audio/df_bg.wasm"));
    mkdirSync(join(out, "ort"), { recursive: true });
    for (const f of ["ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs"]) {
        cpSync(join(root, "node_modules/onnxruntime-web/dist", f), join(out, "ort", f));
    }
    cpSync(join(root, "static/models/human"), join(out, "models/human"), { recursive: true });
    // نموذج فصل الموسيقى لتنظيف الفيديو
    cpSync(join(root, "static/models/uvr"), join(out, "models/uvr"), { recursive: true });
    console.log("✓ web → dist/web (النماذج nudenet وyamnet يقدّمها التطبيق)");
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ["chrome", "firefox", "safari", "web"];
for (const t of targets) {
    if (t === "web") await buildWeb();
    else await buildTarget(t);
}
