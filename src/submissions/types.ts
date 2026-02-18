export type StudentWorkEntry = {
  studentId: string;
  workPath: string | null;
};

export type StudentWorksData = {
  years: Record<string, StudentWorkEntry[]>;
};
