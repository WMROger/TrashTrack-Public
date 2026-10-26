export type FleetCoordinate = { latitude: number; longitude: number };

export type FleetTrackingContext = {
  routePolyline?: FleetCoordinate[];
  activeScheduleIds?: string[];
  barangay?: string;
  assignedBarangay?: string;
  driverName?: string;
  assignedDriverName?: string;
  plateNumber?: string;
  truckPlate?: string;
};

const radians = (degrees: number) => degrees * Math.PI / 180;

export function distanceMeters(a: FleetCoordinate, b: FleetCoordinate) {
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function distanceFromRouteMeters(point: FleetCoordinate, route: FleetCoordinate[] = []) {
  if (!route.length) return null;
  if (route.length === 1) return distanceMeters(point, route[0]);
  const metersPerDegreeLatitude = 111_320;
  const metersPerDegreeLongitude = metersPerDegreeLatitude * Math.cos(radians(point.latitude));
  const project = (coordinate: FleetCoordinate) => ({
    x: (coordinate.longitude - point.longitude) * metersPerDegreeLongitude,
    y: (coordinate.latitude - point.latitude) * metersPerDegreeLatitude,
  });
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < route.length - 1; index += 1) {
    const start = project(route[index]);
    const end = project(route[index + 1]);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(start.x * dx + start.y * dy) / lengthSquared));
    minimum = Math.min(minimum, Math.hypot(start.x + t * dx, start.y + t * dy));
  }
  return minimum;
}

export function dailyTripId(driverId: string, truckId: string, date = new Date()) {
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${truckId}-${driverId}-${localDate}`;
}
