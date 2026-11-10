// خلفية هادئة بدل الموسيقى المحذوفة (اختيارية): مطر خفيف، أو نسيم، أو أمواج.
// تُولَّد بالحساب (ضوضاء مُرشَّحة) فلا ملفات صوت ولا حقوق، وهي نفسها في كود الآيفون (Ambient في NativeMusicCleaner.swift).

export const BEDS = ["none", "rain", "breeze", "waves"];
/** مستوى الخلفية: خافتة تحت الكلام (نحو ‎-32 dBFS) */
const LEVEL = 0.025;
// تسوية الأنواع إلى نفس العلو تقريبًا (مقيس: ‎-32 dB RMS)
const GAIN = { rain: 6, breeze: 9.6, waves: 10.4 };

/** مولّد أرقام عشوائية ثابت (نفس الناتج في كل مرة وعلى كل جهاز). */
function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return s / 4294967296 * 2 - 1;
    };
}

/**
 * قناة واحدة من الخلفية. next() تُرجع العينة التالية.
 * @param {"rain"|"breeze"|"waves"} kind
 */
export class Ambient {
    constructor(kind, rate, seed = 1) {
        this.kind = kind;
        this.rate = rate;
        this.r = rng(seed);
        this.n = 0;
        this.lp1 = 0; this.lp2 = 0; this.hp = 0; this.prev = 0;
        this.drop = 0; this.dropEnv = 0;
        // معاملات المرشحات بتردد القطع (مستقلة عن تردد الملف)
        const a = (fc) => 1 - Math.exp((-2 * Math.PI * fc) / rate);
        this.aLow = a(kind === "waves" ? 350 : kind === "breeze" ? 500 : 3000);
        this.aHigh = a(kind === "rain" ? 400 : 60);
        this.aDrop = a(2500);
        this.phase = this.r() * 1000;
    }

    next() {
        const t = this.n++ / this.rate + this.phase;
        const w = this.r();
        // تمرير منخفض مرتين (أنعم)، ثم حذف أخفض الترددات (بلا هدير)
        this.lp1 += this.aLow * (w - this.lp1);
        this.lp2 += this.aLow * (this.lp1 - this.lp2);
        const x = this.lp2;
        this.hp += this.aHigh * (x - this.hp);
        let y = x - this.hp;
        if (this.kind === "breeze") {
            // هبّات بطيئة غير منتظمة
            y *= 2.2 * (0.55 + 0.25 * Math.sin(2 * Math.PI * 0.07 * t) + 0.2 * Math.sin(2 * Math.PI * 0.031 * t + 1.3));
        } else if (this.kind === "waves") {
            // موجة كل نحو 8 ثوانٍ: ترتفع ثم تنحسر
            const p = (t / 8) % 1;
            const swell = p < 0.35 ? Math.sin((p / 0.35) * Math.PI / 2) : Math.cos(((p - 0.35) / 0.65) * Math.PI / 2);
            y *= 2.6 * (0.15 + 0.85 * swell * swell);
        } else {
            // مطر: هسهسة خفيفة + قطرات متفرقة
            y *= 0.9;
            if (this.dropEnv < 1e-3 && this.r() > 1 - 18 / this.rate) this.dropEnv = 0.35 + 0.4 * Math.abs(this.r());
            this.drop += this.aDrop * (this.r() - this.drop);
            y += this.drop * this.dropEnv;
            this.dropEnv *= Math.exp(-1 / (0.012 * this.rate));
        }
        return y * LEVEL * GAIN[this.kind];
    }
}

/** خلفية لقناتين (بذرتان مختلفتان: اتساع طبيعي). */
export function ambientPair(kind, rate) {
    if (!kind || kind === "none") return null;
    return [new Ambient(kind, rate, 11), new Ambient(kind, rate, 29)];
}
