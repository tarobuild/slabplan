export function escapeLikePattern(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

export function buildContainsLikePattern(value: string) {
  return `%${escapeLikePattern(value)}%`;
}
