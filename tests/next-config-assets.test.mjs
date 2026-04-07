import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../next.config.js";

test("next config disables static image wrappers for course asset imports", () => {
  assert.equal(nextConfig.images?.disableStaticImages, true);
  assert.equal(nextConfig.images?.unoptimized, true);
});
