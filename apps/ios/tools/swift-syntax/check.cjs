const Parser = require("web-tree-sitter");
const fs = require("fs");
(async () => {
  await Parser.init();
  const lang = await Parser.Language.load(require.resolve("tree-sitter-wasms/out/tree-sitter-swift.wasm"));
  const p = new Parser(); p.setLanguage(lang);
  let bad = 0;
  for (const f of process.argv.slice(2)) {
    const t = p.parse(fs.readFileSync(f, "utf8"));
    const errs = [];
    const walk = (n) => { if (n.type === "ERROR" || n.isMissing) errs.push(`${n.startPosition.row + 1}:${n.startPosition.column + 1} ${n.isMissing ? "missing " + n.type : "error"} «${n.text.slice(0, 60).replace(/\n/g, " ")}»`); for (const c of n.children) walk(c); };
    walk(t.rootNode);
    console.log((errs.length ? "✗ " : "✓ ") + f.split("/apps/ios/")[1] + (errs.length ? "\n   " + errs.slice(0, 5).join("\n   ") : ""));
    bad += errs.length;
  }
  process.exit(bad ? 1 : 0);
})();
