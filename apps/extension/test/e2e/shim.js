// محاكاة لواجهة الإضافات داخل صفحة عادية، لاختبار كود الإضافة في متصفح حقيقي
// عندما لا يدعم المتصفح تحميل الإضافات (مثل headless shell).
(() => {
    const params = new URLSearchParams(location.search);
    const EXT = location.origin + "/ext/";
    const listeners = [];
    const changeListeners = [];
    const store = {};
    const session = {};
    let rules = [];

    // إعدادات أولية من الرابط: ?viewer=female&level=strict
    if (params.has("viewer")) {
        store["hisn-settings"] = {
            viewer: params.get("viewer"),
            level: params.get("level") ?? "medium",
            blurAdultWomen: params.get("viewer") === "male",
            blurCartoonWomen: params.get("viewer") === "male",
            onboarded: true,
        };
        // إعدادات إضافية للاختبار: &off=filterVideos,filterImages
        for (const k of (params.get("off") ?? "").split(",").filter(Boolean)) store["hisn-settings"][k] = false;
    }

    const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

    async function sendMessage(msg) {
        // ننتظر حتى تسجّل الخلفية والمحرك مستمعيهما (كما تكون جاهزة دائمًا في المتصفح)
        for (let wait = 0; wait < 100; wait++) {
            const resp = await new Promise((resolve) => {
                let answered = false;
                let async = false;
                for (const l of [...listeners]) {
                    const ret = l(clone(msg), { tab: { id: 1 }, frameId: 0 }, (r) => {
                        if (!answered) { answered = true; resolve({ r: clone(r) }); }
                    });
                    if (ret === true) async = true;
                    if (answered) return;
                }
                if (!async && !answered) resolve(null);
            });
            if (resp) return resp.r;
            await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error("Could not establish connection. Receiving end does not exist.");
    }

    const area = (obj, name) => ({
        async get(keys) {
            if (keys == null) return clone(obj);
            const out = {};
            for (const k of [].concat(keys)) if (k in obj) out[k] = clone(obj[k]);
            return out;
        },
        async set(items) {
            const changes = {};
            for (const [k, v] of Object.entries(items)) {
                changes[k] = { oldValue: clone(obj[k]), newValue: clone(v) };
                obj[k] = clone(v);
            }
            setTimeout(() => changeListeners.forEach((l) => l(changes, name)), 0);
        },
    });

    window.chrome = {
        runtime: {
            id: "test-extension",
            getURL: (p) => EXT + p.replace(/^\//, ""),
            sendMessage,
            onMessage: { addListener: (l) => listeners.push(l), hasListeners: () => listeners.length > 0 },
            onInstalled: { addListener: () => {} },
            onStartup: { addListener: () => {} },
            lastError: null,
        },
        storage: {
            local: area(store, "local"),
            session: area(session, "session"),
            onChanged: { addListener: (l) => changeListeners.push(l) },
        },
        declarativeNetRequest: {
            getDynamicRules: async () => clone(rules),
            updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }) => {
                rules = rules.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
            },
        },
        tabs: { create: () => {}, query: async () => [{ url: location.href }], sendMessage: () => {} },
        contextMenus: { create: () => {}, removeAll: (cb) => cb?.(), onClicked: { addListener: () => {} } },
    };
    window.__hisnTest = { store, getRules: () => rules };
})();
