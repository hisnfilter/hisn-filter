import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    TextFilter, summarizeAudio, classifyMusic, MusicGate, parseYouTubeJson3, muteIntervals,
    inIntervals, resampleTo16k, encodePcm16, decodePcm16,
} from "../src/index.js";

// درجات YAMNet الحقيقية لأصوات اختبار (من النموذج نفسه على مقاطع حقيقية ومخلوطة)
const scores = JSON.parse(readFileSync(new URL("./fixtures/audio/yamnet-scores.json", import.meta.url)));
const isMusic = (name, s = {}) => classifyMusic(summarizeAudio(scores[name]), s).music;
const filter = new TextFilter(JSON.parse(readFileSync(new URL("../data/lexicon.json", import.meta.url))));

test("الموسيقى تُكتم: إيقاع، وموسيقى درامية، وموسيقى هادئة، وكلام فوق موسيقى", () => {
    for (const n of ["congas", "drama", "soft-music", "speech-over-music"]) assert.ok(isMusic(n), n);
});

test("لا يُكتم: الكلام، والتصفيق، والطبيعة، والقطار", () => {
    for (const n of ["speech", "applause", "nature", "train"]) assert.ok(!isMusic(n), n);
});

test("الصوت البشري بلا آلات (إنشاد أو تلاوة) لا يُكتم إلا إذا طلب المستخدم", () => {
    const vocal = { speech: 0.1, vocal: 0.7, music: 0.6, instrument: 0.05, genre: 0.1 };
    assert.equal(classifyMusic(vocal).music, false);
    assert.equal(classifyMusic(vocal, { allowNasheedsWithoutInstruments: false }).music, true);
    assert.equal(classifyMusic({ ...vocal, instrument: 0.5 }).music, true); // غناء مع آلات
});

test("بوابة الكتم: تكتم فورًا وتفتح بعد نافذتين سليمتين", () => {
    const g = new MusicGate();
    assert.deepEqual([false, true, false, false, false].map((m) => g.push(m)), [false, true, true, false, false]);
    assert.deepEqual([true, false, true, false, false].map((m) => g.push(m)), [true, true, true, true, false]);
});

test("ترجمة يوتيوب: كتم الكلمة وحدها عند وجود توقيت الكلمات", () => {
    const json = {
        events: [
            { tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: "what" }, { utf8: " the", tOffsetMs: 400 }, { utf8: " fuck", tOffsetMs: 800 }, { utf8: " man", tOffsetMs: 1300 }] },
            { tStartMs: 5000, dDurationMs: 2000, segs: [{ utf8: "hello there" }] },
            { tStartMs: 8000, dDurationMs: 2000, segs: [{ utf8: "يا شرموطة" }] },
        ],
    };
    const cues = parseYouTubeJson3(json);
    assert.equal(cues.length, 3);
    const iv = muteIntervals(cues, filter);
    assert.equal(iv.length, 2);
    assert.ok(inIntervals(1.9, iv) && !inIntervals(1.5, iv) && !inIntervals(2.5, iv), JSON.stringify(iv));
    assert.ok(inIntervals(9, iv) && !inIntervals(6, iv));
});

test("تحويل التردد وترميز الصوت", () => {
    const sine = Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5);
    const r = resampleTo16k(sine, 48000);
    assert.equal(r.length, 16000);
    assert.ok(Math.abs(Math.max(...r) - 0.5) < 0.05);
    const back = decodePcm16(encodePcm16(r));
    assert.equal(back.length, r.length);
    assert.ok(back.every((v, i) => Math.abs(v - r[i]) < 1e-4));
});

test("المغني بعد إزالة الموسيقى: الغناء يُعرف والكلام لا", async () => {
    const { SingingDetector } = await import("../src/index.js");
    const load = (n) => {
        const b = readFileSync(new URL(`./fixtures/audio/${n}.s16`, import.meta.url));
        const i16 = new Int16Array(b.buffer, b.byteOffset, b.length / 2);
        return Float32Array.from(i16, (v) => v / 32767);
    };
    const judge = (n) => {
        const d = new SingingDetector();
        const x = load(n);
        for (let i = 0; i < x.length; i += 1600) d.push(x.subarray(i, i + 1600)); // كما تصل في البث: 0.1 ثانية كل مرة
        return { singing: d.isSinging(), ...d.measure() };
    };
    for (const n of ["sung-1", "sung-2"]) assert.ok(judge(n).singing, `${n} ${JSON.stringify(judge(n))}`);
    for (const n of ["speech-1", "speech-2", "speech-3"]) assert.ok(!judge(n).singing, `${n} ${JSON.stringify(judge(n))}`);
});
