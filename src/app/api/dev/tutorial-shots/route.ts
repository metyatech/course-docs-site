import { NextResponse } from "next/server";
import {
  getTutorialShotAuthoringContext,
  scanTutorialShots,
} from "../../../../lib/tutorial-shots-server.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedSource = searchParams.get("source");
    const context = await getTutorialShotAuthoringContext({ requestedSource });

    if (!context.enabled) {
      return NextResponse.json(context, {
        status: 400,
        headers: {
          "cache-control": "no-store, max-age=0",
        },
      });
    }

    const shots = await scanTutorialShots({ sourceRoot: context.sourceRoot });

    return NextResponse.json(
      {
        enabled: true,
        activeSourcePath: context.activeSourcePath,
        sourceKind: context.sourceKind,
        configuredSource: context.configuredSource,
        suggestedLocalSources: context.suggestedLocalSources,
        shots,
      },
      {
        headers: {
          "cache-control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        enabled: false,
        reason: error instanceof Error ? error.message : "Failed to scan tutorial shots.",
      },
      {
        status: 500,
        headers: {
          "cache-control": "no-store, max-age=0",
        },
      },
    );
  }
}
