export const normalizeIntroInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\r\n/g, '\n');
};
