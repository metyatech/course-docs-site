export const isSameOriginMutation = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  const secFetchSite = request.headers.get("sec-fetch-site");

  if (origin) {
    try {
      const requestUrl = new URL(request.url);
      const originUrl = new URL(origin);
      if (requestUrl.origin !== originUrl.origin) return false;
    } catch {
      return false;
    }
  }

  if (secFetchSite) {
    const allowed = new Set(["same-origin", "same-site", "none"]);
    if (!allowed.has(secFetchSite.toLowerCase())) return false;
  }

  if (!origin && !secFetchSite) return true;

  return true;
};
