# Notices / إشعارات الحقوق

## HaramBlur

Hisn Filter's browser extension is derived from **HaramBlur** by Mohamed Alganzory —
https://github.com/alganzory/HaramBlur — version 0.2.6 (last upstream commit f47000e, 2024-07-07).

HaramBlur is licensed under the GNU Affero General Public License v3.0.
Hisn Filter is distributed under the same license (see `LICENSE`).
The complete source code of every release (extension, Android and iPhone apps, build scripts,
tests, and the model registry `docs/models-registry.md`) is published alongside the release.
Build: `npm install && npm run build` in `apps/extension` (Node 20+).

إضافة المتصفح مشتقة من HaramBlur لمحمد الجنزوري، ومرخصة بنفس رخصته AGPL-3.0.
الكود المصدري الكامل لكل إصدار (الإضافة، وتطبيقا أندرويد والآيفون، وأدوات البناء، والاختبارات، وسجل النماذج)
يُنشر مع الإصدار نفسه.

## What this package contains / ما تحتويه هذه الحزمة

| Component (path in this package) | Source | License |
| --- | --- | --- |
| Human library (bundled in `offscreen.js`, `background.js`) | https://github.com/vladmandic/human | MIT |
| Human models: BlazeFace, FaceRes, MoveNet MultiPose (`models/human/`) | https://github.com/vladmandic/human | MIT (MoveNet: Apache-2.0) |
| NudeNet 320n detector v3.4.2 (`models/nudenet/`) | https://github.com/notAI-tech/NudeNet | AGPL-3.0 |
| YAMNet audio classifier (`models/yamnet/`) | Google — https://github.com/tensorflow/models/tree/master/research/audioset/yamnet | Apache-2.0 |
| UVR-MDX-NET-Inst_HQ_4, int8 weights (`models/uvr/`) | Ultimate Vocal Remover — https://github.com/Anjok07/ultimatevocalremovergui (MIT); ONNX build from https://github.com/k2-fsa/sherpa-onnx (Apache-2.0) | MIT, with credit to UVR and its developers (shown in Settings) |
| DeepFilterNet3 (`audio/df_bg.wasm`, npm `@lofcz/deepfilternet-web`) | https://github.com/Rikorose/DeepFilterNet | MIT / Apache-2.0 |
| onnxruntime-web (`ort/`) | https://github.com/microsoft/onnxruntime | MIT |
| mp4box.js, mp4-muxer (bundled in `pages/clean-video.js`) | https://github.com/gpac/mp4box.js · https://github.com/Vanilagy/mp4-muxer | BSD-3-Clause · MIT |
| qrcode-generator (bundled in `pages/settings.js`) | https://github.com/kazuhikoarase/qrcode-generator | MIT |
| Adult/gambling domain lists (`rules/`) | Sinfonietta, Clefspeare13, BigDargon hosts lists | MIT |
| Arabic lexicon and topic lists (in `content.js`) | Hisn Filter | AGPL-3.0 |

## Privacy, precisely / الخصوصية بدقة

- Images, video frames and audio are analysed on this device. Nothing is uploaded and there is no Hisn server.
- Stored on this device only: settings, the lock code's PBKDF2 hash, hidden accounts, and your image corrections.
- Fetched from the web: the images and videos of pages you open (to analyse them) and their caption tracks
  (to mute spoken profanity) — the same files your browser is already loading.
