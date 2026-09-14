/* Matching and counting. */

/* How many datarail.org pages an entry stands for: 1 plus its sub-links,
   unless the entry declares otherwise. A repository on GitHub is not a page
   of this site, so it counts as an entry but not as a page. */
export function pageCount(entry) {
  if (entry.external) return 0;
  if (typeof entry.pages === "number" && entry.pages > 0) return entry.pages;
  return 1 + (entry.sub ? entry.sub.length : 0);
}

function haystack(entry) {
  const bits = [entry.title, entry.desc, entry.path, entry.keywords];
  if (entry.tag && entry.tag.text) bits.push(entry.tag.text);
  for (const sub of entry.sub || []) bits.push(sub.label, sub.path);
  if (entry.repo) bits.push(entry.repo.repo, entry.repo.language, entry.repo.description);
  return bits.filter(Boolean).join(" ").toLowerCase();
}

export function matches(entry, state) {
  if (state.group !== "all" && entry.group !== state.group) return false;
  if (!state.query) return true;
  return haystack(entry).includes(state.query.toLowerCase());
}
