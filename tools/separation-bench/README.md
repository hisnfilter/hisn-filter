# مقياس فصل الموسيقى عن الكلام

يقيس نماذج الفصل على كلام حقيقي نظيف (LibriSpeech من librosa/data) مخلوط بخمس موسيقات حقيقية
بثلاثة مستويات (0، ‎-6، ‎-12 dB)، ويحسب:
- **sdr**: مطابقة الناتج للكلام الأصلي (SI-SDR، أعلى أفضل).
- **fidelity**: كلام بلا موسيقى يمر بالنموذج — هل يتغير؟ (أعلى = لا يتغير).
- **music_left_db**: ما يبقى من الموسيقى وحدها.

التحضير (ملفات من GitHub فقط):

    mkdir -p models audio
    B=https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models
    curl -L -o models/UVR-MDX-NET-Inst_HQ_4.onnx $B/UVR-MDX-NET-Inst_HQ_4.onnx
    R=https://raw.githubusercontent.com/librosa/data/main/audio
    # 5703-47212-0000.ogg، 198-209-0000.hq.ogg، وملفات الموسيقى المذكورة في bench.py ← audio/

    python3 bench.py inst_hq4 voc_ft spleeter dfn

النتيجة التي اعتمدنا عليها (أكتوبر 2026):

| النموذج | sdr عند 0/‎-6/‎-12 | fidelity | music_left |
| --- | --- | --- | --- |
| **UVR-MDX-NET-Inst_HQ_4 (طرح الموسيقى من الأصل)** | **15.9 / 18.8 / 21.2** | **35.3** | ‎-32.8 |
| UVR-MDX-NET-Voc_FT | 14.9 / 17.4 / 19.7 | 24.8 | ‎-44.5 |
| UVR_MDXNET_Main | 14.8 / 17.1 / 19.6 | 22.6 | ‎-44.0 |
| Spleeter 2stems | 7.7 / 11.7 / 14.2 | 19.7 | ‎-38.6 |
| DeepFilterNet3 (المحرك اللحظي) | 7.0 / 7.8 / 4.7 | 15.8 | ‎-20.8 |
| Inst_HQ_4 مرتين | 15.9 / 18.8 / 21.2 | 33.3 | ‎-48.4 |
