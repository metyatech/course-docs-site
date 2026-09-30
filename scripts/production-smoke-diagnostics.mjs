const WORK_COMMENTS_PATH = "/rest/v1/work_comments";

const parseRequestUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    return {
      safeUrl: `${url.origin}${url.pathname}`,
      pathname: url.pathname,
    };
  } catch {
    return { safeUrl: "<invalid URL>", pathname: "" };
  }
};

const isSupabaseRestPath = (pathname) => pathname.includes("/rest/v1/");

const isWorkCommentsPath = (pathname) =>
  pathname === WORK_COMMENTS_PATH || pathname.startsWith(`${WORK_COMMENTS_PATH}/`);

const networkFailureCode = (failureText) =>
  failureText?.match(
    /\b(?:net::)?ERR_[A-Z0-9_]+\b|\b(?:EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ECONNABORTED)\b/u,
  )?.[0] ?? "request failed";

const requestDetails = (request) => {
  const parsed = parseRequestUrl(request.url());
  return {
    url: parsed.safeUrl,
    pathname: parsed.pathname,
    method: request.method(),
  };
};

export const createSupabaseSmokeMonitor = (page, timeoutMs) => {
  const requests = [];
  const responses = [];
  const failedRequests = [];
  let outcome = null;
  let waiter = null;
  let timeout = null;

  const settle = (nextOutcome) => {
    if (outcome) return;
    outcome = nextOutcome;
    clearTimeout(timeout);
    waiter?.(outcome);
  };

  const onRequest = (request) => {
    const details = requestDetails(request);
    if (isSupabaseRestPath(details.pathname)) requests.push(details);
  };

  const onResponse = (response) => {
    const details = requestDetails(response.request());
    if (!isSupabaseRestPath(details.pathname)) return;

    const record = { ...details, status: response.status() };
    responses.push(record);
    if (record.status >= 400) {
      const endpoint = isWorkCommentsPath(record.pathname) ? "work_comments" : "Supabase REST";
      settle({
        error: new Error(
          `Programming ${endpoint} request returned HTTP ${record.status}: ${record.url}`,
        ),
      });
    } else if (isWorkCommentsPath(record.pathname)) {
      settle({ response: record });
    }
  };

  const onRequestFailed = (request) => {
    const details = requestDetails(request);
    if (!isSupabaseRestPath(details.pathname)) return;

    const failureText = networkFailureCode(request.failure()?.errorText);
    const record = { ...details, failureText };
    failedRequests.push(record);

    const endpoint = isWorkCommentsPath(record.pathname) ? "work_comments" : "Supabase REST";
    settle({
      error: new Error(
        `Programming ${endpoint} request failed before receiving a response: ${record.failureText} (${record.url})`,
      ),
    });
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);

  return {
    requests,
    responses,
    failedRequests,
    waitForCommentRead() {
      if (outcome) {
        return outcome.error ? Promise.reject(outcome.error) : Promise.resolve(outcome.response);
      }

      return new Promise((resolve, reject) => {
        waiter = (result) => (result.error ? reject(result.error) : resolve(result.response));
        timeout = setTimeout(() => {
          const commentRequest = requests.find((request) => isWorkCommentsPath(request.pathname));
          const message = commentRequest
            ? `Programming work_comments request started but received no response within ${timeoutMs}ms: ${commentRequest.url}`
            : `Programming work_comments request did not start within ${timeoutMs}ms.`;
          settle({ error: new Error(message) });
        }, timeoutMs);
      });
    },
    failureMessage() {
      const failedRequest = failedRequests[0];
      if (failedRequest) {
        const endpoint = isWorkCommentsPath(failedRequest.pathname)
          ? "work_comments"
          : "Supabase REST";
        return `Programming ${endpoint} request failed before receiving a response: ${failedRequest.failureText} (${failedRequest.url})`;
      }

      const failedResponse = responses.find((response) => response.status >= 400);
      if (!failedResponse) return null;

      const endpoint = isWorkCommentsPath(failedResponse.pathname)
        ? "work_comments"
        : "Supabase REST";
      return `Programming ${endpoint} request returned HTTP ${failedResponse.status}: ${failedResponse.url}`;
    },
    dispose() {
      clearTimeout(timeout);
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);
    },
  };
};
