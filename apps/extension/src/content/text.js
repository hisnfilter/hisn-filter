// فلترة النصوص في الصفحة: إخفاء الألفاظ، وطيّ الفقرات الإباحية.
// لا نلمس أبدًا ما يكتبه المستخدم: خانات الإدخال، والمحررات، والرسائل قيد الكتابة.
import { TextFilter } from "@hisn/core";
import lexicon from "@hisn/core/lexicon.json";
import { foldElement } from "./ui.js";

const filter = new TextFilter(lexicon);

const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION",
    "CODE", "PRE", "SVG", "MATH", "CANVAS", "IFRAME", "TEMPLATE",
]);
const BLOCK_SELECTOR =
    "p, li, blockquote, article, dd, td, h1, h2, h3, h4, h5, h6, " +
    "[data-testid='tweetText'], [data-ad-preview='message'], [dir='auto'], div";

const seenBlocks = new WeakSet();
let settings = null;

export function configureText(s) {
    settings = s;
    filter.setInsults(s.maskInsults); // الشتائم العامة في وضع الطفل
}

function isEditable(el) {
    for (let n = el; n; n = n.parentElement) {
        if (n.isContentEditable || SKIP_TAGS.has(n.tagName)) return true;
        if (n.getAttribute?.("role") === "textbox") return true;
        if (n.classList?.contains("hisn-ui")) return true; // واجهاتنا نحن
    }
    return false;
}

// عدّاد بسيط لكل نص، حتى لا نعيد معالجة نفس النص بعد تعديله
const processed = new WeakMap();

function censorTextNode(node) {
    const value = node.nodeValue;
    if (!value || value.length < 2 || processed.get(node) === value) return false;
    const out = filter.censor(value);
    if (out !== value) {
        node.nodeValue = out;
        processed.set(node, out);
        return true;
    }
    processed.set(node, value);
    return false;
}

function checkBlock(el) {
    if (!el || seenBlocks.has(el) || !settings?.foldExplicitText) return;
    // نفحص الكتلة الأقرب ذات النص الكافي، مع تجنب الحاويات الضخمة (الصفحة كاملة)
    const text = el.textContent ?? ""; // textContent لا يُجبر المتصفح على إعادة حساب التصميم
    if (text.length < 60 || text.length > 6000) return;
    seenBlocks.add(el);
    if (filter.isExplicit(text, settings.level)) foldElement(el, "نص غير لائق");
}

/** يعالج شجرة من الصفحة: كل النصوص داخلها. */
export function processTextTree(root) {
    if (!settings?.filterText || !root) return;
    const doc = root.ownerDocument ?? root;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
            const p = n.parentElement;
            if (!p || isEditable(p)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    const blocks = new Set();
    let n;
    while ((n = walker.nextNode())) {
        censorTextNode(n);
        const block = n.parentElement?.closest?.(BLOCK_SELECTOR);
        if (block) blocks.add(block);
    }
    for (const b of blocks) checkBlock(b);
}

/** لمعالجة نص واحد تغيّر (characterData). */
export function processTextNode(node) {
    if (!settings?.filterText) return;
    const p = node.parentElement;
    if (!p || isEditable(p)) return;
    censorTextNode(node);
    checkBlock(p.closest?.(BLOCK_SELECTOR));
}

/** إخفاء الحسابات التي أخفاها المستخدم: يطوي المنشورات والتعليقات التي تحمل اسمها. */
export function applyHiddenAccounts(root, hostname) {
    const list = (settings?.hiddenAccounts ?? []).filter((a) => hostname.endsWith(a.site));
    if (!list.length) return;
    const handles = list.map((a) => a.handle.toLowerCase().replace(/^@/, ""));
    for (const a of root.querySelectorAll?.("a[href]") ?? []) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/^\/@?([A-Za-z0-9_.]+)\/?$/);
        if (m && handles.includes(m[1].toLowerCase())) {
            const post = a.closest("article, [role='article'], li, [data-e2e*='comment'], div[class*='Comment']");
            if (post) foldElement(post, "حساب مخفي");
        }
    }
}

export const _textFilter = filter;
