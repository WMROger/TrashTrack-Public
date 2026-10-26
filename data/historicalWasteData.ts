import { HISTORICAL_TONS_PER_CUBIC_METER, toMetricTons } from '@/utils/wasteUnits';

export type HistoricalWastePoint = {
  period: string;
  value: number;
  unit: 'ton';
  sourceValue: number;
  sourceUnit: 'm3';
  conversionFactorTonsPerM3: number;
  source: 'Danao City historical workbook';
  qualityNote?: string;
};

// Source-reported monthly totals for the workbook's first (unnamed) route block.
// 2021 is excluded because it begins in June. November-December 2025 zero placeholders
// are excluded. The unidentified source block and mixed units must be resolved before
// combining this series with the second block or using it for official budget estimates.
const yearlyTotals: Record<number, number[]> = {
  2022: [763.95, 590.98, 611.83, 673.17, 603.13, 756.58, 722.44, 811.76, 812.76, 862.78, 770.18, 923.81],
  2023: [1236.23, 1324.70, 1476.22, 1386.31, 1393.96, 809.42, 1160.46, 1156.39, 1200.06, 1200.44, 1068.59, 1219.38],
  2024: [1077.88, 1152.57, 1100.43, 1063.44, 1370.67, 1205.00, 1498.10, 1373.95, 1349.09, 1358.47, 1227.36, 1148.38],
  2025: [1580.93, 1244.89, 1239.17, 1636.88, 1449.44, 1156.62, 1330.75, 1041.55, 1361.19, 1258.72],
};

export const historicalWasteSeries: HistoricalWastePoint[] = Object.entries(yearlyTotals).flatMap(
  ([yearText, values]) => values.map((sourceValue, monthIndex) => ({
    period: `${yearText}-${String(monthIndex + 1).padStart(2, '0')}`,
    value: toMetricTons(sourceValue, 'm3'),
    unit: 'ton' as const,
    sourceValue,
    sourceUnit: 'm3' as const,
    conversionFactorTonsPerM3: HISTORICAL_TONS_PER_CUBIC_METER,
    source: 'Danao City historical workbook' as const,
    qualityNote: yearText === '2023'
      ? 'Source total retained; detailed rows require reconciliation.'
      : undefined,
  }))
);

export const historicalWasteDataNotes = [
  'Series represents source Block A only because the workbook does not identify its two route blocks.',
  `Displayed values are estimated metric tons converted from source volumes using ${HISTORICAL_TONS_PER_CUBIC_METER} t/m³ as a planning density; original m³ values are retained on every point.`,
  '2021 partial data and 2025 November-December zero placeholders are excluded.',
  '2023 source totals are retained, but route-detail reconciliation remains required.',
];
