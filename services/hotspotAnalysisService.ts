export type LocationLike = { lat?: number; lng?: number; latitude?: number; longitude?: number } | null | undefined;

export type Hotspot = {
  id: string;
  latitude: number;
  longitude: number;
  reportCount: number;
  intensity: number;
};

export function buildHotspots(locations: LocationLike[], cellSizeDegrees = 0.002): {
  hotspots: Hotspot[];
  geocodedCount: number;
  missingLocationCount: number;
} {
  const cells = new Map<string, { latitudeTotal: number; longitudeTotal: number; count: number }>();
  let geocodedCount = 0;

  locations.forEach(location => {
    const latitude = location?.lat ?? location?.latitude;
    const longitude = location?.lng ?? location?.longitude;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    geocodedCount += 1;
    const key = `${Math.floor(Number(latitude) / cellSizeDegrees)}:${Math.floor(Number(longitude) / cellSizeDegrees)}`;
    const cell = cells.get(key) || { latitudeTotal: 0, longitudeTotal: 0, count: 0 };
    cell.latitudeTotal += Number(latitude);
    cell.longitudeTotal += Number(longitude);
    cell.count += 1;
    cells.set(key, cell);
  });

  const maximum = Math.max(1, ...Array.from(cells.values()).map(cell => cell.count));
  const hotspots = Array.from(cells.entries()).map(([id, cell]) => ({
    id,
    latitude: cell.latitudeTotal / cell.count,
    longitude: cell.longitudeTotal / cell.count,
    reportCount: cell.count,
    intensity: Math.round((cell.count / maximum) * 100),
  })).sort((a, b) => b.reportCount - a.reportCount);

  return { hotspots, geocodedCount, missingLocationCount: locations.length - geocodedCount };
}
