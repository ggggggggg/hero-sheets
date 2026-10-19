// Test helper: read {tables, requests} JSON on stdin, print results as JSON.
const core = require("./core.js");
let buf = "";
process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", () => {
  const { tables, requests } = JSON.parse(buf);
  const out = requests.map((r) => {
    try {
      const ch = core.buildCharacter(tables, r);
      return { ok: true, character: ch, html: core.sheetHtml(ch) };
    } catch (err) {
      if (err instanceof core.CharError) return { ok: false, kind: err.kind, msg: err.message };
      return { ok: false, kind: "crash", msg: String(err && err.stack) };
    }
  });
  process.stdout.write(JSON.stringify(out));
});
