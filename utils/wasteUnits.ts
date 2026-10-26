export type WasteMeasurementUnit = 'kg' | 'ton' | 'm3';

/**
 * Planning conversion used only when the historical source provides volume.
 * The original m3 value remains attached to each historical point for traceability.
 * Reference: World Bank municipal solid-waste cost guidance uses 0.16 t/m3 for
 * waste stored in containers.
 */
export const HISTORICAL_TONS_PER_CUBIC_METER = 0.16;

export function toMetricTons(value: number, unit: WasteMeasurementUnit): number {
  if (!Number.isFinite(value)) return 0;
  if (unit === 'kg') return value / 1000;
  if (unit === 'm3') return value * HISTORICAL_TONS_PER_CUBIC_METER;
  return value;
}

export function parseWasteAmountToMetricTons(
  value: unknown,
  fallbackUnit: WasteMeasurementUnit = 'kg',
): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? toMetricTons(value, fallbackUnit) : null;
  }
  if (typeof value !== 'string') return null;

  const parsed = Number.parseFloat(value.replace(/,/g, '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  const normalized = value.toLowerCase();
  if (/m(?:3|³)|cubic\s*(?:meter|metre)/.test(normalized)) return toMetricTons(parsed, 'm3');
  if (/\bkg\b|kilogram/.test(normalized)) return toMetricTons(parsed, 'kg');
  if (/\b(?:metric\s+)?ton(?:ne)?s?\b|\bt\b/.test(normalized)) return parsed;
  return toMetricTons(parsed, fallbackUnit);
}

export function formatMetricTons(value: number | null | undefined, maximumFractionDigits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString(undefined, { maximumFractionDigits })} t`;
}

/**
 * Shows smaller weights in kilograms and switches to metric tons at 1,000 kg.
 * Values remain normalized as metric tons internally for forecasting and budgets.
 */
export function formatAdaptiveMassFromMetricTons(
  value: number | null | undefined,
  maximumFractionDigits = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';

  if (Math.abs(value) < 1) {
    return `${(value * 1000).toLocaleString(undefined, { maximumFractionDigits })} kg`;
  }

  return `${value.toLocaleString(undefined, { maximumFractionDigits })} t`;
}

export function formatWasteAmount(value: unknown): string {
  return formatAdaptiveMassFromMetricTons(parseWasteAmountToMetricTons(value));
}
