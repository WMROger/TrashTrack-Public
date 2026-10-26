const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>TrashTrack System Turnover & Operations Manual</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    @page {
      size: A4;
      margin: 20mm 15mm 20mm 15mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1E293B;
      line-height: 1.6;
      font-size: 11pt;
      margin: 0;
      padding: 24px;
      background: #FFFFFF;
    }
    .header-banner {
      background: linear-gradient(135deg, #1E293B 0%, #0F172A 100%);
      color: #FFFFFF;
      padding: 28px 24px;
      border-radius: 12px;
      margin-bottom: 24px;
      border-left: 6px solid #4F46E5;
    }
    .header-banner h1 {
      margin: 0 0 8px 0;
      font-size: 22pt;
      color: #FFFFFF;
      letter-spacing: -0.5px;
    }
    .header-banner p {
      margin: 0;
      font-size: 12pt;
      color: #94A3B8;
      font-weight: 500;
    }
    .meta-card {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      padding: 16px 20px;
      margin-bottom: 28px;
    }
    .meta-card h2 {
      margin-top: 0;
      font-size: 13pt;
      color: #334155;
      border-bottom: 1px solid #E2E8F0;
      padding-bottom: 8px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px 20px;
      font-size: 10pt;
    }
    .meta-item strong {
      color: #0F172A;
    }
    h2 {
      font-size: 15pt;
      color: #0F172A;
      margin-top: 32px;
      margin-bottom: 12px;
      border-bottom: 2px solid #E2E8F0;
      padding-bottom: 6px;
      page-break-after: avoid;
    }
    h3 {
      font-size: 12pt;
      color: #1E293B;
      margin-top: 20px;
      margin-bottom: 8px;
      page-break-after: avoid;
    }
    p, li {
      font-size: 10.5pt;
      color: #334155;
    }
    ul, ol {
      padding-left: 24px;
      margin: 8px 0;
    }
    li {
      margin-bottom: 6px;
    }
    .diagram-box {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      padding: 20px;
      margin: 20px 0;
      text-align: center;
      page-break-inside: avoid;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 10pt;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid #CBD5E1;
      padding: 10px 14px;
      text-align: left;
    }
    th {
      background-color: #F1F5F9;
      color: #0F172A;
      font-weight: 700;
    }
    tr:nth-child(even) td {
      background-color: #F8FAFC;
    }
    code {
      font-family: Consolas, Monaco, "Courier New", monospace;
      background: #F1F5F9;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 9.5pt;
      color: #0F172A;
      border: 1px solid #E2E8F0;
    }
    pre {
      background: #0F172A;
      color: #F8FAFC;
      padding: 14px 18px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 9.5pt;
      line-height: 1.45;
      page-break-inside: avoid;
    }
    pre code {
      background: transparent;
      color: #F8FAFC;
      border: none;
      padding: 0;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 8.5pt;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .badge-cicto { background: #F0FDFA; color: #0F766E; border: 1px solid #CCFBF1; }
    .badge-cenro { background: #ECFDF5; color: #047857; border: 1px solid #A7F3D0; }
    .badge-driver { background: #FEF3C7; color: #B45309; border: 1px solid #FDE68A; }
    .badge-citizen { background: #F3F4F6; color: #4B5563; border: 1px solid #E5E7EB; }
    .page-break {
      page-break-before: always;
    }
    .print-button {
      position: fixed;
      top: 16px;
      right: 16px;
      background: #1B4D3E;
      color: white;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 9999;
    }
    @media print {
      .print-button { display: none; }
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <button class="print-button" onclick="window.print()">🖨️ Print / Save to PDF</button>

  <div class="header-banner">
    <h1>🏛️ TrashTrack System Turnover & Operations Manual</h1>
    <p>City Information and Communications Technology Office (CICTO) ⇄ LGU Danao City (CENRO)</p>
  </div>

  <div class="meta-card">
    <h2>📌 Document Control & Institutional Metadata</h2>
    <div class="meta-grid">
      <div class="meta-item"><strong>System Name:</strong> TrashTrack (Municipal Waste Logistics & Telemetry)</div>
      <div class="meta-item"><strong>Deploying / Supervising Agency:</strong> CICTO Danao City</div>
      <div class="meta-item"><strong>Operating Municipal Beneficiary:</strong> CENRO – Danao City, Cebu</div>
      <div class="meta-item"><strong>Statutory Compliance:</strong> RA 9003, RA 10173, E-Governance Framework</div>
      <div class="meta-item"><strong>Production Environment:</strong> Web Portals & Mobile Apps (Android/iOS)</div>
      <div class="meta-item"><strong>Effective Date:</strong> August 2026 / Academic Year 2025–2026</div>
    </div>
  </div>

  <h2>1. Executive Summary & Governance Model</h2>
  <p>
    <strong>TrashTrack</strong> is an enterprise-grade municipal solid waste logistics, real-time vehicle telemetry, citizen geotagged reporting, and eco-token reward incentive platform. It establishes a compliant, high-security bridge between <strong>CICTO</strong> (Municipal IT Governance & Policy Oversight) and <strong>CENRO</strong> (Local Municipal Operations).
  </p>

  <h3>4-Tier Role Authority Architecture</h3>
  <div class="diagram-box">
    <div class="mermaid">
graph TD
    classDef cicto fill:#042F2E,stroke:#0D9488,stroke-width:2px,color:#FFFFFF;
    classDef cenro fill:#064E3B,stroke:#10B981,stroke-width:2px,color:#FFFFFF;
    classDef ops fill:#1E3A8A,stroke:#3B82F6,stroke-width:2px,color:#FFFFFF;
    classDef citizen fill:#78350F,stroke:#F59E0B,stroke-width:2px,color:#FFFFFF;

    CICTO["TIER 1: CICTO Super Administrator<br/><b>Role: 'cicto'</b><br/>• Provisions CENRO Administrators<br/>• Security & Inactivity Governance<br/>• 1-Min OTP Account Purging<br/>• Inter-Agency Directives"]:::cicto
    CENRO["TIER 2: CENRO City Administrator<br/><b>Role: 'admin'</b><br/>• Onboards Drivers & Coordinators<br/>• Danao City Barangay Schedules<br/>• Fleet Telemetry & Overrides<br/>• Physical Souvenir Voucher Validation"]:::cenro
    Drivers["TIER 3: Truck Drivers<br/><b>Role: 'driver'</b><br/>• GPS Route Navigation<br/>• Scale Weighing (Tons/Kg)<br/>• Photographic Completion"]:::ops
    Coordinators["TIER 3: Barangay Coordinators<br/><b>Role: 'coordinator'</b><br/>• Barangay Bin Audits<br/>• Waste Segregation Compliance<br/>• Neighborhood Notices"]:::ops
    Residents["TIER 4: Citizen Community<br/><b>Role: 'user'</b><br/>• Geotagged Trash Reports<br/>• Live Truck Tracking<br/>• 50 Eco-Tokens per Collection<br/>• Sustainable Souvenir Claims"]:::citizen

    CICTO -->|"1. Provisions Admin & Credentials"| CENRO
    CENRO -->|"2. Onboards with Secondary Auth"| Drivers
    CENRO -->|"2. Appoints & Assigns Barangay"| Coordinators
    Residents -->|"3. Submits Geotagged Report"| CENRO
    CENRO -->|"4. Optimizes Route & Dispatches"| Drivers
    Drivers -->|"5. Completes Pickup with Photo/Scale Data"| Residents
    Drivers -->|"6. Automatic 50-Token Ledger Award"| Residents
    CICTO -.->|"Continuous Governance & Inactivity Cleanups"| Residents
    </div>
  </div>

  <div class="page-break"></div>

  <h2>2. Step-by-Step Turnover & Operational Workflow</h2>

  <h3>Phase 1: CICTO Master Initialization & CENRO Provisioning</h3>
  <ol>
    <li>
      <strong>CICTO Super Admin Sign-In:</strong>
      The designated CICTO supervisor accesses the master executive console (<code>cicto@trashtrack.gov.ph</code>). The portal incorporates auto-healing Firestore self-initialization (<code>ensureCictoProfileInFirestore</code>), guaranteeing administrative oversight is never lost.
    </li>
    <li>
      <strong>Provisioning CENRO Administrator:</strong>
      Under <strong>Identity & Access Management</strong>, CICTO clicks <em>"Create CENRO Account"</em>. The system automatically creates a high-entropy password (e.g., <code>Cenro@Danao7421!Gov</code>) and employee ID (<code>CENRO-ADMIN-01</code>), creates the Firebase Auth profile in an isolated secondary session without signing out CICTO, and dispatches a welcome email with a 5-minute temporary code.
    </li>
  </ol>

  <h3>Phase 2: CENRO Municipal Setup & Fleet Onboarding</h3>
  <ol>
    <li>
      <strong>Barangay Scheduling:</strong>
      CENRO configures Danao City's 42 barangays with designated pickup days, operational time windows (e.g. <code>08:00 - 17:00</code>), assigned compactor trucks, and waste streams.
    </li>
    <li>
      <strong>Onboarding Drivers & Coordinators:</strong>
      Under <strong>Accounts Directory</strong>, CENRO registers drivers with their commercial license numbers and assigns compactor trucks. Barangay environmental coordinators are onboarded and assigned to their respective barangays using the 5-item scrollable selector standard.
    </li>
  </ol>

  <h3>Phase 3: Citizen Reporting & Field Route Execution</h3>
  <div class="diagram-box">
    <div class="mermaid">
sequenceDiagram
    autonumber
    actor Resident as 👤 Citizen / Resident
    participant App as 📱 TrashTrack Mobile
    participant Cloud as ☁️ Firebase Firestore
    actor CENRO as 🏢 CENRO Admin
    actor Driver as 🚛 Truck Driver
    actor CICTO as 🏛️ CICTO Oversight

    Resident->>App: Submits Trash Report (Photo, Barangay, GPS Pin)
    App->>Cloud: Writes to /reports (status: 'pending')
    Cloud-->>CENRO: Real-time report appears on Live Map & Reports Tab
    CENRO->>Cloud: Dispatches schedule with assigned driver & truck
    Cloud-->>Driver: Dispatch notification appears on Driver Terminal
    Driver->>Driver: Navigates road network with turn-by-turn routing
    Driver->>App: Captures Scale Weight (Tons/Kg) & Photo Evidence
    Driver->>Cloud: Updates schedule (status: 'completed', validEvidence: true)
    Cloud->>Cloud: Immutable Ledger creates award (50 Eco-Tokens)
    Cloud-->>Resident: Notification: 50 Eco-Tokens credited
    Cloud-->>CICTO: Cryptographic audit event logged
    </div>
  </div>

  <h3>Phase 4: Eco-Reward Catalog & Physical Redemption</h3>
  <ul>
    <li><strong>Token Earnings:</strong> Citizens automatically receive <strong>50 Eco-Tokens</strong> upon verified completion of their waste report by a driver.</li>
    <li><strong>Digital Voucher Claim:</strong> Citizens redeem approved items in the mobile catalog (e.g., CENRO Heavy-Duty Tote Bag = 500 tokens, Eco Tumbler = 1,000 tokens, Bamboo Utensil Kit = 2,000 tokens).</li>
    <li><strong>Physical Verification:</strong> The citizen presents their digital voucher QR code at CENRO Danao City for in-person physical handover.</li>
  </ul>

  <div class="page-break"></div>

  <h2>3. System Security, Data Protection & Lifecycle Policies</h2>

  <h3>1. 1-Minute OTP Account Deletion Policy</h3>
  <p>
    Any permanent account deletion requested by CICTO triggers a temporary 6-digit authorization PIN with an enforced <strong>1-minute (60-second)</strong> expiration countdown to prevent unauthorized or accidental data loss.
  </p>

  <h3>2. 6-Month Resident Inactivity Deactivation Policy</h3>
  <p>
    Resident accounts with no login activity for over <strong>180 days (6 months)</strong> are automatically soft-deactivated (<code>disabled: true</code>, <code>status: 'inactive'</code>):
  </p>
  <ul>
    <li><strong>Data Preservation:</strong> Historical waste reports, scale tonnage metrics, and token ledgers are permanently preserved.</li>
    <li><strong>Automated Cron:</strong> A daily background Cloud Function (<code>deactivateInactiveResidents</code>) runs every 24 hours.</li>
    <li><strong>CICTO Console Controls:</strong> CICTO Super Admins can filter <code>Inactive (6+ Mos)</code> accounts and perform on-demand batch deactivations or individual reactivations.</li>
  </ul>

  <h3>3. Operational Overrides vs Audit Logs Separation</h3>
  <ul>
    <li><strong>System Overrides (<code>operational-overrides</code>):</strong> Real-time interactive switches for <em>Force Pause Collection</em>, <em>Activate Backup Fleet</em>, <em>Severe Weather Rerouting</em>, and <em>Surge Priority Mode</em>, with emergency broadcasts and live telemetry.</li>
    <li><strong>System Logs (<code>logs</code>):</strong> Dedicated full-screen audit trail with category filter pills (<em>System</em>, <em>Driver</em>, <em>Dispatch</em>, <em>Report</em>), search, and CSV download.</li>
  </ul>

  <h3>4. 5-Item Scrollable Barangay Dropdown Standard</h3>
  <p>
    All municipal barangay selection menus across settings and registration display exactly 5 items visible at a time with smooth internal scrolling for the rest of Danao City's 42 barangays.
  </p>

  <h2>4. Technical Configuration & Environment Reference</h2>
  <pre><code># Firebase Client Configuration (Web & Mobile)
EXPO_PUBLIC_FIREBASE_API_KEY=AIzaSy...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=trashtruck-swu-98ce9.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=trashtruck-swu-98ce9
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=trashtruck-swu-98ce9.appspot.com
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=109283746512
EXPO_PUBLIC_FIREBASE_APP_ID=1:109283746512:web:a1b2c3d4e5f6

# CICTO Super Administrator Default Credentials
EXPO_PUBLIC_CICTO_ADMIN_EMAIL=cicto@trashtrack.gov.ph
EXPO_PUBLIC_CICTO_ADMIN_PASSWORD=CictoAdmin2026!

# Cloudinary Unsigned Photographic Evidence Upload
EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME=danao-trashtrack
EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET=trashtrack_evidence

# Google Maps Platform & Routing Optimization
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSy...</code></pre>

  <div class="page-break"></div>

  <h2>5. Formal Handover Sign-Off & Acceptance Matrix</h2>
  <table>
    <thead>
      <tr>
        <th>Role / Representation</th>
        <th>Agency / Institution</th>
        <th>Designated Representative</th>
        <th>Signature</th>
        <th>Date</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Lead Proponents / Developers</strong></td>
        <td>Capstone Development Team</td>
        <td>Lead Project Proponent</td>
        <td>________________________</td>
        <td>____/____/2026</td>
      </tr>
      <tr>
        <td><strong>Supervising Agency</strong></td>
        <td>CICTO Danao City</td>
        <td>CICTO Project Officer</td>
        <td>________________________</td>
        <td>____/____/2026</td>
      </tr>
      <tr>
        <td><strong>Operating Beneficiary</strong></td>
        <td>LGU Danao City – CENRO</td>
        <td>City Environmental Officer</td>
        <td>________________________</td>
        <td>____/____/2026</td>
      </tr>
      <tr>
        <td><strong>Evaluation Committee</strong></td>
        <td>College of Computer Studies</td>
        <td>Capstone Panel Chair / Dean</td>
        <td>________________________</td>
        <td>____/____/2026</td>
      </tr>
    </tbody>
  </table>

  <script>
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    });
  </script>
</body>
</html>`;

const outputHtmlPath = path.join(__dirname, '..', 'docs', 'CICTO_TURNOVER_MANUAL.html');
const outputPdfPath = path.join(__dirname, '..', 'docs', 'CICTO_TURNOVER_MANUAL.pdf');

fs.writeFileSync(outputHtmlPath, htmlContent);
console.log('✅ Generated HTML manual at:', outputHtmlPath);

// Locate Chrome or Edge
const candidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

let browserPath = candidates.find((p) => fs.existsSync(p));

if (browserPath) {
  console.log('🖨️ Printing PDF using browser:', browserPath);
  try {
    const fileUrl = 'file:///' + outputHtmlPath.split('\\').join('/');
    const cmd = `"${browserPath}" --headless=new --disable-gpu --run-all-compositor-stages-before-draw --print-to-pdf="${outputPdfPath}" "${fileUrl}"`;
    execSync(cmd, { stdio: 'inherit', timeout: 30000 });
    console.log('🎉 PDF successfully created at:', outputPdfPath);
  } catch (err) {
    console.warn('PDF CLI generation note:', err.message);
  }
} else {
  console.log('Browser binary not found, but standalone HTML viewer is ready.');
}
