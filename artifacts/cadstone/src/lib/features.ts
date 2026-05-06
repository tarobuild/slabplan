export const FEATURES = {
  reports: false,
} as const

export type FeatureFlag = keyof typeof FEATURES

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURES[flag]
}
