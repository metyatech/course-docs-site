import assert from "node:assert/strict";
import test from "node:test";
import {
  createBuildMatrix,
  createE2EMatrix,
  createRedeployMatrix,
  discoverCourseRepositories,
  fetchAllRepositoryPages,
  selectCourseRepositories,
  validateCourseRepositoryContracts,
} from "../scripts/discover-course-repositories.mjs";

const repository = (
  name,
  {
    branch = "main",
    private: isPrivate = false,
    archived = false,
    topics = ["course-docs"],
    owner = "metyatech",
  } = {},
) => ({
  name,
  full_name: `${owner}/${name}`,
  default_branch: branch,
  private: isPrivate,
  archived,
  topics,
});

const jsonResponse = (body, { status = 200, headers = {} } = {}) =>
  new Response(JSON.stringify(body), { status, headers });

test("an eighth public topic repository enters the build and redeploy matrices automatically", () => {
  const discovered = selectCourseRepositories({
    publicRepositories: [repository("existing-course"), repository("new-eighth-course")],
    privateRepositories: [],
  });

  assert.deepEqual(
    createBuildMatrix(discovered).include.map((entry) => entry.siteId),
    ["existing-course", "new-eighth-course"],
  );
  assert.deepEqual(
    createRedeployMatrix(discovered).include.map((entry) => entry.fullName),
    ["metyatech/existing-course", "metyatech/new-eighth-course"],
  );
});

test("private repositories require the read token and matrix output contains only a boolean", () => {
  const discovered = selectCourseRepositories({
    publicRepositories: [],
    privateRepositories: [repository("private-course", { private: true })],
  });
  const matrix = createBuildMatrix(discovered);

  assert.equal(matrix.include[0].requiresContentReadToken, true);
  assert.equal(JSON.stringify(matrix).includes("secret-token"), false);
});

test("public discovery is anonymous while private discovery receives the token", async () => {
  const authorizationByPath = new Map();
  const fetchImpl = async (url, options) => {
    const pathname = new URL(url).pathname;
    authorizationByPath.set(pathname, options.headers.Authorization);
    return jsonResponse(
      pathname === "/user/repos" ? [repository("private-course", { private: true })] : [],
    );
  };

  const discovered = await discoverCourseRepositories({ token: "fixture-token", fetchImpl });

  assert.equal(authorizationByPath.get("/users/metyatech/repos"), undefined);
  assert.equal(authorizationByPath.get("/user/repos"), "Bearer fixture-token");
  assert.equal(discovered[0].private, true);
});

test("main and master default branches are derived from repository metadata", () => {
  const matrix = createBuildMatrix(
    selectCourseRepositories({
      publicRepositories: [
        repository("main-course"),
        repository("master-course", { branch: "master" }),
      ],
      privateRepositories: [],
    }),
  );

  assert.deepEqual(
    matrix.include.map(({ courseSource }) => courseSource),
    ["github:metyatech/main-course#main", "github:metyatech/master-course#master"],
  );
});

test("archived, non-topic, and other-owner repositories are excluded", () => {
  const selected = selectCourseRepositories({
    publicRepositories: [
      repository("active-course"),
      repository("archived-course", { archived: true }),
      repository("other-topic", { topics: ["education"] }),
      repository("other-owner-course", { owner: "another-user" }),
    ],
    privateRepositories: [],
  });

  assert.deepEqual(
    selected.map(({ name }) => name),
    ["active-course"],
  );
});

test("repository discovery is sorted and duplicate results are deduplicated", () => {
  const duplicate = repository("duplicate-course");
  const selected = selectCourseRepositories({
    publicRepositories: [repository("z-course"), duplicate, repository("a-course"), duplicate],
    privateRepositories: [],
  });

  assert.deepEqual(
    selected.map(({ full_name }) => full_name),
    ["metyatech/a-course", "metyatech/duplicate-course", "metyatech/z-course"],
  );
});

test("all GitHub API pages are followed in order", async () => {
  const visited = [];
  const fetchImpl = async (url) => {
    visited.push(new URL(url).searchParams.get("page"));
    if (visited.length === 1) {
      return jsonResponse([repository("first-course")], {
        headers: {
          Link: '<https://api.github.com/users/metyatech/repos?per_page=1&page=2>; rel="next", <https://api.github.com/users/metyatech/repos?per_page=1&page=2>; rel="last"',
        },
      });
    }
    return jsonResponse([repository("second-course")]);
  };

  const pages = await fetchAllRepositoryPages({
    url: "https://api.github.com/users/metyatech/repos?per_page=1&page=1",
    fetchImpl,
  });

  assert.deepEqual(visited, ["1", "2"]);
  assert.deepEqual(
    pages.map(({ name }) => name),
    ["first-course", "second-course"],
  );
});

test("API failure and empty discovery both fail closed", async () => {
  await assert.rejects(
    discoverCourseRepositories({
      token: "fixture-token",
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
    }),
    /failed with HTTP 503/u,
  );

  await assert.rejects(
    discoverCourseRepositories({
      token: "fixture-token",
      fetchImpl: async () => jsonResponse([]),
    }),
    /No active repositories/u,
  );
});

test("private discovery cannot silently run without its read token", async () => {
  await assert.rejects(discoverCourseRepositories({ token: "" }), /COURSE_CONTENT_READ_TOKEN/u);
});

test("representative E2E entries must exist in dynamic discovery", () => {
  assert.throws(
    () =>
      createE2EMatrix(
        [],
        [{ siteId: "missing-course", e2ePort: 3101, e2eSourceEnv: "E2E_SOURCE" }],
      ),
    /not in dynamic course discovery/u,
  );
});

test("a topic repository without its tiny deployment caller fails contract validation", async () => {
  const selected = repository("missing-caller-course");
  const fetchImpl = async (url) => {
    if (new URL(url).pathname.endsWith("/contents")) {
      return jsonResponse([
        { name: "site.config.ts", type: "file" },
        { name: "content", type: "dir" },
      ]);
    }
    return new Response(null, { status: 404 });
  };

  await assert.rejects(
    validateCourseRepositoryContracts([selected], { fetchImpl }),
    /course-docs repository metyatech\/missing-caller-course is missing the deployment caller/u,
  );
});
