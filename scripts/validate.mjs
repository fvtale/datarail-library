/* Validation for data/library.json and data/repos.json, shared by
   `npm run check` and the build, so nothing that fails a check can publish.

   Returns every problem found instead of throwing on the first, so one run
   reports them all rather than one per attempt. */

const RESERVED_GROUPS = new Set(["all", "github"]);
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const isText = (v) => typeof v === "string" && v.trim() !== "";

export function validateLibrary(lib) {
  const errors = [];
  const warnings = [];
  const paths = new Set();

  if (!lib || typeof lib !== "object") {
    return { errors: ["the file is not a JSON object"], warnings, paths };
  }

  const groups = Array.isArray(lib.groups) ? lib.groups : [];
  const entries = Array.isArray(lib.entries) ? lib.entries : [];
  if (!Array.isArray(lib.groups)) errors.push("groups must be an array");
  if (!Array.isArray(lib.entries)) errors.push("entries must be an array");

  const ids = new Set();
  groups.forEach((group, i) => {
    const at = `groups[${i}]`;
    if (!group || typeof group.id !== "string" || !SLUG.test(group.id)) {
      errors.push(`${at}: id must be a lowercase slug`);
    } else if (RESERVED_GROUPS.has(group.id)) {
      errors.push(`${at}: the id "${group.id}" is reserved`);
    } else if (ids.has(group.id)) {
      errors.push(`${at}: duplicate id "${group.id}"`);
    } else {
      ids.add(group.id);
    }
    if (!group || !isText(group.name)) errors.push(`${at}: name is required`);
  });

  entries.forEach((entry, i) => {
    const at = `entries[${i}]${entry && entry.title ? ` "${entry.title}"` : ""}`;
    if (!entry || typeof entry !== "object") {
      errors.push(`${at}: not an object`);
      return;
    }

    if (!isText(entry.title)) errors.push(`${at}: title is required`);

    if (typeof entry.path !== "string" || !entry.path.startsWith("/")) {
      errors.push(`${at}: path must start with /`);
    } else if (paths.has(entry.path)) {
      errors.push(`${at}: duplicate path ${entry.path}`);
    } else {
      paths.add(entry.path);
    }

    if (!ids.has(entry.group)) errors.push(`${at}: unknown group ${JSON.stringify(entry.group)}`);

    if (entry.desc !== undefined && typeof entry.desc !== "string") {
      errors.push(`${at}: desc must be a string`);
    } else if (entry.desc && entry.desc.length > 240) {
      warnings.push(`${at}: desc is ${entry.desc.length} characters; one sentence reads better`);
    }

    if (entry.tag !== undefined) {
      if (!entry.tag || !isText(entry.tag.text)) errors.push(`${at}: tag.text is required when tag is set`);
      if (entry.tag && entry.tag.kind !== undefined && !["live", "warn"].includes(entry.tag.kind)) {
        errors.push(`${at}: tag.kind must be "live", "warn" or left out`);
      }
    }

    if (entry.sub !== undefined) {
      if (!Array.isArray(entry.sub)) {
        errors.push(`${at}: sub must be an array`);
      } else {
        entry.sub.forEach((sub, j) => {
          if (!sub || !isText(sub.label)) errors.push(`${at} sub[${j}]: label is required`);
          if (!sub || typeof sub.path !== "string" || !sub.path.startsWith("/")) {
            errors.push(`${at} sub[${j}]: path must start with /`);
          }
        });
      }
    }

    if (entry.pages !== undefined && !(Number.isInteger(entry.pages) && entry.pages > 0)) {
      errors.push(`${at}: pages must be a positive whole number`);
    }
    if (entry.keywords !== undefined && typeof entry.keywords !== "string") {
      errors.push(`${at}: keywords must be a string`);
    }
  });

  return { errors, warnings, paths };
}

export function validateRepos(file, libraryPaths = new Set()) {
  const errors = [];
  const warnings = [];

  if (!file || !Array.isArray(file.repos)) {
    return { errors: ["the file must have a repos array"], warnings };
  }

  const seen = new Set();
  const attached = new Map();

  file.repos.forEach((item, i) => {
    const at = `repos[${i}]${item && item.repo ? ` ${item.repo}` : ""}`;
    if (!item || typeof item.repo !== "string" || !REPO.test(item.repo)) {
      errors.push(`${at}: repo must be "owner/name"`);
      return;
    }

    const key = item.repo.toLowerCase();
    if (seen.has(key)) errors.push(`${at}: listed twice`);
    seen.add(key);

    if (item.entry !== undefined) {
      if (typeof item.entry !== "string" || !libraryPaths.has(item.entry)) {
        errors.push(`${at}: entry ${JSON.stringify(item.entry)} is not a path in library.json`);
      } else if (attached.has(item.entry)) {
        errors.push(`${at}: ${item.entry} already shows ${attached.get(item.entry)}; one repository per row`);
      } else {
        attached.set(item.entry, item.repo);
      }
    }

    if (item.label !== undefined && !isText(item.label)) errors.push(`${at}: label must be a non-empty string`);
    if (item.allowPrivate !== undefined && typeof item.allowPrivate !== "boolean") {
      errors.push(`${at}: allowPrivate must be true or false`);
    }
  });

  return { errors, warnings };
}
