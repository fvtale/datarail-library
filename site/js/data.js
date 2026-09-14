/* Loading, and joining the two data files into one model.

   library.json is required. repos.generated.json is the GitHub snapshot CI
   takes at build time; it is optional, and a missing or broken one only means
   there are no GitHub details to show - never that the library fails.

   Both paths are relative, so they resolve beside the page wherever it is
   mounted: /library/ in production, the same under the local preview. */

export const GITHUB_GROUP = {
  id: "github",
  name: "On GitHub",
  note: "Repositories behind the work, with a snapshot of their latest activity."
};

async function getJson(url, { optional = false } = {}) {
  const response = await fetch(url, { cache: "no-store" });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

export async function loadModel() {
  const [library, snapshot] = await Promise.all([
    getJson("library.json"),
    getJson("repos.generated.json", { optional: true }).catch((err) => {
      console.warn("Library: GitHub snapshot unavailable", err);
      return null;
    })
  ]);

  const groups = Array.isArray(library.groups) ? library.groups.slice() : [];
  const known = new Set(groups.map((g) => g.id));

  const entries = (Array.isArray(library.entries) ? library.entries : []).filter((entry) => {
    if (!entry || !entry.title || !entry.path) return false;
    /* An entry pointing at a group that does not exist is dropped rather than
       dumped into a catch-all, so a typo shows up as a missing row. CI catches
       it before publish; this is the backstop. */
    if (!known.has(entry.group)) {
      console.warn(`Library: unknown group ${JSON.stringify(entry.group)} on ${entry.path}`);
      return false;
    }
    return true;
  });

  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const loose = [];

  for (const repo of (snapshot && Array.isArray(snapshot.repos)) ? snapshot.repos : []) {
    const host = repo.entry && byPath.get(repo.entry);
    if (host) host.repo = repo;
    else loose.push(repo);
  }

  /* Repositories not attached to a row become rows of their own, in a group
     of their own, so search, filters and counts treat them like anything else. */
  if (loose.length) {
    groups.push(GITHUB_GROUP);
    for (const repo of loose) {
      entries.push({
        title: repo.label,
        path: repo.url,
        group: GITHUB_GROUP.id,
        desc: repo.description,
        external: true,
        repo
      });
    }
  }

  return { groups, entries };
}
