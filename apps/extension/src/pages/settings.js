// صفحة الإعدادات (تُستخدم كنافذة الإضافة وكصفحة كاملة).
import { api, siteOf, listHasSite } from "../shared/settings.js";
import { childPreset, exportSettings, transferLink, importSettings } from "@hisn/core";
import qrcode from "qrcode-generator";
import { MSG, send } from "../shared/messages.js";

const $ = (s) => document.querySelector(s);
const isPopup = new URLSearchParams(location.search).has("popup");
document.body.classList.toggle("popup", isPopup);

const TOGGLES = [
    ["filterImages", "الصور", "تضبيب العورات والصور غير المناسبة"],
    ["filterVideos", "الفيديو", "فحص مستمر لكل فيديو"],
    ["autoSkipShortVideos", "تخطّي المقاطع المخالفة", "في تيك توك وريلز وشورتس"],
    ["filterText", "الألفاظ", "إخفاء الكلمات الفاحشة بنجوم"],
    ["foldExplicitText", "النصوص الإباحية", "طيّ الفقرات غير اللائقة"],
    ["blockAdultSites", "المواقع الإباحية", "حجبها قبل أن تفتح"],
    ["blockGambling", "مواقع القمار", "حجبها قبل أن تفتح"],
    ["blockUnfilterableStreaming", "خدمات البث المشفّرة", "نتفلكس وشاهد وأخواتها: لا تُفحص فلا تُفتح"],
    ["fastReveal", "ظهور سريع للمقاطع", "في المتوسط فقط: يظهر بعد فحص غلافه ويستمر فحصه خلفه؛ قد يمر جزء من الثانية قبل تغطية مشهد مخالف. أطفئه ليبقى كل مقطع مغبّشًا حتى يُفحص. (الصارم ووضع الطفل: مطفأ دائمًا)"],
    ["hideAds", "إخفاء الإعلانات", "منشورات «ممول» والبطاقات المروّجة، وتخطّي إعلانات يوتيوب"],
    ["hideSuggested", "إخفاء المنشورات المقترحة", "منشورات «مقترح لك» من حسابات لا تتابعها في خلاصة إنستغرام الرئيسية"],
    ["allowedChannelsOnly", "القنوات المسموحة فقط في يوتيوب (وضع الطفل)", "لا يظهر إلا مقاطع القنوات التي تضيفها في قسم «القنوات المسموحة» أدناه"],
    ["removeFlaggedCards", "حذف بطاقات يوتيوب المخالفة (وضع الطفل)", "البطاقة التي صورتها المصغّرة مخالفة تُحذف كلها بدل تغبيشها"],
    ["hideShortsAndComments", "إخفاء Shorts والتعليقات في يوتيوب (وضع الطفل)", "ولا تشغيل تلقائي للمقطع التالي"],
    ["autoUnmute", "صوت إنستغرام تلقائيًا", "يعيد الصوت لمقاطع الخلاصة التي يكتمها الموقع افتراضيًا"],
    ["safeSearch", "البحث الآمن", "في قوقل وبنج وDuckDuckGo"],
    ["youtubeRestricted", "الوضع المقيّد في يوتيوب", "في المستوى المتوسط والصارم"],
    ["blurMen", "تضبيب الرجال", "اختياري"],
    ["blurAdultWomen", "تضبيب النساء", "حسب المستخدم والمستوى"],
    ["blockScaryTopics", "حماية العقيدة", "إخفاء السحر والشعوذة والجن والرعب والهالوين"],
    ["maskInsults", "إخفاء الشتائم", "مثل «يا حمار» و«ابن الكلب» (يشغّله وضع الطفل)"],
    ["partialBlur", "تغطية الشخص وحده", "تُغطّى المرأة ويظهر باقي الصورة حين يكون الكشف واثقًا، وإلا تُغطّى الصورة كلها"],
    ["removeMusic", "إزالة الموسيقى (تجريبي)", "تُخفَّض الموسيقى ويبقى الكلام غالبًا، والنتيجة تختلف بين المقاطع. ما لا يُنظَّف يُكتم أثناء الموسيقى"],
    ["allowNasheedsWithoutInstruments", "الأناشيد والتلاوة بلا آلات", "تبقى مسموعة (إيقافه قد يكتم التلاوة المجودة)"],
    ["muteSpokenProfanity", "كتم الألفاظ المنطوقة", "يعمل فقط حين يكون للفيديو ترجمة نصية (مثل ترجمة يوتيوب)"],
];

const LIGHT_OFF = new Set(["blurAdultWomen", "youtubeRestricted", "removeMusic"]);

const LEVEL_HELP = {
    light: "العورات، والمواقع الإباحية، والألفاظ فقط.",
    medium: "يضيف تضبيب النساء للرجل، والوضع المقيّد في يوتيوب. موصى به. المقطع يظهر بسرعة إذا كان غلافه سليمًا ويستمر فحصه (قد يمر جزء من الثانية قبل تغطية مشهد مخالف).",
    strict: "يغطّي الصورة أو المقطع كاملًا إذا فيه امرأة، وأي شك يُحجب. كل مقطع يبقى مغبّشًا حتى تُفحص إطاراته (أبطأ قليلًا وأضمن).",
};
const VIEWER_HELP = {
    male: "تُضبَّب صور النساء (عدا الطفلات)، والعورات دائمًا.",
    female: "تظهر صور النساء، وتُضبَّب العورات فقط.",
};

let s = null;
let site = null;

async function load() {
    s = await send(api, { type: MSG.GET_SETTINGS });
    if (!s) return;
    render();
}

/** يطلب الرمز إن كان القفل مفعّلًا. يُرجع الرمز أو null عند الإلغاء. */
function askPin(title = "أدخل رمز القفل", help = "هذا التغيير يقلل الحماية، فيحتاج الرمز.") {
    return new Promise((resolve) => {
        const dlg = $("#pinDialog");
        $("#pinTitle").textContent = title;
        $("#pinHelp").textContent = help;
        $("#pinErr").textContent = "";
        $("#pinInput").value = "";
        dlg.showModal();
        $("#pinInput").focus();
        dlg.onclose = () => resolve(dlg.returnValue === "ok" ? $("#pinInput").value : null);
    });
}

const pinError = (r) => (r?.error === "wait" ? `محاولات كثيرة. انتظر ${r.wait} ثانية ثم أعد المحاولة.` : "الرمز غير صحيح");

async function update(patch) {
    let r = await send(api, { type: MSG.UPDATE_SETTINGS, patch });
    if (r?.error === "wait") { alert(pinError(r)); return render(); }
    if (r?.error === "pin") {
        const pin = await askPin();
        if (pin == null) return render();
        r = await send(api, { type: MSG.UPDATE_SETTINGS, patch, pin });
        if (!r?.ok) {
            alert(pinError(r));
            return render();
        }
    }
    if (r?.settings) s = { ...s, ...r.settings };
    render();
}

const LAYER_NAMES = { sites: "حجب المواقع", images: "فحص الصور", video: "فحص الفيديو", audio: "إزالة الموسيقى", text: "الألفاظ" };
let healthTimer = null;
/** الحالة الحقيقية: «الحماية تعمل» فقط إذا عملت كل الطبقات المفعّلة. */
async function checkHealth() {
    clearTimeout(healthTimer);
    const h = await send(api, { type: MSG.GET_HEALTH });
    if (!h || !s.enabled) return;
    const bad = Object.entries(h.layers).filter(([, v]) => v === "failed" || v === "partial").map(([k]) => LAYER_NAMES[k]);
    $("#statusText").textContent = h.overall === "ok" ? "الحماية تعمل" : h.overall === "loading" ? "جارٍ تحميل الحماية…" : "حماية جزئية";
    $("#statusText").dataset.state = h.overall;
    if (bad.length) $("#statusSub").textContent = `لا يعمل الآن: ${bad.join("، ")}. أعد تشغيل المتصفح، وإن تكرر فأعد تثبيت الإضافة.`;
    if (h.overall !== "ok") healthTimer = setTimeout(checkHealth, 3000);
}

// ===== الأقسام الأربعة =====
function showTab(name) {
    if (!document.querySelector(`[data-group="${name}"]`)) name = "protect";
    for (const g of document.querySelectorAll("[data-group]")) g.hidden = g.dataset.group !== name;
    for (const t of document.querySelectorAll("[data-tab]")) t.setAttribute("aria-selected", String(t.dataset.tab === name));
    try { history.replaceState(null, "", `#${name}`); } catch { /* */ }
}
for (const t of document.querySelectorAll("[data-tab]")) t.onclick = () => showTab(t.dataset.tab);
showTab(location.hash.slice(1) || "protect");

/** الاستثناءات والتصحيحات: كل عنصر بزر حذف (الحذف يعيد الحماية). */
function renderExceptions() {
    const box = $("#exceptionList");
    box.textContent = "";
    const head = (t) => { const d = document.createElement("div"); d.className = "ex-head"; d.textContent = t; box.appendChild(d); };
    const item = (label, action, run) => {
        const d = document.createElement("div");
        d.className = "ex";
        const span = document.createElement("span");
        span.textContent = label;
        span.dir = "auto";
        const b = document.createElement("button");
        b.textContent = action;
        b.onclick = run;
        d.append(span, b);
        box.appendChild(d);
    };
    let any = false;
    const allow = s.allowlist ?? [];
    if (allow.length) { any = true; head("مواقع رُفع عنها الحجب"); for (const x of allow) item(x, "إعادة الحجب", () => update({ allowlist: allow.filter((y) => y !== x) })); }
    const off = s.disabledSites ?? [];
    if (off.length) { any = true; head("مواقع أُوقفت فيها الحماية"); for (const x of off) item(x, "تشغيل الحماية", () => update({ disabledSites: off.filter((y) => y !== x) })); }
    const paused = Object.entries(s.pausedSites ?? {}).filter(([, t]) => t > Date.now());
    if (paused.length) {
        any = true;
        head("إيقاف مؤقت");
        for (const [x, t] of paused) {
            item(`${x} — ${Math.ceil((t - Date.now()) / 60000)} دقيقة`, "تشغيل الآن", () => {
                const p = { ...s.pausedSites };
                delete p[x];
                update({ pausedSites: p });
            });
        }
    }
    // كلمات محجوبة (ولي الأمر): أي عنوان فيها يُحذف من يوتيوب وتيك توك والألعاب، ويُوقف المقطع المفتوح
    any = true;
    head("كلمات محجوبة");
    const wordsBox = document.createElement("div");
    const input = document.createElement("input");
    input.placeholder = "كلمة أو عبارة (مثال: مرعب، gacha)…";
    input.style.cssText = "width:70%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font:inherit";
    const addBtn = document.createElement("button");
    addBtn.textContent = "إضافة";
    addBtn.onclick = () => { const w = input.value.trim(); if (w.length >= 2) { update({ blockedWords: [...new Set([...(s.blockedWords ?? []), w])] }); input.value = ""; } };
    wordsBox.append(input, addBtn);
    box.appendChild(wordsBox);
    (s.blockedWords ?? []).forEach((w) => item(w, "حذف", () => update({ blockedWords: (s.blockedWords ?? []).filter((x) => x !== w) })));
    // القنوات المسموحة (يوتيوب، وضع الطفل): الاسم أو @المعرّف
    any = true;
    head("القنوات المسموحة (يوتيوب)");
    const chBox = document.createElement("div");
    const chInput = document.createElement("input");
    chInput.placeholder = "اسم القناة أو @المعرّف أو رابطها…";
    chInput.style.cssText = "width:70%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font:inherit";
    const chAdd = document.createElement("button");
    chAdd.textContent = "إضافة";
    chAdd.onclick = () => {
        const raw = chInput.value.trim(); if (raw.length < 2) return;
        const m = raw.match(/@([^/?#\s]+)/);
        const entry = m ? { name: m[1], handle: m[1] } : { name: raw, handle: "" };
        update({ allowedChannels: [...(s.allowedChannels ?? []), entry] }); chInput.value = "";
    };
    chBox.append(chInput, chAdd);
    box.appendChild(chBox);
    (s.allowedChannels ?? []).forEach((c, i) => item(c.handle ? `${c.name} (@${c.handle})` : c.name, "حذف", () => update({ allowedChannels: (s.allowedChannels ?? []).filter((_, j) => j !== i) })));
    const accounts = s.hiddenAccounts ?? [];
    if (accounts.length) {
        any = true;
        head("حسابات مخفية");
        accounts.forEach((a, i) => item(`${a.handle} (${a.site})`, "إظهار", () => update({ hiddenAccounts: accounts.filter((_, j) => j !== i) })));
    }
    const verdicts = Object.entries(s.imageVerdicts ?? {});
    const safe = verdicts.filter(([, v]) => v === "safe").length, unsafe = verdicts.length - safe;
    if (verdicts.length) {
        any = true;
        head("تصحيحاتك للصور");
        if (safe) item(`${safe} صورة عُلّمت «سليمة دائمًا»`, "إلغاؤها", () => update({ imageVerdicts: Object.fromEntries(verdicts.filter(([, v]) => v === "unsafe")) }));
        if (unsafe) item(`${unsafe} صورة أخفيتها بنفسك`, "إظهارها", () => update({ imageVerdicts: Object.fromEntries(verdicts.filter(([, v]) => v === "safe")) }));
    }
    if (!any) { const p = document.createElement("p"); p.className = "muted"; p.textContent = "لا توجد استثناءات. كل الحماية تعمل في كل المواقع."; box.appendChild(p); }
}

function render() {
    $("#enabled").checked = s.enabled;
    renderExceptions();
    $("#statusText").textContent = s.enabled ? "جارٍ التحقق…" : "الحماية متوقفة";
    if (s.enabled) checkHealth();
    $("#statusSub").textContent = s.hasPin ? "مقفلة برمز" : "بلا قفل";

    $("#childMode").checked = Boolean(s.childMode);
    $("#childBox").hidden = !s.childMode;
    for (const b of document.querySelectorAll("[data-age]")) b.setAttribute("aria-pressed", String(b.dataset.age === s.childAge));
    $("#childLockHint").textContent = (s.hasPin ? "مقفل برمز: لا يُطفأ من هنا إلا بالرمز." : "ضع رمز قفل (في الأسفل) حتى لا يُطفأ من هنا إلا بالرمز.")
        + " القفل لا يمنع حذف الإضافة من إعدادات المتصفح؛ لذلك استخدم للطفل حسابًا غير مسؤول في المتصفح أو الجهاز.";

    for (const b of document.querySelectorAll("[data-level]")) b.setAttribute("aria-pressed", String(b.dataset.level === s.level));
    $("#levelHelp").textContent = LEVEL_HELP[s.level];
    for (const b of document.querySelectorAll("[data-viewer]")) b.setAttribute("aria-pressed", String(b.dataset.viewer === s.viewer));
    $("#viewerHelp").textContent = VIEWER_HELP[s.viewer];

    const box = $("#toggles");
    box.querySelectorAll(".row").forEach((r) => r.remove());
    for (const [key, label, help] of TOGGLES) {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML = `<div class="label"><span></span><small></small></div>
          <label class="switch"><input type="checkbox"><span></span></label>`;
        row.querySelector(".label span").textContent = label;
        row.querySelector(".label small").textContent = help;
        const input = row.querySelector("input");
        input.checked = Boolean(s[key]);
        // المستوى المخفف يوقف بعض الخيارات وإن بقيت محفوظة مفعّلة: نُظهر ذلك بدل أن تبدو تعمل
        if (s.level === "light" && LIGHT_OFF.has(key) && s[key]) {
            row.querySelector(".label small").textContent = "متوقف في المستوى المخفف";
            input.disabled = true;
        }
        input.setAttribute("aria-label", label);
        input.onchange = () => update({ [key]: input.checked });
        box.appendChild(row);
    }

    $("#lockText").textContent = s.hasPin
        ? "الإعدادات مقفلة. أي تغيير يقلل الحماية يحتاج الرمز، والعورات لا تُكشف أبدًا."
        : "ضع رمزًا يمنع إطفاء الحماية أو تغيير الإعدادات دون إذنك.";
    $("#setPin").textContent = s.hasPin ? "تغيير الرمز" : "وضع رمز قفل";
    $("#lockNow").hidden = !(s.hasPin && s.unlocked);
    if (s.hasPin && s.unlocked) $("#lockText").textContent = "مفتوح مؤقتًا (5 دقائق من آخر إدخال للرمز). اضغط «قفل الآن» عند الانتهاء.";
    $("#removePin").hidden = !s.hasPin;

    if (site) {
        $("#siteCard").hidden = false;
        $("#siteName").textContent = site;
        const off = listHasSite(s.disabledSites ?? [], site);
        $("#siteToggle").textContent = off ? "تشغيل الحماية هنا" : "إيقاف الحماية في هذا الموقع";
        $("#siteToggle").onclick = () => {
            const list = new Set(s.disabledSites ?? []);
            off ? list.delete(site) : list.add(site);
            update({ disabledSites: [...list] });
        };
        $("#hideAccount").hidden = !/(twitter|x|instagram|tiktok|facebook|reddit|youtube|snapchat)\./.test(site + ".");
    }
}

$("#enabled").onchange = (e) => update({ enabled: e.target.checked });
// وضع الطفل لا يخفض المستوى الصارم إن كان مختارًا
const childPatch = (age) => ({ ...childPreset(age), level: s.level === "strict" ? "strict" : "medium" });
$("#childMode").onchange = (e) => update(e.target.checked ? childPatch(s.childAge ?? "9to12") : { childMode: false });
for (const b of document.querySelectorAll("[data-age]")) b.onclick = () => update(childPatch(b.dataset.age));
for (const b of document.querySelectorAll("[data-level]")) b.onclick = () => update({ level: b.dataset.level });
for (const b of document.querySelectorAll("[data-viewer]")) {
    b.onclick = () => {
        const v = b.dataset.viewer;
        update({ viewer: v, blurAdultWomen: v === "male", blurCartoonWomen: v === "male" });
    };
}

$("#setPin").onclick = async () => {
    let oldPin;
    if (s.hasPin) {
        oldPin = await askPin("الرمز الحالي", "أدخل الرمز الحالي أولًا.");
        if (oldPin == null) return;
    }
    const pin = await askPin("الرمز الجديد", "اختر رمزًا من 4 إلى 8 أرقام، ولا تنسه.");
    if (pin == null) return;
    const confirmPin = await askPin("تأكيد الرمز", "أعد كتابة الرمز الجديد.");
    if (confirmPin !== pin) return alert("الرمزان غير متطابقين");
    const r = await send(api, { type: MSG.SET_PIN, pin, oldPin });
    if (!r?.ok) alert(r?.error === "format" ? "الرمز يجب أن يكون من 4 إلى 8 أرقام" : pinError(r));
    load();
};
$("#lockNow").onclick = async () => { await send(api, { type: MSG.LOCK_NOW }); load(); };
$("#removePin").onclick = async () => {
    const oldPin = await askPin("إزالة القفل", "أدخل الرمز الحالي لإزالة القفل.");
    if (oldPin == null) return;
    const r = await send(api, { type: MSG.SET_PIN, pin: null, oldPin });
    if (!r?.ok) alert(pinError(r));
    load();
};
// ===== نقل الإعدادات لجهاز آخر =====
$("#showTransfer").onclick = () => {
    const qr = qrcode(0, "M");
    qr.addData(transferLink(s));
    qr.make();
    $("#qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    $("#qr").querySelector("svg").style.cssText = "width:220px;height:220px";
    $("#transferCode").value = exportSettings(s);
    $("#transferDialog").showModal();
};
$("#copyTransfer").onclick = async () => {
    $("#transferCode").select();
    try { await navigator.clipboard.writeText($("#transferCode").value); } catch { document.execCommand("copy"); }
    $("#copyTransfer").textContent = "نُسخ ✓";
    setTimeout(() => { $("#copyTransfer").textContent = "نسخ الرمز"; }, 1500);
};
$("#importTransfer").onclick = () => {
    const dlg = $("#importDialog");
    $("#importInput").value = "";
    $("#importErr").textContent = "";
    dlg.showModal();
    dlg.onclose = async () => {
        if (dlg.returnValue !== "ok") return;
        const code = $("#importInput").value;
        // معاينة قبل التطبيق
        const preview = importSettings(code);
        if (!preview) return alert("رمز النقل غير صحيح. انسخه كاملًا من الجهاز الآخر.");
        const AGE = { under9: "أقل من 9", "9to12": "9 إلى 12", "13to15": "13 إلى 15" };
        const LVL = { light: "مخفف", medium: "متوسط", strict: "صارم" };
        const lines = [
            `المستخدم: ${preview.viewer === "female" ? "امرأة" : "رجل"}`,
            `المستوى: ${LVL[preview.level] ?? "—"}`,
            `وضع الطفل: ${preview.childMode ? `يعمل (${AGE[preview.childAge] ?? ""})` : "متوقف"}`,
        ];
        if (!confirm(`سيُطبَّق على هذا الجهاز:\n${lines.join("\n")}\nوخيارات الحماية كما في الجهاز الآخر.`)) return;
        let r = await send(api, { type: MSG.IMPORT_SETTINGS, code });
        if (r?.error === "pin") {
            const pin = await askPin("رمز هذا الجهاز", "الإعدادات الجديدة تخفف الحماية هنا، فتحتاج رمز القفل.");
            if (pin == null) return;
            r = await send(api, { type: MSG.IMPORT_SETTINGS, code, pin });
        }
        if (!r?.ok) return alert(r?.error === "code" ? "رمز النقل غير صحيح. انسخه كاملًا من الجهاز الآخر." : pinError(r));
        await load();
        alert(s.hasPin ? "نُقلت الإعدادات ✓" : "نُقلت الإعدادات ✓\nضع رمز قفل على هذا الجهاز من قسم «القفل».");
    };
};

$("#hideAccount").onclick = () => {
    const dlg = $("#accountDialog");
    $("#accountInput").value = "";
    dlg.showModal();
    dlg.onclose = async () => {
        const handle = $("#accountInput").value.trim();
        if (dlg.returnValue === "ok" && handle) await send(api, { type: MSG.HIDE_ACCOUNT, site, handle });
        load();
    };
};

(async () => {
    if (isPopup) {
        const [tab] = await api.tabs.query({ active: true, currentWindow: true });
        try {
            const u = new URL(tab?.url ?? "");
            if (u.protocol.startsWith("http")) site = siteOf(u.hostname);
        } catch { /* صفحة داخلية */ }
    }
    load();
})();
