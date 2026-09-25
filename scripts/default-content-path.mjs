import fs from "node:fs";
import path from "node:path";
import { parseNextraMetaOrder } from "./nextra-meta-order.mjs";

const RESERVED_META_KEYS = new Set(["*", "index"]);

const readMetaOrder = (dirPath) => {
  const metaPath = path.join(dirPath, "_meta.ts");
  if (!fs.existsSync(metaPath)) return { supported: false, entries: [] };
  return parseNextraMetaOrder(fs.readFileSync(metaPath, "utf8"));
};

const hasIndexPage = (dirPath) =>
  fs.existsSync(path.join(dirPath, "index.mdx")) || fs.existsSync(path.join(dirPath, "index.md"));

const resolveFirstContentPath = (dirPath, routePrefix) => {
  const meta = readMetaOrder(dirPath);
  const candidates = meta.supported
    ? meta.entries
        .filter(({ key, hidden }) => !RESERVED_META_KEYS.has(key) && !hidden)
        .map(({ key }) => key)
    : fs
        .readdirSync(dirPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  for (const key of candidates) {
    if (key.includes("/") || key.includes("\\") || key === "." || key === "..") continue;

    const childDir = path.join(dirPath, key);
    if (!fs.existsSync(childDir) || !fs.statSync(childDir).isDirectory()) continue;

    const nextRoute = `${routePrefix}/${key}`;
    if (hasIndexPage(childDir)) return nextRoute;

    const nestedRoute = resolveFirstContentPath(childDir, nextRoute);
    if (nestedRoute) return nestedRoute;
  }

  return null;
};

/** Resolve the first visible content route during Next configuration/build. */
export const resolveDefaultContentPath = ({
  contentRoot = path.join(process.cwd(), "content"),
} = {}) => {
  const route = resolveFirstContentPath(contentRoot, "");
  if (!route) {
    throw new Error("Could not determine a default content route from content/_meta.ts.");
  }
  return route;
};
