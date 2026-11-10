"""مقياس فصل الكلام عن الموسيقى: كلام نظيف حقيقي + موسيقى حقيقية بمستويات مختلفة،
ونقيس كم يطابق الناتجُ الكلامَ الأصلي (SI-SDR)، وهل يمس الكلامَ النظيف (الأمانة)، وكم يحذف من الموسيقى وحدها."""
import json, subprocess, sys, time, os
import numpy as np
import onnxruntime as ort

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
A = lambda n: os.path.join(HERE, "audio", n)


def load(path, sr=SR, ch=2):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", str(ch), "-ar", str(sr), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, ch).T.copy()


def rms(x):
    return float(np.sqrt(np.mean(x ** 2) + 1e-12))


def si_sdr(est, ref):
    est = est - est.mean(); ref = ref - ref.mean()
    a = np.dot(est, ref) / (np.dot(ref, ref) + 1e-12)
    t = a * ref
    return float(10 * np.log10(np.dot(t, t) / (np.dot(est - t, est - t) + 1e-12)))


# ---------------- STFT (مثل torch.stft center=True، نافذة hann دورية) ----------------
def hann(n):
    return (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)).astype(np.float32)


def stft(x, n_fft, hop):
    w = hann(n_fft)
    pad = n_fft // 2
    xp = np.pad(x, (pad, pad), mode="reflect")
    n = 1 + (len(xp) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n)[:, None]
    return np.fft.rfft(xp[idx] * w, axis=1).T  # [bins, frames]


def istft(S, n_fft, hop, length):
    w = hann(n_fft)
    frames = np.fft.irfft(S.T, n=n_fft, axis=1) * w
    n = frames.shape[0]
    out = np.zeros(n_fft + hop * (n - 1)); norm = np.zeros_like(out)
    for i in range(n):
        out[i * hop:i * hop + n_fft] += frames[i]
        norm[i * hop:i * hop + n_fft] += w ** 2
    out /= np.maximum(norm, 1e-8)
    pad = n_fft // 2
    return out[pad:pad + length]


class MDX:
    def __init__(self, path, batch=1):
        self.batch = batch
        self.s = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        m = self.s.get_modelmeta().custom_metadata_map
        self.n_fft = int(m["n_fft"]); self.hop = int(m["hop_length"]); self.dim_f = int(m["dim_f"]); self.dim_t = int(m["dim_t"])
        self.name = m["model_name"]

    def run(self, mix):  # mix [2, N] → الناتج المباشر للنموذج [2, N]
        n_fft, hop, dim_f, dim_t = self.n_fft, self.hop, self.dim_f, self.dim_t
        trim = n_fft // 2
        chunk = hop * (dim_t - 1)
        gen = chunk - 2 * trim
        N = mix.shape[1]
        pad = gen - N % gen
        mp = np.concatenate([np.zeros((2, trim)), mix, np.zeros((2, pad + trim))], axis=1).astype(np.float32)
        outs = []
        segs = [mp[:, i:i + chunk] for i in range(0, N + pad, gen)]
        for b in range(0, len(segs), self.batch):
            batch = segs[b:b + self.batch]
            X = []
            for s in batch:
                S = np.stack([stft(s[c], n_fft, hop) for c in range(2)])  # [2, bins, T]
                S = S[:, :dim_f]
                X.append(np.concatenate([np.stack([S[c].real, S[c].imag]) for c in range(2)]))  # [4, F, T]
            Y = self.s.run(None, {self.s.get_inputs()[0].name: np.stack(X).astype(np.float32)})[0]
            for y in Y:
                full = np.zeros((2, n_fft // 2 + 1, dim_t), np.complex64)
                full[0, :dim_f] = y[0] + 1j * y[1]
                full[1, :dim_f] = y[2] + 1j * y[3]
                o = np.stack([istft(full[c], n_fft, hop, chunk) for c in range(2)])
                outs.append(o[:, trim:chunk - trim])
        out = np.concatenate(outs, axis=1)[:, :N]
        return out


class Spleeter:
    """Deezer Spleeter 2stems (MIT): قناع ناعم من مقدار الطيف."""
    def __init__(self, d):
        self.v = ort.InferenceSession(os.path.join(d, "vocals.fp16.onnx"), providers=["CPUExecutionProvider"])
        self.a = ort.InferenceSession(os.path.join(d, "accompaniment.fp16.onnx"), providers=["CPUExecutionProvider"])
        self.name = "spleeter-2stems"

    def run(self, mix):
        n_fft, hop = 4096, 1024
        S = np.stack([stft(mix[c], n_fft, hop) for c in range(2)])  # [2, 2049, T]
        T = S.shape[2]
        Tp = ((T + 511) // 512) * 512
        mag = np.zeros((2, Tp, 1024), np.float32)
        mag[:, :T] = np.abs(S[:, :1024, :]).transpose(0, 2, 1)
        x = mag.reshape(2, Tp // 512, 512, 1024)
        dt = np.float16 if "float16" in self.v.get_inputs()[0].type else np.float32
        v = self.v.run(None, {"x": x.astype(dt)})[0].astype(np.float32).reshape(2, Tp, 1024)
        a = self.a.run(None, {"x": x.astype(dt)})[0].astype(np.float32).reshape(2, Tp, 1024)
        m = (v ** 2 + 1e-10 / 2) / (v ** 2 + a ** 2 + 1e-10)
        mask = np.zeros((2, S.shape[1], T), np.float32)
        mask[:, :1024] = m[:, :T].transpose(0, 2, 1)
        return np.stack([istft(S[c] * mask[c], n_fft, hop, mix.shape[1]) for c in range(2)])


class DFN:
    """المحرك الحالي (DeepFilterNet3) للمقارنة: أحادي 48kHz عبر node."""
    name = "deepfilternet3"
    PKG = os.path.join(HERE, "../hisn-filter/apps/extension/node_modules/@lofcz/deepfilternet-web")

    def run(self, mix):
        from scipy.signal import resample_poly
        import tempfile
        x = resample_poly(mix.mean(0), 160, 147).astype(np.float32)
        with tempfile.TemporaryDirectory() as d:
            f = os.path.join(d, "x.f32"); x.tofile(f)
            subprocess.run(["node", os.path.join(HERE, "dfn.mjs"), self.PKG, f], check=True, capture_output=True)
            y = np.fromfile(f.replace(".f32", ".dfn.f32"), np.float32)
        lag = int(0.03 * 48000)
        y = np.concatenate([y[lag:], np.zeros(lag, np.float32)])
        y = resample_poly(y, 147, 160)[: mix.shape[1]]
        return np.stack([y, y])


def speech_estimate(model, kind, mix):
    y = model.run(mix)
    return mix - y if kind == "inst" else y


def main():
    speech = [load(A(n)) for n in ["5703-47212-0000.ogg", "198-209-0000.hq.ogg"]]
    music_files = ["Kevin_MacLeod_-_Vibe_Ace.hq.ogg", "admiralbob77_-_Choice_-_Drum-bass.hq.ogg",
                   "Hungarian_Dance_number_5_-_Allegro_in_F_sharp_minor_(string_orchestra).hq.ogg",
                   "Kevin_MacLeod_-_P_I_Tchaikovsky_Dance_of_the_Sugar_Plum_Fairy.hq.ogg",
                   "147793__setuniman__sweet-waltz-0i-22mi.hq.ogg"]
    music = [load(A(n)) for n in music_files]
    L = 10 * SR
    cases = []
    for si, s in enumerate(speech):
        s = s[:, SR:SR + L]
        for mi, m in enumerate(music):
            m = m[:, 5 * SR:5 * SR + L]
            for db in [0, -6, -12]:
                g = rms(s) / rms(m) * 10 ** (db / 20)
                cases.append((f"s{si}-m{mi}@{db}", s, m * g))
    which = sys.argv[1:] or ["voc_ft", "inst_hq4", "mdx_1_9703", "mdx_main", "kara2", "spleeter"]
    models = {
        "voc_ft": (lambda: MDX(os.path.join(HERE, "models/UVR-MDX-NET-Voc_FT.onnx")), "vocal"),
        "inst_hq4": (lambda: MDX(os.path.join(HERE, "models/UVR-MDX-NET-Inst_HQ_4.onnx")), "inst"),
        "mdx_1_9703": (lambda: MDX(os.path.join(HERE, "models/UVR_MDXNET_1_9703.onnx")), "auto"),
        "mdx_main": (lambda: MDX(os.path.join(HERE, "models/UVR_MDXNET_Main.onnx")), "auto"),
        "kara2": (lambda: MDX(os.path.join(HERE, "models/UVR_MDXNET_KARA_2.onnx")), "auto"),
        "spleeter": (lambda: Spleeter(os.path.join(HERE, "models/sherpa-onnx-spleeter-2stems-fp16")), "vocal"),
        "dfn": (lambda: DFN(), "vocal"),
    }
    results = {}
    for key in which:
        make, kind = models[key]
        model = make()
        clean = speech[0][:, SR:SR + L]
        if kind == "auto":
            # أي مخرج هو الكلام؟ نجرب على كلام نظيف: نموذج الأصوات يُرجع الكلام نفسه تقريبًا
            y = model.run(clean)
            kind = "vocal" if rms(y) > rms(clean - y) else "inst"
        t0 = time.time()
        sdr = {}
        for name, s, m in cases:
            est = speech_estimate(model, kind, s + m)
            sdr[name] = si_sdr(est.mean(0), s.mean(0))
        secs = time.time() - t0
        mixsdr = {name: si_sdr((s + m).mean(0), s.mean(0)) for name, s, m in cases}
        # الأمانة: كلام بلا موسيقى يجب أن يخرج كما هو
        fid = [si_sdr(speech_estimate(model, kind, sp[:, SR:SR + L]).mean(0), sp[:, SR:SR + L].mean(0)) for sp in speech]
        # موسيقى وحدها: كم يبقى منها في مخرج الكلام
        att = [20 * np.log10(rms(speech_estimate(model, kind, mu[:, 5 * SR:5 * SR + L])) / rms(mu[:, 5 * SR:5 * SR + L])) for mu in music]
        by = lambda d, lv: np.mean([v for k, v in d.items() if k.endswith(f"@{lv}")])
        r = {
            "kind": kind,
            "sdr": {lv: round(by(sdr, lv), 2) for lv in [0, -6, -12]},
            "gain": {lv: round(by(sdr, lv) - by(mixsdr, lv), 2) for lv in [0, -6, -12]},
            "fidelity": round(float(np.mean(fid)), 2),
            "music_left_db": round(float(np.mean(att)), 1),
            "rtf": round(secs / (len(cases) * 10), 3),
            "per_case": {k: round(v, 1) for k, v in sdr.items()},
        }
        results[key] = r
        print(key, json.dumps({k: v for k, v in r.items() if k != "per_case"}, ensure_ascii=False), flush=True)
    json.dump(results, open(os.path.join(HERE, "results-" + "_".join(which) + ".json"), "w"), indent=1)


if __name__ == "__main__":
    main()
