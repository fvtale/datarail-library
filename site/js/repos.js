/* GitHub details on a row.

   Everything here comes from the snapshot CI took at build time. The one
   thing computed in the browser is "how long ago", so "pushed 3 days ago"
   stays true even when the snapshot itself is a day old. */

import { el, external } from "./dom.js";

const UNITS = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60]
];

export function ago(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (!then) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  for (const [name, size] of UNITS) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

/* Says something only when it is unambiguous. A cancelled or skipped run
   tells a visitor nothing about whether the project works, so it shows
   nothing rather than a guess. */
function ciBadge(ci) {
  if (!ci) return null;
  if (ci.status && ci.status !== "completed") return { cls: "run", text: "CI running" };
  if (ci.conclusion === "success") return { cls: "pass", text: "CI passing" };
  if (["failure", "timed_out", "startup_failure"].includes(ci.conclusion)) {
    return { cls: "fail", text: "CI failing" };
  }
  return null;
}

/* The facts line. Plain text only: it sits inside the row's own <a>, and a
   link nested in there is invalid HTML that browsers pull apart. */
export function repoFacts(repo, { showName = true } = {}) {
  const line = el("span", "repo");
  if (showName) line.appendChild(el("span", "gh", repo.repo));
  if (repo.language) line.appendChild(el("span", "lang", repo.language));
  if (repo.stars > 0) line.appendChild(el("span", null, `★ ${repo.stars}`));
  if (repo.pushedAt) line.appendChild(el("span", null, `pushed ${ago(repo.pushedAt)}`));
  if (repo.private) line.appendChild(el("span", "badge", "Private"));
  if (repo.archived) line.appendChild(el("span", "badge", "Archived"));
  const badge = ciBadge(repo.ci);
  if (badge) line.appendChild(el("span", `badge ${badge.cls}`, badge.text));
  return line;
}

/* The links, which live beside the row rather than inside it. A private
   repository gets none: every one of them would 404 for a visitor. */
export function repoLinks(repo, { includeRepo = true } = {}) {
  if (repo.private) return [];
  const links = [];
  if (includeRepo && repo.url) links.push(pill("GitHub ↗", repo.url));
  if (repo.release && repo.release.url) links.push(pill(`${repo.release.tag} ↗`, repo.release.url));
  if (repo.ci && repo.ci.url) links.push(pill("Latest run ↗", repo.ci.url));
  return links;
}

function pill(text, href) {
  const link = el("a", null, text);
  link.href = href;
  return external(link);
}
