import { Platform, Share, Alert } from 'react-native';
import * as XLSX from 'xlsx';

export type ExportFormat = 'pdf' | 'xlsx' | 'csv';

export interface ExportReportChartDataset {
  label: string;
  data: number[];
  color?: string;
  strokeWidth?: number;
}

export interface ExportReportChart {
  title?: string;
  labels: string[];
  datasets: ExportReportChartDataset[];
  unit?: string;
}

export interface ExportReportOptions {
  filename: string;
  title: string;
  subtitle?: string;
  jurisdiction?: string;
  generatedBy?: string;
  metadata?: { label: string; value: string | number }[];
  summaryCards?: { label: string; value: string | number }[];
  headers: string[];
  rows: (string | number | boolean | null | undefined)[][];
  format: ExportFormat;
  sheetName?: string;
  chart?: ExportReportChart;
}

const escapeHtml = (val: unknown): string => {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const escapeCsvCell = (val: unknown): string => {
  let str = String(val ?? '');
  // Neutralize spreadsheet formula injection
  if (/^[\s]*[=+@-]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
};

function renderSvgChartHtml(chart: ExportReportChart): string {
  if (!chart || !chart.datasets || chart.datasets.length === 0 || !chart.labels || chart.labels.length === 0) {
    return '';
  }

  const allValues: number[] = [];
  chart.datasets.forEach((ds) => {
    ds.data.forEach((v) => {
      if (typeof v === 'number' && Number.isFinite(v)) {
        allValues.push(v);
      }
    });
  });

  if (allValues.length === 0) return '';

  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const rawDiff = rawMax - rawMin || 1;
  const paddedMin = Math.max(0, Math.floor((rawMin - rawDiff * 0.1) * 10) / 10);
  const paddedMax = Math.ceil((rawMax + rawDiff * 0.1) * 10) / 10;
  const range = paddedMax - paddedMin || 1;

  const svgWidth = 800;
  const svgHeight = 150;
  const leftPad = 48;
  const rightPad = 16;
  const topPad = 12;
  const bottomPad = 26;
  const plotW = svgWidth - leftPad - rightPad;
  const plotH = svgHeight - topPad - bottomPad;
  const baselineY = topPad + plotH;

  // 5 horizontal grid lines
  const gridSteps = 4;
  let gridLinesSvg = '';
  for (let i = 0; i <= gridSteps; i++) {
    const frac = i / gridSteps;
    const y = topPad + frac * plotH;
    const val = paddedMax - frac * range;
    const formattedVal = val >= 100 ? Math.round(val).toString() : val.toFixed(1);
    const unitStr = chart.unit ? ` ${chart.unit}` : '';
    gridLinesSvg += `
      <line x1="${leftPad}" y1="${y.toFixed(1)}" x2="${(svgWidth - rightPad).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="4 4"/>
      <text x="${leftPad - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="8.5" font-weight="600" fill="#64748B">${formattedVal}${unitStr}</text>
    `;
  }

  // Defs & Datasets rendering
  let defsSvg = '';
  let pathsSvg = '';

  chart.datasets.forEach((ds, dsIdx) => {
    const color = ds.color || (dsIdx === 0 ? '#059669' : '#7C3AED');
    const gradId = `chartGrad_${dsIdx}`;

    defsSvg += `
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
      </linearGradient>
    `;

    const points = ds.data.map((val, idx) => {
      const x = leftPad + (idx / Math.max(1, chart.labels.length - 1)) * plotW;
      const clamped = Math.max(paddedMin, Math.min(paddedMax, val));
      const y = topPad + (1 - (clamped - paddedMin) / range) * plotH;
      return { x, y, val };
    });

    if (points.length === 0) return;

    let pathD = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cpX1 = p0.x + (p1.x - p0.x) * 0.45;
      const cpY1 = p0.y;
      const cpX2 = p1.x - (p1.x - p0.x) * 0.45;
      const cpY2 = p1.y;
      pathD += ` C ${cpX1.toFixed(1)} ${cpY1.toFixed(1)}, ${cpX2.toFixed(1)} ${cpY2.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
    }

    const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${baselineY.toFixed(1)} L ${points[0].x.toFixed(1)} ${baselineY.toFixed(1)} Z`;

    const dotsSvg = points
      .map(
        (p) => `
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2" fill="${color}" stroke="#FFFFFF" stroke-width="1.6"/>
      `
      )
      .join('');

    pathsSvg += `
      <!-- Area Fill -->
      <path d="${areaD}" fill="url(#${gradId})"/>
      <!-- Curve Line -->
      <path d="${pathD}" fill="none" stroke="${color}" stroke-width="${ds.strokeWidth || 2.2}" stroke-linecap="round" stroke-linejoin="round"/>
      <!-- Data Nodes -->
      ${dotsSvg}
    `;
  });

  // X Axis Labels
  const labelStep = chart.labels.length > 20 ? 3 : chart.labels.length > 14 ? 2 : 1;
  const xLabelsSvg = chart.labels
    .map((lbl, idx) => {
      if (!lbl || (idx % labelStep !== 0 && idx !== chart.labels.length - 1)) return '';
      const x = leftPad + (idx / Math.max(1, chart.labels.length - 1)) * plotW;
      const y = topPad + plotH + 16;
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="#64748B">${escapeHtml(lbl)}</text>`;
    })
    .join('');

  const legendHtml = chart.datasets
    .map((ds, idx) => {
      const color = ds.color || (idx === 0 ? '#059669' : '#7C3AED');
      return `
      <div class="legend-item">
        <span class="legend-indicator" style="background-color: ${color};"></span>
        <span class="legend-label">${escapeHtml(ds.label)}</span>
      </div>
    `;
    })
    .join('');

  return `
    <div class="chart-card">
      <div class="chart-card-header">
        <div class="chart-card-title-group">
          <div class="chart-eyebrow">Visual Telemetry &amp; Projection Horizon</div>
          <div class="chart-card-title">${escapeHtml(chart.title || 'Analytical Trend & Forecast Trajectory')}</div>
        </div>
        <div class="chart-legend">
          ${legendHtml}
        </div>
      </div>
      <div class="chart-svg-container">
        <svg viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="xMidYMid meet" class="chart-svg">
          <defs>
            ${defsSvg}
          </defs>
          <!-- Grid Lines & Y Axis -->
          ${gridLinesSvg}
          <!-- Curves & Areas -->
          ${pathsSvg}
          <!-- X Axis Labels -->
          ${xLabelsSvg}
        </svg>
      </div>
    </div>
  `;
}

export function buildOfficialReportHtml(options: ExportReportOptions): string {
  const {
    title,
    subtitle = 'Solid Waste Management & Ecological Operations System',
    jurisdiction = 'City of Danao, Cebu',
    generatedBy = 'CENRO Administration',
    metadata = [],
    summaryCards = [],
    headers,
    rows,
    chart,
  } = options;

  const chartHtml = chart ? renderSvgChartHtml(chart) : '';

  const timestamp = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const fullMetadata = [
    { label: 'Report Generated', value: timestamp },
    { label: 'Jurisdiction / Scope', value: jurisdiction },
    { label: 'Authorized Officer', value: generatedBy },
    { label: 'Total Records', value: `${rows.length} record(s)` },
    ...metadata,
  ];

  const metaHtml = fullMetadata
    .map(
      (m) => `
      <div class="meta-item">
        <span class="meta-label">${escapeHtml(m.label)}</span>
        <span class="meta-value">${escapeHtml(m.value)}</span>
      </div>
    `
    )
    .join('');

  const summaryCardsHtml = summaryCards.length > 0
    ? `
      <div class="summary-cards-grid">
        ${summaryCards
          .map(
            (c) => {
              const valStr = String(c.value ?? '').trim();
              const isLong = valStr.length > 16;
              return `
              <div class="summary-card">
                <div class="summary-card-accent"></div>
                <div class="summary-card-inner">
                  <div class="summary-card-label">${escapeHtml(c.label)}</div>
                  <div class="summary-card-value ${isLong ? 'summary-card-value-long' : ''}">${escapeHtml(valStr)}</div>
                </div>
              </div>
            `;
            }
          )
          .join('')}
      </div>
    `
    : '';

  const renderCellContent = (val: unknown): string => {
    const str = String(val ?? '').trim();
    const lower = str.toLowerCase();
    if (lower === 'completed' || lower === 'verified' || lower === 'id verified' || lower === 'active') {
      return `<span class="badge badge-green">${escapeHtml(str)}</span>`;
    }
    if (lower === 'stopped early' || lower === 'rejected' || lower === 'id rejected' || lower === 'maintenance' || lower === 'out of service') {
      return `<span class="badge badge-red">${escapeHtml(str)}</span>`;
    }
    if (lower === 'pending' || lower === 'in progress' || lower === 'pending review') {
      return `<span class="badge badge-amber">${escapeHtml(str)}</span>`;
    }
    if (lower === 'rate required' || lower === 'unassigned' || lower === 'no truck') {
      return `<span class="badge badge-gray">${escapeHtml(str)}</span>`;
    }
    return escapeHtml(str);
  };

  const tableHeadersHtml = headers
    .map(
      (h) => `
      <th>
        ${escapeHtml(h)}
      </th>
    `
    )
    .join('');

  const tableRowsHtml = rows
    .map(
      (row, idx) => `
      <tr class="${idx % 2 === 1 ? 'row-alt' : ''}">
        ${row
          .map(
            (cell) => `
          <td>
            ${renderCellContent(cell)}
          </td>
        `
          )
          .join('')}
      </tr>
    `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8"/>
      <title>${escapeHtml(title)} - Danao City CENRO</title>
      <style>
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          color: #0F172A;
          margin: 0;
          padding: 16px 20px;
          background-color: #FFFFFF;
          font-size: 11px;
          line-height: 1.35;
          -webkit-font-smoothing: antialiased;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        /* Letterhead Header */
        .header-container {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding-bottom: 2px;
        }
        .header-seal {
          flex-shrink: 0;
        }
        .header-center {
          flex: 1;
          text-align: center;
        }
        .republic-text {
          font-size: 9.5px;
          font-weight: 700;
          color: #475569;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 1px;
        }
        .province-text {
          font-size: 10.5px;
          font-weight: 800;
          color: #0F172A;
          letter-spacing: 0.6px;
          margin-bottom: 2px;
        }
        .agency-title {
          font-size: 14.5px;
          font-weight: 900;
          color: #065F46;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          margin-bottom: 1px;
        }
        .agency-sub {
          font-size: 9.5px;
          font-weight: 600;
          color: #059669;
          letter-spacing: 0.4px;
          text-transform: uppercase;
        }
        .header-badge-col {
          flex-shrink: 0;
          text-align: right;
        }
        .doc-badge {
          display: inline-block;
          background: #ECFDF5 !important;
          border: 1px solid #A7F3D0;
          border-radius: 6px;
          padding: 4px 8px;
          text-align: right;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .doc-badge-status {
          font-size: 8px;
          font-weight: 800;
          color: #047857;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .doc-badge-code {
          font-size: 10px;
          font-weight: 900;
          color: #065F46;
          font-family: monospace;
          margin-top: 1px;
        }

        /* Ribbon Bar */
        .ribbon-bar {
          height: 3px;
          background: linear-gradient(90deg, #064E3B 0%, #059669 35%, #D97706 50%, #059669 65%, #064E3B 100%) !important;
          background-color: #059669 !important;
          border-radius: 2px;
          margin: 8px 0 10px;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        /* Title Block */
        .title-section {
          margin-bottom: 10px;
        }
        .report-eyebrow {
          font-size: 8.5px;
          font-weight: 800;
          color: #0D9488;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          margin-bottom: 2px;
        }
        .report-title {
          margin: 0 0 2px;
          font-size: 15px;
          font-weight: 900;
          color: #0F172A;
          letter-spacing: -0.2px;
          line-height: 1.25;
        }
        .report-subtitle {
          font-size: 10.5px;
          color: #475569;
          font-weight: 500;
          line-height: 1.35;
        }

        /* Meta Box */
        .meta-card {
          background-color: #F8FAFC !important;
          border: 1px solid #E2E8F0;
          border-left: 4px solid #059669;
          border-radius: 6px;
          padding: 8px 12px;
          margin-bottom: 10px;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 6px 12px;
        }
        .meta-item {
          display: flex;
          flex-direction: column;
        }
        .meta-label {
          font-size: 8px;
          font-weight: 800;
          color: #64748B;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 1px;
        }
        .meta-value {
          font-size: 10px;
          font-weight: 700;
          color: #0F172A;
        }

        /* Summary Cards */
        .summary-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
          gap: 8px;
          margin-bottom: 12px;
        }
        .summary-card {
          background: #FFFFFF !important;
          border: 1px solid #E2E8F0;
          border-radius: 6px;
          overflow: hidden;
          box-shadow: 0 1px 2px rgba(0,0,0,0.03);
          display: flex;
          flex-direction: column;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .summary-card-accent {
          height: 2.5px;
          background: linear-gradient(90deg, #059669, #10B981) !important;
          background-color: #059669 !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .summary-card-inner {
          padding: 6px 8px;
          flex: 1;
        }
        .summary-card-label {
          font-size: 7.5px;
          font-weight: 800;
          color: #047857;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 2px;
        }
        .summary-card-value {
          font-size: 13px;
          font-weight: 800;
          color: #065F46;
          line-height: 1.2;
          word-break: break-word;
        }
        .summary-card-value-long {
          font-size: 9.5px;
          font-weight: 700;
          color: #1E293B;
          line-height: 1.3;
        }

        /* Visual Chart Card */
        .chart-card {
          background: #FFFFFF !important;
          border: 1px solid #CBD5E1;
          border-radius: 6px;
          padding: 8px 12px 6px;
          margin-bottom: 12px;
          page-break-inside: avoid;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .chart-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 6px;
          gap: 12px;
        }
        .chart-eyebrow {
          font-size: 8px;
          font-weight: 800;
          color: #0D9488;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          margin-bottom: 1px;
        }
        .chart-card-title {
          font-size: 11.5px;
          font-weight: 800;
          color: #0F172A;
          letter-spacing: -0.2px;
        }
        .chart-legend {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .legend-item {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .legend-indicator {
          width: 12px;
          height: 3.5px;
          border-radius: 2px;
          display: inline-block;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .legend-label {
          font-size: 8.5px;
          font-weight: 800;
          color: #334155;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .chart-svg-container {
          width: 100%;
        }
        .chart-svg {
          width: 100%;
          height: auto;
          display: block;
        }

        /* Table */
        .table-wrap {
          border: 1px solid #CBD5E1;
          border-radius: 6px;
          overflow: visible;
          margin-bottom: 14px;
        }
        table {
          width: 100%;
          table-layout: auto;
          border-collapse: collapse;
          margin: 0;
          font-size: 9.5px;
        }
        thead {
          display: table-header-group;
        }
        thead th {
          background-color: #064E3B !important;
          color: #FFFFFF !important;
          padding: 6px 6px;
          font-weight: 800;
          text-align: left;
          font-size: 8px;
          line-height: 1.25;
          letter-spacing: 0.3px;
          text-transform: uppercase;
          border-bottom: 2px solid #047857;
          word-break: normal;
          overflow-wrap: break-word;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        tbody td {
          padding: 5.5px 6px;
          border-bottom: 1px solid #E2E8F0;
          color: #1E293B;
          font-size: 9px;
          line-height: 1.25;
          word-break: normal;
          overflow-wrap: break-word;
        }
        tbody tr.row-alt {
          background-color: #F8FAFC !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        tbody tr:last-child td {
          border-bottom: none;
        }

        /* Status Badges */
        .badge {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 9999px;
          font-size: 7.5px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          white-space: nowrap;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .badge-green {
          background-color: #DCFCE7 !important;
          color: #15803D !important;
          border: 1px solid #BBF7D0;
        }
        .badge-red {
          background-color: #FEE2E2 !important;
          color: #B91C1C !important;
          border: 1px solid #FECACA;
        }
        .badge-amber {
          background-color: #FEF3C7 !important;
          color: #B45309 !important;
          border: 1px solid #FDE68A;
        }
        .badge-gray {
          background-color: #F1F5F9 !important;
          color: #475569 !important;
          border: 1px solid #CBD5E1;
        }

        /* Signatures */
        .signatures-wrapper {
          margin-top: 14px;
          display: flex;
          justify-content: space-around;
          align-items: flex-end;
          gap: 20px;
          page-break-inside: avoid;
        }
        .sign-block {
          width: 44%;
          text-align: center;
        }
        .stamp-badge {
          display: inline-block;
          border: 1.5px dashed #059669;
          border-radius: 5px;
          padding: 2px 8px;
          margin-bottom: 6px;
          transform: rotate(-1.5deg);
          background-color: #F0FDF4 !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .stamp-amber {
          border-color: #D97706;
          background-color: #FFFBEB !important;
        }
        .stamp-ring {
          font-size: 8px;
          font-weight: 900;
          color: #059669;
          letter-spacing: 0.7px;
        }
        .stamp-amber .stamp-ring {
          color: #D97706;
        }
        .stamp-date {
          font-size: 7.5px;
          font-weight: 700;
          color: #64748B;
        }
        .sign-line {
          border-bottom: 1.5px solid #1E293B;
          margin-bottom: 4px;
          height: 18px;
        }
        .sign-name {
          font-weight: 800;
          font-size: 10.5px;
          color: #0F172A;
          letter-spacing: 0.3px;
        }
        .sign-title {
          font-size: 9px;
          font-weight: 600;
          color: #475569;
          margin-top: 1px;
        }
        .sign-org {
          font-size: 8.5px;
          color: #64748B;
        }

        /* Document Footer */
        .document-footer {
          margin-top: 14px;
          padding-top: 8px;
          border-top: 1px solid #E2E8F0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 8px;
          color: #64748B;
          page-break-inside: avoid;
        }
        .footer-brand {
          font-weight: 700;
          color: #0F172A;
        }
        .footer-code {
          font-family: monospace;
          font-weight: 700;
          color: #059669;
        }

        @media print {
          body {
            padding: 4mm 6mm;
            background: #FFFFFF !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          @page {
            size: auto;
            margin: 6mm 8mm 6mm 8mm;
          }
          thead {
            display: table-header-group;
          }
          .header-container, .meta-card, .summary-cards-grid, .chart-card, .signatures-wrapper, .document-footer {
            page-break-inside: avoid;
          }
          tr {
            page-break-inside: avoid;
          }
        }
      </style>
    </head>
    <body>
      <!-- Executive Header -->
      <div class="header-container">
        <div class="header-seal">
          <svg width="48" height="48" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="48" fill="#064E3B" stroke="#D97706" stroke-width="3"/>
            <circle cx="50" cy="50" r="43" fill="#065F46" stroke="#BBF7D0" stroke-width="1.5" stroke-dasharray="3 2"/>
            <circle cx="50" cy="50" r="32" fill="#FFFFFF"/>
            <!-- Leaf / Recycling emblem -->
            <path d="M50 24 C40 24 33 32 33 44 C33 58 50 72 50 72 C50 72 67 58 67 44 C67 32 60 24 50 24 Z" fill="#059669"/>
            <path d="M50 27 C43 32 39 40 41 49 C43 57 50 65 50 65 C50 65 57 57 59 49 C61 40 57 32 50 27 Z" fill="#34D399"/>
            <path d="M50 31 L50 61" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>
            <!-- 3 Heraldic Stars -->
            <polygon points="50,10 51.5,13.5 55,13.5 52,16 53,19.5 50,17 47,19.5 48,16 45,13.5 48.5,13.5" fill="#F59E0B"/>
            <polygon points="13,48 14.5,50.5 17.5,50.5 15,52.5 16,55.5 13,53.5 10,55.5 11,52.5 8.5,50.5 11.5,50.5" fill="#F59E0B"/>
            <polygon points="87,48 88.5,50.5 91.5,50.5 89,52.5 90,55.5 87,53.5 84,55.5 85,52.5 82.5,50.5 85.5,50.5" fill="#F59E0B"/>
          </svg>
        </div>

        <div class="header-center">
          <div class="republic-text">Republic of the Philippines</div>
          <div class="province-text">Province of Cebu · City of Danao</div>
          <div class="agency-title">City Environment and Natural Resources Office</div>
          <div class="agency-sub">Solid Waste Management & Ecological Telemetry Administration</div>
        </div>

        <div class="header-badge-col">
          <div class="doc-badge">
            <div class="doc-badge-status">● VERIFIED RECORD</div>
            <div class="doc-badge-code">CENRO-DANAO</div>
          </div>
        </div>
      </div>

      <div class="ribbon-bar"></div>

      <!-- Title Section -->
      <div class="title-section">
        <div class="report-eyebrow">Official Analytics & Operations Dossier</div>
        <h1 class="report-title">${escapeHtml(title)}</h1>
        ${subtitle ? `<div class="report-subtitle">${escapeHtml(subtitle)}</div>` : ''}
      </div>

      <!-- Meta Card -->
      <div class="meta-card">
        <div class="meta-grid">
          ${metaHtml}
        </div>
      </div>

      <!-- Summary Cards -->
      ${summaryCardsHtml}

      <!-- Visual Telemetry Chart -->
      ${chartHtml}

      <!-- Data Table -->
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${tableHeadersHtml}
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
      </div>

      <!-- Official Signatures -->
      <div class="signatures-wrapper">
        <div class="sign-block">
          <div class="stamp-badge">
            <div class="stamp-ring">OFFICIALLY AUDITED</div>
            <div class="stamp-date">CENRO DANAO CITY</div>
          </div>
          <div class="sign-line"></div>
          <div class="sign-name">ENGR. CITY ENVIRONMENT OFFICER</div>
          <div class="sign-title">Department Head, CENRO Danao City</div>
          <div class="sign-org">City Government of Danao</div>
        </div>

        <div class="sign-block">
          <div class="stamp-badge stamp-amber">
            <div class="stamp-ring">APPROVED & NOTED</div>
            <div class="stamp-date">OFFICE OF THE MAYOR</div>
          </div>
          <div class="sign-line"></div>
          <div class="sign-name">HON. CITY MAYOR</div>
          <div class="sign-title">Local Chief Executive</div>
          <div class="sign-org">City Government of Danao</div>
        </div>
      </div>

      <!-- Document Footer -->
      <div class="document-footer">
        <div class="footer-left">
          <div class="footer-brand">TrashTrack Danao City • Republic Act 9003 Certified</div>
          <div>Official Solid Waste Management Telemetry & Operations Information Ledger</div>
        </div>
        <div class="footer-right">
          <div class="footer-code">SEC-REF: TT-${Date.now().toString(36).toUpperCase()}</div>
          <div>Generated ${escapeHtml(timestamp)}</div>
        </div>
      </div>

      <script>
        window.addEventListener('load', function() {
          setTimeout(function() {
            try {
              window.focus();
              window.print();
            } catch (e) {
              console.warn('Auto print trigger error:', e);
            }
          }, 350);
        });
      </script>
    </body>
    </html>
  `;
}

export async function exportReport(options: ExportReportOptions): Promise<void> {
  const { format, filename, title, headers, rows, sheetName = 'Records' } = options;

  // Safeguard prompt when exporting large datasets to PDF
  if (format === 'pdf' && rows.length >= 300) {
    const estPages = Math.ceil(rows.length / 32);
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        const proceed = window.confirm(
          `Large Dataset Notice (${rows.length.toLocaleString()} records)\n\n` +
          `Exporting to PDF will generate an estimated ${estPages}-page document.\n\n` +
          `• Click [Cancel] to switch to Excel (.xlsx) for easier filtering and sorting.\n` +
          `• Click [OK] to proceed with generating the ${estPages}-page PDF.`
        );
        if (!proceed) {
          return exportReport({ ...options, format: 'xlsx' });
        }
      }
    } else {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          `Large Dataset (${rows.length.toLocaleString()} records)`,
          `This report will generate an estimated ${estPages} PDF pages. Would you prefer Excel (.xlsx) for easier sorting and filtering?`,
          [
            { text: 'Switch to Excel', onPress: () => resolve(false) },
            { text: 'Proceed with PDF', style: 'default', onPress: () => resolve(true) },
          ],
          { cancelable: true }
        );
      });
      if (!proceed) {
        return exportReport({ ...options, format: 'xlsx' });
      }
    }
  }

  if (format === 'csv') {
    const csvContent =
      '\uFEFF' +
      [
        headers.map(escapeCsvCell).join(','),
        ...rows.map((row) => row.map(escapeCsvCell).join(',')),
      ].join('\r\n');

    if (Platform.OS === 'web') {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }

    await Share.share({
      title,
      message: csvContent,
    });
    return;
  }

  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new();

    // Data sheet
    const wsData = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // Calculate intelligent column widths
    const colWidths = headers.map((h, colIdx) => {
      let maxLen = String(h).length;
      for (const row of rows) {
        const cellLen = String(row[colIdx] ?? '').length;
        if (cellLen > maxLen) maxLen = cellLen;
      }
      return { wch: Math.min(Math.max(maxLen + 3, 10), 45) };
    });
    wsData['!cols'] = colWidths;
    wsData['!autofilter'] = {
      ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${rows.length + 1}`,
    };

    XLSX.utils.book_append_sheet(wb, wsData, sheetName.slice(0, 31));

    // Summary Sheet
    const summaryData: { Indicator: string; 'Metric / Observation': string | number }[] = [
      { Indicator: 'REPORT TITLE', 'Metric / Observation': title },
      { Indicator: 'Export Authority', 'Metric / Observation': options.generatedBy || 'CENRO Danao City' },
      { Indicator: 'Scope / Jurisdiction', 'Metric / Observation': options.jurisdiction || 'City of Danao' },
      { Indicator: 'Generated At', 'Metric / Observation': new Date().toLocaleString() },
      { Indicator: 'Total Active Records', 'Metric / Observation': rows.length },
    ];

    if (options.summaryCards) {
      options.summaryCards.forEach((c) => {
        summaryData.push({ Indicator: c.label, 'Metric / Observation': c.value });
      });
    }

    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 32 }, { wch: 45 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Executive_Summary');

    const xlsxFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;

    if (Platform.OS === 'web') {
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = xlsxFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }

    // Native mobile export
    try {
      const FileSystem: any = await import('expo-file-system');
      const base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
      const fileUri = `${cacheDir}${xlsxFilename}`;
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType?.Base64 || 'base64',
      });

      await Share.share({
        title,
        url: fileUri,
        message: `${title} exported successfully.`,
      });
    } catch (nativeErr) {
      console.warn('Native Excel share error:', nativeErr);
      // Fallback to CSV text share if file system write fails
      const csvFallback =
        '\uFEFF' +
        [
          headers.map(escapeCsvCell).join(','),
          ...rows.map((row) => row.map(escapeCsvCell).join(',')),
        ].join('\r\n');
      await Share.share({
        title,
        message: csvFallback,
      });
    }
    return;
  }

  if (format === 'pdf') {
    const html = buildOfficialReportHtml(options);

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.open();
          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.focus();
          return;
        }

        // Popup blocked fallback
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.target = '_blank';
        link.download = filename.endsWith('.html') ? filename : `${filename}.html`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      }
      return;
    }

    // Native PDF printing via expo-print
    let Print: typeof import('expo-print');
    try {
      Print = await import('expo-print');
    } catch (e) {
      throw new Error('PDF export is unavailable in this app build.');
    }

    const file = await Print.printToFileAsync({ html });
    if (file && file.uri) {
      await Share.share({
        title,
        url: file.uri,
        message: `Official PDF Report: ${title}`,
      });
    }
  }
}
