import React from 'react';
import { View, Text } from 'react-native';

const MapView = React.forwardRef<any, any>(function MapView({ children, style, ...props }, ref) {
  return (
    <View ref={ref} style={[style, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#e0e0e0' }]}>
      <Text style={{ color: '#666', textAlign: 'center', padding: 16 }}>
        Interactive Maps are only available on iOS and Android.
      </Text>
    </View>
  );
});

export default MapView;

export function Marker({ children, ...props }: any) {
  return null;
}

export function Heatmap(props: any) {
  return null;
}

export function Polyline(props: any) {
  return null;
}

export function UrlTile(props: any) {
  return null;
}
