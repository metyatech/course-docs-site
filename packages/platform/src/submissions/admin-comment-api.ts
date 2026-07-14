export const ADMIN_SESSION_EXPIRED_MESSAGE =
  '管理者セッションの有効期限が切れています。管理者モードを再度有効にしてください。';

export const buildAdminCommentDeletePath = (commentId: string) =>
  `/api/admin/comments/${encodeURIComponent(commentId)}`;

export const readApiError = async (response: Response, fallback: string): Promise<string> => {
  try {
    const data = (await response.json()) as { error?: unknown };
    if (typeof data.error === 'string' && data.error.length > 0) {
      return data.error;
    }
  } catch {
    // Non-JSON responses must not expose their raw body to users.
  }
  return fallback;
};

export type AdminCommentDeleteFailure = {
  disableAdminMode: boolean;
  message: string;
};

export const getAdminCommentDeleteFailure = async (
  response: Response,
): Promise<AdminCommentDeleteFailure> => {
  if (response.status === 401) {
    return {
      disableAdminMode: true,
      message: ADMIN_SESSION_EXPIRED_MESSAGE,
    };
  }

  return {
    disableAdminMode: false,
    message: await readApiError(response, '削除に失敗しました。'),
  };
};
