import { readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

// Treat the supplied file strictly as data; never execute it or print its values.
const inputPath = process.argv[2];
if (!inputPath) { console.error("Usage: node scripts/import-atlas.mjs <path-to-atlas-credentials.env>"); process.exit(1); }
const values = {};
for (const line of (await readFile(inputPath, "utf8")).split(/\r?\n/)) {
  const match = line.match(/^\s*(?:export\s+)?(MONGODB_URI|MONGODB_USERNAME|MONGODB_PASSWORD|MONGODB_DB)\s*=\s*(.*?)\s*$/);
  if (!match) continue;
  let value = match[2];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  values[match[1]] = value;
}
let uri = values.MONGODB_URI || "";
if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) { console.error("MONGODB_URI is missing or invalid."); process.exit(1); }
for (const [key, tokens] of [
  ["MONGODB_USERNAME", ["<username>", "<db_username>", "${MONGODB_USERNAME}"]],
  ["MONGODB_PASSWORD", ["<password>", "<db_password>", "${MONGODB_PASSWORD}"]]
]) for (const token of tokens) if (uri.includes(token)) {
  if (!values[key]) { console.error(`${key} is required for the connection string template.`); process.exit(1); }
  uri = uri.replaceAll(token, encodeURIComponent(values[key]));
}
if (!uri.split("/")[2]?.includes("@") && values.MONGODB_USERNAME && values.MONGODB_PASSWORD) {
  uri = uri.replace(/^(mongodb(?:\+srv)?:\/\/)/, `$1${encodeURIComponent(values.MONGODB_USERNAME)}:${encodeURIComponent(values.MONGODB_PASSWORD)}@`);
}
if (/[<>\r\n]/.test(uri) || uri.includes("${")) { console.error("The connection string still contains a template or invalid characters."); process.exit(1); }
const destination = path.resolve(".env.local");
let previous = "";
try { previous = await readFile(destination, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const lines = previous.split(/\r?\n/).filter(line => !/^\s*MONGODB_(URI|DB)\s*=/.test(line) && !/^AUTH_SECRET=\s*$/.test(line));
const quote = value => JSON.stringify(value).replaceAll("$", "\\$");
lines.push(`MONGODB_URI=${quote(uri)}`, `MONGODB_DB=${quote(values.MONGODB_DB || "family_budget")}`);
if (!/^AUTH_SECRET=.+/m.test(previous)) lines.push(`AUTH_SECRET=${randomBytes(32).toString("base64url")}`);
if (!/^AUTH_URL=/m.test(previous)) lines.push("AUTH_URL=http://localhost:3000");
if (!/^AUTH_GOOGLE_ID=/m.test(previous)) lines.push("AUTH_GOOGLE_ID=");
if (!/^AUTH_GOOGLE_SECRET=/m.test(previous)) lines.push("AUTH_GOOGLE_SECRET=");
await writeFile(`${destination}.tmp`, `${lines.filter(Boolean).join("\n")}\n`, { mode: 0o600 });
await rename(`${destination}.tmp`, destination);
console.log("Local server environment prepared. Credential values were not printed.");
