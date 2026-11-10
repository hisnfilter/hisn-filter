import { api } from "../shared/settings.js";
import { MSG, send } from "../shared/messages.js";
import { childPreset } from "@hisn/core";

const $ = (s) => document.querySelector(s);
const show = (n) => {
    for (const s of document.querySelectorAll(".step")) s.hidden = s.dataset.step !== String(n);
    document.querySelector(`[data-step="${n}"] h1`)?.focus?.();
};
const choice = { viewer: "male", level: "medium", child: false };

for (const b of document.querySelectorAll("[data-viewer]")) {
    b.onclick = () => {
        choice.viewer = b.dataset.viewer;
        show(2);
    };
}
for (const b of document.querySelectorAll("[data-level]")) {
    b.onclick = () => {
        choice.level = b.dataset.level;
        for (const x of document.querySelectorAll("[data-level]")) x.setAttribute("aria-pressed", String(x === b));
    };
}
$("[data-next]").onclick = () => show(3);
// جهاز طفل: وضع الطفل مباشرة (المستوى المتوسط)، ثم رمز القفل (موصى به هنا)
$("[data-child]").onclick = () => {
    choice.child = true;
    $("#ageBox").hidden = false;
    show(3);
};

/** يحفظ ويتحقق من الحفظ فعلًا؛ يُرجع false مع رسالة إن رُفض أو لم ترد الخلفية */
async function save() {
    const male = choice.viewer === "male";
    const r = await send(api, {
        type: MSG.UPDATE_SETTINGS,
        patch: {
            viewer: choice.viewer,
            level: choice.level,
            blurAdultWomen: male,
            blurCartoonWomen: male,
            onboarded: true,
            ...(choice.child ? childPreset($("#childAge").value) : {}),
        },
    });
    if (!r?.ok) { $("#err").textContent = "تعذّر حفظ الإعدادات. أعد المحاولة، أو أعد تشغيل المتصفح."; return false; }
    const check = await send(api, { type: MSG.GET_SETTINGS });
    if (!check?.onboarded || check.viewer !== choice.viewer) { $("#err").textContent = "لم تُحفظ الإعدادات كما يجب. أعد المحاولة."; return false; }
    return true;
}

/** حالة كل طبقة بصدق (جاهزة/تُحمّل/متعذرة/مطفأة) بدل ادعاء أن كل شيء يعمل */
const LAYER_NAMES = { sites: "حجب المواقع", images: "فحص الصور", video: "فحص الفيديو", audio: "إزالة الموسيقى", text: "تنقية النصوص" };
const STATE_TEXT = { ok: "✅ جاهزة", loading: "⏳ تُحمّل", failed: "⚠️ متعذرة", partial: "⚠️ تعمل جزئيًا", off: "— مطفأة باختيارك" };
async function showLayers() {
    const list = $("#layers");
    for (let i = 0; i < 20; i++) {
        const h = await send(api, { type: MSG.GET_HEALTH });
        if (!h) { list.innerHTML = "<li>⚠️ تعذّر الوصول لمحرك الحماية. أعد تشغيل المتصفح.</li>"; return; }
        list.replaceChildren(...Object.entries(h.layers || {}).map(([k, v]) => {
            const li = document.createElement("li");
            li.textContent = `${LAYER_NAMES[k] ?? k}: ${STATE_TEXT[v] ?? v}`;
            return li;
        }));
        if (h.overall !== "loading") {
            if (h.overall === "partial") { const li = document.createElement("li"); li.textContent = "بعض الطبقات متعذرة الآن؛ افتح «الإعدادات ← فحص ذاتي» للتفاصيل."; list.append(li); }
            return;
        }
        await new Promise((r) => setTimeout(r, 1500));
    }
}

$("#skipPin").onclick = async () => {
    if (!(await save())) return;
    show(4);
    showLayers();
};
$("#finishPin").onclick = async () => {
    const p1 = $("#pin1").value, p2 = $("#pin2").value;
    if (!/^\d{4,8}$/.test(p1)) return ($("#err").textContent = "الرمز يجب أن يكون من 4 إلى 8 أرقام");
    if (p1 !== p2) return ($("#err").textContent = "الرمزان غير متطابقين");
    if (!(await save())) return;
    const r = await send(api, { type: MSG.SET_PIN, pin: p1 });
    if (!r?.ok) return ($("#err").textContent = "تعذّر حفظ الرمز");
    show(4);
    showLayers();
};
