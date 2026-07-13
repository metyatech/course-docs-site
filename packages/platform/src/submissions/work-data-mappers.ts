export type WorkIntroRow = {
  student_id: string;
  intro: string | null;
  updated_at: string | null;
};

export type WorkIntroMap = Record<string, string | undefined>;

export type WorkCommentRow = {
  id: string;
  student_id: string;
  author_name: string | null;
  message: string;
  created_at: string;
};

export type WorkComment = {
  id: string;
  studentId: string;
  authorName: string;
  message: string;
  createdAt: string;
};

export type WorkCommentMap = Record<string, WorkComment[]>;

export const mapWorkIntros = (rows: WorkIntroRow[]): WorkIntroMap => {
  return rows.reduce<WorkIntroMap>((acc, row) => {
    if (row.intro) {
      acc[row.student_id] = row.intro;
    }
    return acc;
  }, {});
};

export const mapWorkComments = (rows: WorkCommentRow[]): WorkCommentMap => {
  return rows.reduce<WorkCommentMap>((acc, row) => {
    const comment: WorkComment = {
      id: row.id,
      studentId: row.student_id,
      authorName: row.author_name?.trim() || '匿名',
      message: row.message,
      createdAt: row.created_at,
    };

    if (!acc[row.student_id]) {
      acc[row.student_id] = [];
    }

    acc[row.student_id].push(comment);
    return acc;
  }, {});
};
