// أين يُكتب الناتج: في الذاكرة (الإضافة على الحاسوب) أو مباشرة في ملف عند التطبيق (الجوال)،
// فلا يبقى الفيديو الناتج كله في ذاكرة الصفحة. الكتابة بموضع (position) لأن ملف MP4 تُصحَّح
// ترويسته في النهاية.

/** في الذاكرة: قطع متتالية، مع تصحيح ما يُكتب فوق قطعة سابقة. */
export class MemorySink {
    constructor() { this.parts = new Map(); }

    open(part, mime) {
        const pieces = [];
        let end = 0;
        this.parts.set(part, { pieces, mime });
        return {
            write(pos, data) {
                const bytes = data.slice(); // نسخة: المصدر قد يُعاد استخدامه
                let a = pos;
                // ما يقع فوق قطع موجودة يُنسخ فيها
                for (const p of pieces) {
                    const from = Math.max(a, p.pos), to = Math.min(pos + bytes.length, p.pos + p.data.length);
                    if (to > from) p.data.set(bytes.subarray(from - pos, to - pos), from - p.pos);
                }
                if (pos + bytes.length > end) {
                    a = Math.max(pos, end);
                    if (a > end) pieces.push({ pos: end, data: new Uint8Array(a - end) }); // فجوة (لا تحدث عادة)
                    pieces.push({ pos: a, data: bytes.subarray(a - pos) });
                    end = pos + bytes.length;
                }
            },
            close() {},
        };
    }

    blob(part) {
        const p = this.parts.get(part);
        return p ? new Blob(p.pieces.map((x) => x.data), { type: p.mime }) : null;
    }
}

function toBase64(bytes) {
    let s = "";
    for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
    return btoa(s);
}

/** عند التطبيق (HisnHost): كل كتابة تذهب للملف المؤقت في التطبيق على دفعات صغيرة. */
export class HostSink {
    constructor(host) { this.host = host; }

    open(part, mime) {
        const host = this.host;
        host.begin(part, mime);
        const CHUNK = 512 * 1024;
        return {
            write(pos, data) {
                for (let i = 0; i < data.length; i += CHUNK) host.write(part, pos + i, toBase64(data.subarray(i, i + CHUNK)));
            },
            close() {},
        };
    }

    blob() { return null; }
}
