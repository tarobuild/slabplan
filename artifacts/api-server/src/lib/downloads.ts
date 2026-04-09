export function sanitizeDownloadFilename(filename: string): string {
  return filename.replace(/[^\w .-]/g, "_");
}
