/**
 * Geocoding & Reverse Geocoding Service for Danao City, Cebu
 * Powered by OpenStreetMap Nominatim (100% Free Public API, No Key Required)
 * Accurately translates GPS coordinates into street names, landmarks, and Danao City barangays across Web, iOS, and Android.
 */

import { DANAO_CITY_BARANGAYS, resolveScheduleBarangays } from '@/constants/danaoBarangays';

export interface GeocodeAddressResult {
  fullAddress: string;
  street: string;
  barangay: string;
  city: string;
  province: string;
  postcode?: string;
  latitude: number;
  longitude: number;
  displayName: string;
}

// In-memory cache for coordinates to avoid redundant network calls
const geocodeCache = new Map<string, GeocodeAddressResult>();

/**
 * Normalizes string for barangay matching
 */
function cleanBarangayName(str?: string | null): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/^brgy\.?\s*/i, '')
    .replace(/^barangay\s*/i, '')
    .replace(/\s*city$/i, '')
    .trim();
}

/**
 * Matches extracted address parts against the 42 official Danao City barangays
 */
function matchDanaoBarangay(candidates: string[]): string {
  const allBarangays = [...DANAO_CITY_BARANGAYS];

  // 1. Exact match
  for (const cand of candidates) {
    const cleanedCand = cleanBarangayName(cand);
    if (!cleanedCand) continue;
    const match = allBarangays.find(b => cleanBarangayName(b) === cleanedCand);
    if (match) return match;
  }

  // 2. Substring match
  for (const cand of candidates) {
    const cleanedCand = cleanBarangayName(cand);
    if (cleanedCand.length < 3) continue;
    const match = allBarangays.find(b => {
      const cleanB = cleanBarangayName(b);
      return cleanB.includes(cleanedCand) || cleanedCand.includes(cleanB);
    });
    if (match) return match;
  }

  return '';
}

/**
 * Performs Reverse Geocoding (Converts Latitude & Longitude to exact Street & Danao City Barangay).
 */
export async function reverseGeocodeCoords(latitude: number, longitude: number): Promise<GeocodeAddressResult> {
  const cacheKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey)!;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'TrashTrack-DanaoCity-WasteManagement/1.0',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Nominatim responded with HTTP ${response.status}`);
    }

    const data = await response.json();
    const addr = data.address || {};

    const street = addr.road || addr.street || addr.pedestrian || addr.footway || addr.suburb || addr.neighbourhood || '';
    const candBarangays = [
      addr.suburb,
      addr.village,
      addr.quarter,
      addr.neighbourhood,
      addr.district,
      addr.city_district,
    ].filter(Boolean) as string[];

    const matchedBarangay = matchDanaoBarangay(candBarangays) || addr.village || addr.suburb || 'Poblacion';
    const city = addr.city || addr.town || addr.municipality || 'Danao City';
    const province = addr.province || addr.state || 'Cebu';
    const postcode = addr.postcode || '6004';

    const fullAddress = [street, matchedBarangay ? `Brgy. ${matchedBarangay}` : null, city, province]
      .filter(Boolean)
      .join(', ');

    const result: GeocodeAddressResult = {
      fullAddress: fullAddress || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      street: street || fullAddress || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      barangay: matchedBarangay,
      city,
      province,
      postcode,
      latitude,
      longitude,
      displayName: data.display_name || fullAddress,
    };

    geocodeCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.warn('Nominatim reverse geocode failed, using fallback:', error);

    const fallback: GeocodeAddressResult = {
      fullAddress: `Coordinates: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}, Danao City, Cebu`,
      street: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      barangay: 'Poblacion',
      city: 'Danao City',
      province: 'Cebu',
      latitude,
      longitude,
      displayName: `Danao City, Cebu (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`,
    };
    return fallback;
  }
}

/**
 * Searches for coordinates and address details in Danao City by street or landmark query.
 */
export async function forwardGeocodeDanaoLocation(queryText: string): Promise<GeocodeAddressResult | null> {
  const cleanQuery = queryText.trim();
  if (!cleanQuery) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const fullQuery = cleanQuery.toLowerCase().includes('danao')
      ? cleanQuery
      : `${cleanQuery}, Danao City, Cebu, Philippines`;

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(fullQuery)}&limit=1&addressdetails=1`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'TrashTrack-DanaoCity-WasteManagement/1.0',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data: any[] = await response.json();
    if (!data || data.length === 0) return null;

    const first = data[0];
    const lat = Number(first.lat);
    const lon = Number(first.lon);
    const addr = first.address || {};

    const street = addr.road || addr.street || first.name || cleanQuery;
    const candBarangays = [addr.suburb, addr.village, addr.quarter, addr.neighbourhood, addr.city_district].filter(Boolean) as string[];
    const matchedBarangay = matchDanaoBarangay(candBarangays) || 'Poblacion';

    return {
      fullAddress: first.display_name,
      street,
      barangay: matchedBarangay,
      city: addr.city || 'Danao City',
      province: addr.state || 'Cebu',
      latitude: lat,
      longitude: lon,
      displayName: first.display_name,
    };
  } catch (error) {
    console.warn('Nominatim search failed:', error);
    return null;
  }
}
