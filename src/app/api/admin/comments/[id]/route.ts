import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAdminModeCookieName, isAdminSessionValid } from "../../../../../lib/admin-mode";
import { deleteComment } from "../../../../../lib/admin/comment-delete";
import { isSameOriginMutation } from "../../../../../lib/admin/same-origin";
import { getCurrentCourseSite } from "../../../../../lib/current-course-site";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cookieStore = await cookies();
  const enabled = await isAdminSessionValid(cookieStore.get(getAdminModeCookieName())?.value);

  if (!enabled) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (getCurrentCourseSite()?.features.adminCommentModeration !== true) {
    return NextResponse.json(
      { error: "Comment moderation is not enabled for this site" },
      { status: 403 },
    );
  }

  const resolvedParams = await context.params;
  const commentId = resolvedParams.id;

  const result = await deleteComment(commentId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
