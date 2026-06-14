import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAdminModeCookieName, isAdminSessionValid } from "../admin-mode";
import { getCurrentCourseSite } from "../current-course-site";
import { isSameOriginMutation } from "./same-origin";
import { deleteComment } from "./comment-delete";

const NO_STORE = "no-store";

export type GetCookieValue = () => Promise<string | undefined> | string | undefined;

export type IsAdminSessionValidFn = (
  value: string | null | undefined,
) => Promise<boolean> | boolean;

export type IsAdminCommentModerationEnabled = () => boolean;

export type IsSameOriginMutationFn = (request: Request) => boolean;

export type DeleteCommentFn = (
  commentId: string,
) => Promise<{ ok: true } | { ok: false; error: string; status: number }>;

export type CreateAdminCommentDeleteRouteOptions = {
  isSameOriginMutation?: IsSameOriginMutationFn;
  getCookieValue?: GetCookieValue;
  isAdminSessionValid?: IsAdminSessionValidFn;
  isAdminCommentModerationEnabled?: IsAdminCommentModerationEnabled;
  deleteComment?: DeleteCommentFn;
};

const json = (body: unknown, init: ResponseInit = {}): Response => {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", NO_STORE);
  return response;
};

const defaultGetCookieValue: GetCookieValue = async () => {
  const store = await cookies();
  return store.get(getAdminModeCookieName())?.value;
};

const defaultIsAdminCommentModerationEnabled: IsAdminCommentModerationEnabled = () =>
  getCurrentCourseSite()?.features.adminCommentModeration === true;

export const createAdminCommentDeleteRoute = (
  options: CreateAdminCommentDeleteRouteOptions = {},
) => {
  const isSameOrigin = options.isSameOriginMutation ?? isSameOriginMutation;
  const getCookieValue = options.getCookieValue ?? defaultGetCookieValue;
  const isSessionValid = options.isAdminSessionValid ?? isAdminSessionValid;
  const isAdminCommentModerationEnabledFn =
    options.isAdminCommentModerationEnabled ?? defaultIsAdminCommentModerationEnabled;
  const deleteCommentFn = options.deleteComment ?? deleteComment;

  return async function DELETE(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    if (!isSameOrigin(request)) {
      return json({ error: "Forbidden" }, { status: 403 });
    }

    const cookieValue = await getCookieValue();
    const enabled = await isSessionValid(cookieValue ?? undefined);
    if (!enabled) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isAdminCommentModerationEnabledFn()) {
      return json({ error: "Comment moderation is not enabled for this site" }, { status: 403 });
    }

    const resolvedParams = await context.params;
    const commentId = resolvedParams?.id ?? "";

    const result = await deleteCommentFn(commentId);
    if (!result.ok) {
      return json({ error: result.error }, { status: result.status });
    }

    return json({ ok: true });
  };
};
