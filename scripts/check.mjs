#!/usr/bin/env node
/* npm run check   validate data/library.json and data/repos.json
   npm run links   also request every listed path from the live site

   node scripts/check.mjs --live --base=http://localhost:5288   another host */

import { readFile } from "node:fs/promises";
import { validateLibrary, validateRepos } from "./validate.mjs";

const args = process.argv.slice(2);
const live = args.includes("--live");
const baseArg = args.find((a) => a.startsWith("--base="));
const base = (baseArg ? baseArg.slice("--base=".length) : "https://datarail.org").replace(/\/$/, "");

const root = new URL("../", import.meta.url);
let failed = false;

async function read(name) {
  try {
    return JSON.parse(await readFile(new URL(name, root), "utf8"));
  } catch (err) {
    console.error(`  ERROR ${name}: ${err.message}`);
    process.exit(1);
  }
}

function report(label, { errors, warnings }) {
  for (const w of warnings) console.warn(`  warn  ${label}: ${w}`);
  for (const e of errors) console.error(`  ERROR ${label}: ${e}`);
  if (errors.length) failed = true;
}

const library = await read("data/library.json");
const repos = await read("data/repos.json");

const lib = validateLibrary(library);
report("library.json", lib);
report("repos.json", validateRepos(repos, lib.paths));

const entryCount = Array.isArray(library.entries) ? library.entries.length : 0;
const repoCount = Array.isArray(repos.repos) ? repos.repos.length : 0;
console.log(`  ${entryCount} entries, ${repoCount} repositories`);

if (live && !failed) {
  const targets = new Set();
  for (const entry of library.entries) {
    targets.add(entry.path.split("#")[0]);
    for (const sub of entry.sub || []) targets.add(sub.path.split("#")[0]);
  }

  const results = await Promise.all(
    [...targets].map(async (path) => {
      try {
        const response = await fetch(base + path, { redirect: "follow" });
        return [path, response.status];
      } catch (err) {
        return [path, `unreachable (${err.cause?.code || err.message})`];
      }
    })
  );

  const broken = results.filter(([, status]) => status !== 200);
  for (const [path, status] of broken) console.error(`  BROKEN ${base}${path} -> ${status}`);
  console.log(`  checked ${results.length} paths on ${base}: ${broken.length} broken`);
  if (broken.length) failed = true;
}

/* exitCode, not process.exit(). After --live has made requests, exiting while
   fetch's sockets are still closing trips a libuv assertion on Windows: the
   process dies with 127 and the report above is buried under the crash. */
process.exitCode = failed ? 1 : 0;
