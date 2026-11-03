// Quick safety check run before a proposal is saved.
// 1. Every inline <script> in the site's HTML pages must parse.
// 2. The model and texture files the viewer loads must still exist.
// Usage: node scripts/check.mjs
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pages = ["site/index.html", "site/viewer/index.html"];
const requiredFiles = [
  "site/viewer/polished-glb.txt",
  "site/viewer/zq630plus-glb.txt",
  "site/viewer/tex-polished.jpg",
  "site/viewer/tex-top_half.jpg",
  "site/viewer/tex-bottom_half.jpg"
];

let failed = false;

for (const page of pages) {
  const path = join(root, page);
  if (!existsSync(path)) {
    console.error("missing page: " + page);
    failed = true;
    continue;
  }
  const html = readFileSync(path, "utf8");
  const pattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match = pattern.exec(html);
  let index = 0;
  while (match) {
    index += 1;
    try {
      new vm.Script(match[1], { filename: page + " (inline script " + index + ")" });
    } catch (err) {
      console.error(page + ", inline script " + index + ": " + err.message);
      failed = true;
    }
    match = pattern.exec(html);
  }
  console.log("checked " + page + " (" + index + " inline scripts)");
}

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) {
    console.error("missing data file: " + file);
    failed = true;
  }
}

if (failed) {
  console.error("CHECK FAILED");
  process.exit(1);
}
console.log("CHECK PASSED");
