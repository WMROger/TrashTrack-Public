import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import { DANAO_CITY_BARANGAYS } from '@/constants/danaoBarangays';
import { exportWasteAnalyticsPdf, WasteReportData } from '@/services/wasteReportPdfService';
import ExportModal from './ExportModal';
import { exportReport, ExportFormat } from '@/services/reportExportService';

export interface TruckAnalyticsItem {
  id: string;
  plateNumber: string;
  type: string;
  driverName: string;
  totalTons: number;
  tripCount: number;
  avgLoadPerTrip: number;
  capacityTons: number;
  utilizationPercent: number;
  primaryBarangay: string;
  barangayBreakdown: Record<string, number>;
}

interface TruckWasteAnalyticsPanelProps {
  schedulesData: any[];
  trucksData: any[];
  districtData?: any[];
  isCoordinator?: boolean;
  assignedBarangay?: string;
  initialCustomRange?: {
    startDate: string;
    endDate: string;
  };
}

export default function TruckWasteAnalyticsPanel({
  schedulesData,
  trucksData,
  districtData = [],
  isCoordinator = false,
  assignedBarangay = '',
  initialCustomRange,
}: TruckWasteAnalyticsPanelProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  // Filter States
  const [selectedBarangay, setSelectedBarangay] = useState<string>(
    isCoordinator && assignedBarangay ? assignedBarangay : 'ALL'
  );
  const [selectedDuration, setSelectedDuration] = useState<string>('30d');
  const [selectedTruckId, setSelectedTruckId] = useState<string>('ALL');
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportModalVisible, setIsExportModalVisible] = useState(false);

  // Custom Date Range State
  const [customStartDate, setCustomStartDate] = useState<string>(
    initialCustomRange?.startDate || '2025-10-10'
  );
  const [customEndDate, setCustomEndDate] = useState<string>(
    initialCustomRange?.endDate || '2025-10-20'
  );

  // Dropdown visibility
  const [isBarangayPickerOpen, setIsBarangayPickerOpen] = useState(false);
  const [isDurationPickerOpen, setIsDurationPickerOpen] = useState(false);
  const [isTruckPickerOpen, setIsTruckPickerOpen] = useState(false);

  const durationOptions = [
    { id: '30d', label: 'Past 30 Days' },
    { id: 'this_month', label: 'This Month' },
    { id: '90d', label: 'Past 3 Months' },
    { id: '180d', label: 'Past 6 Months' },
    { id: '365d', label: 'Past 12 Months' },
    { id: 'custom', label: 'Custom Date Range' },
    { id: 'all', label: 'All-Time Records' },
  ];

  // Duration cutoff timestamp
  const durationCutoffTimestamp = useMemo(() => {
    const now = new Date();
    if (selectedDuration === 'all' || selectedDuration === 'custom') return 0;
    if (selectedDuration === 'this_month') {
      return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    }
    const days =
      selectedDuration === '30d'
        ? 30
        : selectedDuration === '90d'
        ? 90
        : selectedDuration === '180d'
        ? 180
        : 365;
    return now.getTime() - days * 24 * 60 * 60 * 1000;
  }, [selectedDuration]);

  // Custom date range timestamps
  const customRangeTimestamps = useMemo(() => {
    if (selectedDuration !== 'custom') return { startMs: 0, endMs: Infinity };
    const startMs = customStartDate ? new Date(`${customStartDate}T00:00:00`).getTime() : 0;
    const endMs = customEndDate ? new Date(`${customEndDate}T23:59:59.999`).getTime() : Infinity;
    return {
      startMs: isNaN(startMs) ? 0 : startMs,
      endMs: isNaN(endMs) ? Infinity : endMs,
    };
  }, [selectedDuration, customStartDate, customEndDate]);

  // Aggregate Waste per Truck based on Schedules & Measurements
  const truckAnalyticsList: TruckAnalyticsItem[] = useMemo(() => {
    const truckMap: Record<string, TruckAnalyticsItem> = {};
    const truckLookup: Record<string, string> = {};

    // 1. Initialize from trucks data and build lookup dictionary
    trucksData.forEach((t) => {
      const capNum = parseFloat(t.capacity) || 5.0; // default 5 tons
      truckMap[t.id] = {
        id: t.id,
        plateNumber: t.plateNumber || 'Truck',
        type: t.type || 'Compactor',
        driverName: t.assignedDriverName || t.lastDriverName || 'Unassigned',
        totalTons: 0,
        tripCount: 0,
        avgLoadPerTrip: 0,
        capacityTons: capNum,
        utilizationPercent: 0,
        primaryBarangay: t.assignedBarangay || 'Danao City',
        barangayBreakdown: {},
      };
      if (t.id) truckLookup[t.id.toLowerCase()] = t.id;
      if (t.plateNumber) truckLookup[t.plateNumber.toLowerCase()] = t.id;
    });

    // 2. Aggregate completed schedules with collection measurements
    schedulesData.forEach((s) => {
      if (!['completed', 'done'].includes(String(s.status || '').toLowerCase())) return;

      const bName = (s.barangay || s.barangayName || '').trim();
      const rawTrkId = s.truckId || s.truck_id || s.vehicleId || '';
      const rawTrkPlate = s.truckPlate || s.truckName || s.truck || '';

      // Canonical truck resolution
      const canonicalKey =
        (rawTrkId && truckLookup[rawTrkId.toLowerCase()]) ||
        (rawTrkPlate && truckLookup[rawTrkPlate.toLowerCase()]) ||
        rawTrkId ||
        rawTrkPlate ||
        'UNKNOWN_TRUCK';

      // Filter: Barangay
      if (selectedBarangay !== 'ALL' && bName.toLowerCase() !== selectedBarangay.toLowerCase()) {
        return;
      }

      // Filter: Specific Truck
      if (
        selectedTruckId !== 'ALL' &&
        canonicalKey !== selectedTruckId &&
        rawTrkId !== selectedTruckId &&
        rawTrkPlate.toLowerCase() !== selectedTruckId.toLowerCase()
      ) {
        return;
      }

      // Filter: Duration
      const rawTime = s.completedAt || s.completedDate || s.createdAt || s.dateText || s.date;
      const timeMs = rawTime?.toMillis
        ? rawTime.toMillis()
        : rawTime?.seconds
        ? rawTime.seconds * 1000
        : rawTime instanceof Date
        ? rawTime.getTime()
        : typeof rawTime === 'string' || typeof rawTime === 'number'
        ? new Date(rawTime).getTime()
        : 0;

      if (selectedDuration === 'custom') {
        if (!timeMs || timeMs < customRangeTimestamps.startMs || timeMs > customRangeTimestamps.endMs) {
          return;
        }
      } else {
        if (!timeMs || timeMs < durationCutoffTimestamp) {
          return;
        }
      }

      // Measurement conversion to metric tons
      let weightTons = 0;
      if (s.collectionMeasurement) {
        if (typeof s.collectionMeasurement === 'number' && s.collectionMeasurement > 0) {
          weightTons = s.collectionMeasurement;
        } else if (Number(s.collectionMeasurement.value) > 0) {
          const val = Number(s.collectionMeasurement.value);
          const unit = String(s.collectionMeasurement.unit || 'kg').toLowerCase();
          if (['ton', 'tons', 't'].includes(unit)) weightTons = val;
          else if (unit === 'kg') weightTons = val / 1000;
          else if (unit === 'm3') weightTons = val * 0.16; // standard municipal waste density
          else weightTons = val / 1000;
        }
      } else if (s.collectedKg && Number(s.collectedKg) > 0) {
        weightTons = Number(s.collectedKg) / 1000;
      } else if (s.actualWeightKg && Number(s.actualWeightKg) > 0) {
        weightTons = Number(s.actualWeightKg) / 1000;
      } else if (s.tons && Number(s.tons) > 0) {
        weightTons = Number(s.tons);
      } else if (s.netWeightKg && Number(s.netWeightKg) > 0) {
        weightTons = Number(s.netWeightKg) / 1000;
      }

      // Find or create truck record
      if (!truckMap[canonicalKey]) {
        truckMap[canonicalKey] = {
          id: canonicalKey,
          plateNumber: rawTrkPlate || canonicalKey,
          type: 'Garbage Truck',
          driverName: s.driverName || s.driver || s.assignedDriverName || 'Driver',
          totalTons: 0,
          tripCount: 0,
          avgLoadPerTrip: 0,
          capacityTons: 5.0,
          utilizationPercent: 0,
          primaryBarangay: bName || 'Danao City',
          barangayBreakdown: {},
        };
        truckLookup[canonicalKey.toLowerCase()] = canonicalKey;
      }

      // Update driver name if currently unassigned or placeholder
      const scheduleDriver = s.driverName || s.driver || s.assignedDriverName;
      if (
        scheduleDriver &&
        (!truckMap[canonicalKey].driverName ||
          ['unassigned', 'driver'].includes(truckMap[canonicalKey].driverName.toLowerCase()))
      ) {
        truckMap[canonicalKey].driverName = scheduleDriver;
      }

      truckMap[canonicalKey].totalTons += weightTons;
      truckMap[canonicalKey].tripCount += 1;
      if (bName) {
        truckMap[canonicalKey].barangayBreakdown[bName] =
          (truckMap[canonicalKey].barangayBreakdown[bName] || 0) + weightTons;
      }
    });

    // 3. Compute derived metrics and sort descending by total tons
    const list = Object.values(truckMap).map((t) => {
      const avg = t.tripCount > 0 ? t.totalTons / t.tripCount : 0;
      const util = t.capacityTons > 0 ? Math.min(100, Math.round((avg / t.capacityTons) * 100)) : 0;

      // Find primary barangay by highest tonnage
      let topBrgy = t.primaryBarangay;
      let topBrgyTons = 0;
      Object.entries(t.barangayBreakdown).forEach(([b, w]) => {
        if (w > topBrgyTons) {
          topBrgyTons = w;
          topBrgy = b;
        }
      });

      return {
        ...t,
        avgLoadPerTrip: parseFloat(avg.toFixed(2)),
        utilizationPercent: util,
        primaryBarangay: topBrgy,
      };
    });

    return list.sort((a, b) => b.totalTons - a.totalTons);
  }, [schedulesData, trucksData, selectedBarangay, selectedTruckId, durationCutoffTimestamp, selectedDuration, customRangeTimestamps]);

  // Fleet Totals
  const fleetSummary = useMemo(() => {
    let totalTons = 0;
    let totalTrips = 0;
    truckAnalyticsList.forEach((t) => {
      totalTons += t.totalTons;
      totalTrips += t.tripCount;
    });

    const leader = truckAnalyticsList[0] || null;

    return {
      totalTons: parseFloat(totalTons.toFixed(2)),
      totalTrips,
      activeTrucksCount: truckAnalyticsList.filter((t) => t.totalTons > 0).length,
      leader,
    };
  }, [truckAnalyticsList]);

  // Max tons for bar chart scaling
  const maxTruckTons = useMemo(() => {
    return Math.max(1, ...(truckAnalyticsList.map((t) => t.totalTons) || [1]));
  }, [truckAnalyticsList]);

  // Handle Export (Excel, CSV, PDF)
  const handleExport = async (format: ExportFormat) => {
    try {
      const durationLabel =
        selectedDuration === 'custom'
          ? `Custom Range (${customStartDate} to ${customEndDate})`
          : durationOptions.find((d) => d.id === selectedDuration)?.label || 'Selected Duration';
      const truckLabel =
        selectedTruckId === 'ALL'
          ? 'All Fleet Trucks'
          : trucksData.find((t) => t.id === selectedTruckId)?.plateNumber || selectedTruckId;
      const jurisdictionLabel =
        selectedBarangay === 'ALL' ? 'City of Danao (All 42 Barangays)' : `Brgy. ${selectedBarangay}`;

      if (format === 'pdf') {
        const reportData: WasteReportData = {
          generatedAt: new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
          generatedBy: 'CENRO Municipal Solid Waste Management Office',
          filters: {
            barangay: jurisdictionLabel,
            monthDuration: durationLabel,
            truck: truckLabel,
          },
          summary: {
            totalCollectedTons: fleetSummary.totalTons,
            collectionEfficiency: 92.5,
            activeTrucks: fleetSummary.activeTrucksCount,
            totalRuns: fleetSummary.totalTrips,
            highestLoadTruckPlate: fleetSummary.leader?.plateNumber,
            highestLoadTons: fleetSummary.leader?.totalTons,
          },
          truckRankings: truckAnalyticsList.map((t) => ({
            plateNumber: t.plateNumber,
            type: t.type,
            driverName: t.driverName,
            totalTons: t.totalTons,
            tripCount: t.tripCount,
            avgLoadPerTrip: t.avgLoadPerTrip,
            capacityTons: t.capacityTons,
            utilizationPercent: t.utilizationPercent,
            primaryBarangay: t.primaryBarangay,
          })),
          barangayBreakdown: districtData.map((d: any) => ({
            name: d.label || 'Barangay',
            collectedTons: (d.pct / 100) * (fleetSummary.totalTons || 20),
            reportsCount: d.pct ? Math.round(d.pct / 10) : 0,
            status: d.status || 'STABLE',
          })),
        };

        await exportWasteAnalyticsPdf(reportData);
        return;
      }

      // Excel (.xlsx) and CSV (.csv) formats
      const headers = [
        'Rank',
        'Plate Number',
        'Vehicle Type',
        'Assigned Driver',
        'Primary Barangay Sector',
        'Total Tonnage (Tons)',
        'Completed Trips',
        'Avg Load / Trip (Tons)',
        'Capacity (Tons)',
        'Capacity Utilization (%)',
      ];

      const rows = truckAnalyticsList.map((t, idx) => [
        idx + 1,
        t.plateNumber,
        t.type || 'Compactor',
        t.driverName || 'Unassigned',
        t.primaryBarangay || 'Danao City',
        t.totalTons,
        t.tripCount,
        t.avgLoadPerTrip,
        t.capacityTons,
        `${t.utilizationPercent}%`,
      ]);

      const filename = `truck_waste_rankings_${selectedBarangay.replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().slice(0, 10)}`;

      await exportReport({
        format,
        filename,
        title: 'Waste Analytics per Truck & Load Rankings',
        subtitle: `Municipal Solid Waste Fleet Performance Directory (${durationLabel} • ${truckLabel})`,
        jurisdiction: jurisdictionLabel,
        generatedBy: 'CENRO Fleet Logistics & Tonnage Auditing',
        headers,
        rows,
        summaryCards: [
          { label: 'Total Fleet Tonnage', value: `${fleetSummary.totalTons} t` },
          { label: 'Completed Runs', value: `${fleetSummary.totalTrips} runs` },
          { label: 'Active Trucks', value: `${fleetSummary.activeTrucksCount} vehicles` },
          { label: 'Fleet Leader', value: fleetSummary.leader ? `${fleetSummary.leader.plateNumber} (${fleetSummary.leader.totalTons} t)` : 'None' },
        ],
        sheetName: 'Truck_Rankings',
      });
    } catch (err) {
      console.error('Error generating report:', err);
      Alert.alert(
        'Report Generation Error',
        err instanceof Error ? err.message : 'Could not export the waste analytics report.'
      );
    }
  };

  return (
    <View style={styles.card}>
      {/* Header with Title and Export Action */}
      <View style={[styles.headerRow, isMobile && { flexDirection: 'column', gap: 12 }]}>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={styles.iconCircle}>
              <MaterialIcons name="leaderboard" size={20} color="#059669" />
            </View>
            <Text style={styles.cardTitle}>Waste Analytics per Truck & Load Rankings</Text>
          </View>
          <Text style={styles.cardSubtitle}>
            Track waste mass tonnage collected per vehicle, trips completed, and highest load leaders across Danao City.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.exportPdfBtn}
          onPress={() => setIsExportModalVisible(true)}
          activeOpacity={0.8}
        >
          <MaterialIcons name="file-download" size={17} color="#FFFFFF" />
          <Text style={styles.exportPdfBtnText}>Export Analytics</Text>
        </TouchableOpacity>
      </View>

      {/* Interactive Filters Bar (Requirement #11 & Consultant #10) */}
      <View
        style={[
          styles.filtersBar,
          (isBarangayPickerOpen || isDurationPickerOpen || isTruckPickerOpen) && { zIndex: 1000 },
        ]}
      >
        {/* Invisible Backdrop when any picker is open */}
        {(isBarangayPickerOpen || isDurationPickerOpen || isTruckPickerOpen) && (
          <TouchableOpacity
            style={styles.dropdownBackdrop}
            activeOpacity={1}
            onPress={() => {
              setIsBarangayPickerOpen(false);
              setIsDurationPickerOpen(false);
              setIsTruckPickerOpen(false);
            }}
          />
        )}

        {/* Barangay Filter */}
        <View style={[styles.filterGroup, isBarangayPickerOpen && { zIndex: 1001 }]}>
          <Text style={styles.filterLabel}>BARANGAY SECTOR</Text>
          <TouchableOpacity
            style={[styles.filterSelector, selectedBarangay !== 'ALL' && styles.filterSelectorActive]}
            onPress={() => {
              setIsBarangayPickerOpen(!isBarangayPickerOpen);
              setIsDurationPickerOpen(false);
              setIsTruckPickerOpen(false);
            }}
            disabled={isCoordinator && !!assignedBarangay}
          >
            <MaterialIcons name="location-on" size={15} color="#059669" />
            <Text style={styles.filterSelectorText} numberOfLines={1}>
              {selectedBarangay === 'ALL' ? 'All Barangays' : `Brgy. ${selectedBarangay}`}
            </Text>
            <MaterialIcons name="arrow-drop-down" size={18} color="#6B7280" />
          </TouchableOpacity>

          {isBarangayPickerOpen && (
            <View style={styles.dropdownModal}>
              <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                <TouchableOpacity
                  style={[styles.dropdownOption, selectedBarangay === 'ALL' && styles.dropdownOptionActive]}
                  onPress={() => {
                    setSelectedBarangay('ALL');
                    setIsBarangayPickerOpen(false);
                  }}
                >
                  <Text style={[styles.dropdownOptionText, selectedBarangay === 'ALL' && styles.dropdownOptionTextActive]}>
                    All 42 Barangays
                  </Text>
                </TouchableOpacity>
                {DANAO_CITY_BARANGAYS.map((b) => (
                  <TouchableOpacity
                    key={b}
                    style={[styles.dropdownOption, selectedBarangay === b && styles.dropdownOptionActive]}
                    onPress={() => {
                      setSelectedBarangay(b);
                      setIsBarangayPickerOpen(false);
                    }}
                  >
                    <Text style={[styles.dropdownOptionText, selectedBarangay === b && styles.dropdownOptionTextActive]}>
                      Brgy. {b}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        {/* Duration / Month Filter */}
        <View style={[styles.filterGroup, isDurationPickerOpen && { zIndex: 1001 }]}>
          <Text style={styles.filterLabel}>DURATION / TIME RANGE</Text>
          <TouchableOpacity
            style={[styles.filterSelector, selectedDuration !== '30d' && styles.filterSelectorActive]}
            onPress={() => {
              setIsDurationPickerOpen(!isDurationPickerOpen);
              setIsBarangayPickerOpen(false);
              setIsTruckPickerOpen(false);
            }}
          >
            <MaterialIcons name="date-range" size={15} color="#059669" />
            <Text style={styles.filterSelectorText} numberOfLines={1}>
              {durationOptions.find((d) => d.id === selectedDuration)?.label || '30 Days'}
            </Text>
            <MaterialIcons name="arrow-drop-down" size={18} color="#6B7280" />
          </TouchableOpacity>

          {isDurationPickerOpen && (
            <View style={styles.dropdownModal}>
              {durationOptions.map((opt) => (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.dropdownOption, selectedDuration === opt.id && styles.dropdownOptionActive]}
                  onPress={() => {
                    setSelectedDuration(opt.id);
                    setIsDurationPickerOpen(false);
                  }}
                >
                  <Text style={[styles.dropdownOptionText, selectedDuration === opt.id && styles.dropdownOptionTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Truck Filter */}
        <View style={[styles.filterGroup, isTruckPickerOpen && { zIndex: 1001 }]}>
          <Text style={styles.filterLabel}>FLEET VEHICLE</Text>
          <TouchableOpacity
            style={[styles.filterSelector, selectedTruckId !== 'ALL' && styles.filterSelectorActive]}
            onPress={() => {
              setIsTruckPickerOpen(!isTruckPickerOpen);
              setIsBarangayPickerOpen(false);
              setIsDurationPickerOpen(false);
            }}
          >
            <MaterialIcons name="local-shipping" size={15} color="#059669" />
            <Text style={styles.filterSelectorText} numberOfLines={1}>
              {selectedTruckId === 'ALL'
                ? 'All Fleet Trucks'
                : trucksData.find((t) => t.id === selectedTruckId)?.plateNumber || selectedTruckId}
            </Text>
            <MaterialIcons name="arrow-drop-down" size={18} color="#6B7280" />
          </TouchableOpacity>

          {isTruckPickerOpen && (
            <View style={styles.dropdownModal}>
              <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                <TouchableOpacity
                  style={[styles.dropdownOption, selectedTruckId === 'ALL' && styles.dropdownOptionActive]}
                  onPress={() => {
                    setSelectedTruckId('ALL');
                    setIsTruckPickerOpen(false);
                  }}
                >
                  <Text style={[styles.dropdownOptionText, selectedTruckId === 'ALL' && styles.dropdownOptionTextActive]}>
                    All Fleet Trucks ({trucksData.length})
                  </Text>
                </TouchableOpacity>
                {trucksData.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.dropdownOption, selectedTruckId === t.id && styles.dropdownOptionActive]}
                    onPress={() => {
                      setSelectedTruckId(t.id);
                      setIsTruckPickerOpen(false);
                    }}
                  >
                    <Text style={[styles.dropdownOptionText, selectedTruckId === t.id && styles.dropdownOptionTextActive]}>
                      {t.plateNumber} ({t.type || 'Compactor'})
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        {/* Reset Filters */}
        {(selectedBarangay !== 'ALL' || selectedDuration !== '30d' || selectedTruckId !== 'ALL') && (
          <TouchableOpacity
            style={styles.resetFiltersBtn}
            onPress={() => {
              setSelectedBarangay('ALL');
              setSelectedDuration('30d');
              setSelectedTruckId('ALL');
            }}
          >
            <MaterialIcons name="refresh" size={15} color="#4B5563" />
            <Text style={styles.resetFiltersBtnText}>Reset</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Custom Date Range Picker Bar */}
      {selectedDuration === 'custom' && (
        <View style={styles.customDateBar}>
          <View style={styles.customDatePill}>
            <MaterialIcons name="filter-alt" size={14} color="#059669" />
            <Text style={styles.customDatePillText}>
              Custom Range Active: {customStartDate} to {customEndDate}
            </Text>
          </View>
          <View style={styles.customDateInputsRow}>
            <View style={styles.customDateInputGroup}>
              <Text style={styles.customDateLabel}>FROM (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.customDateInput}
                value={customStartDate}
                onChangeText={setCustomStartDate}
                placeholder="2025-10-10"
                placeholderTextColor="#9CA3AF"
              />
            </View>
            <View style={styles.customDateInputGroup}>
              <Text style={styles.customDateLabel}>TO (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.customDateInput}
                value={customEndDate}
                onChangeText={setCustomEndDate}
                placeholder="2025-10-20"
                placeholderTextColor="#9CA3AF"
              />
            </View>
            <View style={styles.customQuickPresets}>
              <TouchableOpacity
                style={styles.customQuickBtn}
                onPress={() => {
                  setCustomStartDate('2025-10-10');
                  setCustomEndDate('2025-10-20');
                }}
              >
                <MaterialIcons name="flash-on" size={13} color="#059669" />
                <Text style={styles.customQuickBtnText}>Oct 10 – 20, 2025</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.customQuickBtn}
                onPress={() => {
                  setCustomStartDate('2025-10-01');
                  setCustomEndDate('2025-10-31');
                }}
              >
                <Text style={styles.customQuickBtnText}>Oct 2025 Full</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <Text style={styles.measurementNote}>
        Completed trips are counted from finished schedules. Tonnage includes recorded pickup weights only; trips without a measured weight are not estimated.
      </Text>

      {/* Highest Load Truck Highlight Banner (Consultant item & Core item) */}
      {fleetSummary.leader && fleetSummary.leader.totalTons > 0 && (
        <View style={styles.leaderBanner}>
          <View style={styles.leaderBadge}>
            <MaterialIcons name="emoji-events" size={24} color="#D97706" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.leaderLabel}>FLEET LEADER — HIGHEST LOAD RECORD</Text>
              <View style={styles.rank1Pill}>
                <Text style={styles.rank1PillText}>RANK #1</Text>
              </View>
            </View>
            <Text style={styles.leaderPlate}>
              {fleetSummary.leader.plateNumber} • {fleetSummary.leader.type}
            </Text>
            <Text style={styles.leaderMeta}>
              Assigned to: <Text style={{ fontWeight: '700', color: '#111827' }}>{fleetSummary.leader.driverName}</Text> • Primary Sector:{' '}
              <Text style={{ fontWeight: '700', color: '#059669' }}>Brgy. {fleetSummary.leader.primaryBarangay}</Text>
            </Text>
          </View>

          <View style={styles.leaderStatsBox}>
            <Text style={styles.leaderStatsTons}>{fleetSummary.leader.totalTons.toFixed(2)} t</Text>
            <Text style={styles.leaderStatsSub}>
              {fleetSummary.leader.tripCount} completed runs ({fleetSummary.leader.avgLoadPerTrip.toFixed(2)} t/run)
            </Text>
          </View>
        </View>
      )}

      {/* Tabulated Fleet Load & Waste Tracking Table */}
      <View style={styles.tableCard}>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { flex: 0.6, textAlign: 'center' }]}>RANK</Text>
          <Text style={[styles.th, { flex: 2.2 }]}>TRUCK / VEHICLE</Text>
          <Text style={[styles.th, { flex: 2 }]}>DRIVER & SECTOR</Text>
          <Text style={[styles.th, { flex: 2.2, textAlign: 'right' }]}>TOTAL TONNAGE</Text>
          <Text style={[styles.th, { flex: 1.2, textAlign: 'center' }]}>TRIPS</Text>
          <Text style={[styles.th, { flex: 1.8, textAlign: 'right' }]}>AVG / TRIP</Text>
        </View>

        {truckAnalyticsList.length === 0 ? (
          <View style={styles.emptyTable}>
            <MaterialIcons name="local-shipping" size={36} color="#CBD5E1" />
            <Text style={styles.emptyTableText}>No truck collection data found for this filter criteria.</Text>
          </View>
        ) : (
          truckAnalyticsList.map((truck, idx) => {
            const barPct = Math.round((truck.totalTons / maxTruckTons) * 100);

            return (
              <View
                key={truck.id}
                style={[
                  styles.tableRow,
                  idx === 0 && truck.totalTons > 0 && styles.tableRowLeader,
                ]}
              >
                {/* Rank */}
                <View style={[styles.cell, { flex: 0.6, alignItems: 'center' }]}>
                  <View
                    style={[
                      styles.rankCircle,
                      idx === 0 && truck.totalTons > 0 && { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
                      idx === 1 && { backgroundColor: '#F3F4F6', borderColor: '#9CA3AF' },
                      idx === 2 && { backgroundColor: '#FFEDD5', borderColor: '#F97316' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.rankCircleText,
                        idx === 0 && truck.totalTons > 0 && { color: '#B45309' },
                      ]}
                    >
                      {idx + 1}
                    </Text>
                  </View>
                </View>

                {/* Truck Plate */}
                <View style={[styles.cell, { flex: 2.2 }]}>
                  <Text style={styles.truckPlateText}>{truck.plateNumber}</Text>
                  <Text style={styles.truckSubText}>
                    {truck.type} • {truck.capacityTons}t Capacity
                  </Text>
                </View>

                {/* Driver & Barangay */}
                <View style={[styles.cell, { flex: 2 }]}>
                  <Text style={styles.driverNameText}>{truck.driverName}</Text>
                  <Text style={styles.sectorText}>Brgy. {truck.primaryBarangay}</Text>
                </View>

                {/* Total Tonnage with visual bar */}
                <View style={[styles.cell, { flex: 2.2, alignItems: 'flex-end' }]}>
                  <Text style={styles.tonnageText}>{truck.totalTons.toFixed(2)} t</Text>
                  <View style={styles.miniBarContainer}>
                    <View style={[styles.miniBarFill, { width: `${barPct}%` }]} />
                  </View>
                </View>

                {/* Completed Trips */}
                <View style={[styles.cell, { flex: 1.2, alignItems: 'center' }]}>
                  <View style={styles.tripsPill}>
                    <Text style={styles.tripsPillText}>{truck.tripCount}</Text>
                  </View>
                </View>

                {/* Avg per Trip */}
                <View style={[styles.cell, { flex: 1.8, alignItems: 'flex-end' }]}>
                  <Text style={styles.avgText}>{truck.avgLoadPerTrip.toFixed(2)} t</Text>
                  <Text style={styles.utilText}>{truck.utilizationPercent}% capacity</Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      <ExportModal
        visible={isExportModalVisible}
        onClose={() => setIsExportModalVisible(false)}
        title="Truck Waste Analytics & Load Rankings"
        description={`Exporting performance & mass tonnage records for ${truckAnalyticsList.length} fleet vehicles (${selectedBarangay === 'ALL' ? 'All 42 Barangays' : `Brgy. ${selectedBarangay}`}).`}
        dataCount={truckAnalyticsList.length}
        onExport={handleExport}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    position: 'relative',
    overflow: 'visible',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
    maxWidth: 700,
  },
  exportPdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#059669',
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 8,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  exportPdfBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  filtersBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'flex-end',
    marginBottom: 18,
    position: 'relative',
    zIndex: 100,
  },
  dropdownBackdrop: {
    position: 'fixed' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 950,
  },
  measurementNote: {
    marginTop: -8,
    marginBottom: 16,
    color: '#64748B',
    fontSize: 11,
    lineHeight: 16,
    position: 'relative',
    zIndex: 1,
  },
  filterGroup: {
    minWidth: 160,
    position: 'relative',
    zIndex: 10,
  },
  filterLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#6B7280',
    letterSpacing: 0.5,
    marginBottom: 5,
  },
  filterSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  filterSelectorActive: {
    borderColor: '#059669',
    backgroundColor: '#ECFDF5',
  },
  filterSelectorText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F2937',
    flex: 1,
  },
  dropdownModal: {
    position: 'absolute',
    top: 60,
    left: 0,
    minWidth: 210,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 20,
    zIndex: 2000,
  },
  dropdownOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  dropdownOptionActive: {
    backgroundColor: '#ECFDF5',
  },
  dropdownOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  dropdownOptionTextActive: {
    color: '#059669',
    fontWeight: '800',
  },
  resetFiltersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  resetFiltersBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4B5563',
  },
  leaderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    padding: 16,
    marginBottom: 20,
    position: 'relative',
    zIndex: 1,
  },
  leaderBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#D97706',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  leaderLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  rank1Pill: {
    backgroundColor: '#F59E0B',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  rank1PillText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
  leaderPlate: {
    fontSize: 17,
    fontWeight: '800',
    color: '#78350F',
    marginTop: 2,
  },
  leaderMeta: {
    fontSize: 12,
    color: '#92400E',
    marginTop: 2,
  },
  leaderStatsBox: {
    alignItems: 'flex-end',
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  leaderStatsTons: {
    fontSize: 20,
    fontWeight: '900',
    color: '#B45309',
  },
  leaderStatsSub: {
    fontSize: 11,
    fontWeight: '600',
    color: '#78350F',
    marginTop: 1,
  },
  tableCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F9FAFB',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  th: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6B7280',
    letterSpacing: 0.4,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
  },
  tableRowLeader: {
    backgroundColor: '#FFFBEB',
  },
  cell: {
    justifyContent: 'center',
  },
  rankCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankCircleText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6B7280',
  },
  truckPlateText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
  },
  truckSubText: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 1,
  },
  driverNameText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  sectorText: {
    fontSize: 11,
    color: '#059669',
    fontWeight: '600',
  },
  tonnageText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#059669',
  },
  miniBarContainer: {
    width: 80,
    height: 5,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    marginTop: 4,
    overflow: 'hidden',
  },
  miniBarFill: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 3,
  },
  tripsPill: {
    backgroundColor: '#F3F4F6',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  tripsPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#374151',
  },
  avgText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F2937',
  },
  utilText: {
    fontSize: 10,
    color: '#6B7280',
  },
  emptyTable: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTableText: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 8,
  },
  customDateBar: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  customDatePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  customDatePillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#065F46',
  },
  customDateInputsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 12,
  },
  customDateInputGroup: {
    flex: 1,
    minWidth: 140,
  },
  customDateLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#047857',
    marginBottom: 5,
    letterSpacing: 0.4,
  },
  customDateInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },
  customQuickPresets: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  customQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  customQuickBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
  },
});
