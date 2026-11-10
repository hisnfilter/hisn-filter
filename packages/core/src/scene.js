// فهم الصورة كاملة (MobileCLIP-S0): يقارن متجه الصورة بنصوص محسوبة مسبقًا (data/scene.json)
// ويُرجع احتمال وجود امرأة، واحتمال أن الصورة إيحائية. نفس الحساب في كود الآيفون (NativeDetector.sceneScores).
import S from "../data/scene.json" with { type: "json" };

export const SCENE_SIZE = S.size;

/** @param {Float32Array|number[]} e متجه الصورة (512) قبل التطبيع */
export function sceneFrom(e) {
    let norm = 0;
    for (const v of e) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    const sims = S.emb.map((t) => { let d = 0; for (let i = 0; i < t.length; i++) d += t[i] * e[i]; return (d / norm) * S.scale; });
    const mx = Math.max(...sims);
    const ex = sims.map((x) => Math.exp(x - mx));
    const sum = ex.reduce((a, b) => a + b, 0);
    const pick = (ids) => ids.reduce((a, i) => a + ex[i], 0) / sum;
    // covered: منقبة/برقع — صنف مستقل حتى لا تُحسب «امرأة» (المنقبة تظهر في المتوسط وتُحجب في الصارم للرجل)
    // scary: مشهد مخيف (رعب/وحوش/مهرج مخيف/مبنى مسكون) — يُحجب في وضع الطفل فقط
    return { woman: +pick(S.woman).toFixed(3), sexual: +pick(S.sexual).toFixed(3), covered: +pick(S.covered ?? []).toFixed(3), nobody: +pick(S.nobody ?? []).toFixed(3), scary: +pick(S.scary ?? []).toFixed(3) };
}
