import { Share, Platform } from 'react-native';

export interface WasteReportData {
  generatedAt: string;
  generatedBy?: string;
  filters: {
    barangay: string;
    monthDuration: string;
    truck: string;
  };
  summary: {
    totalCollectedTons: number;
    collectionEfficiency: number;
    activeTrucks: number;
    totalRuns: number;
    highestLoadTruckPlate?: string;
    highestLoadTons?: number;
  };
  truckRankings: {
    plateNumber: string;
    type: string;
    driverName: string;
    totalTons: number;
    tripCount: number;
    avgLoadPerTrip: number;
    capacityTons: number;
    utilizationPercent: number;
    primaryBarangay: string;
  }[];
  barangayBreakdown: {
    name: string;
    collectedTons: number;
    reportsCount: number;
    status: string;
  }[];
}

export function buildWasteReportHtml(data: WasteReportData): string {
  const { summary, filters, truckRankings, barangayBreakdown } = data;

  const truckRowsHtml = truckRankings
    .map(
      (t, idx) => `
      <tr style="${idx === 0 ? 'background-color: #F0FDF4; font-weight: bold;' : ''}">
        <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; text-align: center;">
          ${idx === 0 ? '🥇 #1' : idx === 1 ? '🥈 #2' : idx === 2 ? '🥉 #3' : `#${idx + 1}`}
        </td>
        <td style="padding: 10px; border-bottom: 1px solid #E5E7EB;">
          <strong>${t.plateNumber}</strong><br/>
          <span style="font-size: 11px; color: #6B7280;">${t.type || 'Compactor'}</span>
        </td>
        <td style="padding: 10px; border-bottom: 1px solid #E5E7EB;">${t.driverName || 'Unassigned'}</td>
        <td style="padding: 10px; border-bottom: 1px solid #E5E7EB;">${t.primaryBarangay || 'Danao City'}</td>
        <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; text-align: right; color: #059669; font-weight: bold;">
          ${(t.totalTons || 0).toFixed(2)} t
        </td>
        <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; text-align: center;">${t.tripCount || 0}</td>
        <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; text-align: right;">${(t.avgLoadPerTrip || 0).toFixed(2)} t</td>
        <td style="padding: 10px; border-bottom: 1px solid #E5E7EB; text-align: center;">${t.utilizationPercent || 0}%</td>
      </tr>
    `
    )
    .join('');

  const barangayRowsHtml = barangayBreakdown
    .map(
      (b, idx) => `
      <tr>
        <td style="padding: 8px 10px; border-bottom: 1px solid #E5E7EB;">${idx + 1}. Brgy. ${b.name}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #E5E7EB; text-align: right; font-weight: 600;">
          ${b.collectedTons.toFixed(2)} t
        </td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #E5E7EB; text-align: center;">${b.reportsCount}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #E5E7EB; text-align: center;">
          <span style="
            display: inline-block;
            padding: 3px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: bold;
            background-color: ${b.status === 'SURGE' ? '#FEE2E2' : b.status === 'NEAR CAP' ? '#FEF3C7' : '#DCFCE7'};
            color: ${b.status === 'SURGE' ? '#DC2626' : b.status === 'NEAR CAP' ? '#D97706' : '#16A34A'};
          ">${b.status}</span>
        </td>
      </tr>
    `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <title>TrashTrack Danao - Waste Intelligence Report</title>
      <style>
        * {
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: #1F2937;
          margin: 0;
          padding: 24px;
          background-color: #FFFFFF;
        }
        .header {
          text-align: center;
          border-bottom: 2px solid #059669;
          padding-bottom: 16px;
          margin-bottom: 24px;
        }
        .header h1 {
          margin: 0;
          font-size: 20px;
          color: #065F46;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .header h2 {
          margin: 4px 0 0;
          font-size: 15px;
          color: #374151;
          font-weight: 600;
        }
        .header p {
          margin: 4px 0 0;
          font-size: 12px;
          color: #6B7280;
        }
        .meta-box {
          background-color: #F9FAFB;
          border: 1px solid #E5E7EB;
          border-radius: 8px;
          padding: 12px 16px;
          margin-bottom: 20px;
          display: flex;
          justify-content: space-between;
          font-size: 12px;
        }
        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 24px;
        }
        .kpi-card {
          background-color: #F0FDF4;
          border: 1px solid #BBF7D0;
          border-radius: 8px;
          padding: 12px;
          text-align: center;
        }
        .kpi-label {
          font-size: 10px;
          font-weight: bold;
          color: #065F46;
          text-transform: uppercase;
        }
        .kpi-value {
          font-size: 18px;
          font-weight: 800;
          color: #059669;
          margin-top: 4px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          margin-bottom: 24px;
        }
        th {
          background-color: #F3F4F6;
          color: #374151;
          padding: 10px;
          font-weight: 700;
          text-align: left;
          border-bottom: 2px solid #D1D5DB;
        }
        .section-title {
          font-size: 14px;
          font-weight: 800;
          color: #111827;
          margin: 20px 0 10px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .signatures {
          margin-top: 40px;
          display: flex;
          justify-content: space-between;
          padding-top: 20px;
          border-top: 1px dashed #D1D5DB;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .sign-block {
          width: 45%;
          text-align: center;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .sign-line {
          border-bottom: 1px solid #374151;
          margin-top: 40px;
          margin-bottom: 6px;
        }
        .sign-name {
          font-size: 12px;
          font-weight: bold;
          color: #111827;
        }
        .sign-title {
          font-size: 11px;
          color: #6B7280;
        }
        @media print {
          @page {
            size: A4 portrait;
            margin: 12mm 10mm 12mm 10mm;
          }
          body {
            padding: 0 !important;
            background-color: #FFFFFF !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .kpi-card {
            background-color: #F0FDF4 !important;
            border: 1px solid #BBF7D0 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          th {
            background-color: #F3F4F6 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .signatures {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .no-print-toolbar {
            display: none !important;
          }
        }
      </style>
    </head>
    <body>
      <div class="no-print-toolbar" style="margin-bottom: 20px; padding: 12px 18px; background-color: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <span style="font-size: 13px; font-weight: 700; color: #065F46;">
          Official CENRO Waste Analytics & Fleet Load Report — Ready to Save as PDF
        </span>
        <div style="display: flex; gap: 8px;">
          <button onclick="window.print()" style="padding: 8px 16px; background-color: #059669; color: white; border: none; border-radius: 6px; font-size: 13px; font-weight: bold; cursor: pointer;">
            🖨️ Print / Save as PDF
          </button>
          <button onclick="window.close()" style="padding: 8px 14px; background-color: #E5E7EB; color: #374151; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;">
            ✕ Close
          </button>
        </div>
      </div>

      <div class="header">
        <p style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #4B5563; margin-bottom: 4px;">
          Republic of the Philippines • City Government of Danao
        </p>
        <h1>City Environment & Natural Resources Office (CENRO)</h1>
        <h2>Comprehensive Waste Intelligence & Fleet Analytics Report</h2>
        <p>TrashTrack Autonomous Municipal Telemetry System • Generated: ${data.generatedAt}</p>
      </div>

      <div class="meta-box">
        <div>
          <strong>FILTER PARAMETERS:</strong><br/>
          Barangay Sector: <strong>${filters.barangay}</strong> |
          Duration: <strong>${filters.monthDuration}</strong> |
          Fleet Vehicle: <strong>${filters.truck}</strong>
        </div>
        <div style="text-align: right;">
          Document Ref: <strong>CENRO-TT-ANL-${Date.now().toString().slice(-6)}</strong><br/>
          Audited by: ${data.generatedBy || 'CENRO Data Intelligence Desk'}
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">TOTAL WASTE COLLECTED</div>
          <div class="kpi-value">${(summary.totalCollectedTons || 0).toFixed(2)} t</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">COLLECTION EFFICIENCY</div>
          <div class="kpi-value">${summary.collectionEfficiency || 0}%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">ACTIVE TRUCKS IN FLEET</div>
          <div class="kpi-value">${summary.activeTrucks || 0} Trucks</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">HIGHEST LOAD TRUCK</div>
          <div class="kpi-value" style="font-size: 14px;">
            ${summary.highestLoadTruckPlate || 'TRK-01'} (${(summary.highestLoadTons || 0).toFixed(1)}t)
          </div>
        </div>
      </div>

      <div class="section-title">🚚 1. Waste Collected per Truck & Fleet Load Ranking</div>
      <table>
        <thead>
          <tr>
            <th style="text-align: center; width: 40px;">RANK</th>
            <th>TRUCK / PLATE</th>
            <th>ASSIGNED DRIVER</th>
            <th>SECTOR</th>
            <th style="text-align: right;">TOTAL LOAD</th>
            <th style="text-align: center;">RUNS</th>
            <th style="text-align: right;">AVG / TRIP</th>
            <th style="text-align: center;">UTILIZATION</th>
          </tr>
        </thead>
        <tbody>
          ${truckRowsHtml || '<tr><td colspan="8" style="text-align: center; padding: 20px;">No truck collection data available for selected filter.</td></tr>'}
        </tbody>
      </table>

      <div class="section-title">📍 2. Barangay Capacity & Demand Analysis</div>
      <table>
        <thead>
          <tr>
            <th>BARANGAY JURISDICTION</th>
            <th style="text-align: right;">MEASURED TONNAGE</th>
            <th style="text-align: center;">UNRESOLVED REPORTS</th>
            <th style="text-align: center;">CAPACITY STATUS</th>
          </tr>
        </thead>
        <tbody>
          ${barangayRowsHtml || '<tr><td colspan="4" style="text-align: center; padding: 20px;">No barangay records found.</td></tr>'}
        </tbody>
      </table>

      <div class="signatures">
        <div class="sign-block">
          <div class="sign-line"></div>
          <div class="sign-name">ENGR. CENRO DEPARTMENT HEAD</div>
          <div class="sign-title">City Environment and Natural Resources Office</div>
        </div>
        <div class="sign-block">
          <div class="sign-line"></div>
          <div class="sign-name">HON. CITY MAYOR</div>
          <div class="sign-title">City Government of Danao</div>
        </div>
      </div>

      <script>
        // Automatically trigger print dialog when page finishes rendering
        window.addEventListener('load', function() {
          setTimeout(function() {
            try {
              window.focus();
              window.print();
            } catch (err) {
              console.warn('Auto print trigger error:', err);
            }
          }, 350);
        });
      </script>
    </body>
    </html>
  `;
}

export async function exportWasteAnalyticsPdf(data: WasteReportData): Promise<void> {
  const html = buildWasteReportHtml(data);

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    // Direct, reliable printing on Web:
    // Open a dedicated print window containing ONLY the official municipal report HTML.
    // This avoids modern browser bugs where expo-print / invisible iframes trigger printing of the host application dashboard.
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      return;
    }

    // Fallback if popup was blocked by browser: trigger HTML download so user can open & print
    try {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.target = '_blank';
      link.download = `CENRO_Waste_Analytics_Report_${new Date().toISOString().slice(0, 10)}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      alert('Pop-up was blocked. The official CENRO report has been downloaded for you to open and print.');
    } catch (e) {
      console.warn('Fallback download error:', e);
    }
    return;
  }

  // On native (iOS/Android), generate file and share
  let Print: typeof import('expo-print');
  try {
    Print = await import('expo-print');
  } catch (error) {
    console.error('Expo Print native module is unavailable:', error);
    throw new Error('PDF export is unavailable in this app build. Rebuild or reinstall the Expo development app, then try again.');
  }

  const file = await Print.printToFileAsync({ html });
  if (file && file.uri) {
    await Share.share({
      title: 'Danao City Waste Analytics Report',
      url: file.uri,
      message: 'Attached is the official Danao City CENRO Waste Analytics & Fleet Load Report.',
    });
  }
}
