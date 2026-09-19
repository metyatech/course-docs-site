import { NextResponse } from "next/server";
import { bumpRevision } from "../../../../../lib/dev-reload-bus";
import {
  getTutorialShotAuthoringContext,
  saveTutorialShot,
  TutorialShotConflictError,
} from "../../../../../lib/tutorial-shots-server.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const isSameOriginOrLoopbackAlias = ({
  origin,
  requestUrl,
}: {
  origin: string;
  requestUrl: URL;
}) => {
  const originUrl = new URL(origin);
  if (originUrl.origin === requestUrl.origin) {
    return true;
  }

  return (
    originUrl.protocol === requestUrl.protocol &&
    originUrl.port === requestUrl.port &&
    LOOPBACK_HOSTS.has(originUrl.hostname) &&
    LOOPBACK_HOSTS.has(requestUrl.hostname)
  );
};

const verifyDevJsonWriteRequest = (request: Request) => {
  if (process.env.NODE_ENV === "production") {
    return "チュートリアル画像の保存は開発環境でのみ使えます。";
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return "JSON リクエストだけを受け付けます。";
  }

  const origin = request.headers.get("origin");
  if (origin && !isSameOriginOrLoopbackAlias({ origin, requestUrl: new URL(request.url) })) {
    return "別のオリジンからの保存リクエストは受け付けません。";
  }

  return null;
};

export async function POST(request: Request) {
  try {
    const requestError = verifyDevJsonWriteRequest(request);
    if (requestError) {
      return NextResponse.json({ error: requestError }, { status: 403 });
    }

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
      sourceRef: body.sourceRef,
      manifestInput: body.manifest,
      rawImageDataUrl: typeof body.rawImageDataUrl === "string" ? body.rawImageDataUrl : null,
      rawImageFileName: typeof body.rawImageFileName === "string" ? body.rawImageFileName : null,
      bootstrapFromOutput: body.bootstrapFromOutput === true,
      bootstrapImagePath:
        typeof body.bootstrapImagePath === "string" ? body.bootstrapImagePath : null,
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
        sourceRef: result.sourceRef,
        warnings: result.warnings,
      },
      {
        headers: {
          "cache-control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    const status = error instanceof TutorialShotConflictError ? 409 : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "チュートリアル画像を保存できませんでした。",
      },
      {
        status,
        headers: {
          "cache-control": "no-store, max-age=0",
        },
      },
    );
  }
}
