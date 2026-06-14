import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  const revision = process.env.COURSE_DOCS_SITE_DEV_REVISION ?? '';
  const response = NextResponse.json({ revision });
  response.headers.set('cache-control', 'no-store, max-age=0');
  return response;
}

