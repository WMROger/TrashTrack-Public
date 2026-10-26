import { db } from '@/config/firebase';
import { DANAO_CITY_BARANGAYS } from '@/constants/danaoBarangays';
import { collection, getDocs } from 'firebase/firestore';

export interface BarangayRankEntry {
  rank: number;
  barangay: string;
  points: number;
  divertedTons: number;
  activeSchedules: number;
  weeklyRuns: number;
  fleetTrips: number;
  cleanlinessScore: number; // percentage (e.g. 98%)
  isUserBarangay: boolean;
  statusBadge: string;
  trend: 'up' | 'stable' | 'down';
}

export interface BarangaySpotlightStats {
  rank: number;
  totalBarangays: number;
  barangay: string;
  points: number;
  divertedTons: number;
  activeSchedules: number;
  weeklyRuns: number;
  fleetTrips: number;
  cleanlinessScore: number;
  userContributionPts: number;
  userContributionPct: number;
  statusBadge: string;
}

export interface LeaderboardResult {
  displayList: BarangayRankEntry[];
  top20: BarangayRankEntry[]; // Backwards compatibility for existing consumers
  allRanked: BarangayRankEntry[];
  hasMoreData: boolean;
  displayLimit: number; // 5 when no/low data, 20 when more data
  activeEntriesCount: number;
}

/**
 * Computes the official Danao City Barangay Cleanliness & Eco-Leaderboard
 * using ACTUAL data from Firestore (collection schedules, weekly collection runs,
 * fleet dispatches, and verified citizen points).
 *
 * Rules:
 * - No fake or artificial base points.
 * - If actual data does not exist (or <= 5 barangays have records), list the Top 5 first (even if 0 pts).
 * - If more data exists (> 5 barangays with records), proceed with the Top 20.
 */
export async function fetchBarangayLeaderboard(
  userBarangay: string = '',
  userPoints: number = 0,
): Promise<LeaderboardResult> {
  const schedulesByBrgy: Record<string, any[]> = {};
  const fleetByBrgy: Record<string, any[]> = {};
  const barangayDocsByBrgy: Record<string, any> = {};
  const statsByBrgy: Record<string, any> = {};

  try {
    if (db) {
      // 1. Fetch real collection schedules (public collection)
      try {
        const schedSnap = await getDocs(collection(db, 'barangay_schedules'));
        schedSnap.forEach((docSnap) => {
          const data = docSnap.data();
          const bName = String(data.barangayName || data.barangay || '').trim();
          if (bName) {
            const key = bName.toLowerCase();
            if (!schedulesByBrgy[key]) schedulesByBrgy[key] = [];
            schedulesByBrgy[key].push(data);
          }
        });
      } catch (err) {
        console.warn('Leaderboard: Failed to fetch barangay_schedules:', err);
      }

      // 2. Fetch real fleet dispatches and trips (public collection)
      try {
        const fleetSnap = await getDocs(collection(db, 'fleet_trips'));
        fleetSnap.forEach((docSnap) => {
          const data = docSnap.data();
          const bName = String(data.barangay || '').trim();
          if (bName) {
            const key = bName.toLowerCase();
            if (!fleetByBrgy[key]) fleetByBrgy[key] = [];
            fleetByBrgy[key].push(data);
          }
        });
      } catch (err: any) {
        if (err?.code !== 'permission-denied') {
          console.warn('Leaderboard: Failed to fetch fleet_trips:', err);
        }
      }

      // 3. Fetch barangays collection if any (public collection)
      try {
        const brgySnap = await getDocs(collection(db, 'barangays'));
        brgySnap.forEach((docSnap) => {
          const data = docSnap.data();
          const bName = String(data.name || data.barangay || '').trim();
          if (bName) {
            barangayDocsByBrgy[bName.toLowerCase()] = data;
          }
        });
      } catch (err) {
        console.warn('Leaderboard: Failed to fetch barangays:', err);
      }

      // 4. Fetch barangay_stats collection if any
      try {
        const statsSnap = await getDocs(collection(db, 'barangay_stats'));
        statsSnap.forEach((docSnap) => {
          const data = docSnap.data();
          const bName = String(data.barangayName || data.name || data.barangay || '').trim();
          if (bName) {
            statsByBrgy[bName.toLowerCase()] = data;
          }
        });
      } catch {
        // Optional collection
      }
    }
  } catch (err) {
    console.warn('Leaderboard: Overall fetch error:', err);
  }

  const cleanUserBrgy = (userBarangay || '').trim().toLowerCase();

  const entries: BarangayRankEntry[] = DANAO_CITY_BARANGAYS.map((brgy) => {
    const key = brgy.toLowerCase();
    const isUser = cleanUserBrgy === key;
    const scheds = schedulesByBrgy[key] || [];
    const trips = fleetByBrgy[key] || [];
    const bDoc = barangayDocsByBrgy[key];
    const bStats = statsByBrgy[key];

    const scheduleCount = scheds.length;
    let weeklyRuns = 0;
    const categories = new Set<string>();
    const streets = new Set<string>();

    scheds.forEach((s) => {
      if (Array.isArray(s.days)) {
        weeklyRuns += s.days.length;
      } else if (s.days) {
        weeklyRuns += 1;
      }
      if (s.wasteCategory) categories.add(String(s.wasteCategory));
      if (s.streetName) streets.add(String(s.streetName));
    });

    const tripCount = trips.length;
    const completedTrips = trips.filter(
      (t) => t.status === 'completed' || t.status === 'done'
    ).length;

    // Actual operational scoring (ZERO synthetic baseline):
    // - Weekly collection frequency: 150 pts / run
    // - Waste segregation diversity: 200 pts / stream
    // - Active truck dispatches: 100 pts / dispatch + 250 pts / completed trip
    // - Verified zone/street coverage: 100 pts / street
    // - Verified citizen points: added directly to user's registered barangay
    // - Stored points in Firestore document if set
    const runPoints = weeklyRuns * 150;
    const categoryPoints = categories.size * 200;
    const fleetPoints = tripCount * 100 + completedTrips * 250;
    const streetPoints = streets.size * 100;
    const userBonus = isUser ? Math.max(0, userPoints) : 0;
    const storedPoints = Number(bDoc?.points || bStats?.points || 0);

    const totalPoints = storedPoints + runPoints + categoryPoints + fleetPoints + streetPoints + userBonus;

    // Actual diverted mass estimate based purely on real completed pickups and dispatches
    const storedDiverted = Number(bDoc?.divertedTons || bStats?.divertedTons || 0);
    const calculatedDiverted = (weeklyRuns * 1.4) + (completedTrips * 2.2);
    const divertedTons = parseFloat((storedDiverted + calculatedDiverted).toFixed(1));

    // Cleanliness score derived from actual activity
    let cleanlinessScore = 0;
    let statusBadge = 'No Active Data';

    if (totalPoints > 0) {
      if (totalPoints >= 5000) {
        cleanlinessScore = 98;
        statusBadge = 'Eco Champion';
      } else if (totalPoints >= 3000) {
        cleanlinessScore = 95;
        statusBadge = 'High Compliance';
      } else if (totalPoints >= 2000) {
        cleanlinessScore = 92;
        statusBadge = 'Active Clean';
      } else if (totalPoints >= 1000) {
        cleanlinessScore = 88;
        statusBadge = 'Consistent';
      } else if (totalPoints >= 500) {
        cleanlinessScore = 82;
        statusBadge = 'Active';
      } else {
        cleanlinessScore = Math.min(80, Math.max(10, Math.round((totalPoints / 500) * 80)));
        statusBadge = 'Initial Activity';
      }
    } else {
      cleanlinessScore = 0;
      statusBadge = 'Pending Operations';
    }

    return {
      rank: 0,
      barangay: brgy,
      points: totalPoints,
      divertedTons,
      activeSchedules: scheduleCount,
      weeklyRuns,
      fleetTrips: tripCount,
      cleanlinessScore,
      isUserBarangay: isUser,
      statusBadge,
      trend: (cleanlinessScore >= 90 ? 'up' : 'stable') as 'up' | 'stable' | 'down',
    };
  });

  // Sort descending by actual total points, then diverted tons, then schedules
  entries.sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    if (b.divertedTons !== a.divertedTons) {
      return b.divertedTons - a.divertedTons;
    }
    if (b.activeSchedules !== a.activeSchedules) {
      return b.activeSchedules - a.activeSchedules;
    }
    if (a.isUserBarangay) return -1;
    if (b.isUserBarangay) return 1;
    return 0;
  });

  // Assign 1-indexed ranks across all Danao City barangays
  entries.forEach((item, idx) => {
    item.rank = idx + 1;
  });

  // Count how many barangays have actual operational data/points
  const activeEntriesCount = entries.filter(
    (e) => e.points > 0 || e.activeSchedules > 0 || e.fleetTrips > 0 || e.divertedTons > 0
  ).length;

  // Requirement: "if it doesnt exist list the top 5 first even if 0 but if more data then we can proced with top 20"
  const hasMoreData = activeEntriesCount > 5;
  const displayLimit = hasMoreData ? 20 : 5;
  const displayList = entries.slice(0, displayLimit);

  return {
    displayList,
    top20: displayList, // For backward compatibility with components expecting top20
    allRanked: entries,
    hasMoreData,
    displayLimit,
    activeEntriesCount,
  };
}

/**
 * Returns detailed spotlight metrics for the user's registered barangay.
 */
export function getBarangaySpotlight(
  barangayName: string,
  leaderboard: BarangayRankEntry[],
  userPoints: number = 0,
): BarangaySpotlightStats | null {
  if (!barangayName || leaderboard.length === 0) return null;

  const target = leaderboard.find(
    (b) => b.barangay.toLowerCase() === barangayName.trim().toLowerCase()
  );

  if (!target) return null;

  const userContributionPct =
    target.points > 0
      ? Math.min(100, parseFloat(((userPoints / target.points) * 100).toFixed(1)))
      : 0;

  return {
    rank: target.rank,
    totalBarangays: 42,
    barangay: target.barangay,
    points: target.points,
    divertedTons: target.divertedTons,
    activeSchedules: target.activeSchedules,
    weeklyRuns: target.weeklyRuns,
    fleetTrips: target.fleetTrips,
    cleanlinessScore: target.cleanlinessScore,
    userContributionPts: userPoints,
    userContributionPct,
    statusBadge: target.statusBadge,
  };
}
