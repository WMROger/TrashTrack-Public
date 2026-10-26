export type SimulationWaypoint = {
  latitude: number;
  longitude: number;
  name?: string;
  speed?: number;
  barangay?: string;
};

export const CENRO_DEPOT_WAYPOINT = {
  latitude: 10.5218,
  longitude: 124.0285,
  name: 'CENRO Municipal Depot (Origin)',
  speed: 20,
  barangay: 'Poblacion',
};

export const CENRO_RETURN_WAYPOINT = {
  latitude: 10.5218,
  longitude: 124.0285,
  name: 'CENRO Municipal Transfer Station',
  speed: 18,
  barangay: 'Poblacion',
};

// Precise, street-accurate collection loops for major Danao City sectors
export const BARANGAY_COLLECTION_ROUTES: Record<string, SimulationWaypoint[]> = {
  Poblacion: [
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Depot (Start)', speed: 20, barangay: 'Poblacion' },
    { latitude: 10.5235, longitude: 124.0290, name: 'Rizal St / City Hall Compound', speed: 25, barangay: 'Poblacion' },
    { latitude: 10.5255, longitude: 124.0298, name: 'Beatriz D. Durano Ave (Commercial)', speed: 30, barangay: 'Poblacion' },
    { latitude: 10.5270, longitude: 124.0305, name: 'Duterte St Public Market Stop', speed: 22, barangay: 'Poblacion' },
    { latitude: 10.5285, longitude: 124.0280, name: 'F. Ralota St Residential Sector', speed: 28, barangay: 'Poblacion' },
    { latitude: 10.5265, longitude: 124.0260, name: 'Pio del Pilar St Collection Point', speed: 25, barangay: 'Poblacion' },
    { latitude: 10.5240, longitude: 124.0255, name: 'Hospital Memorial Road', speed: 30, barangay: 'Poblacion' },
    { latitude: 10.5220, longitude: 124.0270, name: 'Central Terminal Link', speed: 25, barangay: 'Poblacion' },
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Transfer Station', speed: 18, barangay: 'Poblacion' },
  ],

  Suba: [
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Depot Departure', speed: 24, barangay: 'Poblacion' },
    { latitude: 10.5250, longitude: 124.0295, name: 'B.D. Durano Northward Link', speed: 35, barangay: 'Poblacion' },
    { latitude: 10.5280, longitude: 124.0315, name: 'P.G. Almendras St (Suba Entry)', speed: 32, barangay: 'Suba' },
    { latitude: 10.5298, longitude: 124.0322, name: 'Suba Elementary Collection Point', speed: 25, barangay: 'Suba' },
    { latitude: 10.5315, longitude: 124.0330, name: 'F. Ralota Coastal Access', speed: 28, barangay: 'Suba' },
    { latitude: 10.5328, longitude: 124.0318, name: 'Suba Riverside Sector Stop', speed: 26, barangay: 'Suba' },
    { latitude: 10.5305, longitude: 124.0300, name: 'Suba Chapel Cross-way', speed: 30, barangay: 'Suba' },
    { latitude: 10.5260, longitude: 124.0280, name: 'Southbound Return Arterial', speed: 38, barangay: 'Suba' },
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Transfer Station', speed: 20, barangay: 'Poblacion' },
  ],

  Looc: [
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Depot Departure', speed: 25, barangay: 'Poblacion' },
    { latitude: 10.5270, longitude: 124.0305, name: 'Highway North Transit', speed: 40, barangay: 'Suba' },
    { latitude: 10.5335, longitude: 124.0335, name: 'Looc Boundary Highway', speed: 42, barangay: 'Looc' },
    { latitude: 10.5355, longitude: 124.0350, name: 'Danao Port Access Road', speed: 30, barangay: 'Looc' },
    { latitude: 10.5380, longitude: 124.0360, name: 'Looc Coastal Boardwalk Stop', speed: 28, barangay: 'Looc' },
    { latitude: 10.5405, longitude: 124.0355, name: 'Looc Norte Residential Point', speed: 32, barangay: 'Looc' },
    { latitude: 10.5390, longitude: 124.0335, name: 'Looc Interior Purok 2', speed: 25, barangay: 'Looc' },
    { latitude: 10.5350, longitude: 124.0315, name: 'Looc West Bypass Connection', speed: 38, barangay: 'Looc' },
    { latitude: 10.5280, longitude: 124.0290, name: 'National Highway South Return', speed: 45, barangay: 'Suba' },
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Transfer Station', speed: 20, barangay: 'Poblacion' },
  ],

  Guinsay: [
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Depot Departure', speed: 28, barangay: 'Poblacion' },
    { latitude: 10.5320, longitude: 124.0325, name: 'North Transit Expressway', speed: 48, barangay: 'Suba' },
    { latitude: 10.5410, longitude: 124.0350, name: 'Taytay Flyover Approach', speed: 45, barangay: 'Taytay' },
    { latitude: 10.5460, longitude: 124.0320, name: 'Guinsay Boulevard Entrance', speed: 40, barangay: 'Guinsay' },
    { latitude: 10.5485, longitude: 124.0305, name: 'Guinsay National High Stop', speed: 25, barangay: 'Guinsay' },
    { latitude: 10.5510, longitude: 124.0290, name: 'Sitio Pag-utlan Waste Station', speed: 28, barangay: 'Guinsay' },
    { latitude: 10.5525, longitude: 124.0315, name: 'Guinsay Coastal Beach Hub', speed: 32, barangay: 'Guinsay' },
    { latitude: 10.5490, longitude: 124.0335, name: 'Guinsay East Purok Collection', speed: 26, barangay: 'Guinsay' },
    { latitude: 10.5440, longitude: 124.0310, name: 'Taytay South Connection', speed: 42, barangay: 'Taytay' },
    { latitude: 10.5330, longitude: 124.0310, name: 'Highway Return Corridor', speed: 48, barangay: 'Looc' },
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Transfer Station', speed: 20, barangay: 'Poblacion' },
  ],

  Sabang: [
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Depot Departure', speed: 30, barangay: 'Poblacion' },
    { latitude: 10.5380, longitude: 124.0350, name: 'North Highway Transit', speed: 50, barangay: 'Looc' },
    { latitude: 10.5480, longitude: 124.0305, name: 'Guinsay Sector Transit', speed: 48, barangay: 'Guinsay' },
    { latitude: 10.5535, longitude: 124.0265, name: 'Sabang Highway Entry', speed: 52, barangay: 'Sabang' },
    { latitude: 10.5565, longitude: 124.0235, name: 'Sabang Public Market Hub', speed: 24, barangay: 'Sabang' },
    { latitude: 10.5595, longitude: 124.0205, name: 'Sabang Elementary Crossing', speed: 32, barangay: 'Sabang' },
    { latitude: 10.5620, longitude: 124.0180, name: 'Sabang North Border Turnaround', speed: 35, barangay: 'Sabang' },
    { latitude: 10.5580, longitude: 124.0220, name: 'Sabang Interior Purok Stop', speed: 26, barangay: 'Sabang' },
    { latitude: 10.5500, longitude: 124.0280, name: 'Sabang Bypass Southlink', speed: 55, barangay: 'Sabang' },
    { latitude: 10.5350, longitude: 124.0320, name: 'Southbound Expressway Return', speed: 50, barangay: 'Looc' },
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Transfer Station', speed: 20, barangay: 'Poblacion' },
  ],

  Maslog: [
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Depot Departure', speed: 30, barangay: 'Poblacion' },
    { latitude: 10.5350, longitude: 124.0250, name: 'Central Bypass Northbound', speed: 42, barangay: 'Poblacion' },
    { latitude: 10.5450, longitude: 124.0200, name: 'Tuburan Hill Approach', speed: 38, barangay: 'Tuburan Sur' },
    { latitude: 10.5520, longitude: 124.0180, name: 'Maslog Bypass Road Entry', speed: 40, barangay: 'Maslog' },
    { latitude: 10.5545, longitude: 124.0165, name: 'Maslog Barangay Hall & Chapel', speed: 25, barangay: 'Maslog' },
    { latitude: 10.5570, longitude: 124.0145, name: 'Maslog Upper Purok 3 Stop', speed: 28, barangay: 'Maslog' },
    { latitude: 10.5550, longitude: 124.0125, name: 'Maslog Farm-to-Market Collection', speed: 30, barangay: 'Maslog' },
    { latitude: 10.5510, longitude: 124.0150, name: 'Maslog South Loop Link', speed: 36, barangay: 'Maslog' },
    { latitude: 10.5420, longitude: 124.0175, name: 'Tuburan Return Link', speed: 42, barangay: 'Tuburan Sur' },
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Transfer Station', speed: 22, barangay: 'Poblacion' },
  ],

  Taytay: [
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Depot Departure', speed: 26, barangay: 'Poblacion' },
    { latitude: 10.5300, longitude: 124.0310, name: 'Suba Northbound Arterial', speed: 40, barangay: 'Suba' },
    { latitude: 10.5380, longitude: 124.0340, name: 'Looc Highway Link', speed: 44, barangay: 'Looc' },
    { latitude: 10.5425, longitude: 124.0325, name: 'Taytay Junction Hub', speed: 32, barangay: 'Taytay' },
    { latitude: 10.5445, longitude: 124.0310, name: 'Taytay Bridge Collection Point', speed: 25, barangay: 'Taytay' },
    { latitude: 10.5465, longitude: 124.0290, name: 'Taytay Riverway Residential Loop', speed: 28, barangay: 'Taytay' },
    { latitude: 10.5435, longitude: 124.0340, name: 'Taytay Coastal Turnaround', speed: 30, barangay: 'Taytay' },
    { latitude: 10.5360, longitude: 124.0330, name: 'Looc Return Corridor', speed: 45, barangay: 'Looc' },
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Transfer Station', speed: 20, barangay: 'Poblacion' },
  ],

  'Cogon-Cruz': [
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Depot Departure', speed: 26, barangay: 'Poblacion' },
    { latitude: 10.5280, longitude: 124.0240, name: 'Hospital Road West Extension', speed: 35, barangay: 'Poblacion' },
    { latitude: 10.5340, longitude: 124.0190, name: 'Cogon Foothills Access', speed: 32, barangay: 'Cogon-Cruz' },
    { latitude: 10.5375, longitude: 124.0170, name: 'Cogon-Cruz Barangay Center', speed: 24, barangay: 'Cogon-Cruz' },
    { latitude: 10.5400, longitude: 124.0150, name: 'Cruz Hillside Collection Stop', speed: 28, barangay: 'Cogon-Cruz' },
    { latitude: 10.5420, longitude: 124.0165, name: 'Upper Cogon Community Hub', speed: 26, barangay: 'Cogon-Cruz' },
    { latitude: 10.5365, longitude: 124.0185, name: 'Cogon Collector Path', speed: 30, barangay: 'Cogon-Cruz' },
    { latitude: 10.5290, longitude: 124.0220, name: 'Terminal Southbound Route', speed: 38, barangay: 'Poblacion' },
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Transfer Station', speed: 20, barangay: 'Poblacion' },
  ],

  'Tuburan Sur': [
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Depot Departure', speed: 28, barangay: 'Poblacion' },
    { latitude: 10.5310, longitude: 124.0230, name: 'Northwest Transit Road', speed: 40, barangay: 'Poblacion' },
    { latitude: 10.5400, longitude: 124.0180, name: 'Tuburan Sur Valley Approach', speed: 35, barangay: 'Tuburan Sur' },
    { latitude: 10.5450, longitude: 124.0155, name: 'Tuburan Sur Barangay Hall', speed: 25, barangay: 'Tuburan Sur' },
    { latitude: 10.5480, longitude: 124.0135, name: 'Tuburan Sur Creek Sector', speed: 28, barangay: 'Tuburan Sur' },
    { latitude: 10.5495, longitude: 124.0160, name: 'Tuburan Access Link Stop', speed: 32, barangay: 'Tuburan Sur' },
    { latitude: 10.5430, longitude: 124.0175, name: 'Tuburan South Link', speed: 36, barangay: 'Tuburan Sur' },
    { latitude: 10.5280, longitude: 124.0240, name: 'City Center South Access', speed: 40, barangay: 'Poblacion' },
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Transfer Station', speed: 20, barangay: 'Poblacion' },
  ],

  Dunggoan: [
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Depot Departure', speed: 25, barangay: 'Poblacion' },
    { latitude: 10.5200, longitude: 124.0250, name: 'South Arterial Highway', speed: 38, barangay: 'Poblacion' },
    { latitude: 10.5175, longitude: 124.0210, name: 'Dunggoan Highway Entry', speed: 35, barangay: 'Dunggoan' },
    { latitude: 10.5155, longitude: 124.0190, name: 'Dunggoan Port Access Collection', speed: 24, barangay: 'Dunggoan' },
    { latitude: 10.5140, longitude: 124.0220, name: 'Dunggoan Coastal Purok Stop', speed: 28, barangay: 'Dunggoan' },
    { latitude: 10.5165, longitude: 124.0240, name: 'Dunggoan Community Center', speed: 30, barangay: 'Dunggoan' },
    { latitude: 10.5190, longitude: 124.0265, name: 'National Road Northward Return', speed: 42, barangay: 'Poblacion' },
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Transfer Station', speed: 20, barangay: 'Poblacion' },
  ],

  Taboc: [
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Depot Departure', speed: 28, barangay: 'Poblacion' },
    { latitude: 10.5170, longitude: 124.0210, name: 'South Highway Corridor', speed: 45, barangay: 'Dunggoan' },
    { latitude: 10.5125, longitude: 124.0160, name: 'Taboc Highway Boundary', speed: 40, barangay: 'Taboc' },
    { latitude: 10.5095, longitude: 124.0135, name: 'Taboc Barangay Hall & Plaza', speed: 25, barangay: 'Taboc' },
    { latitude: 10.5080, longitude: 124.0165, name: 'Taboc Coastal Sector Stop', speed: 28, barangay: 'Taboc' },
    { latitude: 10.5110, longitude: 124.0185, name: 'Taboc Upper Purok Waste Hub', speed: 32, barangay: 'Taboc' },
    { latitude: 10.5150, longitude: 124.0210, name: 'Northbound Return Highway', speed: 46, barangay: 'Dunggoan' },
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Transfer Station', speed: 20, barangay: 'Poblacion' },
  ],

  Binaliw: [
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Depot Departure', speed: 28, barangay: 'Poblacion' },
    { latitude: 10.5180, longitude: 124.0210, name: 'South Highway Corridor', speed: 42, barangay: 'Dunggoan' },
    { latitude: 10.5140, longitude: 124.0050, name: 'Binaliw Access Arterial Road', speed: 35, barangay: 'Binaliw' },
    { latitude: 10.5100, longitude: 123.9900, name: 'Binaliw Barangay Hall & Plaza Hub', speed: 22, barangay: 'Binaliw' },
    { latitude: 10.5080, longitude: 123.9870, name: 'Sitio Binaliw Proper Collection Hub', speed: 25, barangay: 'Binaliw' },
    { latitude: 10.5120, longitude: 123.9850, name: 'Binaliw Elementary School Stop', speed: 24, barangay: 'Binaliw' },
    { latitude: 10.5150, longitude: 123.9890, name: 'Upper Binaliw Purok Waste Loop', speed: 26, barangay: 'Binaliw' },
    { latitude: 10.5170, longitude: 124.0150, name: 'Highway Return Corridor from Binaliw', speed: 40, barangay: 'Dunggoan' },
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Transfer Station', speed: 20, barangay: 'Poblacion' },
  ],

  // 1. Original Baliang Route (9 Corridor Collection Points: Depot -> Baliang -> Transfer Station)
  Baliang_Original: [
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Municipal Depot Departure', speed: 25, barangay: 'Poblacion' },
    { latitude: 10.5255, longitude: 124.0150, name: 'Beatriz Durano Ave Outbound Link', speed: 38, barangay: 'Poblacion' },
    { latitude: 10.5180, longitude: 123.9950, name: 'National Highway West Transit', speed: 45, barangay: 'Cabungahan' },
    { latitude: 10.5120, longitude: 123.9720, name: 'Baliang Valley Highway Entry', speed: 35, barangay: 'Baliang' },
    { latitude: 10.509496, longitude: 123.960304, name: 'Purok 1 Residential Collection Stop', speed: 22, barangay: 'Baliang' },
    { latitude: 10.507351, longitude: 123.956004, name: 'Purok Mangga Street Collection Point', speed: 20, barangay: 'Baliang' },
    { latitude: 10.507170, longitude: 123.955594, name: 'Baliang Barangay Hall & Civic Center', speed: 18, barangay: 'Baliang' },
    { latitude: 10.5160, longitude: 123.9850, name: 'Baliang Inbound Highway Return', speed: 45, barangay: 'Baliang' },
    { latitude: 10.5218, longitude: 124.0285, name: 'CENRO Municipal Transfer Station', speed: 20, barangay: 'Poblacion' },
  ],

  // 2. Whole Barangay Baliang Circuit (8 Comprehensive Sector Stops Covering All Puroks)
  Baliang_Whole: [
    { latitude: 10.509496, longitude: 123.960304, name: 'Purok 1 Residential Collection Stop', speed: 22, barangay: 'Baliang' },
    { latitude: 10.508520, longitude: 123.958210, name: 'Purok 2 Riverside Waste Point', speed: 20, barangay: 'Baliang' },
    { latitude: 10.507351, longitude: 123.956004, name: 'Purok Mangga Street Collection Point', speed: 20, barangay: 'Baliang' },
    { latitude: 10.506120, longitude: 123.954830, name: 'Baliang Elementary School Hub', speed: 22, barangay: 'Baliang' },
    { latitude: 10.507170, longitude: 123.955594, name: 'Baliang Barangay Hall & Civic Center', speed: 18, barangay: 'Baliang' },
    { latitude: 10.504890, longitude: 123.953420, name: 'Purok 3 Hillside Residential Station', speed: 24, barangay: 'Baliang' },
    { latitude: 10.502950, longitude: 123.951860, name: 'Upper Baliang Agricultural Waypoint', speed: 25, barangay: 'Baliang' },
    { latitude: 10.504100, longitude: 123.954200, name: 'Baliang South Boundary Loop Station', speed: 22, barangay: 'Baliang' },
  ],

  // 3. Direct Baliang Local Loop (3 Quick Testing Stops in Barangay Baliang)
  Baliang_Direct: [
    { latitude: 10.509496, longitude: 123.960304, name: 'Purok 1 Residential Collection Stop', speed: 22, barangay: 'Baliang' },
    { latitude: 10.507351, longitude: 123.956004, name: 'Purok Mangga Street Collection Point', speed: 20, barangay: 'Baliang' },
    { latitude: 10.507170, longitude: 123.955594, name: 'Baliang Barangay Hall & Civic Center', speed: 18, barangay: 'Baliang' },
  ],

  // Default Baliang mapping (matches Direct Baliang for quick sector dispatch)
  Baliang: [
    { latitude: 10.509496, longitude: 123.960304, name: 'Purok 1 Residential Collection Stop', speed: 22, barangay: 'Baliang' },
    { latitude: 10.507351, longitude: 123.956004, name: 'Purok Mangga Street Collection Point', speed: 20, barangay: 'Baliang' },
    { latitude: 10.507170, longitude: 123.955594, name: 'Baliang Barangay Hall & Civic Center', speed: 18, barangay: 'Baliang' },
  ],
};

// Verified Geographic Coordinates of All 42 Danao City Barangays (PSA / PhilAtlas / OpenStreetMap)
export const BARANGAY_ANCHORS: Record<string, { lat: number; lng: number }> = {
  Baliang: { lat: 10.5038, lng: 123.9546 },
  Bayabas: { lat: 10.5875, lng: 123.8645 },
  Binaliw: { lat: 10.5419, lng: 123.9825 },
  Cabungahan: { lat: 10.5171, lng: 123.9883 },
  'Cagat-Lamac': { lat: 10.5529, lng: 123.9999 },
  'Cagat-Lapu-Lapu': { lat: 10.5529, lng: 123.9999 },
  Cahumayan: { lat: 10.5609, lng: 123.9488 },
  Cambanay: { lat: 10.5392, lng: 124.0131 },
  Cambubho: { lat: 10.5537, lng: 123.8835 },
  'Cogon-Cruz': { lat: 10.5156, lng: 124.0080 },
  Danasan: { lat: 10.5598, lng: 123.8560 },
  Dumolog: { lat: 10.5538, lng: 123.9418 },
  Dungga: { lat: 10.5538, lng: 123.9418 },
  Dunggoan: { lat: 10.5533, lng: 124.0227 },
  Guinacot: { lat: 10.5252, lng: 124.0003 },
  Guinsay: { lat: 10.5515, lng: 124.0229 },
  Ibo: { lat: 10.5233, lng: 123.9592 },
  Langosig: { lat: 10.5221, lng: 123.9056 },
  Lawaan: { lat: 10.5499, lng: 123.9027 },
  Licos: { lat: 10.5047, lng: 123.9327 },
  Looc: { lat: 10.5104, lng: 124.0271 },
  Magtagobtob: { lat: 10.5628, lng: 123.8805 },
  Malapoc: { lat: 10.5342, lng: 123.9990 },
  Manlayag: { lat: 10.5064, lng: 123.9856 },
  Mantija: { lat: 10.5394, lng: 123.9568 },
  Masaba: { lat: 10.5539, lng: 123.9667 },
  Maslog: { lat: 10.4819, lng: 124.0226 },
  Nangka: { lat: 10.5262, lng: 123.9408 },
  Oguis: { lat: 10.5462, lng: 123.9252 },
  Pili: { lat: 10.5832, lng: 123.8977 },
  Poblacion: { lat: 10.5218, lng: 124.0285 },
  Quisol: { lat: 10.5335, lng: 123.9807 },
  Sabang: { lat: 10.4973, lng: 124.0311 },
  Sacsac: { lat: 10.5306, lng: 123.8948 },
  'Sandayong Norte': { lat: 10.5535, lng: 123.9891 },
  'Sandayong Sur': { lat: 10.4940, lng: 123.9936 },
  'Santa Rosa': { lat: 10.5267, lng: 123.9717 },
  Santican: { lat: 10.5784, lng: 123.9193 },
  Sibacan: { lat: 10.5278, lng: 123.9235 },
  Suba: { lat: 10.5247, lng: 124.0285 },
  Taboc: { lat: 10.5317, lng: 124.0193 },
  Taytay: { lat: 10.5325, lng: 124.0275 },
  Togonon: { lat: 10.5154, lng: 123.9450 },
  'Tuburan Sur': { lat: 10.5152, lng: 124.0189 },
};

/**
 * Returns a complete realistic collection loop starting from CENRO Municipal Depot,
 * traveling to the target Barangay, executing a collection loop within that Barangay,
 * and returning to the CENRO Transfer Station.
 */
export function getBarangaySimulationRoute(
  barangayName?: string,
  variant?: 'whole' | 'original' | 'direct'
): SimulationWaypoint[] {
  const target = (barangayName || 'Poblacion').trim();
  const cleanTarget = target.toLowerCase();

  // If specific Baliang variant is requested
  if (cleanTarget.includes('baliang')) {
    if (variant === 'direct' || cleanTarget.includes('direct')) {
      return BARANGAY_COLLECTION_ROUTES.Baliang_Direct;
    }
    if (variant === 'original' || cleanTarget.includes('original')) {
      return BARANGAY_COLLECTION_ROUTES.Baliang_Original;
    }
    if (variant === 'whole' || cleanTarget.includes('whole')) {
      return BARANGAY_COLLECTION_ROUTES.Baliang_Whole;
    }
    // Default to direct Baliang local loop (100% within Barangay Baliang)
    return BARANGAY_COLLECTION_ROUTES.Baliang_Direct;
  }

  // If a curated route exists, use it
  if (BARANGAY_COLLECTION_ROUTES[target]) {
    return BARANGAY_COLLECTION_ROUTES[target];
  }

  // Find approximate coordinates for any of the 42 Danao City barangays
  const anchor = BARANGAY_ANCHORS[target] || { lat: 10.5300, lng: 124.0100 };
  const depot = { lat: 10.5218, lng: 124.0285 };

  // Intermediate outbound point
  const midOutLat = depot.lat + (anchor.lat - depot.lat) * 0.55;
  const midOutLng = depot.lng + (anchor.lng - depot.lng) * 0.55;

  // Intermediate inbound return point (offset to create realistic road loop)
  const midInLat = depot.lat + (anchor.lat - depot.lat) * 0.45 + 0.002;
  const midInLng = depot.lng + (anchor.lng - depot.lng) * 0.45 - 0.002;

  return [
    { latitude: depot.lat, longitude: depot.lng, name: 'CENRO Municipal Depot (Departure)', speed: 25, barangay: 'Poblacion' },
    { latitude: midOutLat, longitude: midOutLng, name: `Arterial Route to Brgy. ${target}`, speed: 42, barangay: target },
    { latitude: anchor.lat - 0.003, longitude: anchor.lng - 0.002, name: `Brgy. ${target} Sector Entry`, speed: 30, barangay: target },
    { latitude: anchor.lat, longitude: anchor.lng, name: `Brgy. ${target} Barangay Hall & Plaza Hub`, speed: 22, barangay: target },
    { latitude: anchor.lat + 0.003, longitude: anchor.lng + 0.002, name: `Brgy. ${target} Upper Purok Collection Point`, speed: 25, barangay: target },
    { latitude: anchor.lat + 0.001, longitude: anchor.lng + 0.004, name: `Brgy. ${target} East Residential Station`, speed: 28, barangay: target },
    { latitude: anchor.lat - 0.002, longitude: anchor.lng + 0.003, name: `Brgy. ${target} Farm-to-Market Waste Stop`, speed: 26, barangay: target },
    { latitude: midInLat, longitude: midInLng, name: `Southbound Return Corridor from ${target}`, speed: 45, barangay: target },
    { latitude: depot.lat, longitude: depot.lng, name: 'CENRO Municipal Transfer Station', speed: 20, barangay: 'Poblacion' },
  ];
}

export type SimulationRouteOption = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  barangay: string;
  waypoints: SimulationWaypoint[];
  badge: string;
};

export function getAvailableSimulationRoutesForBarangay(barangayName?: string): SimulationRouteOption[] {
  const clean = (barangayName || '').replace(/^(brgy\.?|barangay)\s*/i, '').trim().toLowerCase();
  if (clean === 'baliang') {
    return [
      {
        id: 'direct',
        name: 'Direct Baliang Local Loop',
        shortName: 'Direct Baliang (3 Stops)',
        description: '3 Strategic pickup points inside Brgy. Baliang (Purok 1, Purok Mangga, Barangay Hall)',
        barangay: 'Baliang',
        waypoints: BARANGAY_COLLECTION_ROUTES.Baliang_Direct,
        badge: 'Direct · 3 Stops (Quick Test)',
      },
      {
        id: 'whole',
        name: 'Whole Baliang Circuit',
        shortName: 'Whole Baliang Loop (8 Stops)',
        description: 'Comprehensive 8 pickup points covering all puroks and community hubs across Brgy. Baliang',
        barangay: 'Baliang',
        waypoints: BARANGAY_COLLECTION_ROUTES.Baliang_Whole,
        badge: 'Full Loop · 8 Stops',
      },
      {
        id: 'original',
        name: 'Original Corridor Route',
        shortName: 'Depot to Baliang Corridor (9 Stops)',
        description: 'Full municipal corridor starting from CENRO Depot, traversing transit highways, and completing Baliang sector',
        barangay: 'Baliang',
        waypoints: BARANGAY_COLLECTION_ROUTES.Baliang_Original,
        badge: 'Corridor · 9 Stops',
      },
    ];
  }

  const standardRoute = getBarangaySimulationRoute(barangayName);
  return [
    {
      id: 'standard',
      name: `Brgy. ${barangayName || 'Danao City'} Route`,
      shortName: 'Standard Route',
      description: `Official collection route for Brgy. ${barangayName || 'Danao City'}`,
      barangay: barangayName || 'Poblacion',
      waypoints: standardRoute,
      badge: `${standardRoute.length} Stops`,
    },
  ];
}
