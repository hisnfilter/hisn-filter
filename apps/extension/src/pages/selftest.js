// اختبار ذاتي لكل طبقة بمواد آمنة (صورة مرسومة، ونغمة، ونص اختبار): يثبت أن الحماية تعمل على هذا الجهاز.
import { TextFilter, scaryTopic, encodePcm16, YAMNET_WINDOW } from "@hisn/core";
import lexicon from "@hisn/core/lexicon.json";
import { api } from "../shared/settings.js";
import { MSG, send } from "../shared/messages.js";

const $ = (s) => document.querySelector(s);

/** كل اختبار: يُرجع { ok, note } أو { off } إن كان الخيار مطفأً. */
const TESTS = [
    ["المحرك على جهازك", "النماذج محمّلة وتعمل", async () => {
        for (let i = 0; i < 30; i++) {
            const h = await send(api, { type: MSG.GET_HEALTH });
            if (h?.overall === "ok") return { ok: true };
            if (h?.overall === "partial") return { ok: false, note: "بعض الطبقات لا تعمل" };
            await new Promise((r) => setTimeout(r, 1000));
        }
        return { ok: false, note: "لم يكتمل التحميل" };
    }],
    ["فحص الصور", "صورة اختبار مرسومة تُفحص على جهازك", async (s) => {
        if (!s.filterImages) return { off: true };
        const c = new OffscreenCanvas(320, 200);
        const g = c.getContext("2d");
        g.fillStyle = "#7fb2e5"; g.fillRect(0, 0, 320, 200);
        g.fillStyle = "#3d6b3d"; g.beginPath(); g.moveTo(0, 200); g.lineTo(120, 70); g.lineTo(240, 200); g.fill();
        const blob = await c.convertToBlob({ type: "image/jpeg" });
        const dataUrl = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
        await send(api, { type: MSG.DETECT_IMAGE, dataUrl }); // أول صورة تهيّئ المحرك (أبطأ)
        const t0 = performance.now();
        const r = await send(api, { type: MSG.DETECT_IMAGE, dataUrl });
        const ms = Math.round(performance.now() - t0);
        return r?.analysis?.analyzed ? { ok: true, note: `${ms} ملي ثانية` } : { ok: false, note: r?.error ?? "لا رد من المحرك" };
    }],
    ["فحص الصوت", "نغمة اختبار تُحلَّل", async (s) => {
        if (!s.removeMusic) return { off: true };
        const x = new Float32Array(YAMNET_WINDOW);
        for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / 16000);
        const r = await send(api, { type: MSG.DETECT_AUDIO, pcm: encodePcm16(x) });
        return r?.audio ? { ok: true } : { ok: false, note: "لا رد من محرك الصوت" };
    }],
    ["حجب المواقع الإباحية", "قواعد الحجب مثبتة في المتصفح", async (s) => {
        if (!s.blockAdultSites) return { off: true };
        const rules = await api.declarativeNetRequest.getDynamicRules();
        const n = rules.filter((r) => r.condition.requestDomains?.length && (r.action.type === "redirect" || r.action.type === "block")).reduce((a, r) => a + r.condition.requestDomains.length, 0);
        return n > 1000 ? { ok: true, note: `${n.toLocaleString("ar")} نطاق` } : { ok: false, note: "القواعد غير مثبتة" };
    }],
    ["البحث الآمن", "قوقل وبنج وDuckDuckGo", async (s) => {
        if (!s.safeSearch) return { off: true };
        const rules = await api.declarativeNetRequest.getDynamicRules();
        return rules.some((r) => r.action.redirect?.transform?.queryTransform) ? { ok: true } : { ok: false, note: "القاعدة غير مثبتة" };
    }],
    ["يوتيوب المقيّد", "ترويسة يوتيوب الرسمية", async (s) => {
        if (!s.youtubeRestricted || s.level === "light") return { off: true };
        const rules = await api.declarativeNetRequest.getDynamicRules();
        const h = rules.find((r) => r.action.requestHeaders?.[0]?.header === "YouTube-Restrict");
        return h ? { ok: true, note: h.action.requestHeaders[0].value === "Strict" ? "شديد" : "متوسط" } : { ok: false, note: "القاعدة غير مثبتة" };
    }],
    ["الألفاظ", "عبارة اختبار تُخفى بنجوم", async (s) => {
        if (!s.filterText) return { off: true };
        const f = new TextFilter(lexicon);
        // كلمة اختبار من القاموس نفسه (لا نعرضها)
        const word = lexicon.mask?.ar?.[0] ?? "";
        const out = word ? f.censor(`نص اختبار ${word} هنا`) : "";
        return word && !out.includes(word) ? { ok: true } : { ok: false, note: "القاموس لا يعمل" };
    }],
    ["حماية العقيدة", "عنوان اختبار عن الرعب يُكتشف", async (s) => {
        if (!s.blockScaryTopics) return { off: true };
        return scaryTopic("قصة رعب في بيت مسكون").hit && !scaryTopic("سورة الجن").hit ? { ok: true } : { ok: false };
    }],
];

async function run() {
    const s = await send(api, { type: MSG.GET_SETTINGS });
    const list = $("#list");
    list.textContent = "";
    $("#summary").textContent = "جارٍ الاختبار…";
    if (!s?.enabled) { $("#summary").textContent = "الحماية متوقفة. شغّلها من الإعدادات ثم أعد الاختبار."; return; }
    let fails = 0;
    for (const [name, what, fn] of TESTS) {
        const row = document.createElement("div");
        row.className = "t";
        row.innerHTML = `<span class="ic">…</span><div><strong></strong><small></small></div>`;
        row.querySelector("strong").textContent = name;
        row.querySelector("small").textContent = what;
        list.appendChild(row);
        let r;
        try { r = await fn(s); } catch (e) { r = { ok: false, note: String(e).slice(0, 80) }; }
        row.dataset.r = r.off ? "off" : r.ok ? "ok" : "fail";
        row.querySelector(".ic").textContent = r.off ? "–" : r.ok ? "✓" : "✗";
        const note = r.off ? "مطفأ في الإعدادات" : r.note;
        if (note) row.querySelector("small").textContent = `${what} — ${note}`;
        if (!r.off && !r.ok) fails++;
    }
    $("#summary").textContent = fails ? `${fails} من الاختبارات لم تنجح. أعد تشغيل المتصفح ثم أعد الاختبار.` : "✓ كل الحماية المفعّلة تعمل على هذا الجهاز";
}

$("#again").onclick = run;
run();
