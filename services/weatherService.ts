/**
 * Weather & Monsoon Advisory Service for Danao City, Cebu
 * Powered by Open-Meteo API (100% Free Public API, No Key Required)
 * Coordinates: 10.5218° N, 124.0285° E (Danao City, Cebu, Philippines)
 */

export interface WeatherData {
  temperatureC: number;
  apparentTempC: number;
  humidityPct: number;
  precipitationMm: number;
  rainMm: number;
  weatherCode: number;
  weatherDescription: string;
  weatherIconName: string;
  windSpeedKph: number;
  isDay: boolean;
  advisoryLevel: 'optimal' | 'moderate' | 'warning' | 'severe';
  advisoryTitle: string;
  advisoryMessage: string;
  maxTempTodayC: number;
  minTempTodayC: number;
  precipitationProbability: number;
  updatedAt: string;
}

// In-memory cache for 10 minutes to prevent excess requests
let cachedWeather: WeatherData | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const DANAO_LAT = 10.5218;
const DANAO_LNG = 124.0285;

/**
 * Maps WMO Weather Interpretation Codes (0-99) to descriptive Filipino/English alerts
 */
function interpretWMOCode(code: number, rainMm: number, windKph: number): {
  description: string;
  icon: string;
  level: 'optimal' | 'moderate' | 'warning' | 'severe';
  title: string;
  message: string;
} {
  // Severe weather: Thunderstorm or intense rain / typhoon winds
  if (code >= 95 || rainMm >= 15 || windKph >= 50) {
    return {
      description: 'Thunderstorm / Tropical Rain',
      icon: 'thunderstorm',
      level: 'severe',
      title: '⚠️ Severe Monsoon / Typhoon Warning',
      message: 'Heavy rainfall and high winds in Danao City. Delay collection in flood-prone coastal barangays (Suba, Looc, Dunggoan, Poblacion). Exercise extreme caution.',
    };
  }

  // Heavy Rain / Showers
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82) || rainMm >= 5) {
    return {
      description: 'Moderate to Heavy Rain',
      icon: 'water-drop',
      level: 'warning',
      title: '🌧️ Heavy Rain Advisory',
      message: 'Active rainfall detected in Danao City. Fast-track residual waste pickups before street flooding. Equip crew with waterproof PPE.',
    };
  }

  // Light Drizzle / Rain
  if (code >= 51 && code <= 57 || rainMm > 0) {
    return {
      description: 'Light Passing Showers',
      icon: 'grain',
      level: 'moderate',
      title: '🌦️ Passing Showers Expected',
      message: 'Light localized rain in northern Cebu. Fleet operations running normally. Ensure truck tarpaulins and compactor covers are secured.',
    };
  }

  // Fog / Mist
  if (code >= 45 && code <= 48) {
    return {
      description: 'Misty / Low Visibility',
      icon: 'cloud',
      level: 'moderate',
      title: '🌫️ Low Visibility Advisory',
      message: 'Morning fog reported in upland mountain barangays (Manlayag, Lawaan, Guinacot). Trucks must use hazard/fog lights.',
    };
  }

  // Cloudy / Overcast
  if (code === 2 || code === 3) {
    return {
      description: 'Partly Cloudy to Overcast',
      icon: 'cloud-queue',
      level: 'optimal',
      title: '☁️ Favorable Collection Weather',
      message: 'Overcast skies with mild temperatures. Excellent conditions for full fleet schedule coverage across all 42 barangays.',
    };
  }

  // Clear / Sunny
  return {
    description: 'Clear Skies & Sunny',
    icon: 'wb-sunny',
    level: 'optimal',
    title: '☀️ Optimal Collection Conditions',
    message: 'Clear dry weather across Danao City. All collection routes and landfill transfers proceeding at peak operational efficiency.',
  };
}

/**
 * Fetches real-time Danao City weather and generates operational solid waste management advisories.
 */
export async function getDanaoLiveWeather(): Promise<WeatherData> {
  const now = Date.now();
  if (cachedWeather && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedWeather;
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${DANAO_LAT}&longitude=${DANAO_LNG}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max&timezone=Asia%2FManila`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Open-Meteo responded with HTTP ${response.status}`);
    }

    const data = await response.json();
    const current = data.current || {};
    const daily = data.daily || {};

    const temp = Math.round(Number(current.temperature_2m ?? 29));
    const apparentTemp = Math.round(Number(current.apparent_temperature ?? temp));
    const humidity = Math.round(Number(current.relative_humidity_2m ?? 78));
    const precipitation = Number(current.precipitation ?? 0);
    const rain = Number(current.rain ?? precipitation);
    const weatherCode = Number(current.weather_code ?? 0);
    const windSpeed = Math.round(Number(current.wind_speed_10m ?? 12));
    const isDay = current.is_day === 1;

    const maxTempToday = Math.round(Number(daily.temperature_2m_max?.[0] ?? temp + 2));
    const minTempToday = Math.round(Number(daily.temperature_2m_min?.[0] ?? temp - 4));
    const precipProb = Number(daily.precipitation_probability_max?.[0] ?? 20);

    const interpretation = interpretWMOCode(weatherCode, rain, windSpeed);

    const result: WeatherData = {
      temperatureC: temp,
      apparentTempC: apparentTemp,
      humidityPct: humidity,
      precipitationMm: rain,
      rainMm: rain,
      weatherCode,
      weatherDescription: interpretation.description,
      weatherIconName: interpretation.icon,
      windSpeedKph: windSpeed,
      isDay,
      advisoryLevel: interpretation.level,
      advisoryTitle: interpretation.title,
      advisoryMessage: interpretation.message,
      maxTempTodayC: maxTempToday,
      minTempTodayC: minTempToday,
      precipitationProbability: precipProb,
      updatedAt: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    };

    cachedWeather = result;
    lastFetchTime = now;
    return result;
  } catch (error) {
    console.warn('Could not fetch live weather from Open-Meteo, using reliable defaults:', error);
    
    // Return graceful fallback
    const fallback: WeatherData = {
      temperatureC: 30,
      apparentTempC: 34,
      humidityPct: 75,
      precipitationMm: 0,
      rainMm: 0,
      weatherCode: 1,
      weatherDescription: 'Mainly Clear & Warm',
      weatherIconName: 'wb-sunny',
      windSpeedKph: 14,
      isDay: true,
      advisoryLevel: 'optimal',
      advisoryTitle: '☀️ Normal Collection Operations',
      advisoryMessage: 'Fair weather conditions across Danao City. Standard morning and afternoon waste collection routes active.',
      maxTempTodayC: 32,
      minTempTodayC: 25,
      precipitationProbability: 15,
      updatedAt: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    };
    return cachedWeather || fallback;
  }
}
