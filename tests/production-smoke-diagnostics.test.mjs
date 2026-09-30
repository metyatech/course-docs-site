import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createSupabaseSmokeMonitor } from "../scripts/production-smoke-diagnostics.mjs";

const secretQuery = "apikey=anonymous-secret&access_token=service-secret";
const commentUrl = `https://project.supabase.co/rest/v1/work_comments?${secretQuery}`;

const createRequest = (url, failureText = null) => ({
  url: () => url,
  method: () => "GET",
  failure: () => (failureText ? { errorText: failureText } : null),
  headers: () => ({ apikey: "header-secret", authorization: "Bearer service-secret" }),
});

const createResponse = (request, status) => ({
  request: () => request,
  status: () => status,
});

test("a successful work_comments response passes the smoke monitor", async () => {
  const page = new EventEmitter();
  const monitor = createSupabaseSmokeMonitor(page, 1000);
  try {
    const result = monitor.waitForCommentRead();
    const request = createRequest(commentUrl);
    page.emit("request", request);
    page.emit("response", createResponse(request, 200));

    assert.equal((await result).status, 200);
    assert.equal(monitor.failureMessage(), null);
    assert.equal(monitor.requests[0].url, "https://project.supabase.co/rest/v1/work_comments");
  } finally {
    monitor.dispose();
  }
});

for (const status of [401, 503]) {
  test(`an HTTP ${status} response fails with its status`, async () => {
    const page = new EventEmitter();
    const monitor = createSupabaseSmokeMonitor(page, 1000);
    try {
      const result = monitor.waitForCommentRead();
      const request = createRequest(commentUrl);
      page.emit("request", request);
      page.emit("response", createResponse(request, status));

      await assert.rejects(result, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(
        monitor.failureMessage(),
        /anonymous-secret|service-secret|header-secret/u,
      );
    } finally {
      monitor.dispose();
    }
  });
}

test("a DNS request failure fails immediately with its network reason", async () => {
  const page = new EventEmitter();
  const monitor = createSupabaseSmokeMonitor(page, 1000);
  try {
    const result = monitor.waitForCommentRead();
    const request = createRequest(
      commentUrl,
      `net::ERR_NAME_NOT_RESOLVED (${commentUrl}) apikey=anonymous-secret`,
    );
    page.emit("request", request);
    page.emit("requestfailed", request);

    await assert.rejects(result, /ERR_NAME_NOT_RESOLVED/u);
    assert.match(
      monitor.failureMessage(),
      /work_comments request failed before receiving a response/u,
    );
    assert.doesNotMatch(monitor.failureMessage(), /anonymous-secret|service-secret|header-secret/u);
    assert.equal(monitor.failedRequests[0].method, "GET");
    assert.equal(
      monitor.failedRequests[0].url,
      "https://project.supabase.co/rest/v1/work_comments",
    );
  } finally {
    monitor.dispose();
  }
});

test("a failed request to another Supabase REST path also fails immediately", async () => {
  const page = new EventEmitter();
  const monitor = createSupabaseSmokeMonitor(page, 1000);
  try {
    const result = monitor.waitForCommentRead();
    const request = createRequest(
      `https://project.supabase.co/rest/v1/work_intros?${secretQuery}`,
      "net::ERR_CONNECTION_RESET",
    );
    page.emit("request", request);
    page.emit("requestfailed", request);

    await assert.rejects(
      result,
      /Supabase REST request failed before receiving a response: net::ERR_CONNECTION_RESET/u,
    );
    assert.doesNotMatch(monitor.failureMessage(), /anonymous-secret|service-secret|header-secret/u);
  } finally {
    monitor.dispose();
  }
});

test("a comment read that never starts has a distinct diagnostic", async () => {
  const page = new EventEmitter();
  const monitor = createSupabaseSmokeMonitor(page, 0);
  try {
    await assert.rejects(monitor.waitForCommentRead(), /work_comments request did not start/u);
  } finally {
    monitor.dispose();
  }
});

test("a started comment request without any response reports the sanitized endpoint", async () => {
  const page = new EventEmitter();
  const monitor = createSupabaseSmokeMonitor(page, 0);
  try {
    const result = monitor.waitForCommentRead();
    page.emit("request", createRequest(commentUrl));

    await assert.rejects(result, (error) => {
      assert.match(error.message, /work_comments request started but received no response/u);
      assert.match(error.message, /https:\/\/project\.supabase\.co\/rest\/v1\/work_comments/u);
      assert.doesNotMatch(error.message, /anonymous-secret|service-secret|header-secret/u);
      return true;
    });
  } finally {
    monitor.dispose();
  }
});
