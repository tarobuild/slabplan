export function completionStateForProgress(nextProgress: number | null | undefined) {
  const progress = nextProgress ?? 0
  return {
    progress,
    isComplete: progress >= 100,
  }
}
