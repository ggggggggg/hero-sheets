// Test helper: {tables, custom} on stdin -> merged tables (or the error) as JSON.
const cc = require("./custom.js");
let buf = "";
process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", () => {
  const { tables, custom } = JSON.parse(buf);
  try { process.stdout.write(JSON.stringify({ ok: true, tables: cc.mergeCustom(tables, custom) })); }
  catch (e) { process.stdout.write(JSON.stringify({ ok: false, msg: String(e.message) })); }
});
