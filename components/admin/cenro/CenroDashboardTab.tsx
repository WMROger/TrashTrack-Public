import { MaterialIcons } from '@expo/vector-icons';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { db } from '../../../config/firebase';
import { historicalWasteSeries } from '../../../data/historicalWasteData';
import { buildHotspots, LocationLike } from '../../../services/hotspotAnalysisService';
import { buildValidatedForecast } from '../../../services/wasteForecastService';
import { formatAdaptiveMassFromMetricTons, parseWasteAmountToMetricTons, toMetricTons, WasteMeasurementUnit } from '../../../utils/wasteUnits';
import { getDanaoLiveWeather, WeatherData } from '../../../services/weatherService';
import { getUpcomingHolidayNotice, HolidayScheduleAdvisory } from '../../../services/holidayService';
import ExportModal from './ExportModal';
import { exportReport, ExportFormat } from '@/services/reportExportService';
import { DANAO_CITY_BARANGAYS } from '@/constants/danaoBarangays';
import {
  DEFAULT_FISCAL_YEAR_CONFIG,
  evaluateFiscalYearSufficiency,
  FiscalYearConfig,
} from '../../../services/budgetValidationService';

interface DashboardStats {
  totalWaste: number;
  collectionEfficiency: number;
  activeTrucks: number;
  totalTrucks: number;
  pendingIssues: number;
}

interface Report {
  id: string;
  barangay: string;
  type: string;
  status: string;
  statusColor: string;
}

interface Schedule {
  id: string;
  time: string;
  brgy: string;
  truck: string;
  status: string;
  color: string;
}

interface DistrictPressure {
  label: string;
  count: number;
  pct: number;
  status: string;
  color: string;
}

export interface CollectionRecord {
  id: string;
  timeMs: number;
  date: string;
  barangay: string;
  tonnage: number;
  trips: number;
  truckPlate: string;
  driverName: string;
  status: 'Completed' | 'In Progress' | 'Scheduled';
}

export default function CenroDashboardTab({ onTabChange }: { onTabChange?: (tab: string, targetSection?: string) => void }) {
  const { width } = useWindowDimensions();
  const isNarrow = width < 960;
  const isMobile = width < 640;

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    totalWaste: 0,
    collectionEfficiency: 0,
    activeTrucks: 0,
    totalTrucks: 0,
    pendingIssues: 0,
  });

  const [recentReports, setRecentReports] = useState<Report[]>([]);
  const [todaySchedules, setTodaySchedules] = useState<Schedule[]>([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [districtDemand, setDistrictDemand] = useState<DistrictPressure[]>([]);
  const [topHotspot, setTopHotspot] = useState<{ label: string; count: number } | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [holidayNotice, setHolidayNotice] = useState<HolidayScheduleAdvisory | null>(null);

  // Predictive Chart Data
  const [forecastModelLabel, setForecastModelLabel] = useState('AI Linear Trend');
  const [forecastMae, setForecastMae] = useState(0);
  const [chartData, setChartData] = useState<{
    labels: string[];
    datasets: { data: number[]; color?: (opacity: number) => string; strokeWidth?: number }[];
  }>({
    labels: ['M1', 'M2', 'M3', 'M4', 'Next 1', 'Next 2'],
    datasets: [{ data: [120, 135, 140, 145, 150, 155] }],
  });

  // 30-Day & Historical Tabulated Collections State
  const [allCollectionLogs, setAllCollectionLogs] = useState<CollectionRecord[]>([]);
  const [thirtyDayLogs, setThirtyDayLogs] = useState<CollectionRecord[]>([]);
  const [highestLoadList, setHighestLoadList] = useState<Array<{
    truckPlate: string;
    driverName: string;
    model: string;
    totalTons: number;
    tripsCount: number;
    avgLoadPerTrip: number;
  }>>([]);
  const [brgyTableFilter, setBrgyTableFilter] = useState('all');
  const [filterBarangay, setFilterBarangay] = useState('all');
  const [filterDuration, setFilterDuration] = useState('30d');
  const [filterStatus, setFilterStatus] = useState<'all' | 'Completed' | 'In Progress' | 'Scheduled'>('all');
  const [filterSearch, setFilterSearch] = useState('');
  const [isExportModalVisible, setIsExportModalVisible] = useState(false);
  const [isBarangayPickerOpen, setIsBarangayPickerOpen] = useState(false);
  const [barangaySearchQuery, setBarangaySearchQuery] = useState('');
  const [forecastCardView, setForecastCardView] = useState<'chart' | 'table'>('chart');

  // Fiscal Year & Financial Forecast Sufficiency State
  const [fiscalConfig, setFiscalConfig] = useState<FiscalYearConfig>(DEFAULT_FISCAL_YEAR_CONFIG);
  const [budgetPlanning, setBudgetPlanning] = useState<{ costPerTon: number; contingencyPercent: number }>({
    costPerTon: 2500,
    contingencyPercent: 10,
  });

  useEffect(() => {
    if (!db) return;
    const unsub = onSnapshot(doc(db, 'settings', 'fiscal_year'), snapshot => {
      if (snapshot.exists()) {
        const d = snapshot.data();
        setFiscalConfig({
          fiscalYear: Number(d.fiscalYear) || DEFAULT_FISCAL_YEAR_CONFIG.fiscalYear,
          allocatedBudget: Number(d.allocatedBudget) || DEFAULT_FISCAL_YEAR_CONFIG.allocatedBudget,
          department: d.department || DEFAULT_FISCAL_YEAR_CONFIG.department,
          notes: d.notes || DEFAULT_FISCAL_YEAR_CONFIG.notes,
        });
      }
    }, err => console.warn('Failed to listen to fiscal_year in dashboard:', err));

    getDoc(doc(db, 'analytics', 'budget_planning')).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        setBudgetPlanning({
          costPerTon: Number(d.costPerTon) || 2500,
          contingencyPercent: Number(d.contingencyPercent) || 10,
        });
      }
    }).catch(err => console.warn('Failed to get budget_planning in dashboard:', err));

    return () => unsub();
  }, []);

  const dashboardFiscalSufficiency = useMemo(() => {
    const historicalValues = historicalWasteSeries.map(p => p.value);
    const forecastResult = buildValidatedForecast(historicalValues, 12);
    const annualTons = forecastResult.forecast.reduce((sum, v) => sum + v, 0);
    const baseCost = annualTons * (budgetPlanning.costPerTon || 2500);
    const contingency = baseCost * (Math.max(0, budgetPlanning.contingencyPercent) / 100);
    const totalCost = baseCost + contingency;
    return {
      annualTons,
      totalCost,
      sufficiency: evaluateFiscalYearSufficiency(fiscalConfig, totalCost, true),
    };
  }, [fiscalConfig, budgetPlanning]);

  useEffect(() => {
    if (!db) return;

    let isMounted = true;

    async function loadDashboardData() {
      try {
        // Fetch Live Danao Weather & PH Holiday Notice from Free Public APIs
        getDanaoLiveWeather().then(w => isMounted && setWeather(w)).catch(() => {});
        getUpcomingHolidayNotice().then(h => isMounted && setHolidayNotice(h)).catch(() => {});
        // 1. Fetch Drivers and Trucks first for accurate metadata resolution
        const usersRef = collection(db, 'users');
        const qDrivers = query(usersRef, where('role', '==', 'driver'));
        const snapDrivers = await getDocs(qDrivers);
        const validDrivers = snapDrivers.docs.filter((d) => {
          const u = d.data();
          return u.disabled !== true && u.status !== 'disabled';
        });
        const totalDrivers = validDrivers.length;

        const activeDriverMap = new Map<string, string>();
        validDrivers.forEach((d) => {
          const u = d.data();
          const dName = (u.displayName || u.name || `${u.firstName || ''} ${u.lastName || ''}`).trim() || 'Driver';
          activeDriverMap.set(d.id, dName);
          if (u.currentTruckId) activeDriverMap.set(u.currentTruckId, dName);
          if (u.currentTruckPlate) activeDriverMap.set(u.currentTruckPlate, dName);
        });

        const trucksSnap = await getDocs(collection(db, 'trucks'));
        const totalRegisteredTrucks = trucksSnap.size;
        const trucksMap = new Map<string, { id: string; plate: string; model: string; driver: string; capacity: number }>();
        trucksSnap.forEach(tDoc => {
          const tData = tDoc.data();
          const plate = tData.plateNumber || tData.plate || tDoc.id;
          let driverName = 'Unassigned';
          if (tData.assignedDriverId && activeDriverMap.has(tData.assignedDriverId)) {
            driverName = tData.assignedDriverName || activeDriverMap.get(tData.assignedDriverId)!;
          } else if (activeDriverMap.has(tDoc.id)) {
            driverName = activeDriverMap.get(tDoc.id)!;
          } else if (plate && activeDriverMap.has(plate)) {
            driverName = activeDriverMap.get(plate)!;
          } else if (!tData.assignedDriverId && tData.lastDriverName) {
            driverName = tData.lastDriverName;
          }

          const info = {
            id: tDoc.id,
            plate,
            model: tData.type || tData.model || 'Dump Truck',
            driver: driverName,
            capacity: parseFloat(tData.capacity) || 5.0,
          };
          trucksMap.set(tDoc.id, info);
          trucksMap.set(plate, info);
          if (tData.plateNumber) trucksMap.set(tData.plateNumber, info);
        });

        // 2. Fetch Schedules for live operations, monthly trends & 30-day records
        let totalSchedulesCount = 0;
        let completedSchedulesCount = 0;
        let totalCollectedTons = 0;
        const monthlyActuals: Record<string, { totalTons: number; trips: number }> = {};
        const now = new Date();
        const nowMs = now.getTime();
        const thirtyDaysAgoMs = nowMs - (30 * 24 * 60 * 60 * 1000);
        const processedDocIds = new Set<string>();

        const allLoadedRows: CollectionRecord[] = [];
        const past30DaysRows: CollectionRecord[] = [];

        const truckLoadsMap = new Map<string, {
          truckPlate: string;
          driverName: string;
          model: string;
          totalTons: number;
          tripsCount: number;
        }>();

        try {
          const schedulesSnap = await getDocs(collection(db, 'schedules'));
          schedulesSnap.forEach(d => {
            const data = d.data();
            processedDocIds.add(d.id);
            totalSchedulesCount++;

            const statusLower = String(data.status || '').toLowerCase();
            const isCompleted = ['completed', 'done', 'closed'].includes(statusLower);
            const isInProgress = ['in_progress', 'in-progress'].includes(statusLower);

            let weightTons = 0;
            const measurement = data.collectionMeasurement;
            if (measurement) {
              if (typeof measurement === 'number' && measurement > 0) {
                weightTons = measurement;
              } else if (Number(measurement.value) > 0) {
                const val = Number(measurement.value);
                const unit = String(measurement.unit || 'kg').toLowerCase();
                if (['ton', 'tons', 't'].includes(unit)) weightTons = val;
                else if (unit === 'kg') weightTons = val / 1000;
                else if (unit === 'm3') weightTons = val * 0.16;
                else weightTons = val / 1000;
              }
            } else if (data.collectedKg && Number(data.collectedKg) > 0) {
              weightTons = Number(data.collectedKg) / 1000;
            } else if (data.actualWeightKg && Number(data.actualWeightKg) > 0) {
              weightTons = Number(data.actualWeightKg) / 1000;
            } else if (data.tons && Number(data.tons) > 0) {
              weightTons = Number(data.tons);
            } else if (data.netWeightKg && Number(data.netWeightKg) > 0) {
              weightTons = Number(data.netWeightKg) / 1000;
            }

            if (isCompleted) {
              completedSchedulesCount++;
              totalCollectedTons += weightTons;
            }

            // Parse timestamp
            const rawTime = data.completedAt || data.completedDate || data.createdAt || data.dateText || data.date;
            let timeMs = 0;
            if (rawTime?.toMillis) {
              timeMs = rawTime.toMillis();
            } else if (rawTime?.toDate) {
              timeMs = rawTime.toDate().getTime();
            } else if (rawTime?.seconds) {
              timeMs = rawTime.seconds * 1000;
            } else if (rawTime instanceof Date) {
              timeMs = rawTime.getTime();
            } else if (typeof rawTime === 'string' || typeof rawTime === 'number') {
              const parsed = new Date(rawTime).getTime();
              if (!isNaN(parsed)) timeMs = parsed;
            }

            if (isCompleted && timeMs > 0) {
              const recordDate = new Date(timeMs);
              const monthKey = recordDate.toISOString().slice(0, 7);
              if (!monthlyActuals[monthKey]) monthlyActuals[monthKey] = { totalTons: 0, trips: 0 };
              monthlyActuals[monthKey].totalTons += weightTons;
              monthlyActuals[monthKey].trips += 1;
            }

            const dateStr = timeMs > 0 ? new Date(timeMs).toISOString().split('T')[0] : now.toISOString().split('T')[0];
            const trkInfo = trucksMap.get(data.truckId) || trucksMap.get(data.truckPlate);
            const plate = trkInfo?.plate || data.truckPlate || (data.truckId ? String(data.truckId) : '');
            const driver = data.driverName || data.assignedDriverName || trkInfo?.driver || data.driver || 'Unassigned';
            const brgy = data.barangay || 'Danao City';
            const trips = Number(data.pickupsCompleted) || 1;
            const recStatus: 'Completed' | 'In Progress' | 'Scheduled' = isCompleted
              ? 'Completed'
              : isInProgress
              ? 'In Progress'
              : 'Scheduled';

            const scheduleLogItem: CollectionRecord = {
              id: d.id,
              timeMs: timeMs > 0 ? timeMs : nowMs,
              date: dateStr,
              barangay: brgy,
              tonnage: Math.round(weightTons * 10) / 10,
              trips,
              truckPlate: plate || 'Fleet Truck',
              driverName: driver,
              status: recStatus,
            };

            allLoadedRows.push(scheduleLogItem);

            // Real 30-Day collection logs from database (no placeholders)
            if (timeMs >= thirtyDaysAgoMs && timeMs <= (nowMs + 86400000)) {
              past30DaysRows.push(scheduleLogItem);

              if (isCompleted && plate) {
                const existing = truckLoadsMap.get(plate) || {
                  truckPlate: plate,
                  driverName: driver,
                  model: trkInfo?.model || 'Dump Truck',
                  totalTons: 0,
                  tripsCount: 0,
                };
                existing.totalTons = Math.round((existing.totalTons + weightTons) * 10) / 10;
                existing.tripsCount += trips;
                if (driver && (!existing.driverName || existing.driverName === 'Unassigned')) {
                  existing.driverName = driver;
                }
                truckLoadsMap.set(plate, existing);
              }
            }
          });
        } catch (e) {
          console.warn('Dashboard: schedules fetch warning', e);
        }

        // Query driver_route_history for real driver completed runs
        try {
          const historySnap = await getDocs(collection(db, 'driver_route_history'));
          historySnap.forEach(hDoc => {
            if (processedDocIds.has(hDoc.id)) return;
            processedDocIds.add(hDoc.id);

            const hData = hDoc.data();
            const statusLower = String(hData.status || '').toLowerCase();
            const isCompleted = ['completed', 'done'].includes(statusLower);

            const rawTime = hData.completedAt || hData.createdAt || hData.date;
            let timeMs = 0;
            if (rawTime?.toMillis) {
              timeMs = rawTime.toMillis();
            } else if (rawTime?.toDate) {
              timeMs = rawTime.toDate().getTime();
            } else if (rawTime?.seconds) {
              timeMs = rawTime.seconds * 1000;
            } else if (rawTime instanceof Date) {
              timeMs = rawTime.getTime();
            } else if (typeof rawTime === 'string' || typeof rawTime === 'number') {
              const parsed = new Date(rawTime).getTime();
              if (!isNaN(parsed)) timeMs = parsed;
            }

            const dateStr = timeMs > 0 ? new Date(timeMs).toISOString().split('T')[0] : now.toISOString().split('T')[0];
            const trkInfo = trucksMap.get(hData.truckId) || trucksMap.get(hData.truckPlate);
            const plate = trkInfo?.plate || hData.truckPlate || (hData.truckId ? String(hData.truckId) : '');
            const driver = hData.driverName || trkInfo?.driver || 'Unassigned';
            const brgy = hData.barangay || 'Danao City';
            const trips = 1;

            let weightTons = 0;
            const measurement = hData.collectionMeasurement;
            if (measurement) {
              if (typeof measurement === 'number' && measurement > 0) {
                weightTons = measurement;
              } else if (Number(measurement.value) > 0) {
                const val = Number(measurement.value);
                const unit = String(measurement.unit || 'kg').toLowerCase();
                if (['ton', 'tons', 't'].includes(unit)) weightTons = val;
                else if (unit === 'kg') weightTons = val / 1000;
                else if (unit === 'm3') weightTons = val * 0.16;
                else weightTons = val / 1000;
              }
            } else if (hData.collectedKg && Number(hData.collectedKg) > 0) {
              weightTons = Number(hData.collectedKg) / 1000;
            } else if (hData.actualWeightKg && Number(hData.actualWeightKg) > 0) {
              weightTons = Number(hData.actualWeightKg) / 1000;
            }

            const historyLogItem: CollectionRecord = {
              id: hDoc.id,
              timeMs: timeMs > 0 ? timeMs : nowMs,
              date: dateStr,
              barangay: brgy,
              tonnage: Math.round(weightTons * 10) / 10,
              trips,
              truckPlate: plate || 'Fleet Truck',
              driverName: driver,
              status: isCompleted ? 'Completed' : 'In Progress',
            };

            allLoadedRows.push(historyLogItem);

            if (timeMs >= thirtyDaysAgoMs && timeMs <= (nowMs + 86400000)) {
              past30DaysRows.push(historyLogItem);

              if (isCompleted && plate) {
                const existing = truckLoadsMap.get(plate) || {
                  truckPlate: plate,
                  driverName: driver,
                  model: trkInfo?.model || 'Dump Truck',
                  totalTons: 0,
                  tripsCount: 0,
                };
                existing.totalTons = Math.round((existing.totalTons + weightTons) * 10) / 10;
                existing.tripsCount += trips;
                if (driver && (!existing.driverName || existing.driverName === 'Unassigned')) {
                  existing.driverName = driver;
                }
                truckLoadsMap.set(plate, existing);
              }
            }
          });
        } catch (e) {
          console.warn('Dashboard: driver_route_history fetch warning', e);
        }

        const calculatedEfficiency = totalSchedulesCount > 0
          ? Math.round((completedSchedulesCount / totalSchedulesCount) * 100)
          : 0;

        // 3. AI Predictive Model with Unified Historical & Live Operational Series (2026)
        // Uses the function-scoped 'now' Date object declared above
        const curYear = now.getFullYear();
        const curMonth = now.getMonth() + 1;
        const unifiedSeries: Array<{ period: string; value: number }> = [];

        for (let y = 2022; y <= curYear; y++) {
          const endM = y === curYear ? curMonth : 12;
          for (let m = 1; m <= endM; m++) {
            const periodKey = `${y}-${String(m).padStart(2, '0')}`;
            const realLog = monthlyActuals[periodKey];
            if (realLog && realLog.totalTons > 0) {
              unifiedSeries.push({ period: periodKey, value: Math.round(realLog.totalTons * 10) / 10 });
            } else {
              const histPoint = historicalWasteSeries.find((p: any) => p.period === periodKey);
              if (histPoint) {
                unifiedSeries.push({ period: periodKey, value: histPoint.value });
              } else if (y >= 2025 && y <= curYear) {
                const seasonalPrior = historicalWasteSeries.find((p: any) => p.period.slice(5) === periodKey.slice(5));
                const baseVal = seasonalPrior ? seasonalPrior.value : 201.4;
                unifiedSeries.push({ period: periodKey, value: baseVal });
              }
            }
          }
        }

        const recentHistory = unifiedSeries.slice(-4);
        const forecastResult = buildValidatedForecast(unifiedSeries.map(p => p.value), 2);

        if (isMounted) {
          setForecastModelLabel(forecastResult.modelLabel);
          setForecastMae(forecastResult.mae);
          setChartData({
            labels: [
              ...recentHistory.map(p => p.period.replace(/^\d{4}-/, '')),
              'Next 1',
              'Next 2',
            ],
            datasets: [
              {
                data: [...recentHistory.map(p => p.value), ...forecastResult.forecast],
                color: (opacity = 1) => `rgba(27, 77, 62, ${opacity})`,
                strokeWidth: 3,
              },
            ],
          });
        }

        // 4. Tabulated Data & Highest Load Fleet Aggregation for the Past 30 Days (Strictly Real Database Data)
        allLoadedRows.sort((a, b) => b.timeMs - a.timeMs || b.date.localeCompare(a.date));
        past30DaysRows.sort((a, b) => b.timeMs - a.timeMs || b.date.localeCompare(a.date));

        const sortedTrucks = Array.from(truckLoadsMap.values())
          .filter(t => t.totalTons > 0 || t.tripsCount > 0)
          .map(t => ({
            ...t,
            avgLoadPerTrip: t.tripsCount > 0 ? Math.round((t.totalTons / t.tripsCount) * 10) / 10 : 0,
          }))
          .sort((a, b) => b.totalTons - a.totalTons || b.tripsCount - a.tripsCount);

        if (isMounted) {
          setThirtyDayLogs(past30DaysRows);
          setAllCollectionLogs(allLoadedRows);
          setHighestLoadList(sortedTrucks);
        }

        // 4. Listen to Citizen Reports for metrics, recent table, district demand, and hotspots
        const reportsRef = collection(db, 'reports');
        const reportsQuery = query(reportsRef, orderBy('createdAt', 'desc'), limit(30));

        const unsubReports = onSnapshot(reportsQuery, snapshot => {
          let pendingCount = 0;
          let wasteSum = 0;
          const recent: Report[] = [];
          const countsByBrgy: Record<string, number> = {};
          const unresolvedLocations: LocationLike[] = [];

          snapshot.forEach(doc => {
            const data = doc.data();

            if (data.status === 'pending' || data.status === 'acknowledged') {
              pendingCount++;
            }

            if (data.location) {
              unresolvedLocations.push(data.location);
            }

            const brgy = data.barangay || 'General';
            countsByBrgy[brgy] = (countsByBrgy[brgy] || 0) + 1;

            if (['resolved', 'in progress', 'in-progress', 'completed'].includes(data.status)) {
              if (data.aiAnalysis?.estimatedWeight) {
                wasteSum += parseWasteAmountToMetricTons(data.aiAnalysis.estimatedWeight) || 0;
              }
            }

            if (recent.length < 5) {
              let statusColor = '#64748B';
              if (data.status === 'pending') statusColor = '#EF4444';
              else if (data.status === 'acknowledged') statusColor = '#3B82F6';
              else if (data.status === 'in progress' || data.status === 'in-progress') statusColor = '#F59E0B';
              else if (data.status === 'resolved' || data.status === 'completed') statusColor = '#059669';

              recent.push({
                id: doc.id.substring(0, 8).toUpperCase(),
                barangay: data.barangay || 'Unknown',
                type: data.aiAnalysis?.wasteType || data.reportType || 'General Waste',
                status: data.status ? data.status.toUpperCase() : 'PENDING',
                statusColor,
              });
            }
          });

          // Hotspots calculation
          const hotspotResult = buildHotspots(unresolvedLocations);
          if (hotspotResult.hotspots.length > 0) {
            setTopHotspot({
              label: (hotspotResult.hotspots[0] as any).label || 'Poblacion',
              count: hotspotResult.hotspots[0].reportCount || unresolvedLocations.length,
            });
          }

          // District Demand & Capacity Pressure
          const districts: DistrictPressure[] = Object.keys(countsByBrgy).map(brgy => {
            const count = countsByBrgy[brgy];
            let status = 'STABLE';
            let color = '#059669';
            let pct = Math.min(100, count * 20);

            if (count >= 4) {
              status = 'SURGE';
              color = '#EF4444';
              pct = Math.min(100, Math.max(85, count * 22));
            } else if (count >= 2) {
              status = 'NEAR CAP';
              color = '#F59E0B';
              pct = Math.min(100, Math.max(55, count * 20));
            }

            return { label: brgy, count, pct, status, color };
          });

          districts.sort((a, b) => b.pct - a.pct);
          setDistrictDemand(districts.slice(0, 4));

          setStats({
            totalWaste: totalCollectedTons > 0 ? totalCollectedTons : (wasteSum > 0 ? wasteSum : 0),
            collectionEfficiency: calculatedEfficiency,
            activeTrucks: totalDrivers,
            totalTrucks: totalRegisteredTrucks > 0 ? totalRegisteredTrucks : totalDrivers,
            pendingIssues: pendingCount,
          });
          setRecentReports(recent);
        });

        // 5. Listen to Today's Schedules
        const bSchedRef = collection(db, 'barangay_schedules');
        const bSchedQuery = query(bSchedRef, orderBy('createdAt', 'desc'));

        const unsubSched = onSnapshot(bSchedQuery, snapshot => {
          const schedules: Schedule[] = [];
          let comp = 0;
          let tot = 0;

          const now = new Date();
          const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
          const todayDayStr = DAYS[now.getDay()];
          const todayDateStr = `${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')}`;

          snapshot.forEach(doc => {
            const data = doc.data();

            if (data.specificSchedules && Array.isArray(data.specificSchedules)) {
              data.specificSchedules.forEach((spec: any, idx: number) => {
                if (spec.date === todayDateStr) {
                  tot++;
                  if (spec.status === 'completed') comp++;
                  schedules.push({
                    id: `${doc.id}-spec-${idx}`,
                    time: spec.time || '08:00 AM',
                    brgy: data.barangayName || 'Unknown',
                    truck: data.truck || 'Truck 01',
                    status: spec.status ? spec.status.toUpperCase() : 'SCHEDULED',
                    color: '#3B82F6',
                  });
                }
              });
            }

            if (data.days && Array.isArray(data.days) && data.days.includes(todayDayStr)) {
              tot++;
              const todayTime = (data.dayTimes && data.dayTimes[todayDayStr]) || data.time || data.timeText || 'Regular Route';
              schedules.push({
                id: `${doc.id}-rec`,
                time: todayTime,
                brgy: data.barangayName || 'Unknown',
                truck: data.truck || 'Truck 02',
                status: 'ON TRACK',
                color: '#059669',
              });
            }
          });

          setProgress({ completed: comp, total: Math.max(tot, schedules.length) });
          setTodaySchedules(schedules.slice(0, 5));
          setLoading(false);
        });

        return () => {
          unsubReports();
          unsubSched();
        };
      } catch (err) {
        console.error('Error loading dashboard analytics:', err);
        setLoading(false);
      }
    }

    const cleanup = loadDashboardData();
    return () => {
      isMounted = false;
      cleanup.then(unsub => unsub && unsub());
    };
  }, []);

  const [currentDateTime, setCurrentDateTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const todayStr = currentDateTime.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const timeStr = currentDateTime.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const progressPercent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const responsiveChartWidth = isMobile ? Math.max(width - 64, 280) : isNarrow ? Math.max(width - 80, 320) : Math.max(width - 340, 500);
  const total30DayTons = thirtyDayLogs.reduce((sum, r) => Math.round((sum + r.tonnage) * 10) / 10, 0);
  const total30DayTrips = thirtyDayLogs.reduce((sum, r) => sum + r.trips, 0);

  const getDurationDisplayLabel = (durationKey: string): string => {
    switch (durationKey) {
      case 'today':
        return 'Today';
      case '7d':
        return 'Past 7 Days';
      case '30d':
        return 'Past 30 Days';
      case 'this_month':
        return 'This Month';
      case 'last_month':
        return 'Last Month';
      case '90d':
        return 'Past 90 Days';
      case 'all':
        return 'All Time';
      default:
        if (durationKey.startsWith('month:')) {
          const ym = durationKey.replace('month:', '');
          const [year, month] = ym.split('-');
          const dateObj = new Date(Number(year), Number(month) - 1, 1);
          return dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }
        return 'Past 30 Days';
    }
  };

  const filteredCollectionLogs = useMemo(() => {
    const now = new Date();
    const nowMs = now.getTime();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999).getTime();

    return allCollectionLogs.filter(log => {
      // 1. Barangay Filter
      if (filterBarangay !== 'all' && log.barangay.trim().toLowerCase() !== filterBarangay.trim().toLowerCase()) {
        return false;
      }

      // 2. Status Filter
      if (filterStatus !== 'all' && log.status !== filterStatus) {
        return false;
      }

      // 3. Duration Filter
      if (filterDuration === 'today') {
        if (log.timeMs < startOfToday) return false;
      } else if (filterDuration === '7d') {
        if (log.timeMs < nowMs - 7 * 86400000) return false;
      } else if (filterDuration === '30d') {
        if (log.timeMs < nowMs - 30 * 86400000) return false;
      } else if (filterDuration === 'this_month') {
        if (log.timeMs < startOfThisMonth) return false;
      } else if (filterDuration === 'last_month') {
        if (log.timeMs < startOfLastMonth || log.timeMs > endOfLastMonth) return false;
      } else if (filterDuration === '90d') {
        if (log.timeMs < nowMs - 90 * 86400000) return false;
      } else if (filterDuration.startsWith('month:')) {
        const ym = filterDuration.replace('month:', '');
        if (!log.date.startsWith(ym)) return false;
      }

      // 4. Search Filter
      if (filterSearch.trim()) {
        const q = filterSearch.trim().toLowerCase();
        const matchBrgy = log.barangay.toLowerCase().includes(q);
        const matchTruck = log.truckPlate.toLowerCase().includes(q);
        const matchDriver = log.driverName.toLowerCase().includes(q);
        const matchDate = log.date.toLowerCase().includes(q);
        const matchStatus = log.status.toLowerCase().includes(q);
        if (!matchBrgy && !matchTruck && !matchDriver && !matchDate && !matchStatus) {
          return false;
        }
      }

      return true;
    });
  }, [allCollectionLogs, filterBarangay, filterDuration, filterStatus, filterSearch]);

  const filteredSummary = useMemo(() => {
    const totalTonnage = Math.round(filteredCollectionLogs.reduce((acc, r) => acc + r.tonnage, 0) * 10) / 10;
    const totalTrips = filteredCollectionLogs.reduce((acc, r) => acc + r.trips, 0);
    const completedCount = filteredCollectionLogs.filter(r => r.status === 'Completed').length;
    const inProgressCount = filteredCollectionLogs.filter(r => r.status === 'In Progress').length;
    const scheduledCount = filteredCollectionLogs.filter(r => r.status === 'Scheduled').length;
    const uniqueTrucks = new Set(filteredCollectionLogs.map(r => r.truckPlate).filter(Boolean)).size;

    return {
      totalTonnage,
      totalTrips,
      completedCount,
      inProgressCount,
      scheduledCount,
      uniqueTrucks,
      recordCount: filteredCollectionLogs.length,
    };
  }, [filteredCollectionLogs]);

  const handleExportDashboardReport = async (format: ExportFormat) => {
    const durationLabel = getDurationDisplayLabel(filterDuration);
    const brgyLabel = filterBarangay === 'all' ? 'All Danao City Barangays' : `Brgy. ${filterBarangay}`;
    const statusLabel = filterStatus === 'all' ? 'All Statuses' : filterStatus;

    const dateStr = new Date().toISOString().slice(0, 10);
    const safeScope = filterBarangay === 'all' ? 'citywide' : filterBarangay.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const filename = `danao_cenro_waste_dashboard_${safeScope}_${dateStr}`;

    const headers = [
      'Date',
      'Barangay',
      'Tonnage (t)',
      'Trips',
      'Truck Plate',
      'Driver / Operator',
      'Status',
    ];

    const rows = filteredCollectionLogs.map((row) => [
      row.date,
      `Brgy. ${row.barangay}`,
      `${row.tonnage.toFixed(1)} t`,
      row.trips,
      row.truckPlate,
      row.driverName,
      row.status,
    ]);

    await exportReport({
      format,
      filename,
      title: 'Danao City CENRO Municipal Solid Waste Collections Report',
      subtitle: `Official Municipal Solid Waste Ledger & Operational Audit — ${brgyLabel} (${durationLabel})`,
      jurisdiction: 'City of Danao, Province of Cebu',
      generatedBy: 'City Environment & Natural Resources Office (CENRO)',
      sheetName: 'Collections_Summary',
      metadata: [
        { label: 'Scope', value: brgyLabel },
        { label: 'Time Window', value: durationLabel },
        { label: 'Status Filter', value: statusLabel },
        { label: 'Search Query', value: filterSearch.trim() || 'None (All Records)' },
        { label: 'Filtered Count', value: `${filteredCollectionLogs.length} collections` },
      ],
      summaryCards: [
        { label: 'City-Wide Waste (30d)', value: `${stats.totalWaste} t` },
        { label: 'Collection Efficiency', value: `${stats.collectionEfficiency}%` },
        { label: 'Active Fleet Trucks', value: `${stats.activeTrucks} / ${stats.totalTrucks}` },
        { label: 'Filtered Total Waste', value: `${filteredSummary.totalTonnage} t` },
        { label: 'Filtered Cycles/Trips', value: `${filteredSummary.totalTrips} trips` },
        { label: 'Unique Trucks Deployed', value: `${filteredSummary.uniqueTrucks} units` },
        { label: 'Pending Citizen Issues', value: stats.pendingIssues },
      ],
      headers,
      rows,
    });
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1B4D3E" />
        <Text style={styles.loadingText}>Synthesizing City Waste Analytics...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, isMobile && { padding: 14 }]} showsVerticalScrollIndicator={false}>
      {/* Header Banner */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.headerSubtitle}>MUNICIPAL SOLID WASTE INTELLIGENCE</Text>
          <Text style={styles.headerTitle}>CENRO Operations Dashboard</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Compact Weather Status Pill */}
          <View style={styles.headerWeatherPill}>
            <MaterialIcons
              name={(weather?.weatherIconName as any) || 'wb-sunny'}
              size={15}
              color={weather?.advisoryLevel === 'severe' ? '#DC2626' : weather?.advisoryLevel === 'warning' ? '#D97706' : '#059669'}
            />
            <Text style={styles.headerWeatherText}>
              {weather ? `${weather.temperatureC}°C ${weather.weatherDescription}` : '29°C Fair'} • Danao City
            </Text>
          </View>

          {/* Date & Time Badge */}
          <View style={styles.dateBadge}>
            <MaterialIcons name="calendar-today" size={13} color="#065F46" style={{ marginRight: 5 }} />
            <Text style={styles.dateText}>{todayStr}</Text>
            <View style={styles.dateBadgeDivider} />
            <MaterialIcons name="access-time" size={13} color="#065F46" style={{ marginRight: 4 }} />
            <Text style={[styles.dateText, styles.timeText]}>{timeStr}</Text>
          </View>
        </View>
      </View>

      {/* High-Priority Weather Advisory or Official Holiday Banner (Conditional) */}
      {(weather?.advisoryLevel === 'severe' || weather?.advisoryLevel === 'warning' || !!holidayNotice) && (
        <View style={[
          styles.priorityAlertBanner,
          weather?.advisoryLevel === 'severe' ? styles.alertSevere :
          weather?.advisoryLevel === 'warning' ? styles.alertWarning : styles.alertInfo
        ]}>
          <MaterialIcons
            name={weather?.advisoryLevel === 'severe' ? 'warning' : 'info'}
            size={20}
            color={weather?.advisoryLevel === 'severe' ? '#DC2626' : weather?.advisoryLevel === 'warning' ? '#D97706' : '#0284C7'}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.priorityAlertTitle}>
              {holidayNotice ? holidayNotice.noticeTitle : weather?.advisoryTitle || 'Operational Advisory'}
            </Text>
            <Text style={styles.priorityAlertDesc}>
              {holidayNotice ? holidayNotice.noticeMessage : weather?.advisoryMessage}
            </Text>
          </View>
        </View>
      )}

      {/* TIER 1 SECTION DIVIDER */}
      <View style={styles.tierDividerRow}>
        <View style={[styles.tierDividerAccent, { backgroundColor: '#059669' }]} />
        <Text style={styles.tierDividerText}>TIER 1 • EXECUTIVE OVERVIEW & MUNICIPAL GOVERNANCE</Text>
        <View style={styles.tierDividerLine} />
      </View>

      {/* Hero KPI Cards Row (4 Grid) */}
      <View style={[styles.kpiRow, isMobile && { flexDirection: 'column' }]}>
        {/* 1. AI-Estimated Waste */}
        <TouchableOpacity
          style={styles.kpiCard}
          onPress={() => onTabChange && onTabChange('analytics', 'forecast')}
          activeOpacity={0.75}
        >
          <View style={styles.kpiHeader}>
            <View style={[styles.kpiIconBox, { backgroundColor: '#ECFDF5' }]}>
              <MaterialIcons name="delete-sweep" size={22} color="#059669" />
            </View>
            <View style={styles.kpiTrendBadge}>
              <Text style={styles.kpiTrendText}>AI Monitored</Text>
            </View>
          </View>
          <Text style={styles.kpiLabel}>Total Waste Monitored</Text>
          <Text style={styles.kpiValue}>
            {formatAdaptiveMassFromMetricTons(stats.totalWaste)}
          </Text>
          <Text style={styles.kpiCaption}>Reports & weighbridge telemetry · <Text style={{ color: '#059669', fontWeight: '700' }}>See All →</Text></Text>
        </TouchableOpacity>

        {/* 2. Collection Efficiency */}
        <TouchableOpacity
          style={styles.kpiCard}
          onPress={() => onTabChange && onTabChange('analytics', 'trucks')}
          activeOpacity={0.75}
        >
          <View style={styles.kpiHeader}>
            <View style={[styles.kpiIconBox, { backgroundColor: '#EFF6FF' }]}>
              <MaterialIcons name="bolt" size={22} color="#2563EB" />
            </View>
            <View style={[styles.kpiTrendBadge, { backgroundColor: '#DBEAFE' }]}>
              <Text style={[styles.kpiTrendText, { color: '#1D4ED8' }]}>On Track</Text>
            </View>
          </View>
          <Text style={styles.kpiLabel}>Collection Efficiency</Text>
          <Text style={[styles.kpiValue, { color: '#1E40AF' }]}>
            {stats.collectionEfficiency}%
          </Text>
          <Text style={styles.kpiCaption}>Completed pickup schedules · <Text style={{ color: '#2563EB', fontWeight: '700' }}>See All →</Text></Text>
        </TouchableOpacity>

        {/* 3. Active Fleet */}
        <TouchableOpacity
          style={styles.kpiCard}
          onPress={() => onTabChange && onTabChange('fleet-monitoring')}
          activeOpacity={0.75}
        >
          <View style={styles.kpiHeader}>
            <View style={[styles.kpiIconBox, { backgroundColor: '#F0FDFA' }]}>
              <MaterialIcons name="local-shipping" size={22} color="#0D9488" />
            </View>
            <View style={[styles.kpiTrendBadge, { backgroundColor: '#F0FDFA' }]}>
              <Text style={[styles.kpiTrendText, { color: '#0F766E' }]}>Active</Text>
            </View>
          </View>
          <Text style={styles.kpiLabel}>Fleet Utilization</Text>
          <Text style={styles.kpiValue}>
            {stats.activeTrucks}/{stats.totalTrucks} <Text style={styles.kpiUnit}>Trucks</Text>
          </Text>
          <Text style={styles.kpiCaption}>Drivers online on active routes · <Text style={{ color: '#0D9488', fontWeight: '700' }}>See All →</Text></Text>
        </TouchableOpacity>

        {/* 4. Pending Reports */}
        <TouchableOpacity
          style={styles.kpiCard}
          onPress={() => onTabChange && onTabChange('trash-reports')}
          activeOpacity={0.75}
        >
          <View style={styles.kpiHeader}>
            <View style={[styles.kpiIconBox, { backgroundColor: stats.pendingIssues > 0 ? '#FEE2E2' : '#F1F5F9' }]}>
              <MaterialIcons
                name={stats.pendingIssues > 0 ? 'report-problem' : 'assignment-turned-in'}
                size={22}
                color={stats.pendingIssues > 0 ? '#DC2626' : '#64748B'}
              />
            </View>
            <View style={[styles.kpiTrendBadge, { backgroundColor: stats.pendingIssues > 0 ? '#FEE2E2' : '#F1F5F9' }]}>
              <Text style={[styles.kpiTrendText, { color: stats.pendingIssues > 0 ? '#B91C1C' : '#475569' }]}>
                {stats.pendingIssues > 0 ? 'Requires Action' : 'All Clear'}
              </Text>
            </View>
          </View>
          <Text style={styles.kpiLabel}>Pending Citizen Reports</Text>
          <Text style={[styles.kpiValue, { color: stats.pendingIssues > 0 ? '#DC2626' : '#0F172A' }]}>
            {stats.pendingIssues} <Text style={styles.kpiUnit}>Reports</Text>
          </Text>
          <Text style={styles.kpiCaption}>Unresolved waste incidents · <Text style={{ color: stats.pendingIssues > 0 ? '#DC2626' : '#64748B', fontWeight: '700' }}>See All →</Text></Text>
        </TouchableOpacity>
      </View>

      {/* Fiscal Year Municipal Budget & Financial Forecast Impact Executive Summary */}
      <View style={styles.fiscalExecutiveCard}>
        <View style={[styles.fiscalExecHeader, isMobile && { flexDirection: 'column', alignItems: 'flex-start' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <View style={styles.fiscalExecIconBox}>
              <MaterialIcons name="account-balance" size={20} color="#0D9488" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.fiscalExecEyebrow}>FISCAL YEAR {fiscalConfig.fiscalYear} BUDGET GOVERNANCE & FINANCIAL IMPACT</Text>
              </View>
              <Text style={styles.fiscalExecTitle}>
                Municipal Solid Waste Budget Sufficiency
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: isMobile ? 8 : 0 }}>
            {/* Live Sufficiency Status Badge */}
            <View style={[
              styles.fiscalStatusBadge,
              dashboardFiscalSufficiency.sufficiency.status === 'sufficient' ? styles.fiscalStatusBadgeSufficient :
              dashboardFiscalSufficiency.sufficiency.status === 'near-limit' ? styles.fiscalStatusBadgeWarning :
              dashboardFiscalSufficiency.sufficiency.status === 'insufficient' ? styles.fiscalStatusBadgeDanger :
              styles.fiscalStatusBadgeNeutral
            ]}>
              <MaterialIcons
                name={
                  dashboardFiscalSufficiency.sufficiency.status === 'sufficient' ? 'check-circle' :
                  dashboardFiscalSufficiency.sufficiency.status === 'near-limit' ? 'warning' :
                  dashboardFiscalSufficiency.sufficiency.status === 'insufficient' ? 'error' : 'hourglass-empty'
                }
                size={14}
                color={
                  dashboardFiscalSufficiency.sufficiency.status === 'sufficient' ? '#059669' :
                  dashboardFiscalSufficiency.sufficiency.status === 'near-limit' ? '#D97706' :
                  dashboardFiscalSufficiency.sufficiency.status === 'insufficient' ? '#DC2626' : '#64748B'
                }
              />
              <Text style={[
                styles.fiscalStatusBadgeText,
                dashboardFiscalSufficiency.sufficiency.status === 'sufficient' ? { color: '#065F46' } :
                dashboardFiscalSufficiency.sufficiency.status === 'near-limit' ? { color: '#92400E' } :
                dashboardFiscalSufficiency.sufficiency.status === 'insufficient' ? { color: '#991B1B' } : { color: '#334155' }
              ]}>
                {dashboardFiscalSufficiency.sufficiency.status === 'sufficient' ? `BUDGET SUFFICIENT (${dashboardFiscalSufficiency.sufficiency.utilizationRatePercent}% UTILIZED)` :
                 dashboardFiscalSufficiency.sufficiency.status === 'near-limit' ? `NEAR CEILING (${dashboardFiscalSufficiency.sufficiency.utilizationRatePercent}% UTILIZED)` :
                 dashboardFiscalSufficiency.sufficiency.status === 'insufficient' ? `DEFICIT WARNING (${dashboardFiscalSufficiency.sufficiency.utilizationRatePercent}% UTILIZED)` :
                 'DATA PENDING'}
              </Text>
            </View>

            {onTabChange && (
              <TouchableOpacity
                style={styles.fiscalDetailsBtn}
                onPress={() => onTabChange('analytics', 'budget')}
                activeOpacity={0.8}
              >
                <Text style={styles.fiscalDetailsBtnText}>View Analytics</Text>
                <MaterialIcons name="arrow-forward" size={14} color="#0F766E" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* 4 Stat Columns */}
        <View style={styles.fiscalExecMetricsRow}>
          <View style={styles.fiscalExecMetric}>
            <Text style={styles.fiscalExecMetricLabel}>MUNICIPAL ALLOCATION</Text>
            <Text style={[styles.fiscalExecMetricValue, { color: '#0D9488' }]}>
              ₱{fiscalConfig.allocatedBudget.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </Text>
            <Text style={styles.fiscalExecMetricSub}>FY {fiscalConfig.fiscalYear} City Allocation</Text>
          </View>

          <View style={styles.fiscalExecMetric}>
            <Text style={styles.fiscalExecMetricLabel}>TOTAL PROJECTED COST</Text>
            <Text style={[styles.fiscalExecMetricValue, { color: dashboardFiscalSufficiency.sufficiency.isSufficient ? '#0F172A' : '#DC2626' }]}>
              ₱{Math.round(dashboardFiscalSufficiency.totalCost).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </Text>
            <Text style={styles.fiscalExecMetricSub}>Annual Validated Forecast</Text>
          </View>

          <View style={[styles.fiscalExecMetric, dashboardFiscalSufficiency.sufficiency.isSufficient ? { backgroundColor: '#F0FDF4' } : { backgroundColor: '#FEF2F2' }]}>
            <Text style={styles.fiscalExecMetricLabel}>
              {dashboardFiscalSufficiency.sufficiency.isSufficient ? 'SURPLUS BUFFER' : 'PROJECTED SHORTFALL'}
            </Text>
            <Text style={[styles.fiscalExecMetricValue, { color: dashboardFiscalSufficiency.sufficiency.isSufficient ? '#166534' : '#DC2626' }]}>
              ₱{Math.abs(dashboardFiscalSufficiency.sufficiency.budgetBuffer || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </Text>
            <Text style={styles.fiscalExecMetricSub}>
              {dashboardFiscalSufficiency.sufficiency.isSufficient ? 'Remaining unallocated' : 'Budget deficit warning'}
            </Text>
          </View>

          <View style={styles.fiscalExecMetric}>
            <Text style={styles.fiscalExecMetricLabel}>COST DRIVER BASIS</Text>
            <Text style={styles.fiscalExecMetricValue}>
              ₱{(budgetPlanning.costPerTon || 2500).toLocaleString()}/MT
            </Text>
            <Text style={styles.fiscalExecMetricSub}>+{budgetPlanning.contingencyPercent}% Contingency Buffer</Text>
          </View>
        </View>
      </View>

      {/* TIER 2 SECTION DIVIDER */}
      <View style={[styles.tierDividerRow, { marginTop: 12 }]}>
        <View style={[styles.tierDividerAccent, { backgroundColor: '#2563EB' }]} />
        <Text style={styles.tierDividerText}>TIER 2 • TODAY&apos;S FIELD OPERATIONS & FLEET DISPATCH</Text>
        <View style={styles.tierDividerLine} />
      </View>

      {/* Main 2-Column Section */}
      <View style={[styles.mainColumnsRow, isNarrow && { flexDirection: 'column' }]}>
        
        {/* LEFT COLUMN: Real-Time Operations */}
        <View style={[styles.columnHalf, isNarrow && { width: '100%' }]}>
          
          {/* Daily Schedule Progress */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <MaterialIcons name="check-circle" size={20} color="#059669" />
                <Text style={styles.cardTitle}>Daily Route Completion</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.cardHeaderRightText}>
                  {progress.completed}/{progress.total} Routes Done
                </Text>
                {onTabChange && (
                  <TouchableOpacity
                    onPress={() => onTabChange('route-optimization')}
                    style={styles.seeAllBtn}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.seeAllBtnText}>See All Routes</Text>
                    <MaterialIcons name="arrow-forward" size={13} color="#15803D" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <View style={styles.progressRow}>
              <Text style={styles.progressPercentage}>{progressPercent}%</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              </View>
            </View>
            <Text style={styles.progressCaption}>
              Scheduled municipal collection across Danao City barangays today.
            </Text>
          </View>

          {/* Today's Active Schedules */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <MaterialIcons name="event-note" size={20} color="#1B4D3E" />
                <Text style={styles.cardTitle}>Today&apos;s Collection Schedules</Text>
              </View>
              {onTabChange && (
                <TouchableOpacity onPress={() => onTabChange('collection-scheduler')} style={styles.seeAllBtn} activeOpacity={0.7}>
                  <Text style={styles.seeAllBtnText}>See All Schedules</Text>
                  <MaterialIcons name="arrow-forward" size={13} color="#15803D" />
                </TouchableOpacity>
              )}
            </View>

            {todaySchedules.length === 0 ? (
              <View style={styles.emptyBox}>
                <MaterialIcons name="event-available" size={32} color="#94A3B8" />
                <Text style={styles.emptyText}>No special routes dispatched yet for today.</Text>
              </View>
            ) : (
              todaySchedules.map((item, idx) => (
                <View key={idx} style={styles.scheduleItem}>
                  <View style={styles.scheduleTimeBox}>
                    <Text style={styles.scheduleTimeText}>{item.time}</Text>
                  </View>
                  <View style={{ flex: 1, marginHorizontal: 12 }}>
                    <Text style={styles.scheduleBrgyText}>Barangay {item.brgy}</Text>
                    <Text style={styles.scheduleTruckText}>Assigned: {item.truck}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: item.color === '#059669' ? '#ECFDF5' : '#EFF6FF' }]}>
                    <Text style={[styles.statusBadgeText, { color: item.color }]}>
                      {item.status}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Recent Citizen Reports */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <MaterialIcons name="assignment" size={20} color="#1B4D3E" />
                <Text style={styles.cardTitle}>Recent Incident Reports</Text>
              </View>
              {onTabChange && (
                <TouchableOpacity onPress={() => onTabChange('trash-reports')} style={styles.seeAllBtn} activeOpacity={0.7}>
                  <Text style={styles.seeAllBtnText}>See All Reports</Text>
                  <MaterialIcons name="arrow-forward" size={13} color="#15803D" />
                </TouchableOpacity>
              )}
            </View>

            {recentReports.length === 0 ? (
              <View style={styles.emptyBox}>
                <MaterialIcons name="done-all" size={32} color="#059669" />
                <Text style={styles.emptyText}>All reported incidents resolved!</Text>
              </View>
            ) : (
              <View style={styles.tableWrapper}>
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.tableTh, { flex: 1.2 }]}>ID</Text>
                  <Text style={[styles.tableTh, { flex: 2 }]}>Barangay</Text>
                  <Text style={[styles.tableTh, { flex: 2 }]}>Waste Type</Text>
                  <Text style={[styles.tableTh, { flex: 1.5, textAlign: 'right' }]}>Status</Text>
                </View>
                {recentReports.map((row, i) => (
                  <View key={i} style={styles.tableRow}>
                    <Text style={[styles.tableTd, { flex: 1.2, fontWeight: '700', color: '#1B4D3E' }]}>
                      #{row.id}
                    </Text>
                    <Text style={[styles.tableTd, { flex: 2 }]} numberOfLines={1}>
                      {row.barangay}
                    </Text>
                    <Text style={[styles.tableTd, { flex: 2, color: '#64748B' }]} numberOfLines={1}>
                      {row.type}
                    </Text>
                    <View style={{ flex: 1.5, alignItems: 'flex-end' }}>
                      <View style={[styles.chipBadge, { backgroundColor: `${row.statusColor}18` }]}>
                        <Text style={[styles.chipText, { color: row.statusColor }]}>
                          {row.status}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* RIGHT COLUMN: Fleet Operations & Incident Monitoring */}
        <View style={[styles.columnHalf, isNarrow && { width: '100%' }]}>
          
          {/* Trucks with Highest Load (Past 30 Days) — Fleet Leaderboard */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <MaterialIcons name="local-shipping" size={20} color="#D97706" />
                <Text style={styles.cardTitle}>Highest Load Municipal Trucks (Past 30 Days)</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={[styles.modelBadge, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
                  <Text style={[styles.modelBadgeText, { color: '#B45309' }]}>FLEET LEADERBOARD</Text>
                </View>
                {onTabChange && (
                  <TouchableOpacity
                    onPress={() => onTabChange('analytics', 'trucks')}
                    style={styles.seeAllBtn}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.seeAllBtnText}>See All Analytics</Text>
                    <MaterialIcons name="arrow-forward" size={13} color="#15803D" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <Text style={styles.chartSubtitle}>
              Ranked by cumulative metric tons collected and transport cycle utilization over the past 30 days.
            </Text>

            {highestLoadList.length === 0 ? (
              <View style={styles.emptyLeaderboardBox}>
                <View style={styles.emptyLeaderboardIconWrap}>
                  <MaterialIcons name="local-shipping" size={32} color="#94A3B8" />
                </View>
                <Text style={styles.emptyLeaderboardTitle}>No Fleet Load Records (Past 30 Days)</Text>
                <Text style={styles.emptyLeaderboardSub}>
                  There are no completed collection trips or weighbridge measurements recorded in the database for the past 30 days.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.highestLoadBanner}>
                  <View style={styles.highestLoadIconBox}>
                    <MaterialIcons name="emoji-events" size={28} color="#D97706" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={styles.highestLoadLeaderPlate}>{highestLoadList[0].truckPlate}</Text>
                      <View style={styles.highestLoadLeaderBadge}>
                        <Text style={styles.highestLoadLeaderBadgeText}>🏆 #1 FLEET LEADER</Text>
                      </View>
                    </View>
                    <Text style={styles.highestLoadLeaderSub}>
                      Driver: {highestLoadList[0].driverName} · Model: {highestLoadList[0].model}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.highestLoadLeaderTons}>{highestLoadList[0].totalTons} t</Text>
                    <Text style={styles.highestLoadLeaderTrips}>{highestLoadList[0].tripsCount} trips ({highestLoadList[0].avgLoadPerTrip} t/trip)</Text>
                  </View>
                </View>

                {highestLoadList.length > 1 && (
                  <View style={styles.truckRankGrid}>
                    {highestLoadList.slice(1).map((truck, idx) => (
                      <View key={truck.truckPlate} style={styles.truckRankItem}>
                        <View style={styles.truckRankHeader}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.truckRankNumber}>#{idx + 2}</Text>
                            <Text style={styles.truckRankPlate}>{truck.truckPlate}</Text>
                          </View>
                          <Text style={styles.truckRankTons}>{truck.totalTons} t</Text>
                        </View>
                        <Text style={styles.truckRankDriver}>Driver: {truck.driverName}</Text>
                        <View style={styles.truckRankBarTrack}>
                          <View style={[
                            styles.truckRankBarFill,
                            { width: `${Math.round((truck.totalTons / (highestLoadList[0]?.totalTons || 1)) * 100)}%` }
                          ]} />
                        </View>
                        <View style={styles.truckRankFooter}>
                          <Text style={styles.truckRankTrips}>{truck.tripsCount} trips</Text>
                          <Text style={styles.truckRankAvg}>Avg {truck.avgLoadPerTrip} t/trip</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>

          {/* District Demand & Capacity Pressure */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <MaterialIcons name="grid-view" size={20} color="#1B4D3E" />
                <Text style={styles.cardTitle}>District Capacity & Demand Grid</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.cardHeaderRightText}>Top Pressure Zones</Text>
                {onTabChange && (
                  <TouchableOpacity
                    onPress={() => onTabChange('analytics', 'districts')}
                    style={styles.seeAllBtn}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.seeAllBtnText}>See All in Analytics</Text>
                    <MaterialIcons name="arrow-forward" size={13} color="#15803D" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {districtDemand.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>All districts within baseline capacity.</Text>
              </View>
            ) : (
              districtDemand.map((item, idx) => (
                <View key={idx} style={styles.districtRow}>
                  <View style={styles.districtInfoRow}>
                    <Text style={styles.districtName}>Barangay {item.label}</Text>
                    <View style={[styles.districtStatusBadge, { backgroundColor: `${item.color}15`, borderColor: item.color }]}>
                      <Text style={[styles.districtStatusText, { color: item.color }]}>
                        {item.status} ({item.count} reports)
                      </Text>
                    </View>
                  </View>
                  <View style={styles.districtBarTrack}>
                    <View style={[styles.districtBarFill, { width: `${item.pct}%`, backgroundColor: item.color }]} />
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Geotagged Incident Hotspots Alert */}
          <View style={styles.hotspotCard}>
            <View style={styles.hotspotHeader}>
              <View style={styles.hotspotIconBox}>
                <MaterialIcons name="place" size={22} color="#DC2626" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.hotspotTitle}>
                  {topHotspot ? `Incident Hotspot: ${topHotspot.label}` : 'Incident Hotspot Monitoring'}
                </Text>
                <Text style={styles.hotspotSubtitle}>
                  {topHotspot
                    ? `${topHotspot.count} active reports clustered in this zone. Prioritize dispatch.`
                    : 'Real-time AI spatial clustering active across Danao City.'}
                </Text>
              </View>
            </View>
            {onTabChange && (
              <TouchableOpacity onPress={() => onTabChange('analytics', 'hotspots')} style={styles.hotspotActionBtn} activeOpacity={0.8}>
                <Text style={styles.hotspotActionText}>View Full Analytics & Maps →</Text>
              </TouchableOpacity>
            )}
          </View>

        </View>

      </View>

      {/* TIER 3 SECTION DIVIDER */}
      <View style={[styles.tierDividerRow, { marginTop: 28 }]}>
        <View style={[styles.tierDividerAccent, { backgroundColor: '#7C3AED' }]} />
        <Text style={styles.tierDividerText}>TIER 3 • PREDICTIVE INTELLIGENCE & AUDIT RECORDS</Text>
        <View style={styles.tierDividerLine} />
      </View>

      {/* Monthly Waste Generation & AI Forecast Chart & 30-Day Tabulated Records (Full Width) */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <MaterialIcons name="trending-up" size={20} color="#1B4D3E" />
            <Text style={styles.cardTitle}>Waste Generation & AI Forecast</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={styles.modelBadge}>
              <Text style={styles.modelBadgeText}>MAE {forecastMae} t</Text>
            </View>
            {onTabChange && (
              <TouchableOpacity
                onPress={() => onTabChange('analytics', 'forecast')}
                style={styles.seeAllBtn}
                activeOpacity={0.7}
              >
                <Text style={styles.seeAllBtnText}>See All Analytics</Text>
                <MaterialIcons name="arrow-forward" size={13} color="#15803D" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* View Mode Toggle: Forecast Trend vs Tabulated 30-Day Records */}
        <View style={styles.forecastViewToggleRow}>
          <TouchableOpacity
            style={[styles.forecastViewBtn, forecastCardView === 'chart' && styles.forecastViewBtnActive]}
            onPress={() => setForecastCardView('chart')}
          >
            <MaterialIcons name="show-chart" size={14} color={forecastCardView === 'chart' ? '#FFFFFF' : '#047857'} />
            <Text style={[styles.forecastViewBtnText, forecastCardView === 'chart' && styles.forecastViewBtnTextActive]}>
              Forecast Trend
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.forecastViewBtn, forecastCardView === 'table' && styles.forecastViewBtnActive]}
            onPress={() => setForecastCardView('table')}
          >
            <MaterialIcons name="table-chart" size={14} color={forecastCardView === 'table' ? '#FFFFFF' : '#047857'} />
            <Text style={[styles.forecastViewBtnText, forecastCardView === 'table' && styles.forecastViewBtnTextActive]}>
              Tabulated (Past 30 Days)
            </Text>
          </TouchableOpacity>
        </View>

        {forecastCardView === 'chart' ? (
          <>
            <Text style={styles.chartSubtitle}>
              Historical trends vs. Next 2 Months predictive model ({forecastModelLabel})
            </Text>

            <View style={styles.chartWrapper}>
              <LineChart
                data={chartData}
                width={responsiveChartWidth}
                height={220}
                chartConfig={{
                  backgroundColor: '#FFFFFF',
                  backgroundGradientFrom: '#FFFFFF',
                  backgroundGradientTo: '#FFFFFF',
                  decimalPlaces: 1,
                  color: (opacity = 1) => `rgba(27, 77, 62, ${opacity})`,
                  labelColor: (opacity = 1) => `rgba(100, 116, 139, ${opacity})`,
                  style: { borderRadius: 12 },
                  propsForDots: {
                    r: '5',
                    strokeWidth: '2',
                    stroke: '#1B4D3E',
                  },
                }}
                bezier
                style={{ marginVertical: 8, borderRadius: 12 }}
              />
            </View>

            <View style={styles.chartLegendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#1B4D3E' }]} />
                <Text style={styles.legendText}>Historical Trend</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#059669' }]} />
                <Text style={styles.legendText}>AI Predictive Target</Text>
              </View>
              {onTabChange && (
                <TouchableOpacity onPress={() => onTabChange('analytics', 'forecast')} style={styles.deepDiveLink}>
                  <Text style={styles.deepDiveText}>Explore Analytics →</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Quick 30-Day Bar */}
            <View style={styles.quick30DayBar}>
              <View style={styles.quick30DayLeft}>
                <MaterialIcons name="fact-check" size={16} color="#059669" />
                <Text style={styles.quick30DayLabel}>Past 30 Days Collected:</Text>
                <Text style={styles.quick30DayValue}>{total30DayTons.toFixed(1)} t</Text>
                <Text style={styles.quick30DaySub}>({total30DayTrips} cycles)</Text>
              </View>
              <TouchableOpacity
                style={styles.quick30DayAction}
                onPress={() => setForecastCardView('table')}
              >
                <Text style={styles.quick30DayActionText}>View Table →</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.chartSubtitle}>
              Tabulated daily collection records & weighbridge telemetry over the past 30 days.
            </Text>

            <View style={styles.cardTableWrapper}>
              <View style={styles.cardTableHeader}>
                <Text style={[styles.cardTableTh, { width: 85 }]}>DATE</Text>
                <Text style={[styles.cardTableTh, { flex: 1.2 }]}>BARANGAY</Text>
                <Text style={[styles.cardTableTh, { width: 70, textAlign: 'right' }]}>TONS</Text>
                <Text style={[styles.cardTableTh, { width: 45, textAlign: 'center' }]}>TRIPS</Text>
                <Text style={[styles.cardTableTh, { flex: 1.2 }]}>TRUCK</Text>
                <Text style={[styles.cardTableTh, { width: 75, textAlign: 'right' }]}>STATUS</Text>
              </View>
              <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={true}>
                {thirtyDayLogs.length === 0 ? (
                  <View style={{ padding: 24, alignItems: 'center' }}>
                    <Text style={{ color: '#94A3B8', fontSize: 13, fontWeight: '500' }}>
                      No collection records recorded in the database for the past 30 days.
                    </Text>
                  </View>
                ) : (
                  thirtyDayLogs.map((row, idx) => (
                    <View key={row.id} style={[styles.cardTableRow, idx % 2 === 1 && styles.cardTableRowAlt]}>
                      <Text style={[styles.cardTableTd, { width: 85, fontWeight: '700' }]}>{row.date}</Text>
                      <Text style={[styles.cardTableTd, { flex: 1.2, color: '#0F172A', fontWeight: '600' }]} numberOfLines={1}>
                        {row.barangay}
                      </Text>
                      <Text style={[styles.cardTableTd, { width: 70, textAlign: 'right', fontWeight: '800', color: '#15803D' }]}>
                        {row.tonnage.toFixed(1)} t
                      </Text>
                      <Text style={[styles.cardTableTd, { width: 45, textAlign: 'center', color: '#64748B' }]}>
                        {row.trips}
                      </Text>
                      <Text style={[styles.cardTableTd, { flex: 1.2, color: '#334155' }]} numberOfLines={1}>
                        {row.truckPlate}
                      </Text>
                      <View style={{ width: 75, alignItems: 'flex-end' }}>
                        <View style={[styles.chipBadge, { backgroundColor: row.status === 'Completed' ? '#ECFDF5' : '#FEF3C7' }]}>
                          <Text style={[styles.chipText, { color: row.status === 'Completed' ? '#059669' : '#D97706' }]}>
                            {row.status}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
              <View style={styles.cardTableFooter}>
                <Text style={styles.cardTableFooterText}>
                  Past 30 Days Total:{' '}
                  <Text style={{ fontWeight: '800', color: '#15803D' }}>{total30DayTons.toFixed(1)} metric tons</Text>
                  {' '}({total30DayTrips} trips completed)
                </Text>
              </View>
            </View>
          </>
        )}
      </View>

      {/* 4. Tabulated Data of Collected Tons & Municipal Records (Manuscript Section 5 & Row 9 Requirement) */}
      <View style={[styles.card, { marginTop: 20 }]}>
        <View style={[styles.cardHeader, isMobile && { flexDirection: 'column', alignItems: 'flex-start', gap: 10 }]}>
          <View style={{ flex: 1, marginRight: isMobile ? 0 : 12 }}>
            <View style={styles.cardTitleRow}>
              <MaterialIcons name="table-chart" size={20} color="#15803D" />
              <Text style={styles.cardTitle}>Municipal Solid Waste Collections</Text>
            </View>
            <Text style={styles.cardHeaderSubtext}>
              Showing {filteredCollectionLogs.length} Records • {getDurationDisplayLabel(filterDuration)} • {filterBarangay === 'all' ? 'City-Wide (All Barangays)' : `Brgy. ${filterBarangay}`}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {onTabChange && (
              <TouchableOpacity
                style={styles.tableAnalyticsBtn}
                onPress={() => onTabChange('analytics', 'trucks')}
                activeOpacity={0.8}
              >
                <MaterialIcons name="insights" size={15} color="#0F766E" />
                <Text style={styles.tableAnalyticsBtnText}>See All Analytics</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.exportReportBtn}
              onPress={() => setIsExportModalVisible(true)}
              activeOpacity={0.8}
            >
              <MaterialIcons name="picture-as-pdf" size={16} color="#FFFFFF" />
              <Text style={styles.exportReportBtnText}>Export PDF Report</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.chartSubtitle, { marginBottom: 12 }]}>
          Complete daily municipal solid waste intake, trip counts, and weighbridge records across Danao City.
        </Text>

        {/* Dashboard Filter Bar */}
        <View style={styles.dashboardFilterContainer}>
          {/* Row 1: Search + Barangay Selector Trigger + Reset Button */}
          <View style={[styles.filterRowMain, isMobile && { flexDirection: 'column', alignItems: 'stretch' }]}>
            <View style={styles.filterSearchBox}>
              <MaterialIcons name="search" size={18} color="#94A3B8" />
              <TextInput
                style={styles.filterSearchInput}
                placeholder="Search truck plate, driver, barangay, or date..."
                placeholderTextColor="#94A3B8"
                value={filterSearch}
                onChangeText={setFilterSearch}
              />
              {filterSearch.length > 0 && (
                <TouchableOpacity onPress={() => setFilterSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <MaterialIcons name="cancel" size={16} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TouchableOpacity
                style={styles.barangayPickerTrigger}
                onPress={() => setIsBarangayPickerOpen(true)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="place" size={16} color="#15803D" />
                <Text style={styles.barangayPickerTriggerText} numberOfLines={1}>
                  {filterBarangay === 'all' ? 'All Barangays' : `Brgy. ${filterBarangay}`}
                </Text>
                <MaterialIcons name="arrow-drop-down" size={18} color="#64748B" />
              </TouchableOpacity>

              {(filterBarangay !== 'all' || filterDuration !== '30d' || filterStatus !== 'all' || filterSearch.trim() !== '') && (
                <TouchableOpacity
                  style={styles.filterResetBtn}
                  onPress={() => {
                    setFilterBarangay('all');
                    setFilterDuration('30d');
                    setFilterStatus('all');
                    setFilterSearch('');
                  }}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="refresh" size={14} color="#DC2626" />
                  <Text style={styles.filterResetBtnText}>Reset</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Row 2: Duration Presets */}
          <View style={styles.filterSubRow}>
            <Text style={styles.filterSubLabel}>DURATION:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterPillsScroll}>
              {[
                { id: '30d', label: 'Past 30 Days' },
                { id: 'today', label: 'Today' },
                { id: '7d', label: 'Past 7 Days' },
                { id: 'this_month', label: 'This Month' },
                { id: 'last_month', label: 'Last Month' },
                { id: '90d', label: 'Past 90 Days' },
                { id: 'all', label: 'All Time' },
              ].map((d) => (
                <TouchableOpacity
                  key={d.id}
                  style={[styles.filterPill, filterDuration === d.id && styles.filterPillActive]}
                  onPress={() => setFilterDuration(d.id)}
                >
                  <Text style={[styles.filterPillText, filterDuration === d.id && styles.filterPillTextActive]}>
                    {d.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Row 3: Status Selector */}
          <View style={styles.filterSubRow}>
            <Text style={styles.filterSubLabel}>STATUS:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterPillsScroll}>
              {[
                { id: 'all', label: 'All Statuses' },
                { id: 'Completed', label: 'Completed' },
                { id: 'In Progress', label: 'In Progress' },
                { id: 'Scheduled', label: 'Scheduled' },
              ].map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.filterPill, filterStatus === s.id && styles.filterPillActive]}
                  onPress={() => setFilterStatus(s.id as any)}
                >
                  <View
                    style={[
                      styles.filterStatusDot,
                      {
                        backgroundColor:
                          s.id === 'Completed'
                            ? '#10B981'
                            : s.id === 'In Progress'
                            ? '#F59E0B'
                            : s.id === 'Scheduled'
                            ? '#3B82F6'
                            : '#94A3B8',
                      },
                    ]}
                  />
                  <Text style={[styles.filterPillText, filterStatus === s.id && styles.filterPillTextActive]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Row 4: Quick Barangay Chips */}
          <View style={styles.filterSubRow}>
            <Text style={styles.filterSubLabel}>BARANGAY:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterPillsScroll}>
              <TouchableOpacity
                style={[styles.filterPill, filterBarangay === 'all' && styles.filterPillActive]}
                onPress={() => setFilterBarangay('all')}
              >
                <Text style={[styles.filterPillText, filterBarangay === 'all' && styles.filterPillTextActive]}>
                  All Barangays ({allCollectionLogs.length})
                </Text>
              </TouchableOpacity>
              {Array.from(new Set(allCollectionLogs.map((r) => r.barangay))).slice(0, 12).map((b) => (
                <TouchableOpacity
                  key={b}
                  style={[styles.filterPill, filterBarangay.toLowerCase() === b.toLowerCase() && styles.filterPillActive]}
                  onPress={() => setFilterBarangay(b)}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      filterBarangay.toLowerCase() === b.toLowerCase() && styles.filterPillTextActive,
                    ]}
                  >
                    {b}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.filterPill, { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' }]}
                onPress={() => setIsBarangayPickerOpen(true)}
              >
                <MaterialIcons name="tune" size={13} color="#475569" style={{ marginRight: 4 }} />
                <Text style={[styles.filterPillText, { color: '#475569' }]}>
                  All 42 Barangays...
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>

        {/* Live Filter Summary Cards */}
        <View style={styles.filteredSummaryBar}>
          <View style={styles.filteredSummaryCard}>
            <Text style={styles.filteredSummaryLabel}>FILTERED TONNAGE</Text>
            <Text style={styles.filteredSummaryValue}>{filteredSummary.totalTonnage} t</Text>
            <Text style={styles.filteredSummarySub}>Waste recorded</Text>
          </View>
          <View style={styles.filteredSummaryCard}>
            <Text style={styles.filteredSummaryLabel}>DISPATCH CYCLES</Text>
            <Text style={styles.filteredSummaryValue}>{filteredSummary.totalTrips}</Text>
            <Text style={styles.filteredSummarySub}>Trips completed</Text>
          </View>
          <View style={styles.filteredSummaryCard}>
            <Text style={styles.filteredSummaryLabel}>FLEET IN SERVICE</Text>
            <Text style={styles.filteredSummaryValue}>{filteredSummary.uniqueTrucks}</Text>
            <Text style={styles.filteredSummarySub}>Truck units</Text>
          </View>
          <View style={styles.filteredSummaryCard}>
            <Text style={styles.filteredSummaryLabel}>MATCHED RECORDS</Text>
            <Text style={styles.filteredSummaryValue}>{filteredSummary.recordCount}</Text>
            <Text style={styles.filteredSummarySub}>Log entries</Text>
          </View>
        </View>

        {/* Tabulated Table Container */}
        <View style={styles.tableCardContainer}>
          <View style={styles.tabHeaderRow}>
            <Text style={[styles.tabHeaderCell, { width: 95 }]}>DATE</Text>
            <Text style={[styles.tabHeaderCell, { flex: 1.2, minWidth: 110 }]}>BARANGAY</Text>
            <Text style={[styles.tabHeaderCell, { width: 90, textAlign: 'right' }]}>TONNAGE (t)</Text>
            <Text style={[styles.tabHeaderCell, { width: 65, textAlign: 'center' }]}>TRIPS</Text>
            <Text style={[styles.tabHeaderCell, { flex: 1.4, minWidth: 130 }]}>TRUCK & OPERATOR</Text>
            <Text style={[styles.tabHeaderCell, { width: 95, textAlign: 'right' }]}>STATUS</Text>
          </View>

          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={true}>
            {filteredCollectionLogs.length === 0 ? (
              <View style={styles.emptyTableFilterBox}>
                <MaterialIcons name="search-off" size={36} color="#94A3B8" />
                <Text style={styles.emptyTableFilterTitle}>No Collection Records Found</Text>
                <Text style={styles.emptyTableFilterSub}>
                  No collections match your filter parameters ({getDurationDisplayLabel(filterDuration)} • {filterBarangay === 'all' ? 'All Barangays' : `Brgy. ${filterBarangay}`}).
                </Text>
                <TouchableOpacity
                  style={styles.emptyTableResetBtn}
                  onPress={() => {
                    setFilterBarangay('all');
                    setFilterDuration('30d');
                    setFilterStatus('all');
                    setFilterSearch('');
                  }}
                >
                  <MaterialIcons name="refresh" size={16} color="#FFFFFF" />
                  <Text style={styles.emptyTableResetBtnText}>Reset Filter Parameters</Text>
                </TouchableOpacity>
              </View>
            ) : (
              filteredCollectionLogs.map((row, idx) => (
                <View key={row.id} style={[styles.tabRow, idx % 2 === 1 && styles.tabRowAlt]}>
                  <Text style={[styles.tabCellText, { width: 95, fontWeight: '700' }]}>{row.date}</Text>
                  <Text style={[styles.tabCellText, { flex: 1.2, minWidth: 110, fontWeight: '700', color: '#0F172A' }]}>
                    Brgy. {row.barangay}
                  </Text>
                  <Text style={[styles.tabCellText, { width: 90, textAlign: 'right', fontWeight: '800', color: '#15803D' }]}>
                    {row.tonnage.toFixed(1)} t
                  </Text>
                  <Text style={[styles.tabCellText, { width: 65, textAlign: 'center', color: '#64748B' }]}>
                    {row.trips}
                  </Text>
                  <View style={{ flex: 1.4, minWidth: 130 }}>
                    <Text style={[styles.tabCellText, { fontWeight: '700', color: '#1E293B' }]}>{row.truckPlate}</Text>
                    <Text style={{ fontSize: 10, color: '#64748B' }}>{row.driverName}</Text>
                  </View>
                  <View style={{ width: 95, alignItems: 'flex-end' }}>
                    <View
                      style={[
                        styles.chipBadge,
                        {
                          backgroundColor:
                            row.status === 'Completed'
                              ? '#ECFDF5'
                              : row.status === 'In Progress'
                              ? '#FEF3C7'
                              : '#EFF6FF',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color:
                              row.status === 'Completed'
                                ? '#059669'
                                : row.status === 'In Progress'
                                ? '#D97706'
                                : '#2563EB',
                          },
                        ]}
                      >
                        {row.status}
                      </Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          {/* Table Summary Footer */}
          <View style={styles.tableFooterRow}>
            <Text style={styles.tableFooterText}>
              Filtered Total Volume:{' '}
              <Text style={{ fontWeight: '900', color: '#15803D' }}>
                {filteredSummary.totalTonnage} metric tons
              </Text>
            </Text>
            <Text style={styles.tableFooterText}>
              Total Cycles:{' '}
              <Text style={{ fontWeight: '900', color: '#0F172A' }}>
                {filteredSummary.totalTrips} trips completed
              </Text>
            </Text>
          </View>
        </View>
      </View>

      {/* Export Modal */}
      <ExportModal
        visible={isExportModalVisible}
        onClose={() => setIsExportModalVisible(false)}
        title="Municipal Solid Waste Collections Report"
        description={`Executive Danao City CENRO report covering ${filterBarangay === 'all' ? 'All Danao City Barangays' : `Brgy. ${filterBarangay}`} for ${getDurationDisplayLabel(filterDuration)}.`}
        dataCount={filteredCollectionLogs.length}
        onExport={handleExportDashboardReport}
      />

      {/* Barangay Picker Modal */}
      <Modal
        visible={isBarangayPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsBarangayPickerOpen(false)}
      >
        <View style={styles.pickerModalOverlay}>
          <View style={[styles.pickerModalCard, isMobile && { width: '92%', maxHeight: '85%' }]}>
            <View style={styles.pickerModalHeader}>
              <View style={styles.pickerModalTitleWrap}>
                <MaterialIcons name="location-city" size={20} color="#15803D" />
                <Text style={styles.pickerModalTitle}>Select Barangay Filter</Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsBarangayPickerOpen(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Search Input for Barangay */}
            <View style={styles.pickerSearchBox}>
              <MaterialIcons name="search" size={18} color="#94A3B8" />
              <TextInput
                style={styles.pickerSearchInput}
                placeholder="Search among 42 barangays..."
                placeholderTextColor="#94A3B8"
                value={barangaySearchQuery}
                onChangeText={setBarangaySearchQuery}
                autoCapitalize="none"
              />
              {barangaySearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setBarangaySearchQuery('')}>
                  <MaterialIcons name="clear" size={16} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView style={{ maxHeight: 350 }} showsVerticalScrollIndicator={true}>
              {/* All Barangays Option */}
              {(!barangaySearchQuery.trim() || 'all barangays city-wide'.includes(barangaySearchQuery.toLowerCase())) && (
                <TouchableOpacity
                  style={[styles.pickerItemRow, filterBarangay === 'all' && styles.pickerItemRowSelected]}
                  onPress={() => {
                    setFilterBarangay('all');
                    setIsBarangayPickerOpen(false);
                    setBarangaySearchQuery('');
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <MaterialIcons
                      name="public"
                      size={18}
                      color={filterBarangay === 'all' ? '#15803D' : '#64748B'}
                    />
                    <Text
                      style={[
                        styles.pickerItemText,
                        filterBarangay === 'all' && styles.pickerItemTextSelected,
                      ]}
                    >
                      All Barangays (City-Wide)
                    </Text>
                  </View>
                  {filterBarangay === 'all' && (
                    <MaterialIcons name="check" size={18} color="#15803D" />
                  )}
                </TouchableOpacity>
              )}

              {/* 42 Danao Barangays */}
              {DANAO_CITY_BARANGAYS.filter((b) =>
                b.toLowerCase().includes(barangaySearchQuery.trim().toLowerCase())
              ).map((b) => {
                const isSelected = filterBarangay.toLowerCase() === b.toLowerCase();
                const matchCount = allCollectionLogs.filter(
                  (log) => log.barangay.toLowerCase() === b.toLowerCase()
                ).length;
                return (
                  <TouchableOpacity
                    key={b}
                    style={[styles.pickerItemRow, isSelected && styles.pickerItemRowSelected]}
                    onPress={() => {
                      setFilterBarangay(b);
                      setIsBarangayPickerOpen(false);
                      setBarangaySearchQuery('');
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <MaterialIcons
                        name="place"
                        size={18}
                        color={isSelected ? '#15803D' : '#64748B'}
                      />
                      <Text
                        style={[
                          styles.pickerItemText,
                          isSelected && styles.pickerItemTextSelected,
                        ]}
                      >
                        Brgy. {b}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {matchCount > 0 && (
                        <View style={styles.pickerItemBadge}>
                          <Text style={styles.pickerItemBadgeText}>{matchCount} logs</Text>
                        </View>
                      )}
                      {isSelected && (
                        <MaterialIcons name="check" size={18} color="#15803D" />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 14,
    fontSize: 14,
    fontWeight: '600',
    color: '#1B4D3E',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
    letterSpacing: -0.5,
  },
  dateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  dateBadgeDivider: {
    width: 1,
    height: 12,
    backgroundColor: '#A7F3D0',
    marginHorizontal: 8,
  },
  dateText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },
  timeText: {
    fontWeight: '800',
    color: '#047857',
    fontVariant: ['tabular-nums'],
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 20,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  kpiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  kpiIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiTrendBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  kpiTrendText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#059669',
  },
  kpiLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  kpiUnit: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  kpiCaption: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
  },
  mainColumnsRow: {
    flexDirection: 'row',
    gap: 18,
    marginBottom: 32,
  },
  columnHalf: {
    flex: 1,
    gap: 18,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 180,
  },
  cardTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
    flexShrink: 1,
  },
  cardHeaderRightText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#64748B',
  },
  linkBtn: {
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  linkBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1B4D3E',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 4,
  },
  progressPercentage: {
    fontSize: 20,
    fontWeight: '800',
    color: '#059669',
  },
  progressTrack: {
    flex: 1,
    height: 10,
    backgroundColor: '#F1F5F9',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#059669',
    borderRadius: 5,
  },
  progressCaption: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 6,
  },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  scheduleTimeBox: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  scheduleTimeText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#1E293B',
  },
  scheduleBrgyText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  scheduleTruckText: {
    fontSize: 11.5,
    color: '#64748B',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  tableWrapper: {
    marginTop: 4,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tableTh: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  tableTd: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#1E293B',
  },
  chipBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  chipText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    marginTop: 6,
    fontSize: 12.5,
    color: '#64748B',
    fontWeight: '600',
  },
  modelBadge: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  modelBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#065F46',
  },
  chartSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 8,
  },
  chartWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  chartLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748B',
  },
  deepDiveLink: {
    paddingVertical: 2,
  },
  deepDiveText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1B4D3E',
  },
  districtRow: {
    marginBottom: 12,
  },
  districtInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  districtName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  districtStatusBadge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  districtStatusText: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  districtBarTrack: {
    height: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  districtBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  hotspotCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: '#FECACA',
    borderRadius: 16,
    padding: 16,
  },
  hotspotHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  hotspotIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hotspotTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#991B1B',
  },
  hotspotSubtitle: {
    fontSize: 12,
    color: '#B91C1C',
    marginTop: 2,
    lineHeight: 16,
  },
  hotspotActionBtn: {
    marginTop: 12,
    alignSelf: 'flex-end',
  },
  hotspotActionText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#DC2626',
  },
  advisoryGridRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  weatherCard: {
    flex: 1.4,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },
  weatherHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  weatherLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  weatherIconBox: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weatherIconBoxOptimal: {
    backgroundColor: '#ECFDF5',
  },
  weatherIconBoxWarning: {
    backgroundColor: '#FEF3C7',
  },
  weatherIconBoxSevere: {
    backgroundColor: '#FEE2E2',
  },
  weatherBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  weatherLocation: {
    fontSize: 9,
    fontWeight: '900',
    color: '#64748B',
    letterSpacing: 0.6,
  },
  weatherLevelBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  weatherLevelText: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  weatherTempText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
  },
  weatherFeelsLike: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  weatherMetricsRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  weatherMetricItem: {
    fontSize: 10.5,
    color: '#64748B',
    fontWeight: '600',
  },
  weatherMetricVal: {
    fontWeight: '800',
    color: '#0F172A',
  },
  advisoryMessageBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 9,
    borderLeftWidth: 3,
    borderLeftColor: '#059669',
  },
  advisoryMessageTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  advisoryMessageContent: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 15,
  },
  holidayCard: {
    flex: 1,
    backgroundColor: '#F0F9FF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },
  holidayHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  holidayBadge: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#7DD3FC',
  },
  holidayBadgeText: {
    fontSize: 9.5,
    fontWeight: '900',
    color: '#0369A1',
    letterSpacing: 0.5,
  },
  holidayTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0C4A6E',
    marginBottom: 3,
  },
  holidayDesc: {
    fontSize: 11,
    color: '#0369A1',
    lineHeight: 15,
    marginBottom: 8,
  },
  holidayActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    padding: 6,
    borderRadius: 6,
  },
  holidayActionText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#0284C7',
    flex: 1,
  },
  emptyLeaderboardBox: {
    paddingVertical: 36,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    marginTop: 12,
  },
  emptyLeaderboardIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyLeaderboardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  emptyLeaderboardSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 480,
    lineHeight: 18,
  },
  highestLoadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 16,
    gap: 14,
  },
  highestLoadIconBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  highestLoadLeaderPlate: {
    fontSize: 16,
    fontWeight: '900',
    color: '#78350F',
  },
  highestLoadLeaderBadge: {
    backgroundColor: '#FDE68A',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  highestLoadLeaderBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#92400E',
  },
  highestLoadLeaderSub: {
    fontSize: 12,
    color: '#92400E',
    marginTop: 3,
  },
  highestLoadLeaderTons: {
    fontSize: 20,
    fontWeight: '900',
    color: '#78350F',
  },
  highestLoadLeaderTrips: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 2,
  },
  truckRankGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  truckRankItem: {
    flex: 1,
    minWidth: 200,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  truckRankHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  truckRankNumber: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
  },
  truckRankPlate: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  truckRankTons: {
    fontSize: 13,
    fontWeight: '900',
    color: '#D97706',
  },
  truckRankDriver: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 8,
  },
  truckRankBarTrack: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  truckRankBarFill: {
    height: '100%',
    backgroundColor: '#D97706',
    borderRadius: 3,
  },
  truckRankFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  truckRankTrips: {
    fontSize: 10.5,
    color: '#64748B',
    fontWeight: '600',
  },
  truckRankAvg: {
    fontSize: 10.5,
    color: '#059669',
    fontWeight: '700',
  },
  tableFilterScroll: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 12,
    marginBottom: 4,
  },
  tableFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  tableFilterChipActive: {
    backgroundColor: '#15803D',
    borderColor: '#15803D',
  },
  tableFilterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  tableFilterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  tableCardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  tabHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tabHeaderCell: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  tabRowAlt: {
    backgroundColor: '#FAFAFA',
  },
  tabCellText: {
    fontSize: 12,
    color: '#334155',
  },
  tableFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#F8FAFC',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  tableFooterText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  forecastViewToggleRow: {
    flexDirection: 'row',
    gap: 6,
    marginVertical: 10,
    backgroundColor: '#F1F5F9',
    padding: 3,
    borderRadius: 8,
  },
  forecastViewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    borderRadius: 6,
  },
  forecastViewBtnActive: {
    backgroundColor: '#1B4D3E',
  },
  forecastViewBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },
  forecastViewBtnTextActive: {
    color: '#FFFFFF',
  },
  quick30DayBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 10,
  },
  quick30DayLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  quick30DayLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#166534',
  },
  quick30DayValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#15803D',
  },
  quick30DaySub: {
    fontSize: 11,
    color: '#166534',
  },
  quick30DayAction: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  quick30DayActionText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#059669',
  },
  cardTableWrapper: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    marginTop: 8,
  },
  cardTableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardTableTh: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  cardTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#F1F5F9',
  },
  cardTableRowAlt: {
    backgroundColor: '#FAFAFA',
  },
  cardTableTd: {
    fontSize: 11,
    color: '#334155',
  },
  cardTableFooter: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#F8FAFC',
    borderTopWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  cardTableFooterText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  exportReportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#059669',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  exportReportBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12.5,
  },
  cardHeaderSubtext: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  dashboardFilterContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
    gap: 10,
  },
  filterRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filterSearchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    height: 38,
    gap: 8,
  },
  filterSearchInput: {
    flex: 1,
    fontSize: 12.5,
    color: '#0F172A',
    paddingVertical: 0,
  },
  barangayPickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    height: 38,
    gap: 6,
    minWidth: 140,
    justifyContent: 'space-between',
  },
  barangayPickerTriggerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
    maxWidth: 130,
  },
  filterResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 10,
    height: 38,
    borderRadius: 8,
  },
  filterResetBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#DC2626',
  },
  filterSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterSubLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    width: 72,
  },
  filterPillsScroll: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    paddingVertical: 2,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterPillActive: {
    backgroundColor: '#15803D',
    borderColor: '#15803D',
  },
  filterPillText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#475569',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  filterStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 5,
  },
  filteredSummaryBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  filteredSummaryCard: {
    flex: 1,
    minWidth: 120,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filteredSummaryLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  filteredSummaryValue: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
  },
  filteredSummarySub: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  emptyTableFilterBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  emptyTableFilterTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#334155',
    marginTop: 6,
  },
  emptyTableFilterSub: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 380,
  },
  emptyTableResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#15803D',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 10,
  },
  emptyTableResetBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  pickerModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  pickerModalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  pickerModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  pickerModalTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pickerModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  pickerSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    height: 38,
    gap: 8,
    marginBottom: 12,
  },
  pickerSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    paddingVertical: 0,
  },
  pickerItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 2,
  },
  pickerItemRowSelected: {
    backgroundColor: '#ECFDF5',
  },
  pickerItemText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '500',
  },
  pickerItemTextSelected: {
    fontWeight: '800',
    color: '#15803D',
  },
  pickerItemBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  pickerItemBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#64748B',
  },
  fiscalExecutiveCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#99F6E4',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  fiscalExecHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  fiscalExecIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fiscalExecEyebrow: {
    color: '#0D9488',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  fiscalExecTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 2,
  },
  fiscalStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  fiscalStatusBadgeSufficient: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  fiscalStatusBadgeWarning: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  fiscalStatusBadgeDanger: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  fiscalStatusBadgeNeutral: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  fiscalStatusBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  fiscalDetailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  fiscalDetailsBtnText: {
    color: '#0F766E',
    fontSize: 11,
    fontWeight: '800',
  },
  fiscalExecMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 16,
  },
  fiscalExecMetric: {
    flex: 1,
    minWidth: 140,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
  },
  fiscalExecMetricLabel: {
    color: '#64748B',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  fiscalExecMetricValue: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 4,
  },
  fiscalExecMetricSub: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '600',
    marginTop: 2,
  },
  headerWeatherPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  headerWeatherText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  priorityAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 18,
  },
  alertSevere: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  alertWarning: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  alertInfo: {
    backgroundColor: '#F0F9FF',
    borderColor: '#BAE6FD',
  },
  priorityAlertTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  priorityAlertDesc: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  tierDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 16,
  },
  tierDividerAccent: {
    width: 4,
    height: 16,
    borderRadius: 2,
  },
  tierDividerText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#475569',
    textTransform: 'uppercase',
  },
  tierDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  seeAllBtnText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#15803D',
  },
  tableAnalyticsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  tableAnalyticsBtnText: {
    color: '#0F766E',
    fontSize: 12,
    fontWeight: '800',
  },
});
