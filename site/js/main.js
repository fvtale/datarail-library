/* ==========================================================================
   The Library - entry point.

   Loads the model, builds the filter chips, wires search and the keyboard,
   and renders. Each concern lives in its own module beside this one, so a new
   feature is a new module imported here rather than more lines in one script.
   ========================================================================== */

import { el } from "./dom.js";
import { loadModel } from "./data.js";
import { render } from "./render.js";
import { readUrl, writeUrl } from "./url.js";

/* First, before anything can fail: tells the inline check in index.html that
   the modules loaded, so it does not reveal the plain fallback list. */
document.documentElement.setAttribute("data-library-booted", "1");

const $ = (id) => document.getElementById(id);
const ui = {
  groups: $("libGroups"),
  chips: $("libChips"),
  search: $("libSearch"),
  count: $("libCount"),
  status: $("libStatus"),
  empty: $("libEmpty"),
  clear: $("libClear"),
  shell: $("libShell"),
  toolbar: $("libToolbar"),
  error: $("libError"),
  fallback: $("libFallback")
};

/* Written outside #libShell on purpose. The shell stays hidden until the data
   has loaded, so an error rendered inside it would never be seen. The plain
   list is revealed as well: the pages are all still reachable. */
function fail(message) {
  const box = el("div", "lib-error");
  box.appendChild(el("p", null, message));
  const back = el("a", "btn", "Back to datarail.org");
  back.href = "/";
  box.appendChild(back);
  ui.error.textContent = "";
  ui.error.appendChild(box);
  if (ui.fallback) ui.fallback.hidden = false;
}

function start(model) {
  const state = readUrl(model.groups);
  ui.search.value = state.query;
  const total = model.entries.length;

  const chips = [{ id: "all", name: "Everything" }, ...model.groups].map((group) => {
    const chip = el("button", "chip", group.name);
    chip.type = "button";
    chip.dataset.group = group.id;
    chip.addEventListener("click", () => {
      state.group = group.id;
      update();
    });
    ui.chips.appendChild(chip);
    return chip;
  });

  function update() {
    const { shown, pages } = render(ui.groups, model, state);
    const unfiltered = state.group === "all" && !state.query;

    ui.empty.hidden = shown > 0;
    ui.clear.hidden = unfiltered;
    ui.count.textContent = unfiltered
      ? `${shown} entries · ${pages} pages`
      : `${shown} of ${total} entries`;

    /* Announced rather than only shown, so a screen reader hears the list
       change as it is typed instead of it silently re-rendering underneath. */
    ui.status.textContent = shown
      ? `${shown} ${shown === 1 ? "entry" : "entries"} shown`
      : `Nothing matches ${state.query}`;

    for (const chip of chips) {
      chip.setAttribute("aria-pressed", String(chip.dataset.group === state.group));
    }
    writeUrl(state);
  }

  ui.search.addEventListener("input", () => {
    state.query = ui.search.value.trim();
    update();
  });

  ui.clear.addEventListener("click", () => {
    state.query = "";
    state.group = "all";
    ui.search.value = "";
    update();
    ui.search.focus();
  });

  document.addEventListener("keydown", (event) => {
    const active = document.activeElement;
    const typing = active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
    const modified = event.ctrlKey || event.metaKey || event.altKey;

    if (event.key === "/" && !typing && !modified) {
      event.preventDefault();
      ui.search.focus();
      ui.search.select();
    }
    if (event.key === "Escape" && active === ui.search && ui.search.value) {
      state.query = "";
      ui.search.value = "";
      update();
    }
  });

  update();
  ui.shell.hidden = false;
  ui.toolbar.hidden = false;
}

loadModel()
  .then((model) => {
    if (!model.entries.length) {
      fail("The library loaded but has no entries in it.");
      return;
    }
    start(model);
  })
  .catch((err) => {
    console.error("Library:", err);
    fail("The library index could not be loaded. Everything else on the site is unaffected.");
  });
