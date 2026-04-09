import { NextResponse } from "next/server";
import {
  getTutorialShotAuthoringContext,
  readTutorialShotImage,
} from "../../../../../lib/tutorial-shots-server.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedSource = searchParams.get("source");
    const context = await getTutorialShotAuthoringContext({ requestedSource });
    if (!context.enabled) {
      return NextResponse.json(context, { status: 400 });
    }

    const imagePath = searchParams.get("path");
    if (!imagePath) {
      return NextResponse.json({ error: "Missing image path." }, { status: 400 });
    }

    const image = await readTutorialShotImage({
      sourceRoot: context.sourceRoot,
      contentRelativePath: imagePath,
    });

    return new NextResponse(image.bytes, {
      headers: {
        "content-type": image.contentType,
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to read tutorial shot image.",
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
