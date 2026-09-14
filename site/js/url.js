/* The current filter lives in the address bar, so a filtered view survives
   being copied and shared: /library/?group=projects&q=flipper */

export function readUrl(groups) {
  const params = new URLSearchParams(location.search);
  const query = (params.get("q") || "").trim();
  const wanted = params.get("group");

  /* Only honour a group that exists. A stale or mistyped link would otherwise
     set a filter that no chip matches and render an empty library. */
  const group = wanted && groups.some((g) => g.id === wanted) ? wanted : "all";

  return { query, group };
}

export function writeUrl(state) {
  if (!window.history || !history.replaceState) return;
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.group !== "all") params.set("group", state.group);
  const qs = params.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}
