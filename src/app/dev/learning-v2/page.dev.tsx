import { readFileSync } from "node:fs";
import path from "node:path";
import { compileLearningSourceV2 } from "@metyatech/course-docs-platform/learning-v2/compiler";
import { LearningV2StaticPlayer } from "@metyatech/course-docs-platform/learning-v2/runtime";

export const dynamic = "force-dynamic";
export const metadata = { title: "CSSの学習" };

const source = JSON.parse(
  readFileSync(
    path.resolve(
      process.cwd(),
      "packages/platform/tests/fixtures/learning-v2/box-model-class-selector.json",
    ),
    "utf8",
  ),
);

export default function LearningV2PilotPage() {
  const { bundle } = compileLearningSourceV2(source);
  return <LearningV2StaticPlayer bundle={bundle} />;
}
