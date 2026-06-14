import { NextResponse } from 'next/server';
import { getRevision, subscribe } from '../../../../../lib/dev-reload-bus';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));

      const abort = () => {
        unsubscribe();
        clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      // Speed up reconnection after dev server restart.
      send('retry: 1000\n');
      // Send the current revision immediately on connect so the client can
      // track the baseline and detect any bump that occurred before this
      // connection was established.
      send(`data: ${JSON.stringify({ revision: getRevision() })}\n\n`);

      // Push a new revision to this client whenever bumpRevision() is called
      // (e.g. after a successful tutorial shot save).
      const unsubscribe = subscribe((revision) => {
        try {
          send(`data: ${JSON.stringify({ revision })}\n\n`);
        } catch {
          abort();
        }
      });

      const keepAlive = setInterval(() => {
        // Comment frame (ignored by clients).
        try {
          send(':keep-alive\n\n');
        } catch {
          abort();
        }
      }, 30_000);

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
