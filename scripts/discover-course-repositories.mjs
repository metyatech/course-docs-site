import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import YAML from "yaml";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";
const OWNER = "metyatech";
const TOPIC = "course-docs";
const DEPLOY_WORKFLOW = ".github/workflows/deploy-vercel.yml";

const createApiHeaders = (token) => {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "course-docs-site-repository-discovery",
    "X-GitHub-Api-Version": API_VERSION,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
};

const parseNextLink = (linkHeader) => {
  if (!linkHeader) {
    return null;
  }

  for (const link of linkHeader.split(/,\s*(?=<)/u)) {
    const match = link.match(/^<([^>]+)>\s*;(.*)$/u);
    if (!match) {
      continue;
    }

    const relation = match[2].match(/(?:^|;)\s*rel="?([^";]+)"?/u)?.[1];
    if (relation?.split(/\s+/u).includes("next")) {
      return match[1];
    }
  }

  return null;
};

const parseJsonResponse = async (response, label) => {
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}.`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
};

const fetchJson = async (url, { fetchImpl, token, label, allowNotFound = false }) => {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: createApiHeaders(token),
      redirect: "error",
    });
  } catch {
    throw new Error(`${label} request failed.`);
  }

  if (allowNotFound && response.status === 404) {
    return null;
  }

  return parseJsonResponse(response, label);
};

export const fetchAllRepositoryPages = async ({ url, token, fetchImpl = fetch }) => {
  const repositories = [];
  const visitedUrls = new Set();
  let nextUrl = new URL(url);

  while (nextUrl) {
    if (nextUrl.origin !== API_ROOT) {
      throw new Error("GitHub pagination returned an unexpected API origin.");
    }

    const href = nextUrl.href;
    if (visitedUrls.has(href)) {
      throw new Error("GitHub pagination repeated a page.");
    }
    visitedUrls.add(href);

    let response;
    try {
      response = await fetchImpl(href, {
        headers: createApiHeaders(token),
        redirect: "error",
      });
    } catch {
      throw new Error("GitHub repository discovery request failed.");
    }

    const page = await parseJsonResponse(response, "GitHub repository discovery");
    if (!Array.isArray(page)) {
      throw new Error("GitHub repository discovery returned an invalid page.");
    }

    repositories.push(...page);
    const next = parseNextLink(response.headers.get("link"));
    nextUrl = next ? new URL(next, href) : null;
  }

  return repositories;
};

const normalizeRepository = (repository) => {
  if (
    !repository ||
    typeof repository.name !== "string" ||
    typeof repository.full_name !== "string" ||
    typeof repository.default_branch !== "string" ||
    typeof repository.private !== "boolean" ||
    typeof repository.archived !== "boolean" ||
    !Array.isArray(repository.topics)
  ) {
    return null;
  }

  const [repositoryOwner] = repository.full_name.split("/", 1);
  if (repositoryOwner?.toLowerCase() !== OWNER.toLowerCase()) {
    return null;
  }

  return {
    name: repository.name,
    full_name: repository.full_name,
    default_branch: repository.default_branch,
    private: repository.private,
    archived: repository.archived,
    topics: repository.topics,
  };
};

export const selectCourseRepositories = ({ publicRepositories, privateRepositories }) => {
  const byFullName = new Map();

  const repositorySources = [
    ...publicRepositories.map((repository) => ({ repository, expectedPrivate: false })),
    ...privateRepositories.map((repository) => ({ repository, expectedPrivate: true })),
  ];

  for (const source of repositorySources) {
    const value = source.repository;
    const repository = normalizeRepository(value);
    if (
      !repository ||
      repository.archived ||
      !repository.topics.includes(TOPIC) ||
      repository.private !== source.expectedPrivate
    ) {
      continue;
    }

    const key = repository.full_name.toLowerCase();
    const existing = byFullName.get(key);
    if (!existing) {
      byFullName.set(key, repository);
      continue;
    }

    byFullName.set(key, {
      ...existing,
      ...repository,
      topics: [...new Set([...existing.topics, ...repository.topics])],
    });
  }

  return [...byFullName.values()].sort((left, right) =>
    left.full_name.toLowerCase() < right.full_name.toLowerCase()
      ? -1
      : left.full_name.toLowerCase() > right.full_name.toLowerCase()
        ? 1
        : 0,
  );
};

const buildRepositoryListUrl = ({ owner, privateOnly }) => {
  if (privateOnly) {
    return `${API_ROOT}/user/repos?visibility=private&affiliation=owner&sort=full_name&direction=asc&per_page=100`;
  }

  return `${API_ROOT}/users/${encodeURIComponent(owner)}/repos?type=owner&sort=full_name&direction=asc&per_page=100`;
};

export const discoverCourseRepositories = async ({
  owner = OWNER,
  token,
  publicToken,
  fetchImpl = fetch,
}) => {
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error(
      "COURSE_CONTENT_READ_TOKEN is required to discover private course repositories.",
    );
  }

  const [publicRepositories, privateRepositories] = await Promise.all([
    fetchAllRepositoryPages({
      url: buildRepositoryListUrl({ owner, privateOnly: false }),
      token: publicToken,
      fetchImpl,
    }),
    fetchAllRepositoryPages({
      url: buildRepositoryListUrl({ owner, privateOnly: true }),
      token,
      fetchImpl,
    }),
  ]);

  const repositories = selectCourseRepositories({ publicRepositories, privateRepositories });
  if (repositories.length === 0) {
    throw new Error(`No active repositories with the ${TOPIC} topic were discovered for ${owner}.`);
  }

  return repositories;
};

const repositoryContentsUrl = (repository, path = "") => {
  const encodedOwner = encodeURIComponent(OWNER);
  const encodedName = encodeURIComponent(repository.name);
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const suffix = encodedPath ? `/${encodedPath}` : "";
  const url = new URL(`/repos/${encodedOwner}/${encodedName}/contents${suffix}`, API_ROOT);
  url.searchParams.set("ref", repository.default_branch);
  return url.href;
};

export const validateCourseRepositoryContracts = async (
  repositories,
  {
    token,
    fetchImpl = fetch,
    requireProductionRuntime = false,
    authenticatePublicChecks = false,
  } = {},
) => {
  for (const repository of repositories) {
    const requestToken = repository.private || authenticatePublicChecks ? token : undefined;
    const rootContents = await fetchJson(repositoryContentsUrl(repository), {
      fetchImpl,
      token: requestToken,
      label: `Unable to inspect course-docs repository ${repository.full_name}`,
      allowNotFound: true,
    });

    if (!Array.isArray(rootContents)) {
      throw new Error(
        `course-docs repository ${repository.full_name} is missing its repository root.`,
      );
    }

    const hasSiteConfig = rootContents.some(
      (entry) => entry?.name === "site.config.ts" && entry.type === "file",
    );
    if (!hasSiteConfig) {
      throw new Error(`course-docs repository ${repository.full_name} is missing site.config.ts.`);
    }

    const hasContentDirectory = rootContents.some(
      (entry) => entry?.name === "content" && entry.type === "dir",
    );
    if (!hasContentDirectory) {
      throw new Error(`course-docs repository ${repository.full_name} is missing content/.`);
    }

    const callerContents = await fetchJson(repositoryContentsUrl(repository, DEPLOY_WORKFLOW), {
      fetchImpl,
      token: requestToken,
      label: `Unable to inspect deployment caller in ${repository.full_name}`,
      allowNotFound: true,
    });

    if (!callerContents || callerContents.type !== "file") {
      throw new Error(
        `course-docs repository ${repository.full_name} is missing the deployment caller ${DEPLOY_WORKFLOW}.`,
      );
    }

    if (requireProductionRuntime) {
      if (callerContents.encoding !== "base64" || typeof callerContents.content !== "string") {
        throw new Error(
          `course-docs repository ${repository.full_name} returned an unreadable deployment caller.`,
        );
      }

      const workflowText = Buffer.from(callerContents.content, "base64").toString("utf8");
      validateProductionDeployCaller(workflowText, repository.full_name);
    }
  }
};

export const validateProductionDeployCaller = (workflowText, repositoryName) => {
  let workflow;
  try {
    workflow = YAML.parse(workflowText);
  } catch {
    throw new Error(`${repositoryName} deployment caller is not valid YAML.`);
  }

  const pushPaths = workflow?.on?.push?.paths;
  if (!Array.isArray(pushPaths)) {
    throw new Error(`${repositoryName} deployment caller is missing the content push trigger.`);
  }

  for (const path of [
    "content/**",
    "public/**",
    "site.config.ts",
    ".github/workflows/deploy-vercel.yml",
  ]) {
    if (!pushPaths.includes(path)) {
      throw new Error(`${repositoryName} deployment caller is missing the ${path} push path.`);
    }
  }

  const inputs = workflow?.on?.workflow_dispatch?.inputs;
  if (
    inputs?.shared_runtime_ref?.required !== false ||
    inputs.shared_runtime_ref.type !== "string" ||
    inputs.shared_runtime_ref.default !== "production-runtime"
  ) {
    throw new Error(
      `${repositoryName} deployment caller is missing an optional shared_runtime_ref input defaulting to production-runtime.`,
    );
  }

  if (
    workflow?.jobs?.deploy?.uses !==
    "metyatech/course-docs-site/.github/workflows/deploy-course.yml@production-runtime"
  ) {
    throw new Error(`${repositoryName} deployment workflow is not pinned to production-runtime.`);
  }

  const forwardedRef = workflow?.jobs?.deploy?.with?.shared_runtime_ref;
  if (
    typeof forwardedRef !== "string" ||
    !/^\$\{\{\s*github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*inputs\.shared_runtime_ref\s*\|\|\s*'production-runtime'\s*\}\}$/u.test(
      forwardedRef,
    )
  ) {
    throw new Error(
      `${repositoryName} deployment caller is missing shared_runtime_ref forwarding with the production-runtime fallback.`,
    );
  }

  if (
    inputs?.release_id?.required !== false ||
    inputs.release_id.type !== "string" ||
    inputs.release_id.default !== ""
  ) {
    throw new Error(
      `${repositoryName} deployment caller is missing the optional release_id input.`,
    );
  }

  if (
    !/^Deploy \[shared-runtime-release:\$\{\{\s*inputs\.release_id/u.test(
      workflow["run-name"] ?? "",
    )
  ) {
    throw new Error(
      `${repositoryName} deployment caller is missing a run-name containing the release correlation ID.`,
    );
  }

  if (
    repositoryName.toLowerCase() === "metyatech/programming-course-docs" &&
    workflow?.jobs?.deploy?.with?.next_public_works_base_url !==
      "https://metyatech.github.io/programming-course-student-works"
  ) {
    throw new Error(`${repositoryName} deployment caller is missing the Student Works URL input.`);
  }
};

export const createBuildMatrix = (repositories) => ({
  include: repositories.map((repository) => ({
    siteId: repository.name,
    courseSource: `github:${repository.full_name}#${repository.default_branch}`,
    requiresContentReadToken: repository.private,
  })),
});

export const createRedeployMatrix = (repositories) => ({
  include: repositories.map((repository) => ({
    siteId: repository.name,
    fullName: repository.full_name,
    ref: repository.default_branch,
    workflow: "deploy-vercel.yml",
  })),
});

export const createE2EMatrix = (repositories, representatives) => {
  const repositoriesByName = new Map(
    repositories.map((repository) => [repository.name, repository]),
  );

  return {
    include: representatives.flatMap((representative) => {
      const repository = repositoriesByName.get(representative.siteId);
      if (!repository) {
        throw new Error(
          `Representative E2E repository ${representative.siteId} is not in dynamic course discovery.`,
        );
      }

      return [1, 2].map((shard) => ({
        siteId: repository.name,
        courseSource: `github:${repository.full_name}#${repository.default_branch}`,
        requiresContentReadToken: repository.private,
        e2ePort: representative.e2ePort,
        e2eSourceEnv: representative.e2eSourceEnv,
        shard: `${shard}/2`,
      }));
    }),
  };
};

export const createCIMatrices = (repositories, representatives) => ({
  build: createBuildMatrix(repositories),
  e2e: createE2EMatrix(repositories, representatives),
});

const parseKind = (args) => {
  const kindIndex = args.indexOf("--kind");
  const kind = kindIndex >= 0 ? args[kindIndex + 1] : "";
  if (!["ci", "build", "e2e", "redeploy", "release"].includes(kind) || args.length !== 2) {
    throw new Error(
      "Usage: node scripts/discover-course-repositories.mjs --kind <ci|build|e2e|redeploy|release>",
    );
  }
  return kind;
};

const runCli = async () => {
  const kind = parseKind(process.argv.slice(2));
  const token = process.env.COURSE_CONTENT_READ_TOKEN;
  const repositories = await discoverCourseRepositories({
    token,
    publicToken: kind === "release" ? token : undefined,
  });
  await validateCourseRepositoryContracts(repositories, {
    token,
    requireProductionRuntime: kind === "release",
    authenticatePublicChecks: kind === "release",
  });

  const require = createRequire(import.meta.url);
  const { representativeSites } = require("../tests/e2e/representative-sites.cjs");

  let matrix;
  if (kind === "build") {
    matrix = createBuildMatrix(repositories);
  } else if (kind === "redeploy" || kind === "release") {
    matrix = createRedeployMatrix(repositories);
  } else if (kind === "e2e") {
    matrix = createE2EMatrix(repositories, representativeSites);
  } else {
    matrix = createCIMatrices(repositories, representativeSites);
  }

  process.stdout.write(`${JSON.stringify(matrix)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(`[discover-course-repositories] ${error.message}`);
    process.exitCode = 1;
  });
}
