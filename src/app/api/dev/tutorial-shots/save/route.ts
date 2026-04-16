import { NextResponse } from "next/server";
import { bumpRevision } from "../../../../../lib/dev-reload-bus";
import {
  getTutorialShotAuthoringContext,
  saveTutorialShot,
} from "../../../../../lib/tutorial-shots-server.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || !("manifest" in body)) {
      return NextResponse.json({ error: "manifest がありません。" }, { status: 400 });
    }
    const requestedSource =
      typeof body.source === "string" && body.source.trim() ? body.source.trim() : null;
    const context = await getTutorialShotAuthoringContext({ requestedSource });
    if (!context.enabled) {
      return NextResponse.json(context, { status: 400 });
    }

    const result = await saveTutorialShot({
      sourceRoot: context.sourceRoot,
      manifestInput: body.manifest,
      rawImageDataUrl: typeof body.rawImageDataUrl === "string" ? body.rawImageDataUrl : null,
      bootstrapFromOutput: body.bootstrapFromOutput === true,
    });

    // Bump the SSE revision so all connected docs pages reload via DevAutoReload.
    // This is more reliable than depending solely on the Next.js HMR chain
    // triggered by rewritePageSourceForDevRefresh, which does not always fire
    // a full page reload for <Verify img> or <Action img> when the rendered
    // output image changes but the MDX module cache still holds the old URL.
    bumpRevision();

    return NextResponse.json(
      {
        ok: true,
        manifest: result.manifest,
        warnings: result.warnings,
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
        error:
          error instanceof Error ? error.message : "チュートリアル画像を保存できませんでした。",
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
