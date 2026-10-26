import { IconSymbol } from '@/components/ui/IconSymbol';
import { formatAdaptiveMassFromMetricTons } from '@/utils/wasteUnits';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface EcoCarouselProps {
  totalPoints: number;
  trashCollectedTons: number;
  userReportsCount: number;
  userBarangay?: string;
  nextCollection: {
    dateLabel: string;
    timeText: string;
    wasteCategory: string;
  } | null;
}

export default function EcoCarousel({
  totalPoints,
  trashCollectedTons,
  userReportsCount,
  userBarangay,
  nextCollection,
}: EcoCarouselProps) {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const [containerWidth, setContainerWidth] = useState(Dimensions.get('window').width - 40);

  const cleanBarangay = (userBarangay || '').replace(/^(brgy\.?|barangay)\s*/i, '').trim();
  const hasBarangay = cleanBarangay.length > 0;
  const formattedBarangay = hasBarangay ? `Barangay ${cleanBarangay}` : '';

  const [showSegregationModal, setShowSegregationModal] = useState(false);
  const [showOrdinanceModal, setShowOrdinanceModal] = useState(false);

  const levelNumber = Math.floor(totalPoints / 500) + 1;
  const levelTitle = levelNumber >= 4 ? 'Green Guardian' : levelNumber >= 2 ? 'Eco Champion' : 'Eco Starter';
  const levelPercent = Math.min(100, Math.floor(((totalPoints % 500) / 500) * 100));

  const slides = [
    { id: 'next_collection', type: 'next_collection' },
    { id: 'eco_impact', type: 'eco_impact' },
    { id: 'tip_segregation', type: 'tip_segregation' },
    { id: 'tip_collection', type: 'tip_collection' },
  ];

  // Auto scroll every 6 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      const nextIndex = (currentIndex + 1) % slides.length;
      flatListRef.current?.scrollToIndex({
        index: nextIndex,
        animated: true,
      });
      setCurrentIndex(nextIndex);
    }, 6000);

    return () => clearInterval(timer);
  }, [currentIndex, slides.length]);

  const onMomentumScrollEnd = (e: any) => {
    const offset = e.nativeEvent.contentOffset.x;
    const index = Math.round(offset / containerWidth);
    if (index >= 0 && index < slides.length) {
      setCurrentIndex(index);
    }
  };

  const renderSlide = ({ item }: { item: { id: string; type: string } }) => {
    if (item.type === 'next_collection') {
      return (
        <View style={[styles.slideWrapper, { width: containerWidth }]}>
          <View style={styles.nextCollectionCard}>
            <View style={styles.nextCollectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <IconSymbol name="clock" size={20} color="#FFFFFF" />
                <Text style={styles.nextCollectionTitle}>Next Collection</Text>
              </View>
              {hasBarangay ? (
                <View style={styles.barangayBadge}>
                  <MaterialIcons name="location-on" size={13} color="#FFFFFF" />
                  <Text style={styles.barangayBadgeText} numberOfLines={1}>
                    {cleanBarangay}
                  </Text>
                </View>
              ) : null}
            </View>

            {nextCollection ? (
              <>
                <Text style={styles.nextCollectionDate}>{nextCollection.dateLabel}</Text>
                <Text style={styles.nextCollectionTime}>{nextCollection.timeText}</Text>
                <View style={styles.nextCollectionDivider} />
                <View style={styles.nextCollectionFooter}>
                  <IconSymbol name="arrow.triangle.2.circlepath" size={16} color="#FFFFFF" />
                  <Text style={styles.nextCollectionFooterText}>
                    {nextCollection.wasteCategory.toUpperCase()}{hasBarangay ? ` • BRGY. ${cleanBarangay.toUpperCase()}` : ''}
                  </Text>
                </View>
              </>
            ) : hasBarangay ? (
              <>
                <Text style={styles.nextCollectionDate}>{formattedBarangay}</Text>
                <Text style={[styles.nextCollectionTime, { fontSize: 24, marginTop: 4 }]}>
                  No schedule yet
                </Text>
                <View style={styles.nextCollectionDivider} />
                <TouchableOpacity
                  style={styles.nextCollectionFooter}
                  onPress={() => router.push('/(tabs)/schedule')}
                >
                  <MaterialIcons name="calendar-today" size={16} color="#FFFFFF" />
                  <Text style={styles.nextCollectionFooterText}>CHECK BARANGAY SCHEDULES</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.nextCollectionDate}>No upcoming collection</Text>
                <Text style={[styles.nextCollectionTime, { fontSize: 18, marginTop: 8 }]}>
                  Set your barangay in your profile
                </Text>
                <View style={styles.nextCollectionDivider} />
                <TouchableOpacity
                  style={styles.nextCollectionFooter}
                  onPress={() => router.push('/(tabs)/profile')}
                >
                  <MaterialIcons name="edit-location" size={16} color="#FFFFFF" />
                  <Text style={styles.nextCollectionFooterText}>UPDATE BARANGAY</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      );
    }

    if (item.type === 'eco_impact') {
      return (
        <View style={[styles.slideWrapper, { width: containerWidth }]}>
          <View style={styles.ecoImpactCard}>
            <View style={styles.pointsBadge}>
              <Text style={styles.pointsLabel}>POINTS</Text>
              <Text style={styles.pointsValue}>{totalPoints.toLocaleString()}</Text>
            </View>

            <View style={styles.levelRow}>
              <Text style={styles.levelText}>
                Level {levelNumber}: {levelTitle}
              </Text>
              <Text style={styles.levelPercent}>{levelPercent}%</Text>
            </View>

            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${levelPercent}%` }]} />
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {formatAdaptiveMassFromMetricTons(trashCollectedTons)}
                </Text>
                <Text style={styles.statLabel}>Trash Collected</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{userReportsCount}</Text>
                <Text style={styles.statLabel}>Reports</Text>
              </View>
            </View>
          </View>
        </View>
      );
    }

    if (item.type === 'tip_segregation') {
      return (
        <View style={[styles.slideWrapper, { width: containerWidth }]}>
          <LinearGradient
            colors={['#065F46', '#047857', '#059669']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.tipCard}
          >
            <View style={styles.tipTopRow}>
              <View style={styles.tipBadge}>
                <MaterialIcons name="lightbulb" size={13} color="#FFFFFF" />
                <Text style={styles.tipBadgeText}>ECO TIP #1 • SEGREGATION</Text>
              </View>
              <View style={styles.tipIconCircle}>
                <MaterialIcons name="recycling" size={22} color="#FFFFFF" />
              </View>
            </View>

            <Text style={styles.tipTitle}>Rinse & Sort Before Binning</Text>
            <Text style={styles.tipDescription}>
              Rinse recyclable bottles & food cartons before placing them in blue bins to keep materials odorless and clean for processing.
            </Text>

            <TouchableOpacity
              style={styles.tipActionBtn}
              onPress={() => setShowSegregationModal(true)}
              activeOpacity={0.8}
            >
              <Text style={styles.tipActionBtnText}>View Color Guide</Text>
              <MaterialIcons name="arrow-forward" size={15} color="#065F46" />
            </TouchableOpacity>
          </LinearGradient>
        </View>
      );
    }

    if (item.type === 'tip_collection') {
      return (
        <View style={[styles.slideWrapper, { width: containerWidth }]}>
          <LinearGradient
            colors={['#1E3A8A', '#2563EB', '#3B82F6']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.tipCard}
          >
            <View style={styles.tipTopRow}>
              <View style={styles.tipBadge}>
                <MaterialIcons name="schedule" size={13} color="#FFFFFF" />
                <Text style={styles.tipBadgeText}>ECO TIP #2 • COLLECTION</Text>
              </View>
              <View style={styles.tipIconCircle}>
                <MaterialIcons name="local-shipping" size={22} color="#FFFFFF" />
              </View>
            </View>

            <Text style={styles.tipTitle}>Place Bins Out by 6:00 AM</Text>
            <Text style={styles.tipDescription}>
              Put your segregated trash bins outside early on scheduled pickup mornings. Report unattended dumps to earn citizen Eco Points once resolved!
            </Text>

            <TouchableOpacity
              style={styles.tipActionBtn}
              onPress={() => router.push('/(tabs)/report')}
              activeOpacity={0.8}
            >
              <Text style={[styles.tipActionBtnText, { color: '#1E3A8A' }]}>Report Trash Dump</Text>
              <MaterialIcons name="add-location-alt" size={15} color="#1E3A8A" />
            </TouchableOpacity>
          </LinearGradient>
        </View>
      );
    }

    return null;
  };

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        const width = e.nativeEvent.layout.width;
        if (width > 0) setContainerWidth(width);
      }}
    >
      <FlatList
        ref={flatListRef}
        data={slides}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        renderItem={renderSlide}
      />

      {/* Pagination Indicator Dots */}
      <View style={styles.dotsContainer}>
        {slides.map((_, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => {
              flatListRef.current?.scrollToIndex({ index: i, animated: true });
              setCurrentIndex(i);
            }}
            style={[
              styles.dot,
              currentIndex === i ? styles.activeDot : styles.inactiveDot,
            ]}
          />
        ))}
      </View>

      {/* Waste Segregation Modal */}
      <Modal
        visible={showSegregationModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSegregationModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialIcons name="recycling" size={24} color="#059669" />
                <Text style={styles.modalTitle}>Waste Segregation Guide</Text>
              </View>
              <TouchableOpacity onPress={() => setShowSegregationModal(false)} style={styles.closeBtn}>
                <MaterialIcons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <View style={[styles.guideCard, { borderColor: '#86EFAC', backgroundColor: '#F0FDF4' }]}>
                <View style={styles.guideBadgeGreen}>
                  <Text style={styles.guideBadgeText}>BIODEGRADABLE (GREEN)</Text>
                </View>
                <Text style={styles.guideItemTitle}>Food scraps, vegetable peels, leaves, garden waste</Text>
                <Text style={styles.guideItemDesc}>Collected on Monday, Wednesday, & Friday mornings.</Text>
              </View>

              <View style={[styles.guideCard, { borderColor: '#93C5FD', backgroundColor: '#EFF6FF' }]}>
                <View style={styles.guideBadgeBlue}>
                  <Text style={styles.guideBadgeText}>RECYCLABLE (BLUE)</Text>
                </View>
                <Text style={styles.guideItemTitle}>PET bottles, clean paper, cartons, tin cans, glass</Text>
                <Text style={styles.guideItemDesc}>Collected on Tuesday & Saturday mornings.</Text>
              </View>

              <View style={[styles.guideCard, { borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' }]}>
                <View style={styles.guideBadgeRed}>
                  <Text style={styles.guideBadgeText}>RESIDUAL & HAZARDOUS (RED/BLACK)</Text>
                </View>
                <Text style={styles.guideItemTitle}>Sanitary waste, diapers, styrofoam, worn plastics, batteries</Text>
                <Text style={styles.guideItemDesc}>Collected on Thursday mornings. Keep hazardous separate.</Text>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={styles.modalPrimaryBtn}
              onPress={() => setShowSegregationModal(false)}
            >
              <Text style={styles.modalPrimaryBtnText}>Got It, Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: 12,
  },
  slideWrapper: {
    paddingHorizontal: 2,
  },
  // ── Next Collection Card ──
  nextCollectionCard: {
    backgroundColor: '#4A6741',
    borderRadius: 20,
    padding: 20,
    minHeight: 205,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  nextCollectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  barangayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    maxWidth: '45%',
  },
  barangayBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  nextCollectionTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  nextCollectionDate: {
    color: '#D1FAE5',
    fontSize: 14,
    fontWeight: '600',
  },
  nextCollectionTime: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginTop: 2,
  },
  nextCollectionDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    marginVertical: 10,
  },
  nextCollectionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nextCollectionFooterText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.6,
  },

  // ── Eco Impact Card ──
  ecoImpactCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    minHeight: 205,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pointsBadge: {
    backgroundColor: '#C8E6C9',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  pointsLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2E7D32',
    letterSpacing: 1,
  },
  pointsValue: {
    fontSize: 24,
    fontWeight: '900',
    color: '#1B5E20',
  },
  levelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  levelText: {
    fontSize: 12.5,
    color: '#4A6741',
    fontWeight: '700',
  },
  levelPercent: {
    fontSize: 12,
    color: '#2E7D32',
    fontWeight: '800',
  },
  progressBarBg: {
    height: 7,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#2E7D32',
    borderRadius: 4,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1B5E20',
  },
  statLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: '100%',
    backgroundColor: '#F1F5F9',
  },

  // ── Tip Cards ──
  tipCard: {
    borderRadius: 20,
    padding: 18,
    minHeight: 205,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  tipTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  tipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  tipBadgeText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tipIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tipTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  tipDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.92)',
    lineHeight: 16.5,
    marginBottom: 10,
  },
  tipActionBtn: {
    backgroundColor: '#FFFFFF',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  tipActionBtnText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#065F46',
  },

  // ── Pagination Dots ──
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  dot: {
    height: 5,
    borderRadius: 2.5,
  },
  activeDot: {
    width: 20,
    backgroundColor: '#059669',
  },
  inactiveDot: {
    width: 6,
    backgroundColor: '#CBD5E1',
  },

  // ── Modal Styles ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    width: '100%',
    maxWidth: 440,
    borderRadius: 22,
    padding: 20,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  closeBtn: {
    padding: 4,
  },
  modalScroll: {
    marginBottom: 16,
  },
  guideCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  guideBadgeGreen: {
    backgroundColor: '#059669',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  guideBadgeBlue: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  guideBadgeRed: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  guideBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  guideItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 3,
  },
  guideItemDesc: {
    fontSize: 11.5,
    color: '#64748B',
    lineHeight: 16,
  },
  modalPrimaryBtn: {
    backgroundColor: '#059669',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalPrimaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
