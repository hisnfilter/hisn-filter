// يعمل في سياق صفحة يوتيوب نفسها (لا في سياق الإضافة) ليقرأ قائمة الترجمات من مشغّل يوتيوب،
// ثم يرسلها لسكربت الإضافة. لا يغيّر شيئًا في الصفحة.
(() => {
    let last = "";
    function post() {
        const player = document.getElementById("movie_player");
        const r = player?.getPlayerResponse?.();
        const id = r?.videoDetails?.videoId;
        if (!id || id === last) return;
        last = id;
        const tracks = (r?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).map((t) => ({
            baseUrl: t.baseUrl,
            lang: t.languageCode,
            kind: t.kind ?? "",
        }));
        window.postMessage({ source: "hisn-yt", videoId: id, tracks }, location.origin);
        postAudioTracks(player, id);
        postMusicInfo(r, id);
    }
    // لكاتم الموسيقى بالسماع: تصنيف يوتيوب للمقطع (Music) ورابط المسار الصوتي وحده (أصغر معدل) إن كان مباشرًا
    function postMusicInfo(r, id) {
        let category = "", audioUrl = "";
        try { category = r?.microformat?.playerMicroformatRenderer?.category || ""; } catch { /* */ }
        try {
            const a = (r?.streamingData?.adaptiveFormats ?? []).filter((f) => /^audio\//.test(f.mimeType || "") && f.url);
            a.sort((x, y) => (x.bitrate || 0) - (y.bitrate || 0));
            audioUrl = a[0]?.url || "";
        } catch { /* */ }
        const vd = r?.videoDetails || {};
        window.postMessage({ source: "hisn-yt-music", videoId: id, category, audioUrl, title: String(vd.title || "").slice(0, 200), author: String(vd.author || "").slice(0, 100), keywords: (vd.keywords || []).slice(0, 40).map(String) }, location.origin);
    }
    // مسارات الصوت البديلة (بعض القنوات ترفع مسارًا بلا موسيقى باسم لغة أخرى)
    const name = (t) => t?.AC?.name || t?.displayName || t?.name || t?.AC?.id || "";
    let lastAudio = "";
    function postAudioTracks(player, id) {
        let list = [];
        try { list = player?.getAvailableAudioTracks?.() ?? []; } catch { list = []; }
        let current = "";
        try { current = name(player?.getAudioTrack?.()); } catch { /* لا مشغّل */ }
        // مشغّل الجوال قد لا يسمّي المسار الحالي: نعتبره الافتراضي
        if (!current || current === "und" || current === "Default") current = name(list.find((t) => t?.AC?.isDefault)) || current;
        const sig = id + "|" + list.map(name).join(",") + "|" + current;
        if (sig === lastAudio) return;
        lastAudio = sig;
        window.postMessage({ source: "hisn-yt-audio", videoId: id, tracks: list.map(name), current }, location.origin);
    }
    window.addEventListener("message", (e) => {
        if (e.source !== window || e.data?.source !== "hisn-set-audio-track") return;
        const player = document.getElementById("movie_player");
        let list = [];
        try { list = player?.getAvailableAudioTracks?.() ?? []; } catch { return; }
        const t = list.find((x) => name(x) === e.data.name);
        if (t) { try { player.setAudioTrack(t); } catch { /* رفض */ } }
        setTimeout(() => { lastAudio = ""; post(); }, 300);
    });
    setInterval(() => { const p = document.getElementById("movie_player"); const id = p?.getPlayerResponse?.()?.videoDetails?.videoId; if (id) postAudioTracks(p, id); }, 2000);
    document.addEventListener("yt-navigate-finish", () => setTimeout(post, 600));
    window.addEventListener("load", () => setTimeout(post, 1000));
    setInterval(post, 3000);
})();
