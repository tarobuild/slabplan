import Constants from "expo-constants";

const apiBaseUrl =
  process.env.EXPO_PUBLIC_SLABPLAN_API_BASE_URL ??
  process.env.EXPO_PUBLIC_CADSTONE_API_BASE_URL ??
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  "";

export function getApiBaseUrl(): string {
  const trimmed = apiBaseUrl.trim().replace(/\/+$/, "");

  if (!trimmed) {
    throw new Error(
      "SlabPlan mobile needs EXPO_PUBLIC_SLABPLAN_API_BASE_URL, for example https://slabplan.replit.app.",
    );
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("EXPO_PUBLIC_SLABPLAN_API_BASE_URL must be an absolute URL.");
  }

  return trimmed;
}
