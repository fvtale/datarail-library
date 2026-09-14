/* DOM helpers shared by every module.

   Nothing in the page uses innerHTML. Entries are site-authored rather than
   user-authored, so this is belt-and-braces rather than a live risk, but a
   list that grows by hand-editing JSON is exactly where an ampersand
   eventually turns up in a title. */

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/* Wraps every occurrence of the query in <mark>, built from text nodes. */
export function marked(text, query) {
  const frag = document.createDocumentFragment();
  const value = String(text == null ? "" : text);
  if (!query) {
    frag.appendChild(document.createTextNode(value));
    return frag;
  }

  const hay = value.toLowerCase();
  const needle = query.toLowerCase();
  let from = 0;

  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) {
      frag.appendChild(document.createTextNode(value.slice(from)));
      break;
    }
    if (at > from) frag.appendChild(document.createTextNode(value.slice(from, at)));
    frag.appendChild(el("mark", null, value.slice(at, at + needle.length)));
    from = at + needle.length;
  }
  return frag;
}

/* Opens off-site. noopener so the new tab cannot reach back into this one. */
export function external(link) {
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}
