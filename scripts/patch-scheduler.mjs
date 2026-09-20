// Patches the `scheduler` work loop so React defers its work while the HTML
// document is still streaming. This prevents the React bug where hydration
// overtakes the HTML parser and fatally throws #418 (args[]=HTML) which wipes
// the server-rendered DOM ("This page couldn't load").
// See https://github.com/react/react/issues/37321 for the verified fix.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "node_modules/scheduler/cjs/scheduler.production.js",
  "node_modules/scheduler/cjs/scheduler.development.js",
  "node_modules/next/dist/compiled/scheduler/cjs/scheduler.production.js",
  "node_modules/next/dist/compiled/scheduler/cjs/scheduler.development.js",
];

const gate = (indent) =>
  `${indent}  if (
${indent}    "undefined" !== typeof document &&
${indent}    null !== document &&
${indent}    ("loading" === document.readyState ||
${indent}      ("undefined" !== typeof window &&
${indent}        null !== window.$RB &&
${indent}        0 < window.$RB.length))
${indent}  ) {
${indent}    isMessageLoopRunning && localSetTimeout(performWorkUntilDeadline, 8);
${indent}    return;
${indent}  }
`;

let patched = 0;
for (const rel of files) {
  const abs = join(root, rel);
  let src;
  try {
    src = readFileSync(abs, "utf8");
  } catch {
    console.log(`skip (missing): ${rel}`);
    continue;
  }
  if (src.includes("window.$RB")) {
    console.log(`skip (already patched): ${rel}`);
    continue;
  }
  const marker = /([\t ]*)function performWorkUntilDeadline\(\)\s*\{/;
  if (!marker.test(src)) {
    console.log(`skip (pattern not found): ${rel}`);
    continue;
  }
  src = src.replace(marker, (m, indent) => m + "\n" + gate(indent));
  writeFileSync(abs, src);
  patched += 1;
  console.log(`patched: ${rel}`);
}
if (patched === 0) process.exit(0);