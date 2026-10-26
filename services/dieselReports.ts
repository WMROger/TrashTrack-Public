import { Platform, Share } from 'react-native';
import { DieselLog, DieselSchedule } from './dieselService';
import { DieselPlan, dieselSavings } from './dieselMath';

const money = (value: number | null | undefined) => value == null ? 'Not configured' : `PHP ${value.toFixed(2)}`;
const number = (value: number | null | undefined) => value == null ? 'Not recorded' : value.toFixed(2);
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function dieselReportRows(schedules: DieselSchedule[], logs: DieselLog[], plans: Record<string, DieselPlan>) {
  return schedules.map(s => {
    const plan = plans[s.id] || s.routeOptimization?.dieselEstimate;
    const log = logs.find(l => l.scheduleId === s.id);
    const savings = plan ? dieselSavings(plan.baseline, plan.optimized) : null;
    const actual = log?.actual.actualLiters;
    return [s.id, log?.actual.tripDate || s.dateText || '', s.truckPlate || s.truckId, s.driver || s.assignedDriverName || s.driverName || s.assignedDriverId || 'Unassigned', s.barangay,
      log ? (log.actual.isDemo ? 'DEMO' : 'Reported real trip') : 'No actual record', log?.status || 'Not recorded',
      plan?.distanceSource || '', number(plan?.optimizedInputs.distanceKm), number(plan?.optimized.liters), money(plan?.optimized.cost),
      number(savings?.liters), money(savings?.cost), number(log?.actual.distanceKm), number(actual),
      actual != null && plan ? number(actual - plan.optimized.liters) : 'Not recorded',
      actual != null && plan && plan.parameters.pricePerLiter > 0 ? money(actual * plan.parameters.pricePerLiter) : 'Not recorded',
      number(log ? log.actual.drivingHours + log.actual.idleHours + log.actual.collectionHours : null),
      number(log?.actual.collectedKg), plan ? number(plan.parameters.pricePerLiter) : '', log?.actual.fuelMethod || '', log?.actual.evidence || '', log?.reviewNote || '',
      plan?.savedAt || '', plan?.parameterSource || '', number(plan?.parameters.kmPerLiter), number(plan?.parameters.idleLitersPerHour),
      number(plan?.parameters.collectionLitersPerHour), number(plan?.parameters.fullLoadPenaltyPercent), number(plan?.optimizedInputs.averageLoadPercent),
      number(plan?.optimizedInputs.drivingHours), number(plan?.optimizedInputs.idleHours), number(plan?.optimizedInputs.collectionHours),
      number(plan?.optimized.factor), number(plan?.baselineInputs.distanceKm), number(plan?.baseline.liters), money(plan?.baseline.cost)];
  });
}
const headers = ['Trip ID', 'Date', 'Truck', 'Driver', 'Barangay', 'Data type', 'Review status', 'Planned distance source',
  'Planned km', 'Estimated L', 'Estimated cost', 'Projected savings L', 'Projected savings cost', 'Reported km', 'Actual L',
  'Actual minus estimate L', 'Actual cost at saved supply price', 'Operating hours', 'Collected kg', 'Saved PHP/L', 'Fuel measurement', 'Evidence', 'Review note',
  'Estimate saved at', 'Assumption and price source', 'Driving km/L', 'Idle L/hour', 'Collection L/hour', 'Full load penalty %', 'Planned average load %',
  'Planned driving hours', 'Planned idle hours', 'Planned collection hours', 'Learned multiplier', 'Usual route km', 'Usual route L', 'Usual route cost'];
export const csvCell = (value: unknown) => {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
export async function exportDieselCsv(schedules: DieselSchedule[], logs: DieselLog[], plans: Record<string, DieselPlan>) {
  const csv = '\uFEFF' + [headers, ...dieselReportRows(schedules, logs, plans)].map(row => row.map(csvCell).join(',')).join('\r\n');
  if (Platform.OS !== 'web') { await Share.share({ title: 'TrashTrack diesel report', message: csv }); return; }
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `trashtrack-diesel-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
import { exportReport, ExportFormat } from './reportExportService';

export async function exportDieselReport(
  schedules: DieselSchedule[],
  logs: DieselLog[],
  plans: Record<string, DieselPlan>,
  format: ExportFormat
) {
  const rows = dieselReportRows(schedules, logs, plans);
  const displayHeaders = format === 'pdf' ? headers.slice(0, 10) : headers;
  const displayRows = format === 'pdf' ? rows.map((r) => r.slice(0, 10)) : rows;

  await exportReport({
    format,
    filename: `trashtrack-diesel-${new Date().toISOString().slice(0, 10)}`,
    title: 'Diesel Fuel Consumption & Variance Report',
    subtitle: 'City Environment & Natural Resources Office Fuel Intelligence & Trip Variance',
    jurisdiction: 'City of Danao (All Scheduled Trips)',
    generatedBy: 'CENRO Fleet Logistics',
    headers: displayHeaders,
    rows: displayRows,
    summaryCards: [
      { label: 'Total Trips', value: schedules.length },
      { label: 'Trip Logs', value: logs.length },
    ],
    sheetName: 'Diesel_Analytics',
  });
}

export function printDieselReport(schedules: DieselSchedule[], logs: DieselLog[], plans: Record<string, DieselPlan>) {
  if (Platform.OS !== 'web') throw new Error('Open the CENRO web portal to print or save a PDF. CSV sharing is available here.');
  const popup = (globalThis as any).window?.open('', '_blank');
  if (!popup) throw new Error('Allow this site to open the print report.');
  const rows = dieselReportRows(schedules, logs, plans);
  const cards = schedules.map((s, index) => {
    const plan = plans[s.id] || s.routeOptimization?.dieselEstimate;
    return `<article><h2>${escapeHtml(s.truckPlate || s.truckId)} · ${escapeHtml(s.barangay)}</h2><dl>${headers.slice(0, 23).map((h, i) => `<dt>${escapeHtml(h)}</dt><dd>${escapeHtml(rows[index][i])}</dd>`).join('')}</dl>${plan ? `<h3>Saved calculation assumptions</h3><p>${escapeHtml(plan.parameterSource)}. Saved ${escapeHtml(plan.savedAt)}.</p><p>Driving liters = distance ÷ ${plan.parameters.kmPerLiter} km/L × (1 + ${plan.parameters.fullLoadPenaltyPercent}% × average load%). Idle liters = idle hours × ${plan.parameters.idleLitersPerHour} L/h. Collection liters = collection hours × ${plan.parameters.collectionLitersPerHour} L/h. Total liters = component sum × ${plan.optimized.factor.toFixed(4)} learned adjustment. Cost = total liters × ${money(plan.parameters.pricePerLiter)} per liter.</p><p>Usual route: ${number(plan.baselineInputs.distanceKm)} km; ${number(plan.baseline.operatingHours)} h; ${number(plan.baseline.liters)} L; ${money(plan.baseline.cost)}. Optimized route: driving ${number(plan.optimizedInputs.drivingHours)} h, idle ${number(plan.optimizedInputs.idleHours)} h, collection ${number(plan.optimizedInputs.collectionHours)} h, average load ${number(plan.optimizedInputs.averageLoadPercent)}%.</p>` : '<p>No saved planning estimate.</p>'}</article>`;
  }).join('');
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>TrashTrack Diesel Report</title><style>body{font:13px Arial,sans-serif;color:#142b25;max-width:900px;margin:32px auto}h1{color:#166534}article{border-top:2px solid #166534;padding:16px 0;break-inside:avoid}dl{display:grid;grid-template-columns:240px 1fr;gap:5px}dt{font-weight:bold}dd{margin:0;overflow-wrap:anywhere}p{line-height:1.5}@media print{body{margin:0}button{display:none}@page{size:A4;margin:16mm}}</style></head><body><h1>TrashTrack · Diesel Estimate Report</h1><p>Generated ${escapeHtml(new Date().toLocaleString())}. ${schedules.length} trip(s). Projected savings compare usual and optimized plans. Consumption variance compares a saved estimate with reported measurements. Demo records do not establish actual municipal savings. Reported cost uses the saved supply price.</p>${cards}</body></html>`);
  popup.document.close(); popup.focus(); popup.print();
}

