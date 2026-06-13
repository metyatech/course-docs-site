import { createClient } from "@supabase/supabase-js";

export type AdminSupabaseClient = ReturnType<typeof createClient>;
export type AdminSupabaseFactory = () => AdminSupabaseClient | null;

const getDefaultSupabaseFactory = (): AdminSupabaseFactory => () => {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
};

const COMMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type DeleteCommentResult = { ok: true } | { ok: false; error: string; status: number };

export type CreateAdminCommentDeleteHandlerOptions = {
  createSupabase?: AdminSupabaseFactory;
};

export const createAdminCommentDeleteHandler = (
  options: CreateAdminCommentDeleteHandlerOptions = {},
) => {
  const createSupabase = options.createSupabase ?? getDefaultSupabaseFactory();
  return {
    deleteComment: async (commentId: string): Promise<DeleteCommentResult> => {
      if (typeof commentId !== "string" || !COMMENT_ID_PATTERN.test(commentId)) {
        return { ok: false, error: "Invalid comment id", status: 400 };
      }
      const supabase = createSupabase();
      if (!supabase) {
        return { ok: false, error: "Server not configured", status: 500 };
      }
      try {
        const { data, error } = await supabase
          .from("work_comments")
          .delete()
          .eq("id", commentId)
          .select("id");
        if (error) {
          return { ok: false, error: "Failed to delete comment", status: 500 };
        }
        if (!data || (Array.isArray(data) && data.length === 0)) {
          return { ok: false, error: "Comment not found", status: 404 };
        }
        return { ok: true };
      } catch {
        return { ok: false, error: "Failed to delete comment", status: 500 };
      }
    },
  };
};

// Default singleton for use by the route
const defaultHandler = createAdminCommentDeleteHandler();
export const deleteComment = defaultHandler.deleteComment;

// Keep getAdminSupabase for tests
export const getAdminSupabase = getDefaultSupabaseFactory();
