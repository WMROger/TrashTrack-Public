import React from "react";
import { Feather } from "@expo/vector-icons";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface StationaryCollectionPromptModalProps {
  visible: boolean;
  locationName: string;
  coordinates?: { latitude: number; longitude: number } | null;
  matchedStopName?: string | null;
  matchedStopType?: string | null;
  elapsedMinutes?: number;
  onConfirmCollection: () => void;
  onStuckInTraffic: () => void;
  onClose: () => void;
}

export default function StationaryCollectionPromptModal({
  visible,
  locationName,
  coordinates,
  matchedStopName,
  matchedStopType,
  elapsedMinutes = 5,
  onConfirmCollection,
  onStuckInTraffic,
  onClose,
}: StationaryCollectionPromptModalProps) {
  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Top Status Icon & Badge */}
          <View style={styles.iconHeader}>
            <View style={styles.iconCircle}>
              <Feather name="clock" size={28} color="#D97706" />
            </View>
            <View style={styles.elapsedBadge}>
              <Text style={styles.elapsedText}>{elapsedMinutes} min stop detected</Text>
            </View>
          </View>

          <Text style={styles.title}>Are you collecting waste here?</Text>
          <Text style={styles.subtitle}>
            Your truck has been stationary for over {elapsedMinutes} minutes. If this is a collection stop, you must take a photo proof to proceed.
          </Text>

          {/* Location Summary Box */}
          <View style={styles.locationBox}>
            <View style={styles.locationRow}>
              <Feather name="map-pin" size={18} color="#3B5241" style={{ marginTop: 2 }} />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.locationLabel}>DETECTED LOCATION</Text>
                <Text style={styles.locationValue} numberOfLines={2}>
                  {locationName || "Current GPS Location"}
                </Text>
                {coordinates && (
                  <Text style={styles.coordsText}>
                    {coordinates.latitude.toFixed(5)}, {coordinates.longitude.toFixed(5)}
                  </Text>
                )}
              </View>
            </View>

            {matchedStopName && (
              <View style={styles.matchedStopBadge}>
                <Feather
                  name={matchedStopType === "Verified Citizen Report" ? "alert-circle" : "check-circle"}
                  size={14}
                  color={matchedStopType === "Verified Citizen Report" ? "#B45309" : "#2E7D32"}
                />
                <Text
                  style={[
                    styles.matchedStopText,
                    matchedStopType === "Verified Citizen Report" && styles.matchedReportText,
                  ]}
                  numberOfLines={1}
                >
                  Matched Stop: {matchedStopName}
                </Text>
              </View>
            )}
          </View>

          {/* Action Buttons */}
          <View style={styles.actionContainer}>
            <TouchableOpacity
              style={styles.confirmButton}
              onPress={onConfirmCollection}
              activeOpacity={0.85}
            >
              <Feather name="camera" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.confirmButtonText}>Yes, Collect Here (Take Photo)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.trafficButton}
              onPress={onStuckInTraffic}
              activeOpacity={0.8}
            >
              <Feather name="navigation" size={16} color="#4B5563" style={{ marginRight: 6 }} />
              <Text style={styles.trafficButtonText}>No, Stuck in Traffic</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.trafficHint}>
            Tapping &quot;Stuck in Traffic&quot; pauses stationary alerts for 5 minutes.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  container: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 22,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  iconHeader: {
    alignItems: "center",
    marginBottom: 14,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#FEF3C7",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  elapsedBadge: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  elapsedText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#B45309",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 19,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: "#4B5563",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 16,
    paddingHorizontal: 6,
  },
  locationBox: {
    width: "100%",
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 12,
    marginBottom: 18,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  locationLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#6B7280",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  locationValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1F2937",
  },
  coordsText: {
    fontSize: 11,
    color: "#9CA3AF",
    marginTop: 2,
  },
  matchedStopBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginTop: 10,
    gap: 6,
  },
  matchedStopText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#065F46",
    flex: 1,
  },
  matchedReportText: {
    color: "#92400E",
  },
  actionContainer: {
    width: "100%",
    gap: 10,
  },
  confirmButton: {
    width: "100%",
    backgroundColor: "#3B5241",
    paddingVertical: 14,
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#3B5241",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  confirmButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  trafficButton: {
    width: "100%",
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  trafficButtonText: {
    color: "#374151",
    fontSize: 14,
    fontWeight: "600",
  },
  trafficHint: {
    fontSize: 11,
    color: "#9CA3AF",
    textAlign: "center",
    marginTop: 10,
  },
});

