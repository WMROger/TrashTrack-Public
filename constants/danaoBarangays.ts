export const DANAO_CITY_BARANGAYS = [
  'Baliang',
  'Bayabas',
  'Binaliw',
  'Cabungahan',
  'Cagat-Lapu-Lapu',
  'Cahumayan',
  'Cambanay',
  'Cambubho',
  'Cogon-Cruz',
  'Danasan',
  'Dumolog',
  'Dunggoan',
  'Guinacot',
  'Guinsay',
  'Ibo',
  'Langosig',
  'Lawaan',
  'Licos',
  'Looc',
  'Magtagobtob',
  'Malapoc',
  'Manlayag',
  'Mantija',
  'Masaba',
  'Maslog',
  'Nangka',
  'Oguis',
  'Pili',
  'Poblacion',
  'Quisol',
  'Sabang',
  'Sacsac',
  'Sandayong Norte',
  'Sandayong Sur',
  'Santa Rosa',
  'Santican',
  'Sibacan',
  'Suba',
  'Taboc',
  'Taytay',
  'Togonon',
  'Tuburan Sur',
] as const;

export const mergeDanaoBarangays = (configured: string[]) => Array.from(new Set([
  ...DANAO_CITY_BARANGAYS,
  ...configured.map(item => String(item || '').trim()).filter(Boolean),
])).sort((a, b) => a.localeCompare(b));

/**
 * Always returns all Danao City barangays, merged with any configured schedule barangays.
 */
export const resolveScheduleBarangays = (configured?: string[]): string[] => {
  return mergeDanaoBarangays(configured || []);
};
