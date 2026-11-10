# سجل النماذج والرخص

لا يُضاف نموذج أو مكتبة إلى إصدار منشور قبل تسجيله هنا مع رخصته ومصدره وطريقة التحقق منه.

| النموذج / المكتبة | الاستخدام | المصدر | الرخصة | أين | التحقق |
| --- | --- | --- | --- | --- | --- |
| NudeNet 320n (v3.4.2) | أماكن العورات المكشوفة، ووجوه | ملف PyPI الرسمي `nudenet` | AGPL-3.0 | الإضافة، أندرويد | مطابق لمخرجات الكود الرسمي (`packages/core/test/nudenet.test.js`) |
| Human 3.3.6: blazeface | كشف الوجوه | https://github.com/vladmandic/human | MIT | الإضافة؛ أندرويد (ONNX) | التحويل: أقصى فرق 1.4e-4 |
| Human 3.3.6: faceres | الجنس والعمر | نفسه (أصله HSE-FaceRes) | MIT | الإضافة؛ أندرويد (ONNX)؛ آيفون (Core ML fp16) | ONNX: أقصى فرق 3.8e-7؛ Core ML: `apps/ios/tools/verify_coreml.py` على الماك |
| Human 3.3.6: movenet-multipose | الأجسام (شخص بلا وجه ظاهر) | نفسه (أصله Google MoveNet، Apache-2.0) | MIT / Apache-2.0 | الإضافة؛ أندرويد (ONNX) | التحويل: أقصى فرق 5.7e-7 |
| YAMNet (MediaPipe، int8) | تمييز الموسيقى من الكلام والإنشاد | Google — الملف الرسمي بترخيصه المضمّن (sha256 10c95ea3…) | Apache-2.0 | الإضافة؛ أندرويد | ONNX يطابق TFLite في أعلى الفئات (فروق تكميم ≤ 0.17) |
| onnxruntime-web / onnxruntime-android | تشغيل النماذج | https://github.com/microsoft/onnxruntime | MIT | الإضافة؛ أندرويد | — |
| DeepFilterNet3 (`@lofcz/deepfilternet-web` 0.1.0، الأوزان داخل df_bg.wasm) | إزالة الموسيقى أثناء التصفح وفي أندرويد (لحظي، ~30ms) | https://github.com/Rikorose/DeepFilterNet | MIT / Apache-2.0 | الإضافة؛ أندرويد (WebView) | `apps/extension/test/e2e/app-engine.mjs` |
| UVR-MDX-NET-Inst_HQ_4 (ONNX، أوزان int8 لكل قناة تُفك عند التحميل، وطول نافذة متغير (نستخدم 64 إطارًا = ربع الذاكرة): 15MB؛ الأصل af6de857…) | فصل الموسيقى في فيديو الاستوديو: تُقدَّر الموسيقى وتُطرح من الأصل، فيبقى صوت المتكلم كما سُجّل | Ultimate Vocal Remover (Anjok07 و aufr33)، نسخة ONNX من إصدار `source-separation-models` في sherpa-onnx | MIT (نص فريق UVR: «لمطوري التطبيقات الذين يستخدمون نماذجنا: التزموا برخصة MIT بذكر UVR ومطوريه») — الذكر موجود في «عن التطبيق» | الإضافة؛ صفحات التطبيق؛ أندرويد (المعالج الأصلي) | مقياس على كلام وموسيقى حقيقيين: كلام نظيف لا يتغير (35dB)، موسيقى وحدها ‎-33dB، وضوح الكلام 15.9/18.8/21.2dB عند 0/‎-6/‎-12dB؛ JS وKotlin يطابقان مرجع Python (فرق ‎-48dB)؛ نسخة int8: 15.8/18.7/21.1dB وأمانة 33.7dB (فرق ‎-0.1dB عن الأصل)، وطريقة التحويل في `tools/separation-bench/quantize.py` |
| Apple SensitiveContentAnalysis + Vision | العري والوجوه في فحص الشاشة (آيفون) | نظام iOS | ضمن النظام | آيفون | — |

## غير مستخدم

| النموذج | السبب |
| --- | --- |
| NSFWJS (من HaramBlur) | استُبدل بـ NudeNet (يحدد المكان لا الصورة كلها) |
| GEAR (Human) | جُرّب لتقدير الجنس فكان أسوأ من faceres على صور النساء |
| HTDemucs | ثقيل جدًا، وأوزانه غير متاحة إلا عبر خوادم PyTorch |
| UVR-MDX-NET-Voc_FT، UVR_MDXNET_Main | في المقياس: أقل أمانة لصوت المتكلم (24.8 و22.6dB مقابل 35dB) |
| UVR_MDXNET_1_9703 | يقص الكلام (صُمم للغناء) |
| Spleeter 2stems | سريع جدًا لكن أضعف بكثير (وضوح 7.7/11.7/14.2dB) |
