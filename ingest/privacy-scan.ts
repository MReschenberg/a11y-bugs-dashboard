/**
 * Pre-deploy privacy gate (R15/R16). Scans everything under public/data/ and FAILS
 * (exit 1) if any published artifact contains bug-level or personal data — defense in
 * depth so a future code change can't silently start leaking. The published output is
 * supposed to be aggregate-only: counts/stats, query-LINK provenance, no IDs/emails.
 *
 * RUN: npx -y tsx ingest/privacy-scan.ts   (also wired into the deploy workflow)
 */
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");

// Keys that would indicate bug-level / personal data leaked into an aggregate file.
const FORBIDDEN_KEYS = new Set([
  "id", "bug_id", "bugs", "ids", "summary", "creator", "creator_detail",
  "assigned_to", "assigned_to_detail", "reporter", "email", "dupe_of",
  "cf_last_resolved", "last_change_time", "groups", "whiteboard", "comments",
  "webaimcontractor",
]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const BUG_URL_RE = /show_bug\.cgi\?id=\d+/i; // a specific bug page (buglist.cgi query bases are fine)

interface Violation { file: string; path: string; reason: string }

function looksLikeIdArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" && Number.isInteger(x) && x > 10_000);
}

function walk(value: unknown, path: string, file: string, out: Violation[]): void {
  if (value === null) return;
  if (typeof value === "string") {
    if (EMAIL_RE.test(value)) out.push({ file, path, reason: `string contains an email-like value: "${value.slice(0, 60)}"` });
    if (BUG_URL_RE.test(value)) out.push({ file, path, reason: `string contains a specific bug URL: "${value.slice(0, 80)}"` });
    return;
  }
  if (Array.isArray(value)) {
    if (looksLikeIdArray(value)) out.push({ file, path, reason: `array looks like a list of bug IDs (${value.length} large integers)` });
    value.forEach((item, i) => walk(item, `${path}[${i}]`, file, out));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) {
        out.push({ file, path: `${path}.${k}`, reason: `forbidden key "${k}" (bug-level / personal field)` });
      }
      walk(v, `${path}.${k}`, file, out);
    }
  }
}

async function jsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await jsonFiles(full)));
    else if (e.name.endsWith(".json")) files.push(full);
  }
  return files;
}

async function main(): Promise<void> {
  const files = await jsonFiles(DATA);
  if (files.length === 0) {
    console.error("Privacy scan: no JSON found in public/data — run `npm run ingest` first.");
    process.exit(1);
  }
  const violations: Violation[] = [];
  for (const f of files) {
    const rel = f.slice(f.indexOf("public/data"));
    walk(JSON.parse(await readFile(f, "utf8")), "$", rel, violations);
  }
  if (violations.length > 0) {
    console.error(`✗ Privacy scan FAILED — ${violations.length} potential leak(s):`);
    for (const v of violations) console.error(`  ${v.file} ${v.path}: ${v.reason}`);
    process.exit(1);
  }
  console.log(`✓ Privacy scan passed — ${files.length} file(s), aggregate-only, no bug IDs / emails / personal fields.`);
}

main().catch((e) => { console.error("Privacy scan errored:", e); process.exit(1); });
