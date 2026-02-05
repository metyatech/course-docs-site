import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const revision = process.env.COURSE_DOCS_SITE_DEV_REVISION ?? '';
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));

      // Speed up reconnection after dev server restart.
      send('retry: 1000\n');
      send(`data: ${JSON.stringify({ revision })}\n\n`);

      const keepAlive = setInterval(() => {
        // Comment frame (ignored by clients).
        send(':keep-alive\n\n');
      }, 30_000);

      const abort = () => {
        clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      if (request.signal.aborted) {
        abort();
        return;
      }
      request.signal.addEventListener('abort', abort, { once: true });
    },
  });

  return new NextResponse(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      connection: 'keep-alive',
    },
  });
}

