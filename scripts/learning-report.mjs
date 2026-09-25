import { analyzeCourseLearning } from "./learning-analysis.mjs";

const result = await analyzeCourseLearning();
if (!result.configured) {
  process.stdout.write(
    "learning-report: no learning-units.yaml found; legacy course content is unchanged.\n",
  );
} else if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write("Course learning progression\n");
  process.stdout.write(
    `Page order: ${result.pageOrder.source} (certain=${result.pageOrder.certain})\n`,
  );
  for (const unit of result.progression) {
    const coverage =
      unit.kind === "composite"
        ? `direct events=${unit.directCoverage.events}; descendant events=${unit.descendantCoverage.events} across ${unit.descendantCoverage.units} units`
        : `events=${unit.directCoverage.events}; evidence=${unit.directCoverage.evidence.join(", ") || "none"}`;
    const introductions =
      unit.initialIntroductions.map(({ id, page }) => `${id} (${page})`).join(", ") || "none";
    const recurrences =
      unit.laterRecurrence.map(({ id, page, phase }) => `${id}:${phase} (${page})`).join(", ") ||
      "none";
    process.stdout.write(
      `- ${unit.id} [${unit.kind}] parent=${unit.parent ?? "none"}; ${coverage}; initial=${introductions}; later recurrence=${recurrences}\n`,
    );
    for (const site of unit.evidenceSites) {
      process.stdout.write(
        `  evidence=${site.demonstrates}; event=${site.eventId}; page=${site.page}\n`,
      );
    }
  }
  process.stdout.write("Events (derived course order):\n");
  for (const event of result.events) {
    process.stdout.write(
      `- ${event.id}: targets=${event.targets.join(", ")}; phase=${event.phase}; page=${event.page}\n`,
    );
  }
}
for (const issue of result.issues) process.stdout.write(`${issue.severity}: ${issue.message}\n`);
if (result.issues.some((issue) => issue.severity === "error")) process.exitCode = 1;
