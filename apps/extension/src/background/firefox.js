// Firefox لا يدعم الصفحات الخفية، لكن خلفيته صفحة كاملة فيها DOM و WebGL، فيستضيف المحرك مباشرة.
import "./index.js";
import { startDetectorHost } from "../detector/host.js";
startDetectorHost();
