export function selectBackupSizeBaseline(trailing, env, today) {
  const date = env.BACKUP_REVIEWED_BASELINE_DATE?.trim();
  const rawSize = env.BACKUP_REVIEWED_BASELINE_BYTES?.trim();
  const size = Number(rawSize);
  if (date || rawSize) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
        date > today || !Number.isSafeInteger(size) || size <= 0) {
      throw new Error("Reviewed backup baseline requires a valid past/current UTC date and positive byte size from a successful restore.");
    }
  }
  const samples = date ? trailing.filter((entry) => entry.dateStr >= date) : trailing;
  if (samples.length < 3) {
    return date ? { bytes: size, source: "reviewed_restore", sampleCount: samples.length, reviewedDate: date } : null;
  }
  const values = samples.map((entry) => entry.sizeBytes).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return { bytes: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2, source: "trailing_median", sampleCount: samples.length };
}
