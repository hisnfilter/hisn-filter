// مدخل اختبار انحدار لإصلاحات المراجعة (F01/F02): وحدات الصفحة نفسها، بلا نماذج
import { markRevealed, revealStillValid, setMediaState, setPartial, clearAllVideoOverlays, ATTR, installClickGuard, _popTest } from "../../../src/content/ui.js";
import { mediaSourceChanged, configureMedia, onHiddenMediaClick, retryAllErrors } from "../../../src/content/media.js";
import { configureSongs } from "../../../src/content/songs.js";
import { configureAudio, watchAudio, suspendAudio, _audioTest } from "../../../src/content/audio.js";
import { watchVideo, stopVideoMonitors } from "../../../src/content/video.js";
globalThis.T = { _popTest, configureMedia, onHiddenMediaClick, retryAllErrors, installClickGuard, markRevealed, revealStillValid, setMediaState, setPartial, clearAllVideoOverlays, ATTR, mediaSourceChanged, configureSongs, configureAudio, watchAudio, suspendAudio, _audioTest, watchVideo, stopVideoMonitors };
