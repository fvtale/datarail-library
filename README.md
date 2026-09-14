# DataRail Library

The index behind [datarail.org/library](https://datarail.org/library/): the pages on the site worth
finding, searchable and filterable, with a live snapshot of the GitHub projects behind them.

It lives in its own repository so it can grow features without being tangled into the rest of the site.

## How it fits together

```
data/library.json ─┐
data/repos.json  ──┼─ scripts/build.mjs ──> dist/ ── publish.yml ──> datarail-site/public/library ── deploy.yml ──> datarail.org/library
site/            ──┘   (reads GitHub)                (deploy key)                                     (SFTP)
```

- **`data/library.json`** — the entries. The only file to edit to change what the library lists.
- **`data/repos.json`** — the GitHub repositories to show. Hand-picked: nothing appears unless listed.
- **`site/`** — the page: `index.html` plus one ES module per concern in `site/js/`. No framework, no dependencies, no bundler.
- **`scripts/`** — `build.mjs` assembles `dist/`, `check.mjs` validates the data and can check live links, `serve.mjs` previews locally.

`dist/` is never committed. It can hold details read from private repositories, and this repository is public.

This repository never talks to the web server. CI copies the build into
[datarail-site](https://github.com/fvtale/datarail-site), and that repository's existing deploy ships it.

## Working on it

Needs Node 20 or newer. There is nothing to install.

```bash
npm run serve    # build without network, then preview at http://localhost:5288/library/
npm run check    # validate data/library.json and data/repos.json
npm run links    # also request every listed path from datarail.org
npm run build    # full build, including GitHub details
```

The preview mounts the page at `/library/` exactly as production does, fetches `/assets/*` (the circuit
rails) from datarail.org, and sends every other link to the live site.

### Modules

| File | Does |
|---|---|
| `site/js/main.js` | Entry point: loads the data, builds the filter chips, wires search and the keyboard |
| `site/js/data.js` | Fetches `library.json` and the GitHub snapshot and joins them into one model |
| `site/js/render.js` | Turns the model into groups and rows |
| `site/js/search.js` | Matching and page counts |
| `site/js/repos.js` | GitHub details on a row: language, stars, last push, CI status |
| `site/js/url.js` | Keeps the current filter in the address bar so a view can be shared |
| `site/js/dom.js` | Element and highlighting helpers. Nothing on the page uses `innerHTML` |

A new feature is a new module imported from `main.js`.

If the modules fail to load, or JavaScript is off, the page falls back to a plain list of every entry. That
list is generated at build time from `library.json`, so it cannot drift from the real one.

## Adding an entry

Add an object to `entries` in `data/library.json`. The shape and the rules are in that file's `_howto`
block. Counts on the page are derived, so never type one. `npm run check` catches a group that does not
exist, a duplicate path or a malformed tag before anything publishes.

## Showing a GitHub repository

Add it to `data/repos.json`:

```json
{ "repo": "fvtale/DocShift", "entry": "/docshift/" }
```

With `entry`, the details appear on that library row. Without it, the repository gets a row of its own in
an **On GitHub** section. The browser never calls GitHub: the build reads it and publishes a snapshot,
refreshed daily.

**Private repositories are refused** unless the item also sets `"allowPrivate": true`, because listing one
publishes its name, language, last push and CI status on a public page. Reading one also needs a
`LIBRARY_READ_TOKEN` secret — a fine-grained token with read-only Metadata, Contents and Actions access to
that repository — since the workflow's own token cannot see outside this one. Links to a private repository
are never shown, because they would 404 for visitors.

If any listed repository cannot be read, the build fails and nothing is published.

## Publishing: one-time setup

Publishing is off until two things exist. Every run still builds in the meantime, so problems surface in CI
first.

Run this in **Git Bash**. In PowerShell, `-N ""` is swallowed and ssh-keygen fails with
*option requires an argument -- N*.

```bash
ssh-keygen -t ed25519 -N "" -C "datarail-library publish" -f datarail-library-deploy
gh repo deploy-key add datarail-library-deploy.pub --repo fvtale/datarail-site --allow-write --title "datarail-library (pushes public/library)"
gh secret set DATARAIL_SITE_DEPLOY_KEY --repo fvtale/datarail-library < datarail-library-deploy
gh variable set PUBLISH_TO_SITE --repo fvtale/datarail-library --body true
rm datarail-library-deploy datarail-library-deploy.pub
```

Then run **Publish to datarail.org** from the Actions tab.

From then on, `datarail-site/public/library` belongs to this repository. Anything edited there directly is
overwritten on the next publish.
