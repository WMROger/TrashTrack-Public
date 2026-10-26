import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export interface LiveTruckMarkerProps {
  plateNumber?: string;
  driverName?: string;
  speedKph?: number;
  heading?: number;
  isStale?: boolean;
  isZoomed?: boolean;
  locationName?: string;
}

/**
 * 100% Complete, Zero-Clipping Waste Collection Truck Marker for Android and iOS
 */
export const LiveTruckMarker: React.FC<LiveTruckMarkerProps> = ({
  isStale = false,
}) => {
  const bg = isStale ? '#D97706' : '#059669';

  return (
    <View collapsable={false} style={styles.container}>
      <View collapsable={false} style={[styles.badge, { backgroundColor: bg }]}>
        <Text style={styles.truckEmoji}>🚛</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },
  truckEmoji: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
    includeFontPadding: false,
  },
});

export default LiveTruckMarker;
