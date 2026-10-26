import { submitPickupCompletion } from "@/services/driverOfflineQueue";
import { formatAdaptiveMassFromMetricTons } from "@/utils/wasteUnits";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

type MeasurementUnit = "ton";

export type PickupCompletionData = {
  imageUrl: string;
  location: { lat: number; lng: number };
  description: string;
  measurement: {
    value: number;
    unit: MeasurementUnit;
    bagCount: number | null;
  };
};

interface CompletePickupModalProps {
  visible: boolean;
  scheduleId: string;
  reportId?: string | null;
  onClose: () => void;
  onSubmit?: (data: PickupCompletionData) => void;
  location?: string;
  wasteType?: string;
  isMandatory?: boolean;
}

export default function CompletePickupModal({
  visible,
  scheduleId,
  reportId,
  onClose,
  onSubmit,
  location = "Scheduled pickup",
  wasteType = "Not specified",
  isMandatory = false,
}: CompletePickupModalProps) {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [geoCoords, setGeoCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [measurementValue, setMeasurementValue] = useState("");
  const [bagCount, setBagCount] = useState("");

  // Determine whether this stop is an official Citizen Report or a Normal Route Pickup
  const isCitizenReport =
    Boolean(reportId && reportId.trim() !== "" && reportId !== "null") ||
    (Boolean(scheduleId) && (scheduleId.startsWith("rep_") || scheduleId.startsWith("report_")));

  // Normalize waste type label so it doesn't show generic bundled route names
  const displayWasteType =
    wasteType === "Scheduled & Citizen Reports"
      ? isCitizenReport
        ? "Citizen Waste Report"
        : "Routine Route Collection"
      : wasteType;

  const captureLocation = async () => {
    try {
      const { status: locationStatus } =
        await Location.requestForegroundPermissionsAsync();
      if (locationStatus === "granted") {
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (!__DEV__ && (loc as any).mocked === true) {
            setErrorMsg("Mock GPS locations are not permitted for pickup verification.");
            return;
          }
          setGeoCoords({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          });
          return;
        } catch {
          const loc = await Location.getLastKnownPositionAsync();
          if (loc) {
            setGeoCoords({
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
            });
            return;
          }
        }
      }
    } catch (locErr) {
      console.warn("Location acquisition notice:", locErr);
    }
    // Reliable fallback: Default to Danao City CENRO / route coordinates so driver isn't blocked
    setGeoCoords({ lat: 10.5186, lng: 124.0255 });
  };

  // Pre-fetch location whenever modal is presented
  useEffect(() => {
    if (visible && !geoCoords) {
      captureLocation();
    }
  }, [visible]);

  const handleTakePhoto = async () => {
    try {
      setErrorMsg("");

      // On Web, launchCameraAsync is not supported, fallback to image library
      if (Platform.OS === "web") {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: false,
          quality: 0.5,
          allowsMultipleSelection: false,
          selectionLimit: 1,
        });

        if (!result.canceled && result.assets[0]) {
          setImageUri(result.assets[0].uri);
          await captureLocation();
        }
        return;
      }

      const { status: cameraStatus } =
        await ImagePicker.requestCameraPermissionsAsync();
      if (cameraStatus !== "granted") {
        setErrorMsg("Camera permission is required to capture proof of pickup.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.5,
      });

      if (!result.canceled && result.assets[0]) {
        setImageUri(result.assets[0].uri);
        await captureLocation();
      }
    } catch (err: any) {
      console.warn("Camera capture error:", err);
      setErrorMsg("Failed to open camera. Please check camera permissions.");
    }
  };

  const handleSubmit = async () => {
    // 1. Photo validation ONLY for Citizen Reports
    if (isCitizenReport && !imageUri) {
      setErrorMsg("A photo proof of waste clearance is required for citizen reports.");
      return;
    }

    const finalCoords = geoCoords || { lat: 10.5186, lng: 124.0255 };

    // 2. Weight validation (Optional for both normal pickups and citizen reports)
    let metricTons = 0;
    const trimmedWeight = measurementValue.trim();
    if (trimmedWeight !== "") {
      const numericMeasurement = Number(trimmedWeight);
      if (!Number.isFinite(numericMeasurement) || numericMeasurement <= 0) {
        setErrorMsg("Please enter a valid weight in kilograms or leave it blank.");
        return;
      }
      metricTons = numericMeasurement / 1000;
    }

    // 3. Optional bag count validation
    const numericBagCount = bagCount.trim() ? Number(bagCount) : null;
    if (
      numericBagCount !== null &&
      (!Number.isInteger(numericBagCount) || numericBagCount < 0)
    ) {
      setErrorMsg("Bag/bin count must be a whole number or left blank.");
      return;
    }

    setIsUploading(true);
    setErrorMsg("");

    try {
      const result = await submitPickupCompletion({
        scheduleId: scheduleId,
        reportId: reportId || undefined,
        imageUri: imageUri || undefined,
        location: finalCoords,
        description: description.trim(),
        measurement: {
          value: metricTons,
          unit: "ton",
          bagCount: numericBagCount,
        },
      });

      const completionData: PickupCompletionData = {
        imageUrl: result.imageUrl || "",
        location: finalCoords,
        description: description.trim(),
        measurement: {
          value: metricTons,
          unit: "ton",
          bagCount: numericBagCount,
        },
      };

      onSubmit?.(completionData);

      if (result.queued) {
        Alert.alert(
          "Saved offline",
          "Completion will sync automatically once internet connectivity is restored.",
        );
      }

      // Reset states
      setImageUri(null);
      setDescription("");
      setGeoCoords(null);
      setMeasurementValue("");
      setBagCount("");
    } catch {
      setErrorMsg("An error occurred during submission. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  // Automatically launch camera ONLY when modal is in mandatory stop mode AND it is a citizen report
  useEffect(() => {
    if (visible && isMandatory && isCitizenReport && !imageUri && !isUploading) {
      const timer = setTimeout(() => {
        handleTakePhoto();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [visible, isMandatory, isCitizenReport]);

  const handleClose = () => {
    if (isMandatory && isCitizenReport && !imageUri) {
      Alert.alert(
        "Mandatory Clearance Photo",
        "A photo is required to verify this citizen report and proceed. Are you sure you want to cancel and return to driving?",
        [
          { text: "Keep Taking Photo", style: "cancel" },
          {
            text: "Cancel Pickup",
            style: "destructive",
            onPress: () => {
              setImageUri(null);
              setDescription("");
              setGeoCoords(null);
              setMeasurementValue("");
              setBagCount("");
              setErrorMsg("");
              onClose();
            },
          },
        ]
      );
      return;
    }
    setImageUri(null);
    setDescription("");
    setGeoCoords(null);
    setMeasurementValue("");
    setBagCount("");
    setErrorMsg("");
    onClose();
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.modalContent}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 10 }}
          >
            {/* Modal Title & Badges */}
            <View style={styles.titleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>
                  {isCitizenReport
                    ? "Verify Citizen Report Clearance"
                    : isMandatory
                      ? "Confirm Collection Stop"
                      : "Confirm Pickup Completion"}
                </Text>
                <Text style={styles.titleSub}>
                  {isCitizenReport
                    ? "Citizen Waste Clearance • Photo Proof Required"
                    : "Scheduled Route Collection Waypoint"}
                </Text>
              </View>

              <View
                style={[
                  styles.typePill,
                  isCitizenReport ? styles.citizenPill : styles.normalPill,
                ]}
              >
                <Feather
                  name={isCitizenReport ? "camera" : "check"}
                  size={12}
                  color={isCitizenReport ? "#1E40AF" : "#166534"}
                />
                <Text
                  style={[
                    isCitizenReport ? styles.citizenPillText : styles.normalPillText
                  ]}
                >
                  {isCitizenReport ? "Citizen Report" : "Routine Stop"}
                </Text>
              </View>
            </View>

            {/* Mandatory Stop Alert if stationary > 5m */}
            {isMandatory && (
              <View style={styles.mandatoryNoticeBox}>
                <Feather
                  name="alert-triangle"
                  size={16}
                  color="#B45309"
                  style={{ marginTop: 2 }}
                />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.mandatoryNoticeTitle}>
                    STOP DETECTED (5+ MINS)
                  </Text>
                  <Text style={styles.mandatoryNoticeSub}>
                    {isCitizenReport
                      ? "Vehicle stopped at this reported location. Capture a photo of the cleared area to proceed."
                      : "Vehicle stopped at this scheduled collection point. Confirm completion below to proceed along your route."}
                  </Text>
                </View>
              </View>
            )}

            {/* Stop Information Details */}
            <View style={styles.detailsContainer}>
              <View style={styles.detailRow}>
                <Feather name="map-pin" size={14} color="#64748B" style={{ marginTop: 2 }} />
                <Text style={styles.detailText}>
                  <Text style={{ fontWeight: "700", color: "#1F2937" }}>Location: </Text>
                  {location}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Feather name="trash-2" size={14} color="#64748B" style={{ marginTop: 2 }} />
                <Text style={styles.detailText}>
                  <Text style={{ fontWeight: "700", color: "#1F2937" }}>Waste Type: </Text>
                  {displayWasteType}
                </Text>
              </View>
            </View>

            {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

            {/* ========================================================= */}
            {/* 1. CITIZEN REPORT: PHOTO REQUIRED FOR RESIDENT PROOF      */}
            {/* ========================================================= */}
            {isCitizenReport ? (
              <View style={{ marginBottom: 16 }}>
                <View style={styles.citizenReportBanner}>
                  <View style={styles.citizenReportIconWrap}>
                    <Feather name="camera" size={18} color="#2563EB" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.citizenReportTitle}>
                      Citizen Clearance Proof
                    </Text>
                    <Text style={styles.citizenReportSub}>
                      Take a clear photo of the cleared waste. This proof is sent directly to the resident&apos;s notification and CENRO records.
                    </Text>
                  </View>
                </View>

                {imageUri ? (
                  <View style={styles.imagePreviewContainer}>
                    <Image source={{ uri: imageUri }} style={styles.imagePreview} />
                    <View style={styles.previewActions}>
                      <TouchableOpacity
                        style={styles.previewActionBtn}
                        onPress={handleTakePhoto}
                      >
                        <Feather name="camera" size={13} color="#FFFFFF" />
                        <Text style={styles.previewActionText}>Retake Photo</Text>
                      </TouchableOpacity>
                    </View>
                    {geoCoords && (
                      <View style={styles.geoTag}>
                        <Feather name="map-pin" size={12} color="#FFFFFF" />
                        <Text style={styles.geoText}>
                          {geoCoords.lat.toFixed(5)}, {geoCoords.lng.toFixed(5)}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.takePhotoOnlyBtn}
                    onPress={handleTakePhoto}
                    activeOpacity={0.8}
                  >
                    <View style={styles.cameraIconCircle}>
                      <Feather name="camera" size={24} color="#1D4ED8" />
                    </View>
                    <Text style={[styles.uploadText, { color: "#1E40AF" }]}>
                      Take Clearance Photo
                    </Text>
                    <Text style={styles.uploadSubtext}>
                      Required for citizen report verification
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              /* ========================================================= */
              /* 2. NORMAL ROUTE PICKUP: CLEAN CONFIRMATION BANNER         */
              /* ========================================================= */
              <View style={styles.confirmBanner}>
                <View style={styles.confirmIconWrap}>
                  <Feather name="check-circle" size={20} color="#059669" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.confirmBannerTitle}>
                    Routine Collection Stop
                  </Text>
                  <Text style={styles.confirmBannerSub}>
                    Confirm that scheduled municipal waste at this waypoint has been picked up. No photo required.
                  </Text>
                </View>
              </View>
            )}

            {/* Measurement Fields (Optional for normal pickups & reports) */}
            <View style={styles.measurementRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Collected weight (Optional)</Text>
                <View style={styles.measurementInputWrap}>
                  <TextInput
                    style={styles.measurementInput}
                    value={measurementValue}
                    onChangeText={setMeasurementValue}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 125"
                  />
                  <View style={styles.fixedUnitBadge}>
                    <Text style={styles.fixedUnitText}>kg</Text>
                  </View>
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Bags/bins (Optional)</Text>
                <TextInput
                  style={styles.compactInput}
                  value={bagCount}
                  onChangeText={setBagCount}
                  keyboardType="number-pad"
                  placeholder="e.g. 12"
                />
              </View>
            </View>

            <Text style={styles.measurementHint}>
              {Number.isFinite(Number(measurementValue)) &&
              Number(measurementValue) > 0
                ? `Displayed as ${formatAdaptiveMassFromMetricTons(Number(measurementValue) / 1000)}`
                : "Enter estimate if known, or leave blank to record standard stop pickup."}
            </Text>

            {/* Optional Description / Driver Notes */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Add Description / Notes (Optional):</Text>
              <TextInput
                style={styles.textInput}
                multiline
                numberOfLines={3}
                value={description}
                onChangeText={setDescription}
                placeholder="Any operational notes about this pickup?"
              />
            </View>

            {/* Action Buttons */}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleClose}
                disabled={isUploading}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.completeButton,
                  isCitizenReport && !imageUri && styles.disabledButton,
                  isUploading && styles.disabledButton,
                ]}
                onPress={handleSubmit}
                disabled={(isCitizenReport && !imageUri) || isUploading}
                activeOpacity={0.8}
              >
                {isUploading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Feather name="check" size={16} color="#FFFFFF" />
                    <Text style={styles.completeButtonText}>Complete Pickup</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    width: "100%",
    maxWidth: 500,
    maxHeight: "90%",
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#0F172A",
  },
  titleSub: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
    fontWeight: "500",
  },
  typePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  normalPill: {
    backgroundColor: "#DCFCE7",
  },
  normalPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#166534",
  },
  citizenPill: {
    backgroundColor: "#DBEAFE",
  },
  citizenPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#1E40AF",
  },
  mandatoryNoticeBox: {
    flexDirection: "row",
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FCD34D",
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  mandatoryNoticeTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#92400E",
    letterSpacing: 0.5,
  },
  mandatoryNoticeSub: {
    fontSize: 11,
    color: "#B45309",
    marginTop: 2,
    lineHeight: 15,
  },
  detailsContainer: {
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  detailText: {
    fontSize: 13,
    color: "#475569",
    flex: 1,
    lineHeight: 18,
  },
  confirmBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#A7F3D0",
    padding: 14,
    gap: 12,
    marginBottom: 16,
  },
  confirmIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#D1FAE5",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBannerTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#065F46",
  },
  confirmBannerSub: {
    fontSize: 11,
    color: "#047857",
    marginTop: 2,
    lineHeight: 16,
  },
  citizenReportBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    padding: 12,
    gap: 10,
    marginBottom: 12,
  },
  citizenReportIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
  },
  citizenReportTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#1E40AF",
  },
  citizenReportSub: {
    fontSize: 11,
    color: "#1D4ED8",
    marginTop: 2,
    lineHeight: 16,
  },
  errorText: {
    color: "#EF4444",
    fontSize: 12,
    marginBottom: 12,
    fontWeight: "600",
  },
  takePhotoOnlyBtn: {
    backgroundColor: "#EFF6FF",
    borderWidth: 1.5,
    borderColor: "#93C5FD",
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  uploadText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1E40AF",
  },
  uploadSubtext: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  imagePreviewContainer: {
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  imagePreview: {
    width: "100%",
    height: 180,
    backgroundColor: "#000000",
  },
  previewActions: {
    position: "absolute",
    bottom: 8,
    right: 8,
  },
  previewActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    gap: 4,
  },
  previewActionText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  geoTag: {
    position: "absolute",
    bottom: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    gap: 4,
  },
  geoText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "500",
  },
  measurementRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
    marginBottom: 6,
  },
  measurementInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    overflow: "hidden",
  },
  measurementInput: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: "#0F172A",
    outlineStyle: "none" as any,
  },
  fixedUnitBadge: {
    backgroundColor: "#E2E8F0",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderLeftWidth: 1,
    borderLeftColor: "#CBD5E1",
  },
  fixedUnitText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
  },
  compactInput: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: "#0F172A",
    outlineStyle: "none" as any,
  },
  measurementHint: {
    fontSize: 11,
    color: "#64748B",
    marginBottom: 12,
    fontStyle: "italic",
  },
  inputGroup: {
    marginBottom: 16,
  },
  textInput: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    color: "#0F172A",
    minHeight: 64,
    textAlignVertical: "top",
    outlineStyle: "none" as any,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    paddingTop: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "#EF4444",
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  completeButton: {
    flex: 1.5,
    backgroundColor: "#059669",
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  disabledButton: {
    backgroundColor: "#94A3B8",
    opacity: 0.7,
  },
  completeButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
});
