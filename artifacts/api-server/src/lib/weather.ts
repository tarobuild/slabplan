import { HttpError } from "./http";

export type WeatherSnapshot = {
  condition: string;
  icon: string;
  temperatureHigh: number | null;
  temperatureLow: number | null;
  windMph: number | null;
  humidity: number | null;
  precipitation: number;
  fetchedAt: string;
};

export type WeatherCoords = { latitude: number; longitude: number };

export function sanitizeWeatherIcon(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("snow")) return "snow";
  if (normalized.includes("storm") || normalized.includes("thunder")) return "storm";
  if (
    normalized.includes("rain") ||
    normalized.includes("drizzle") ||
    normalized.includes("shower")
  ) {
    return "rain";
  }
  if (normalized.includes("cloud") || normalized.includes("overcast") || normalized.includes("fog")) {
    return "cloud";
  }
  return "sun";
}

export function weatherCodeToCondition(code: number) {
  if (code === 0) return "Sunny";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code >= 45 && code <= 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95 && code <= 99) return "Thunderstorm";
  return "Unknown";
}

export async function geocodeAddress(address: string): Promise<WeatherCoords | null> {
  const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geoUrl.searchParams.set("name", address);
  geoUrl.searchParams.set("count", "1");
  geoUrl.searchParams.set("language", "en");
  geoUrl.searchParams.set("format", "json");

  const geoResponse = await fetch(geoUrl);
  if (!geoResponse.ok) {
    throw new HttpError(502, "Weather geocoding failed.");
  }
  const geoPayload = (await geoResponse.json()) as {
    results?: Array<{ latitude: number; longitude: number; name?: string }>;
  };
  const match = geoPayload.results?.[0];
  if (!match) return null;
  return { latitude: match.latitude, longitude: match.longitude };
}

export async function fetchWeatherForCoords(
  coords: WeatherCoords,
  dateValue: string | null,
): Promise<WeatherSnapshot> {
  const today = new Date().toISOString().slice(0, 10);
  const targetDate = dateValue ?? today;
  const isPast = targetDate < today;
  const weatherUrl = new URL(
    isPast
      ? "https://archive-api.open-meteo.com/v1/archive"
      : "https://api.open-meteo.com/v1/forecast",
  );

  weatherUrl.searchParams.set("latitude", String(coords.latitude));
  weatherUrl.searchParams.set("longitude", String(coords.longitude));
  weatherUrl.searchParams.set("temperature_unit", "fahrenheit");
  weatherUrl.searchParams.set("wind_speed_unit", "mph");
  weatherUrl.searchParams.set("precipitation_unit", "inch");
  weatherUrl.searchParams.set("timezone", "auto");
  weatherUrl.searchParams.set("start_date", targetDate);
  weatherUrl.searchParams.set("end_date", targetDate);
  weatherUrl.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
  );
  weatherUrl.searchParams.set("hourly", "relative_humidity_2m,wind_speed_10m");

  const weatherResponse = await fetch(weatherUrl);
  if (!weatherResponse.ok) {
    throw new HttpError(502, "Weather lookup failed.");
  }

  const payload = (await weatherResponse.json()) as {
    daily?: {
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_sum?: number[];
    };
    hourly?: {
      relative_humidity_2m?: number[];
      wind_speed_10m?: number[];
    };
  };

  if (!payload.daily) {
    throw new HttpError(404, "Weather data is unavailable for that day.");
  }

  const code = payload.daily.weather_code?.[0] ?? 0;
  const humidityValues = payload.hourly?.relative_humidity_2m ?? [];
  const windValues = payload.hourly?.wind_speed_10m ?? [];
  const humidityAverage =
    humidityValues.length > 0
      ? Math.round(humidityValues.reduce((sum, value) => sum + value, 0) / humidityValues.length)
      : null;
  const windMax = windValues.length > 0 ? Math.round(Math.max(...windValues)) : null;
  const condition = weatherCodeToCondition(code);

  return {
    condition,
    icon: sanitizeWeatherIcon(condition),
    temperatureHigh:
      typeof payload.daily.temperature_2m_max?.[0] === "number"
        ? Math.round(payload.daily.temperature_2m_max[0])
        : null,
    temperatureLow:
      typeof payload.daily.temperature_2m_min?.[0] === "number"
        ? Math.round(payload.daily.temperature_2m_min[0])
        : null,
    windMph: windMax,
    humidity: humidityAverage,
    precipitation:
      typeof payload.daily.precipitation_sum?.[0] === "number"
        ? Number(payload.daily.precipitation_sum[0].toFixed(2))
        : 0,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchWeatherForAddress(
  address: string,
  dateValue: string | null,
): Promise<WeatherSnapshot> {
  const coords = await geocodeAddress(address);
  if (!coords) {
    throw new HttpError(404, "Unable to locate that address for weather lookup.");
  }
  return fetchWeatherForCoords(coords, dateValue);
}

type CacheEntry = { value: WeatherSnapshot; expiresAt: number };
const FORECAST_TTL_MS = 60 * 60 * 1000;
const forecastCache = new Map<string, CacheEntry>();

function cacheKey(kind: string, key: string, date: string) {
  return `${kind}|${key}|${date}`;
}

function readCache(key: string): WeatherSnapshot | null {
  const entry = forecastCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    forecastCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key: string, value: WeatherSnapshot) {
  forecastCache.set(key, { value, expiresAt: Date.now() + FORECAST_TTL_MS });
}

export async function getCachedForecastForAddress(
  address: string,
): Promise<WeatherSnapshot | null> {
  const today = new Date().toISOString().slice(0, 10);
  const key = cacheKey("addr", address.trim().toLowerCase(), today);
  const cached = readCache(key);
  if (cached) return cached;
  try {
    const snap = await fetchWeatherForAddress(address, today);
    writeCache(key, snap);
    return snap;
  } catch {
    return null;
  }
}

export async function getCachedForecastForCoords(
  coords: WeatherCoords,
): Promise<WeatherSnapshot | null> {
  const today = new Date().toISOString().slice(0, 10);
  const lat = coords.latitude.toFixed(2);
  const lng = coords.longitude.toFixed(2);
  const key = cacheKey("coords", `${lat},${lng}`, today);
  const cached = readCache(key);
  if (cached) return cached;
  try {
    const snap = await fetchWeatherForCoords(coords, today);
    writeCache(key, snap);
    return snap;
  } catch {
    return null;
  }
}

export function __resetWeatherCacheForTests() {
  forecastCache.clear();
}
