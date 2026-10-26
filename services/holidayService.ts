/**
 * Philippine Public Holidays & Special Non-Working Days Service
 * Powered by Nager.Date Public Holidays API (100% Free Public API, No Key Required)
 * Provides automated collection schedule holiday warnings for Danao City / CENRO.
 */

export interface PhilippineHoliday {
  date: string; // "YYYY-MM-DD"
  localName: string;
  name: string;
  countryCode: string;
  fixed: boolean;
  global: boolean;
  types: string[];
  daysUntil: number;
  isToday: boolean;
  isUpcoming: boolean; // within 14 days
}

export interface HolidayScheduleAdvisory {
  hasActiveNotice: boolean;
  holidayName?: string;
  holidayDate?: string;
  daysRemaining?: number;
  badgeText: string;
  noticeTitle: string;
  noticeMessage: string;
  recommendedAction: string;
}

let cachedHolidays: PhilippineHoliday[] = [];
let lastFetchYear = 0;

/**
 * Fetches all official Philippine public holidays for a given year.
 */
export async function getPhilippineHolidays(year: number = new Date().getFullYear()): Promise<PhilippineHoliday[]> {
  if (cachedHolidays.length > 0 && lastFetchYear === year) {
    return cachedHolidays;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/PH`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Nager.Date responded with HTTP ${response.status}`);
    }

    const rawList: any[] = await response.json();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const parsed: PhilippineHoliday[] = rawList.map(h => {
      const hDate = new Date(h.date);
      hDate.setHours(0, 0, 0, 0);
      const diffTime = hDate.getTime() - today.getTime();
      const daysUntil = Math.round(diffTime / (1000 * 60 * 60 * 24));

      return {
        date: h.date,
        localName: h.localName,
        name: h.name,
        countryCode: h.countryCode,
        fixed: h.fixed,
        global: h.global,
        types: h.types || [],
        daysUntil,
        isToday: daysUntil === 0,
        isUpcoming: daysUntil > 0 && daysUntil <= 14,
      };
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    cachedHolidays = parsed;
    lastFetchYear = year;
    return parsed;
  } catch (error) {
    console.warn('Could not fetch holidays from Nager.Date, using Philippine statutory defaults:', error);

    // Fallback standard PH holidays for the current year
    const fallbackDates = [
      { date: `${year}-01-01`, name: "New Year's Day", localName: "Araw ng Bagong Taon" },
      { date: `${year}-04-09`, name: "Day of Valor", localName: "Araw ng Kagitingan" },
      { date: `${year}-05-01`, name: "Labor Day", localName: "Araw ng Paggawa" },
      { date: `${year}-06-12`, name: "Independence Day", localName: "Araw ng Kalayaan" },
      { date: `${year}-08-31`, name: "National Heroes Day", localName: "Araw ng mga Bayani" },
      { date: `${year}-11-01`, name: "All Saints' Day", localName: "Undas" },
      { date: `${year}-11-30`, name: "Bonifacio Day", localName: "Araw ni Bonifacio" },
      { date: `${year}-12-25`, name: "Christmas Day", localName: "Araw ng Pasko" },
      { date: `${year}-12-30`, name: "Rizal Day", localName: "Araw ng Kabayanihan ni Dr. Jose Rizal" },
    ];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fallbacks: PhilippineHoliday[] = fallbackDates.map(h => {
      const hDate = new Date(h.date);
      hDate.setHours(0, 0, 0, 0);
      const diffTime = hDate.getTime() - today.getTime();
      const daysUntil = Math.round(diffTime / (1000 * 60 * 60 * 24));

      return {
        date: h.date,
        localName: h.localName,
        name: h.name,
        countryCode: 'PH',
        fixed: true,
        global: true,
        types: ['Public'],
        daysUntil,
        isToday: daysUntil === 0,
        isUpcoming: daysUntil > 0 && daysUntil <= 14,
      };
    });

    cachedHolidays = fallbacks;
    lastFetchYear = year;
    return fallbacks;
  }
}

/**
 * Evaluates upcoming Philippine holidays and returns an operational CENRO collection notice.
 */
export async function getUpcomingHolidayNotice(): Promise<HolidayScheduleAdvisory> {
  const holidays = await getPhilippineHolidays();
  
  // 1. Check if today is a holiday
  const todayHoliday = holidays.find(h => h.isToday);
  if (todayHoliday) {
    return {
      hasActiveNotice: true,
      holidayName: todayHoliday.name,
      holidayDate: todayHoliday.date,
      daysRemaining: 0,
      badgeText: '🇵🇭 SPECIAL HOLIDAY SCHEDULE (TODAY)',
      noticeTitle: `Today is ${todayHoliday.name} (${todayHoliday.localName})`,
      noticeMessage: `Special Holiday Collection Protocol active. Regular morning residential pickup continues with adjusted transfer station window.`,
      recommendedAction: 'Residential collection prioritized from 06:00 AM – 11:00 AM.',
    };
  }

  // 2. Check if a holiday is coming up in next 14 days
  const upcomingHoliday = holidays.find(h => h.isUpcoming && h.daysUntil > 0);
  if (upcomingHoliday) {
    const formattedDate = new Date(upcomingHoliday.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    return {
      hasActiveNotice: true,
      holidayName: upcomingHoliday.name,
      holidayDate: upcomingHoliday.date,
      daysRemaining: upcomingHoliday.daysUntil,
      badgeText: `🇵🇭 UPCOMING HOLIDAY (${upcomingHoliday.daysUntil}d)`,
      noticeTitle: `Upcoming: ${upcomingHoliday.name} on ${formattedDate}`,
      noticeMessage: `Anticipate 18–25% higher commercial and market waste volume leading into ${upcomingHoliday.name}.`,
      recommendedAction: 'Schedule secondary truck sweeps for Poblacion, Taytay, and Suba markets.',
    };
  }

  return {
    hasActiveNotice: false,
    badgeText: '🇵🇭 REGULAR SCHEDULE',
    noticeTitle: 'Standard Working Operations',
    noticeMessage: 'No statutory holidays in the next 14 days. Regular collection frequencies apply.',
    recommendedAction: 'Standard 42-barangay schedule active.',
  };
}
