#!/usr/bin/env node
/* Builds dist/, the folder published into datarail-site/public/library.

     node scripts/build.mjs                  full build, reads GitHub
     node scripts/build.mjs --offline        no network, no GitHub details
     node scripts/build.mjs --repos=FILE     another repos file, for testing

   dist/ is never committed. It can hold details read from private
   repositories, and this repository is public.

   Every failure happens before dist/ is touched, so a refused build leaves the
   previous output exactly as it was. */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateLibrary, validateRepos } from "./validate.mjs";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
const args = process.argv.slice(2);
const offline = args.includes("--offline");
const reposArg = args.find((a) => a.startsWith("--repos="));

const PAGE_LIST = "<!-- @page-list -->";
const BUILD_MARK = "<!-- @build -->";

class BuildError extends Error {}
function fail(message) {
  throw new BuildError(message);
}

async function readJson(url) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (err) {
    fail(`${fileURLToPath(url)}: ${err.message}`);
  }
}

/* ---------- GitHub ---------- */

/* LIBRARY_READ_TOKEN wins when it is set: it is the only one that can see a
   private repository. The workflow's own GITHUB_TOKEN is enough for public
   ones and lifts the anonymous limit of 60 requests an hour. */
const token = process.env.LIBRARY_READ_TOKEN || process.env.GITHUB_TOKEN || "";

async function gh(path, { allow404 = false } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "datarail-library-build",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    const limited = response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
    throw new Error(`${path}: HTTP ${response.status}${limited ? " (rate limited; set GITHUB_TOKEN)" : ""}`);
  }
  return response.json();
}

async function snapshot(item) {
  const info = await gh(`/repos/${item.repo}`, { allow404: true });
  if (!info) {
    throw new Error(`${item.repo}: not found. Check the name, or if it is private, that LIBRARY_READ_TOKEN can read it.`);
  }
  if (info.private && item.allowPrivate !== true) {
    throw new Error(`${item.repo}: private. Set "allowPrivate": true on it in data/repos.json to publish its details, or remove it.`);
  }

  const [runs, release] = await Promise.all([
    gh(`/repos/${item.repo}/actions/runs?branch=${encodeURIComponent(info.default_branch)}&per_page=1&exclude_pull_requests=true`, { allow404: true }),
    gh(`/repos/${item.repo}/releases/latest`, { allow404: true })
  ]);
  const run = runs && Array.isArray(runs.workflow_runs) ? runs.workflow_runs[0] : null;

  return {
    repo: info.full_name,
    label: item.label || info.name,
    entry: item.entry || null,
    url: info.html_url,
    description: info.description || "",
    language: info.language || "",
    stars: info.stargazers_count || 0,
    pushedAt: info.pushed_at || null,
    archived: Boolean(info.archived),
    private: Boolean(info.private),
    release: release
      ? { tag: release.tag_name, url: release.html_url, publishedAt: release.published_at }
      : null,
    ci: run
      ? { name: run.name, status: run.status, conclusion: run.conclusion, url: run.html_url, updatedAt: run.updated_at }
      : null
  };
}

/* ---------- build ---------- */

async function main() {
  const library = await readJson(new URL("data/library.json", root));
  const reposUrl = reposArg
    ? pathToFileURL(resolve(reposArg.slice("--repos=".length)))
    : new URL("data/repos.json", root);
  const reposFile = await readJson(reposUrl);

  const lib = validateLibrary(library);
  const rep = validateRepos(reposFile, lib.paths);
  const problems = [
    ...lib.errors.map((e) => `library.json: ${e}`),
    ...rep.errors.map((e) => `repos.json: ${e}`)
  ];
  if (problems.length) fail(`\n  ${problems.join("\n  ")}`);

  const repos = [];
  if (!offline && reposFile.repos.length) {
    const results = await Promise.allSettled(reposFile.repos.map(snapshot));
    const failures = results.filter((r) => r.status === "rejected").map((r) => r.reason.message);
    /* All or nothing. Publishing with a row quietly missing is worse than not
       publishing: the live page stays as it was until this is fixed. */
    if (failures.length) {
      fail(`could not read every listed repository, so nothing was built:\n  ${failures.join("\n  ")}`);
    }
    for (const r of results) repos.push(r.value);
  }

  const site = await readFile(new URL("site/index.html", root), "utf8");
  if (!site.includes(PAGE_LIST)) fail(`site/index.html has lost its ${PAGE_LIST} marker`);
  if (!site.includes(BUILD_MARK)) fail(`site/index.html has lost its ${BUILD_MARK} marker`);

  /* ----- nothing above this line writes anything ----- */

  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await cp(new URL("site/", root), dist, { recursive: true });

  /* The page never reads _howto, so it is not shipped. */
  const { _howto, ...published } = library;
  await writeFile(new URL("library.json", dist), JSON.stringify(published));

  /* No timestamp in here, deliberately. A scheduled run that finds nothing new
     has to build byte-identical files, or it would commit to datarail-site, and
     set off a deploy, every single day for no change at all. */
  await writeFile(new URL("repos.generated.json", dist), JSON.stringify({ repos }));

  /* The grantable-apps whitelist, published beside the index so the storage
     admin console can offer a list to pick from instead of a free-text box.
     A free-text box means a typo grants an id nothing recognises, and nothing
     anywhere reports it. Same no-timestamp rule as above: an unchanged
     whitelist has to build byte-identical or the daily run commits for
     nothing. */
  const apps = library.entries
    .filter((entry) => typeof entry.app === "string")
    .map((entry) => ({
      app: entry.app,
      title: entry.title,
      path: entry.path,
      group: entry.group,
      ...(entry.member ? { member: entry.member } : {})
    }));
  await writeFile(new URL("apps.json", dist), JSON.stringify({ apps }));

  /* The plain page list for the no-JavaScript and failed-to-load fallbacks,
     generated from the same data as the page so it cannot drift from it. */
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const listItems = library.entries
    .map((e) => `<li><a href="${esc(e.path)}">${esc(e.title)}</a></li>`)
    .join("\n          ");

  let commit = process.env.GITHUB_SHA || "";
  if (!commit) {
    try {
      commit = execSync("git rev-parse HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      commit = "";
    }
  }

  const html = site
    .split(PAGE_LIST).join(listItems)
    .replace(BUILD_MARK, commit ? `<!-- built from github.com/fvtale/datarail-library@${commit.slice(0, 12)} -->` : "");
  await writeFile(new URL("index.html", dist), html);

  console.log(`built dist/: ${library.entries.length} entries, ${repos.length} repositories${offline ? " (offline)" : ""}`);
}

main().catch((err) => {
  console.error(`build failed: ${err instanceof BuildError ? err.message : err.stack || err}`);
  /* exitCode, not process.exit(). Exiting while fetch's sockets are still
     closing trips a libuv assertion on Windows: the process dies with 127
     and the reason printed above is buried under the crash. */
  process.exitCode = 1;
});
