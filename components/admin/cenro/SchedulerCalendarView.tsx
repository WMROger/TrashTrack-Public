import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { MaterialIcons, FontAwesome5 } from '@expo/vector-icons';

interface ScheduleItem {
  id: string;
  barangayName: string;
  days?: string[];
  dayTimes?: Record<string, string>;
  time?: string;
  truck?: string;
  truckName?: string;
  wasteCategory?: string;
  streetName?: string;
  zone?: string;
  specificDate?: string;
  [key: string]: any;
}

interface SchedulerCalendarViewProps {
  schedules: ScheduleItem[];
  trucksList: any[];
  isCoordinator?: boolean;
  assignedBarangay?: string;
  onSelectSchedule?: (schedule: ScheduleItem) => void;
  onEditSchedule?: (schedule: ScheduleItem) => void;
  onAddScheduleForDate?: (dateStr: string, dayOfWeekAbbr: string) => void;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const CATEGORY_COLORS: Record<string, { bg: string; text: string; dot: string; icon: string }> = {
  BIODEGRADABLE: { bg: '#DCFCE7', text: '#15803D', dot: '#22C55E', icon: 'eco' },
  'NON-BIODEGRADABLE': { bg: '#DBEAFE', text: '#1D4ED8', dot: '#2563EB', icon: 'delete-outline' },
  RECYCLABLE: { bg: '#FEF9C3', text: '#A16207', dot: '#EAB308', icon: 'autorenew' },
  RESIDUAL: { bg: '#F3F4F6', text: '#4B5563', dot: '#6B7280', icon: 'restore-from-trash' },
  HAZARDOUS: { bg: '#FEE2E2', text: '#B91C1C', dot: '#EF4444', icon: 'warning' },
  'SPECIAL/BULK': { bg: '#F3E8FF', text: '#7E22CE', dot: '#A855F7', icon: 'inventory-2' },
};

function normalizeDayStr(d: string): string {
  const clean = String(d || '').trim().toUpperCase();
  if (clean.startsWith('MON')) return 'MON';
  if (clean.startsWith('TUE')) return 'TUE';
  if (clean.startsWith('WED')) return 'WED';
  if (clean.startsWith('THU')) return 'THU';
  if (clean.startsWith('FRI')) return 'FRI';
  if (clean.startsWith('SAT')) return 'SAT';
  if (clean.startsWith('SUN')) return 'SUN';
  return clean;
}

export default function SchedulerCalendarView({
  schedules,
  trucksList,
  isCoordinator = false,
  assignedBarangay = '',
  onSelectSchedule,
  onEditSchedule,
  onAddScheduleForDate,
}: SchedulerCalendarViewProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const today = useMemo(() => new Date(), []);
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth()); // 0-11
  const [selectedDate, setSelectedDate] = useState<Date>(today);

  // Filter schedules if coordinator is locked
  const relevantSchedules = useMemo(() => {
    if (!isCoordinator || !assignedBarangay) return schedules;
    const target = assignedBarangay.trim().toLowerCase();
    return schedules.filter(
      (s) => (s.barangayName || '').trim().toLowerCase() === target
    );
  }, [schedules, isCoordinator, assignedBarangay]);

  // Navigate Months
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleGoToday = () => {
    setCurrentMonth(today.getMonth());
    setCurrentYear(today.getFullYear());
    setSelectedDate(today);
  };

  // Helper to test if a schedule serves a specific date
  const getSchedulesForDate = (date: Date): ScheduleItem[] => {
    const dayOfWeekAbbr = WEEKDAYS[date.getDay()];
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    return relevantSchedules.filter((s) => {
      // 1. One-time specific date match
      if (s.specificDate && s.specificDate === dateStr) {
        return true;
      }
      // 2. Recurring day of week match
      const days = Array.isArray(s.days) ? s.days : [];
      return days.some((d) => normalizeDayStr(d) === dayOfWeekAbbr);
    });
  };

  // Build Calendar Days for the Month
  const calendarCells = useMemo(() => {
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const startingDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sun
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const buildCell = (d: Date, isCurrentMonth: boolean, dayNumber: number) => {
      const scheds = getSchedulesForDate(d);
      const uniqueBrgys = new Set(scheds.map((s) => (s.barangayName || '').trim())).size;
      const uniqueRoutes = Array.from(
        new Set(
          scheds
            .map((s) => (s.streetName || s.zone || 'Whole Barangay').trim())
            .filter(Boolean)
        )
      );
      return {
        date: d,
        isCurrentMonth,
        dayNumber,
        schedules: scheds,
        uniqueBarangaysCount: uniqueBrgys,
        routes: uniqueRoutes,
        routesCount: uniqueRoutes.length > 0 ? uniqueRoutes.length : scheds.length,
      };
    };

    // Previous month filler days
    const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();
    const cells: ReturnType<typeof buildCell>[] = [];

    // Leading days
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - 1, prevMonthDays - i);
      cells.push(buildCell(d, false, d.getDate()));
    }

    // Days in current month
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(currentYear, currentMonth, day);
      cells.push(buildCell(d, true, day));
    }

    // Trailing days to complete full 7-day grid rows (35 or 42)
    const remaining = (7 - (cells.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(currentYear, currentMonth + 1, i);
      cells.push(buildCell(d, false, i));
    }

    return cells;
  }, [currentYear, currentMonth, relevantSchedules]);

  // Selected Date Schedules and Barangay Aggregations
  const selectedDateSchedules = useMemo(() => {
    return getSchedulesForDate(selectedDate);
  }, [selectedDate, relevantSchedules]);

  // Group selected date schedules by Barangay
  const selectedDateBarangayGroups = useMemo(() => {
    const groups: Record<string, ScheduleItem[]> = {};
    selectedDateSchedules.forEach((s) => {
      const b = (s.barangayName || 'Unassigned Barangay').trim();
      if (!groups[b]) groups[b] = [];
      groups[b].push(s);
    });
    return groups;
  }, [selectedDateSchedules]);

  // Total unique routes/streets for selected date
  const selectedDateTotalRoutes = useMemo(() => {
    const set = new Set<string>();
    selectedDateSchedules.forEach((s) => {
      const name = (s.streetName || s.zone || 'Whole Barangay').trim();
      if (name) set.add(name);
    });
    return set.size > 0 ? set.size : selectedDateSchedules.length;
  }, [selectedDateSchedules]);

  const monthName = new Date(currentYear, currentMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const formattedSelectedDate = selectedDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const selectedDateDayAbbr = WEEKDAYS[selectedDate.getDay()];
  const selectedDateStr = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;

  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  return (
    <View style={styles.container}>
      {/* Calendar Header Navigation */}
      <View style={[styles.calendarHeader, isMobile && { flexDirection: 'column', gap: 12 }]}>
        <View style={styles.headerTitleGroup}>
          <MaterialIcons name="calendar-month" size={26} color="#059669" />
          <View>
            <Text style={styles.monthTitle}>{monthName}</Text>
            <Text style={styles.monthSubtitle}>
              {isCoordinator
                ? `Click any date to see scheduled collection routes & puroks for Brgy. ${assignedBarangay || 'your barangay'}`
                : 'Click any date to see scheduled collection barangays'}
            </Text>
          </View>
        </View>

        <View style={styles.navControls}>
          <TouchableOpacity style={styles.todayBtn} onPress={handleGoToday} activeOpacity={0.8}>
            <MaterialIcons name="today" size={16} color="#059669" />
            <Text style={styles.todayBtnText}>Today</Text>
          </TouchableOpacity>
          <View style={styles.navArrows}>
            <TouchableOpacity style={styles.arrowBtn} onPress={handlePrevMonth} activeOpacity={0.8}>
              <MaterialIcons name="chevron-left" size={24} color="#374151" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.arrowBtn} onPress={handleNextMonth} activeOpacity={0.8}>
              <MaterialIcons name="chevron-right" size={24} color="#374151" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Weekday Labels */}
      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((day, idx) => (
          <View key={day} style={styles.weekdayCell}>
            <Text
              style={[
                styles.weekdayText,
                (idx === 0 || idx === 6) && { color: '#9CA3AF' },
              ]}
            >
              {day}
            </Text>
          </View>
        ))}
      </View>

      {/* Calendar Grid */}
      <View style={styles.grid}>
        {calendarCells.map((cell, idx) => {
          const isSelected = isSameDay(cell.date, selectedDate);
          const isCurrentToday = isSameDay(cell.date, today);
          const hasSchedules = isCoordinator
            ? cell.routesCount > 0
            : cell.uniqueBarangaysCount > 0;

          // Unique categories in this day
          const categories = Array.from(
            new Set(cell.schedules.map((s) => s.wasteCategory || 'BIODEGRADABLE'))
          );

          return (
            <TouchableOpacity
              key={`${cell.date.toISOString()}_${idx}`}
              style={[
                styles.dayCell,
                !cell.isCurrentMonth && styles.dayCellOtherMonth,
                isSelected && styles.dayCellSelected,
                isCurrentToday && !isSelected && styles.dayCellToday,
                isCoordinator && !isMobile && { minHeight: 88 },
              ]}
              onPress={() => setSelectedDate(cell.date)}
              activeOpacity={0.7}
            >
              <View style={styles.dayCellHeader}>
                <View
                  style={[
                    styles.dayNumberBadge,
                    isSelected && styles.dayNumberBadgeSelected,
                    isCurrentToday && !isSelected && styles.dayNumberBadgeToday,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayNumberText,
                      !cell.isCurrentMonth && styles.dayNumberTextOtherMonth,
                      isSelected && styles.dayNumberTextSelected,
                      isCurrentToday && !isSelected && styles.dayNumberTextToday,
                    ]}
                  >
                    {cell.dayNumber}
                  </Text>
                </View>

                {hasSchedules && (
                  <View
                    style={[
                      styles.countBadge,
                      isSelected && { backgroundColor: '#10B981', borderColor: '#059669' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.countBadgeText,
                        isSelected && { color: '#FFFFFF' },
                      ]}
                      numberOfLines={1}
                    >
                      {isCoordinator
                        ? (cell.routesCount === 1 && cell.routes[0] && cell.routes[0].length <= 10
                            ? cell.routes[0]
                            : `${cell.routesCount} ${cell.routesCount === 1 ? 'Route' : 'Routes'}`)
                        : `${cell.uniqueBarangaysCount} ${cell.uniqueBarangaysCount === 1 ? 'Brgy' : 'Brgys'}`}
                    </Text>
                  </View>
                )}
              </View>

              {/* Coordinator: Show Purok / Street items right inside the day cell on desktop */}
              {isCoordinator && hasSchedules && !isMobile && (
                <View style={styles.cellRoutesContainer}>
                  {cell.routes.slice(0, 2).map((rName, rIdx) => {
                    const schedForRoute = cell.schedules.find(
                      (s) => (s.streetName || s.zone || 'Whole Barangay').trim() === rName
                    );
                    const cat = schedForRoute?.wasteCategory || 'BIODEGRADABLE';
                    const dotColor = CATEGORY_COLORS[cat]?.dot || '#10B981';
                    return (
                      <View key={rIdx} style={styles.cellRouteItem}>
                        <View style={[styles.cellRouteDot, { backgroundColor: dotColor }]} />
                        <Text
                          style={[
                            styles.cellRouteText,
                            isSelected && { color: '#065F46', fontWeight: '800' },
                          ]}
                          numberOfLines={1}
                        >
                          {rName}
                        </Text>
                      </View>
                    );
                  })}
                  {cell.routes.length > 2 && (
                    <Text style={styles.cellMoreRoutesText}>
                      +{cell.routes.length - 2} more
                    </Text>
                  )}
                </View>
              )}

              {/* Dots for waste categories */}
              {hasSchedules && (
                <View style={styles.dotsRow}>
                  {categories.slice(0, 4).map((cat, cIdx) => (
                    <View
                      key={cIdx}
                      style={[
                        styles.catDot,
                        { backgroundColor: CATEGORY_COLORS[cat]?.dot || '#10B981' },
                      ]}
                    />
                  ))}
                  {categories.length > 4 && (
                    <Text style={styles.moreDotsText}>+{categories.length - 4}</Text>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Specific Date Served Barangays Section (Requirement #10) */}
      <View style={styles.detailSection}>
        <View style={styles.detailSectionHeader}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <MaterialIcons name="event" size={22} color="#059669" />
              <Text style={styles.detailSectionTitle}>
                {isCoordinator ? 'Routes & Puroks to be Served' : 'Barangays to be Served'}
              </Text>
            </View>
            <Text style={styles.detailSectionDate}>{formattedSelectedDate}</Text>
          </View>

          <View style={styles.detailHeaderActions}>
            <View style={styles.statPill}>
              <MaterialIcons
                name={isCoordinator ? 'alt-route' : 'location-city'}
                size={16}
                color="#059669"
              />
              <Text style={styles.statPillText}>
                {isCoordinator
                  ? `${selectedDateTotalRoutes} ${selectedDateTotalRoutes === 1 ? 'Route / Street' : 'Routes / Streets'}`
                  : `${Object.keys(selectedDateBarangayGroups).length} Barangays`}
              </Text>
            </View>

            {onAddScheduleForDate && (
              <TouchableOpacity
                style={styles.addDateScheduleBtn}
                onPress={() => onAddScheduleForDate(selectedDateStr, selectedDateDayAbbr)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="add-circle" size={16} color="#FFFFFF" />
                <Text style={styles.addDateScheduleBtnText}>
                  {isCoordinator ? 'Add Route For This Date' : 'Add For This Date'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* List of Barangays / Routes Served on this Date */}
        {selectedDateSchedules.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialIcons name="event-busy" size={48} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>No Collections Scheduled</Text>
            <Text style={styles.emptySubtitle}>
              {isCoordinator
                ? `There are no garbage collection routes scheduled for Brgy. ${assignedBarangay || 'your barangay'} on ${formattedSelectedDate}.`
                : `There are no garbage collection routes assigned for ${formattedSelectedDate}.`}
            </Text>
            {onAddScheduleForDate && (
              <TouchableOpacity
                style={styles.emptyAddBtn}
                onPress={() => onAddScheduleForDate(selectedDateStr, selectedDateDayAbbr)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="add" size={18} color="#059669" />
                <Text style={styles.emptyAddBtnText}>
                  {isCoordinator ? 'Schedule Route for This Date' : 'Schedule Collection for This Date'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : isCoordinator ? (
          /* Coordinator View: Individual Route / Purok Cards */
          <View style={styles.barangayListGrid}>
            {selectedDateSchedules.map((sched, sIdx) => {
              const routeTitle = sched.streetName || sched.zone || 'Whole Barangay';
              const pickupTime =
                (sched.dayTimes && sched.dayTimes[selectedDateDayAbbr]) ||
                sched.time ||
                '06:00 AM';
              const truckName = sched.truck || sched.truckName || 'Pending Dispatch';
              const catMeta =
                CATEGORY_COLORS[sched.wasteCategory || 'BIODEGRADABLE'] ||
                CATEGORY_COLORS.BIODEGRADABLE;

              return (
                <View key={sched.id || `${routeTitle}_${sIdx}`} style={styles.barangayCard}>
                  <View style={styles.barangayCardHeader}>
                    <View style={styles.barangayTitleGroup}>
                      <View style={styles.barangayIconBox}>
                        <MaterialIcons name="alt-route" size={20} color="#059669" />
                      </View>
                      <View>
                        <Text style={styles.barangayCardName}>{routeTitle}</Text>
                        <Text style={styles.barangayCardSub}>
                          Brgy. {assignedBarangay || sched.barangayName}{sched.zone ? ` • ${sched.zone}` : ''}
                        </Text>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.catBadge,
                        { backgroundColor: catMeta.bg, borderColor: catMeta.dot },
                      ]}
                    >
                      <MaterialIcons name={catMeta.icon as any} size={13} color={catMeta.text} />
                      <Text style={[styles.catBadgeText, { color: catMeta.text }]}>
                        {sched.wasteCategory || 'BIODEGRADABLE'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.cardDetailsSection}>
                    {/* Time & Shift */}
                    <View style={styles.detailRow}>
                      <View style={styles.detailIconWrapper}>
                        <MaterialIcons name="access-time" size={15} color="#4B5563" />
                      </View>
                      <Text style={styles.detailLabel}>Collection Time:</Text>
                      <Text style={styles.detailValueHighlight}>{pickupTime}</Text>
                    </View>

                    {/* Assigned Trucks */}
                    <View style={styles.detailRow}>
                      <View style={styles.detailIconWrapper}>
                        <MaterialIcons name="local-shipping" size={15} color="#4B5563" />
                      </View>
                      <Text style={styles.detailLabel}>Assigned Truck:</Text>
                      <Text style={styles.detailValue}>{truckName}</Text>
                    </View>

                    {/* Driver Assignment if available */}
                    {sched.assignedDriverName ? (
                      <View style={styles.detailRow}>
                        <View style={styles.detailIconWrapper}>
                          <MaterialIcons name="person" size={15} color="#4B5563" />
                        </View>
                        <Text style={styles.detailLabel}>Assigned Driver:</Text>
                        <Text style={styles.detailValue}>{sched.assignedDriverName}</Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Actions */}
                  <View style={styles.cardActionsRow}>
                    {onSelectSchedule && (
                      <TouchableOpacity
                        style={styles.viewDetailBtn}
                        onPress={() => onSelectSchedule(sched)}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="visibility" size={15} color="#059669" />
                        <Text style={styles.viewDetailBtnText}>View Full Route</Text>
                      </TouchableOpacity>
                    )}

                    {onEditSchedule && (
                      <TouchableOpacity
                        style={styles.editBtn}
                        onPress={() => onEditSchedule(sched)}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="edit" size={15} color="#2563EB" />
                        <Text style={styles.editBtnText}>Edit Schedule</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          /* CENRO View: Grouped by Barangay */
          <View style={styles.barangayListGrid}>
            {Object.entries(selectedDateBarangayGroups).map(([bName, bSchedules]) => {
              const primarySchedule = bSchedules[0];
              const uniqueStreets = Array.from(
                new Set(bSchedules.map((s) => s.streetName || 'Whole Barangay').filter(Boolean))
              );
              const uniqueTrucks = Array.from(
                new Set(
                  bSchedules
                    .map((s) => s.truck || s.truckName)
                    .filter((t): t is string => Boolean(t && t.trim()))
                )
              );
              const pickupTime =
                (primarySchedule.dayTimes && primarySchedule.dayTimes[selectedDateDayAbbr]) ||
                primarySchedule.time ||
                '06:00 AM';
              const catMeta =
                CATEGORY_COLORS[primarySchedule.wasteCategory || 'BIODEGRADABLE'] ||
                CATEGORY_COLORS.BIODEGRADABLE;

              return (
                <View key={bName} style={styles.barangayCard}>
                  <View style={styles.barangayCardHeader}>
                    <View style={styles.barangayTitleGroup}>
                      <View style={styles.barangayIconBox}>
                        <MaterialIcons name="location-on" size={20} color="#059669" />
                      </View>
                      <View>
                        <Text style={styles.barangayCardName}>Brgy. {bName}</Text>
                        <Text style={styles.barangayCardSub}>
                          {uniqueStreets.length} {uniqueStreets.length === 1 ? 'Route / Street' : 'Routes / Streets'}
                        </Text>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.catBadge,
                        { backgroundColor: catMeta.bg, borderColor: catMeta.dot },
                      ]}
                    >
                      <MaterialIcons name={catMeta.icon as any} size={13} color={catMeta.text} />
                      <Text style={[styles.catBadgeText, { color: catMeta.text }]}>
                        {primarySchedule.wasteCategory || 'BIODEGRADABLE'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.cardDetailsSection}>
                    {/* Time & Shift */}
                    <View style={styles.detailRow}>
                      <View style={styles.detailIconWrapper}>
                        <MaterialIcons name="access-time" size={15} color="#4B5563" />
                      </View>
                      <Text style={styles.detailLabel}>Collection Time:</Text>
                      <Text style={styles.detailValueHighlight}>{pickupTime}</Text>
                    </View>

                    {/* Assigned Trucks */}
                    <View style={styles.detailRow}>
                      <View style={styles.detailIconWrapper}>
                        <MaterialIcons name="local-shipping" size={15} color="#4B5563" />
                      </View>
                      <Text style={styles.detailLabel}>Assigned Truck:</Text>
                      <Text style={styles.detailValue}>
                        {uniqueTrucks.length > 0 ? uniqueTrucks.join(', ') : 'Pending Dispatch'}
                      </Text>
                    </View>

                    {/* Covered Streets / Routes */}
                    <View style={styles.streetsContainer}>
                      <Text style={styles.streetsHeading}>COVERED STREETS & PUROKS:</Text>
                      <View style={styles.streetsPillsRow}>
                        {uniqueStreets.map((st, sIdx) => (
                          <View key={sIdx} style={styles.streetPill}>
                            <MaterialIcons name="alt-route" size={11} color="#4B5563" />
                            <Text style={styles.streetPillText}>{st}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  </View>

                  {/* Actions */}
                  <View style={styles.cardActionsRow}>
                    {onSelectSchedule && (
                      <TouchableOpacity
                        style={styles.viewDetailBtn}
                        onPress={() => onSelectSchedule(primarySchedule)}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="visibility" size={15} color="#059669" />
                        <Text style={styles.viewDetailBtnText}>View Full Routes</Text>
                      </TouchableOpacity>
                    )}

                    {onEditSchedule && (
                      <TouchableOpacity
                        style={styles.editBtn}
                        onPress={() => onEditSchedule(primarySchedule)}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="edit" size={15} color="#2563EB" />
                        <Text style={styles.editBtnText}>Edit Schedule</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
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
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  monthTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  monthSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  navControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  todayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  todayBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#059669',
  },
  navArrows: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  arrowBtn: {
    padding: 6,
  },
  weekdayRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 8,
    marginBottom: 6,
  },
  weekdayCell: {
    flex: 1,
    alignItems: 'center',
  },
  weekdayText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4B5563',
    letterSpacing: 0.5,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.2857%',
    minHeight: 80,
    padding: 6,
    borderWidth: 0.5,
    borderColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
    justifyContent: 'space-between',
  },
  dayCellOtherMonth: {
    backgroundColor: '#FAFAFA',
    opacity: 0.5,
  },
  dayCellSelected: {
    backgroundColor: '#F0FDF4',
    borderColor: '#10B981',
    borderWidth: 1.5,
    borderRadius: 8,
    zIndex: 2,
  },
  dayCellToday: {
    borderColor: '#3B82F6',
    borderWidth: 1.5,
    borderRadius: 8,
  },
  dayCellHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayNumberBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumberBadgeSelected: {
    backgroundColor: '#059669',
  },
  dayNumberBadgeToday: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  dayNumberText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F2937',
  },
  dayNumberTextOtherMonth: {
    color: '#9CA3AF',
  },
  dayNumberTextSelected: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  dayNumberTextToday: {
    color: '#1D4ED8',
    fontWeight: '800',
  },
  countBadge: {
    backgroundColor: '#ECFDF5',
    paddingVertical: 2,
    paddingHorizontal: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  countBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#059669',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  catDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  moreDotsText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#6B7280',
  },
  cellRoutesContainer: {
    marginTop: 2,
    marginBottom: 2,
    gap: 2,
    flex: 1,
    justifyContent: 'center',
  },
  cellRouteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#F8FAFC',
    borderWidth: 0.5,
    borderColor: '#E2E8F0',
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 4,
  },
  cellRouteDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  cellRouteText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#334155',
    flexShrink: 1,
  },
  cellMoreRoutesText: {
    fontSize: 8.5,
    fontWeight: '700',
    color: '#64748B',
    paddingLeft: 2,
  },
  detailSection: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  detailSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  detailSectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
  },
  detailSectionDate: {
    fontSize: 13,
    color: '#4B5563',
    fontWeight: '600',
    marginTop: 2,
  },
  detailHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  statPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#059669',
  },
  addDateScheduleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#059669',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  addDateScheduleBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyContainer: {
    padding: 32,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#374151',
    marginTop: 10,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 400,
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  emptyAddBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#059669',
  },
  barangayListGrid: {
    gap: 14,
  },
  barangayCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  barangayCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  barangayTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  barangayIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  barangayCardName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  barangayCardSub: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 1,
  },
  catBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  catBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  cardDetailsSection: {
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#F3F4F6',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailIconWrapper: {
    width: 20,
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  detailValueHighlight: {
    fontSize: 13,
    fontWeight: '800',
    color: '#059669',
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2937',
  },
  streetsContainer: {
    marginTop: 4,
  },
  streetsHeading: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  streetsPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  streetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F3F4F6',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  streetPillText: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '600',
  },
  cardActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  viewDetailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  viewDetailBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  editBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
  },
});
