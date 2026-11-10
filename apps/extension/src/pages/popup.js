// نافذة حصن السريعة: الحالة الحقيقية، وتنظيف فيديو، و«عندي مشكلة». التفاصيل في صفحة الإعدادات.
import { api, siteOf, listHasSite } from "../shared/settings.js";
import { MSG, send } from "../shared/messages.js";

const $ = (s) => document.querySelector(s);
const PAUSE_MINUTES = 10;
let s = null;
let site = null; // موقع التبويب الحالي (إن كان صفحة ويب)
let tabId = null;

const CHECK = "M8.5 12l2.5 2.5 4.5-5";
const BANG = "M12 8v5M12 16.5v.1";

function setState(state, title, sub, mark = CHECK) {
    $("#app").dataset.state = state;
    $("#title").textContent = title;
    $("#sub").textContent = sub;
    $("#mark").setAttribute("d", mark);
}

function pausedUntil() {
    const t = site ? s.pausedSites?.[site] ?? 0 : 0;
    return t > Date.now() ? t : 0;
}

async function render() {
    s = await send(api, { type: MSG.GET_SETTINGS });
    if (!s) return setState("off", "تعذّر الاتصال بالحماية", "أعد تشغيل المتصفح.", BANG);
    $("#fix").hidden = true;

    if (!s.enabled) {
        setState("off", "الحماية متوقفة", "لا يُفحص شيء الآن.", BANG);
        $("#fix").hidden = false;
        $("#fix").textContent = "تشغيل الحماية";
        $("#fix").onclick = () => update({ enabled: true });
    } else {
        const h = await send(api, { type: MSG.GET_HEALTH });
        if (h?.overall === "ok") setState("ok", "الحماية تعمل", "تصفّح براحتك، حصن معك");
        else if (h?.overall === "loading") {
            setState("loading", "جارٍ تشغيل الحماية…", "ثوانٍ ويكتمل التحميل.");
            setTimeout(render, 2000);
        } else {
            setState("partial", "بعض الحماية لا تعمل", "اضغط «إصلاح» لإعادة تشغيلها.", BANG);
            $("#fix").hidden = false;
            $("#fix").textContent = "إصلاح";
            $("#fix").onclick = () => api.runtime.reload();
        }
    }
    renderSite();
}

function renderSite() {
    const box = $("#site"), action = $("#siteAction");
    box.hidden = false;
    action.hidden = true;
    if (!site) {
        box.dataset.on = "false";
        $("#siteText").textContent = "الحماية محدودة هنا (صفحات المتصفح لا تُفحص)";
        return;
    }
    const until = pausedUntil();
    const off = listHasSite(s.disabledSites ?? [], site);
    if (!s.enabled) { box.hidden = true; return; }
    if (until) {
        box.dataset.on = "false";
        $("#siteText").textContent = `متوقفة هنا لمدة ${Math.max(1, Math.ceil((until - Date.now()) / 60000))} دقائق`;
        action.hidden = false;
        action.textContent = "تشغيل الآن";
        action.onclick = () => resume();
    } else if (off) {
        box.dataset.on = "false";
        $("#siteText").textContent = "متوقفة على هذا الموقع";
        action.hidden = false;
        action.textContent = "تشغيل هنا";
        action.onclick = () => update({ disabledSites: (s.disabledSites ?? []).filter((x) => x !== site) });
    } else {
        box.dataset.on = "true";
        $("#siteText").textContent = "مفعّلة على هذا الموقع";
    }
}

/** تغيير يحتاج الرمز إن كان مقفلًا: نطلبه داخل النافذة نفسها. */
async function update(patch, pin) {
    const r = await send(api, { type: MSG.UPDATE_SETTINGS, patch, pin });
    if (r?.ok) { await render(); return true; }
    if (r?.error === "pin" || r?.error === "wait") {
        askPin(r.error === "wait" ? `محاولات كثيرة. انتظر ${r.wait} ثانية.` : pin ? "الرمز غير صحيح" : "", (p) => update(patch, p));
    }
    return false;
}

function askPin(err, done) {
    const help = $("#pBrokenHelp");
    help.hidden = false;
    help.innerHTML = `<label class="muted" for="pin">رمز القفل</label>
      <input id="pin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" style="width:100%;min-height:44px;margin:4px 0">
      <span style="color:var(--danger)">${err}</span>
      <button class="primary" id="pinOk" style="width:100%">تأكيد</button>`;
    $("#pin").focus();
    const go = () => done($("#pin").value);
    $("#pinOk").onclick = go;
    $("#pin").onkeydown = (e) => { if (e.key === "Enter") go(); };
}

async function resume() {
    const paused = { ...(s.pausedSites ?? {}) };
    delete paused[site];
    await update({ pausedSites: paused });
}

// ===== الأزرار =====
$("#openSettings").onclick = () => { api.runtime.openOptionsPage(); window.close(); };
$("#clean").onclick = () => { api.tabs.create({ url: api.runtime.getURL("pages/clean-video.html") }); window.close(); };
$("#problem").onclick = () => { $("#main").hidden = true; $("#help").hidden = false; };
$("#pBack").onclick = () => { $("#help").hidden = true; $("#main").hidden = false; $("#pWrongHelp").hidden = true; $("#pBrokenHelp").hidden = true; };
$("#pWrong").onclick = () => { $("#pWrongHelp").hidden = false; };
$("#pShown").onclick = async () => {
    // وضع التحديد في الصفحة: الضغطة التالية على صورة أو فيديو تخفيه
    if (tabId != null) await api.tabs.sendMessage(tabId, { type: MSG.PICK_HIDE }).catch(() => {});
    window.close();
};
$("#pBroken").onclick = async () => {
    const help = $("#pBrokenHelp");
    help.hidden = false;
    if (!site) { help.textContent = "هذه صفحة من المتصفح نفسه، ولا يعمل فيها حصن."; return; }
    help.innerHTML = `جرّب إيقاف الحماية هنا ${PAUSE_MINUTES} دقائق، وتعود تلقائيًا. <button class="primary" id="doPause" style="width:100%;margin-top:6px">إيقاف مؤقت ${PAUSE_MINUTES} دقائق</button>`;
    $("#doPause").onclick = async () => {
        const paused = Object.fromEntries(Object.entries(s.pausedSites ?? {}).filter(([, t]) => t > Date.now()));
        paused[site] = Date.now() + PAUSE_MINUTES * 60_000;
        if (await update({ pausedSites: paused })) { $("#pBack").click(); }
    };
};

(async () => {
    // ?tab=رقم: لفتح النافذة لتبويب بعينه (للاختبار)
    const forced = Number(new URLSearchParams(location.search).get("tab"));
    const [tab] = forced ? [await api.tabs.get(forced).catch(() => null)] : await api.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    tabId = tab?.id ?? null;
    try {
        const u = new URL(tab?.url ?? "");
        if (u.protocol === "http:" || u.protocol === "https:") site = siteOf(u.hostname);
    } catch { /* صفحة داخلية */ }
    render();
})();
