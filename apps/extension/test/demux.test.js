import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demux, SampleReader } from "../src/cleaner/demux.js";

const site = new URL("./e2e/site/", import.meta.url).pathname;

/** ملف يعدّ ما يُقرأ منه (حتى نتأكد أن الفيديو لا يُحمَّل كله في الذاكرة). */
function countingBlob(path) {
    const blob = new Blob([readFileSync(path)]);
    const stats = { bytes: 0, reads: 0 };
    const wrap = (b, start = 0) => ({
        size: b.size,
        slice: (a, e) => { const s = b.slice(a, e); return { arrayBuffer: async () => { stats.bytes += s.size; stats.reads++; return s.arrayBuffer(); }, size: s.size }; },
    });
    return { file: wrap(blob), stats, size: blob.size };
}

for (const [name, faststart] of [["الفهرس في آخر الملف", false], ["الفهرس في أوله", true]]) {
    test(`قراءة الفهرس فقط (${name})`, async () => {
        let path = join(site, "gallery-rotated.mp4"), tmp; // فهرسه في آخره
        if (faststart) {
            tmp = mkdtempSync(join(tmpdir(), "hisn-"));
            path = join(tmp, "fs.mp4");
            execFileSync("ffmpeg", ["-v", "error", "-i", join(site, "gallery-rotated.mp4"), "-c", "copy", "-movflags", "+faststart", path]);
        }
        try {
            const { file, stats, size } = countingBlob(path);
            const src = await demux(file);
            assert.ok(src.video && src.audio);
            assert.equal(src.video.samples.length, src.video.nb);
            assert.ok(src.video.samples.every((s) => s.size > 0 && s.offset > 0 && s.data === undefined));
            // أقل من الملف كله (الملف صغير، لكن المهم أن القفز فوق البيانات يعمل)
            assert.ok(stats.bytes < size || size < (1 << 20) * 2, `قُرئ ${stats.bytes} من ${size}`);
            // قراءة عينة: تطابق البايتات الحقيقية في الملف
            const raw = readFileSync(path);
            const s = src.video.samples[10];
            const got = await new SampleReader(file).read(s);
            assert.deepEqual(Buffer.from(got), raw.subarray(s.offset, s.offset + s.size));
        } finally {
            if (tmp) rmSync(tmp, { recursive: true, force: true });
        }
    });
}

test("ملف كبير: الفهرس يُقرأ بقراءات قليلة دون تحميل البيانات", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hisn-"));
    try {
        // فيديو 3 دقائق (فهرسه في آخره): يجب ألا نقرأ إلا جزءًا صغيرًا منه
        const path = join(tmp, "long.mp4");
        execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
            "-t", "180", "-c:v", "libvpx-vp9", "-b:v", "3M", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus", path]);
        const { file, stats, size } = countingBlob(path);
        const src = await demux(file);
        assert.equal(Math.round(src.duration), 180);
        assert.ok(stats.bytes < size / 4, `قُرئ ${(stats.bytes / 1e6).toFixed(1)}MB من ${(size / 1e6).toFixed(1)}MB`);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});
