/* Turns the model into groups and rows. */

import { el, marked, external } from "./dom.js";
import { matches, pageCount } from "./search.js";
import { repoFacts, repoLinks } from "./repos.js";

function row(entry, query) {
  const link = el("a", "entry");
  link.href = entry.path;
  if (entry.external) external(link);

  const title = el("span", "entry-title");
  title.appendChild(marked(entry.title, query));
  if (entry.tag && entry.tag.text) {
    const kind = entry.tag.kind === "live" || entry.tag.kind === "warn" ? ` ${entry.tag.kind}` : "";
    title.appendChild(el("span", `tag${kind}`, entry.tag.text));
  }
  link.appendChild(title);

  const path = el("span", "entry-path");
  path.appendChild(marked(entry.external ? entry.path.replace(/^https?:\/\//, "") : entry.path, query));
  link.appendChild(path);

  if (entry.desc) {
    const desc = el("p", "entry-desc");
    desc.appendChild(marked(entry.desc, query));
    link.appendChild(desc);
  }

  /* A standalone repository row already shows its github.com path, so the
     facts line would only repeat the name. */
  if (entry.repo) link.appendChild(repoFacts(entry.repo, { showName: !entry.external }));

  return link;
}

/* Sub-pages and GitHub links. Kept outside the row's anchor on purpose:
   nesting <a> inside <a> is invalid, and browsers unnest it, which breaks
   both links. */
function extras(entry) {
  const links = [];
  for (const sub of entry.sub || []) {
    const link = el("a", null, sub.label);
    link.href = sub.path;
    links.push(link);
  }
  if (entry.repo) links.push(...repoLinks(entry.repo, { includeRepo: !entry.external }));
  if (!links.length) return null;

  const wrap = el("div", "sublinks");
  for (const link of links) wrap.appendChild(link);
  return wrap;
}

export function render(root, model, state) {
  root.textContent = "";
  let shown = 0;
  let pages = 0;

  for (const group of model.groups) {
    const hits = model.entries.filter((entry) => entry.group === group.id && matches(entry, state));
    if (!hits.length) continue;

    const section = el("section", "lib-group");
    const head = el("div", "sec-head");
    head.appendChild(el("h2", null, group.name));
    head.appendChild(el("span", "n", `${hits.length} ${hits.length === 1 ? "entry" : "entries"}`));
    section.appendChild(head);
    if (group.note) section.appendChild(el("p", "sec-note", group.note));

    const list = el("div", "entries");
    for (const entry of hits) {
      const wrap = el("div", "entry-wrap");
      wrap.appendChild(row(entry, state.query));
      const more = extras(entry);
      if (more) wrap.appendChild(more);
      list.appendChild(wrap);
      shown += 1;
      pages += pageCount(entry);
    }
    section.appendChild(list);
    root.appendChild(section);
  }

  return { shown, pages };
}
