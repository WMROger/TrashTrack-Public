import { ErrorBoundary } from '@/components/ErrorBoundary';
import OpenStreetMap from "@/components/OpenStreetMap";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { IMAGE_TRANSFORMATIONS, UPLOAD_PRESETS } from "@/config/cloudinary";
import { auth, db, storage } from "@/config/firebase";
import { DANAO_CITY_BARANGAYS, resolveScheduleBarangays } from '@/constants/danaoBarangays';
import { autoDispatchReportToActiveRoute } from "@/services/autoDispatchService";
import {
  cloudinaryService,
  UPLOAD_FOLDERS,
} from "@/services/cloudinaryService";
import { reverseGeocodeCoords } from '@/services/geocodingService';
import { analyzeWasteImage, WasteAnalysisResult } from "@/services/wasteAIService";
import { formatWasteAmount } from '@/utils/wasteUnits';
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { addDoc, collection, doc, onSnapshot, serverTimestamp, query, where } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ReportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState("");
  const [barangay, setBarangay] = useState("");
  const [street, setStreet] = useState("");
  const [landmark, setLandmark] = useState("");
  const [description, setDescription] = useState("");
  const [showBarangay, setShowBarangay] = useState(false);
  const [showLandmark, setShowLandmark] = useState(false);
  const [availableBarangays, setAvailableBarangays] = useState<string[]>([...DANAO_CITY_BARANGAYS]);
  const [barangaySearchText, setBarangaySearchText] = useState("");
  const [scheduleBarangaySet, setScheduleBarangaySet] = useState<Set<string>>(new Set());
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [locationAddress, setLocationAddress] = useState<string>("Locating...");
  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false);
  const [aiResult, setAiResult] = useState<WasteAnalysisResult | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<string>('');
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [userProfileBarangay, setUserProfileBarangay] = useState("");
  const MAX_FIRESTORE_FIELD_BYTES = 1000000; // ~1MB safe cap

  const [rawSchedulesList, setRawSchedulesList] = useState<any[]>([]);
  const [completedSchedulesToday, setCompletedSchedulesToday] = useState<any[]>([]);
  const [showLateReportModal, setShowLateReportModal] = useState(false);
  const [lateReportDetails, setLateReportDetails] = useState<{
    scheduleTime: string;
    wasteCategory: string;
    todayDow: string;
    barangayName: string;
  } | null>(null);

  // 1. Realtime subscription to barangay schedules and completed driver routes
  useEffect(() => {
    if (!db) return;

    const unsubBarangayScheds = onSnapshot(collection(db, 'barangay_schedules'), (snap) => {
      const scheduleNames = new Set<string>();
      const fullSchedules: any[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        fullSchedules.push({ id: docSnap.id, ...data });
        if (data.barangayName && typeof data.barangayName === 'string' && data.barangayName.trim()) {
          scheduleNames.add(data.barangayName.trim());
        }
      });
      setScheduleBarangaySet(scheduleNames);
      setAvailableBarangays(resolveScheduleBarangays(Array.from(scheduleNames)));
      setRawSchedulesList(fullSchedules);
    }, (err) => console.warn('Error listening to barangay_schedules:', err));

    const unsubCompletedSchedules = onSnapshot(
      query(collection(db, 'schedules'), where('status', '==', 'completed')),
      (snap: any) => {
        const completed: any[] = [];
        snap.forEach((docSnap: any) => {
          completed.push({ id: docSnap.id, ...docSnap.data() });
        });
        setCompletedSchedulesToday(completed);
      },
      (err: any) => console.warn('Error listening to completed schedules:', err)
    );

    return () => {
      unsubBarangayScheds();
      unsubCompletedSchedules();
    };
  }, []);

  const normalizeBrgyName = (name: string): string => {
    return (name || '')
      .toLowerCase()
      .replace(/^(brgy\.?|barangay)\s*/i, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  };

  const parseTimestampToDate = (raw: any): Date | null => {
    if (!raw) return null;
    if (typeof raw === 'object' && typeof raw.toDate === 'function') {
      try {
        const d = raw.toDate();
        if (!isNaN(d.getTime())) return d;
      } catch {}
    }
    if (typeof raw === 'object' && typeof raw.seconds === 'number') {
      const d = new Date(raw.seconds * 1000);
      if (!isNaN(d.getTime())) return d;
    }
    if (typeof raw === 'number') {
      const d = new Date(raw > 1e11 ? raw : raw * 1000);
      if (!isNaN(d.getTime())) return d;
    }
    if (typeof raw === 'string') {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  };

  const isDateTodayInPht = (d: Date | null): boolean => {
    if (!d) return false;
    const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
    const nowPhtMs = Date.now() + PHT_OFFSET_MS;
    const datePhtMs = d.getTime() + PHT_OFFSET_MS;
    const nowPht = new Date(nowPhtMs);
    const datePht = new Date(datePhtMs);
    return (
      nowPht.getUTCFullYear() === datePht.getUTCFullYear() &&
      nowPht.getUTCMonth() === datePht.getUTCMonth() &&
      nowPht.getUTCDate() === datePht.getUTCDate()
    );
  };

  // Helper to check whether current report submission is before, during, or after the collection schedule
  const getScheduleStatusForBarangay = (targetBarangay: string) => {
    if (!targetBarangay) return null;
    const normTarget = normalizeBrgyName(targetBarangay);
    if (!normTarget) return null;

    const DOW_MAP = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Resolve current date & time aligned to Danao City / Philippine Standard Time (PST/PHT, UTC+8)
    const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
    const phtNow = new Date(Date.now() + PHT_OFFSET_MS);
    const dowIndex = phtNow.getUTCDay();
    const todayDow = DOW_MAP[dowIndex];
    const todayDowName = DOW_NAMES[dowIndex];

    // Find all schedules configured for this barangay
    const matchingScheds = rawSchedulesList.filter((s) => {
      const sNorm = normalizeBrgyName(s.barangayName || s.barangay || '');
      return sNorm === normTarget;
    });

    // Check if driver has completed collection for this barangay TODAY
    const isDriverCompletedToday =
      matchingScheds.some((s: any) => s.status === 'completed') ||
      completedSchedulesToday.some((s: any) => {
        const sNorm = normalizeBrgyName(s.barangay || s.barangayName || '');
        let matches = Boolean(sNorm && (sNorm === normTarget || sNorm.includes(normTarget) || normTarget.includes(sNorm)));
        if (!matches && Array.isArray(s.stops)) {
          matches = s.stops.some((st: any) => {
            const stNorm = normalizeBrgyName(st.name || st.street || st.barangay || '');
            return stNorm.includes(normTarget);
          });
        }
        if (!matches) return false;

        const compDate = parseTimestampToDate(s.completedAt) || parseTimestampToDate(s.updatedAt);
        if (!compDate) return true;
        return isDateTodayInPht(compDate) || (Date.now() - compDate.getTime() < 18 * 3600000);
      });

    if (!matchingScheds.length && !isDriverCompletedToday) return null;

    // Check if scheduled today
    const todayScheds = matchingScheds.filter((s: any) => Array.isArray(s.days) && s.days.includes(todayDow));
    const isTodayScheduled = todayScheds.length > 0;

    // Resolve scheduled pickup time for today
    let latestScheduledTimeToday: Date | null = null;
    let scheduledTimeStr = '06:00 AM';
    let wasteCategory = 'Standard Collection';

    const candidateScheds = isTodayScheduled ? todayScheds : matchingScheds;
    if (candidateScheds.length > 0) {
      wasteCategory = candidateScheds[0].wasteCategory || 'Standard Collection';
    }

    for (const sched of candidateScheds) {
      const tStr =
        (sched.dayTimes && sched.dayTimes[todayDow]) ||
        sched.time ||
        sched.timeText ||
        sched.collectionTime ||
        '06:00 AM';
      const timeMatch = tStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const ampm = timeMatch[3]?.toUpperCase();
        if (ampm === 'PM' && hours < 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
        const schedDate = new Date(Date.UTC(phtNow.getUTCFullYear(), phtNow.getUTCMonth(), phtNow.getUTCDate(), hours, minutes, 0));
        if (!latestScheduledTimeToday || schedDate.getTime() > latestScheduledTimeToday.getTime()) {
          latestScheduledTimeToday = schedDate;
          scheduledTimeStr = tStr;
        }
      }
    }

    // Check if scheduled time has passed
    const isPastScheduledTime = isTodayScheduled && latestScheduledTimeToday
      ? phtNow.getTime() > latestScheduledTimeToday.getTime()
      : false;

    // Is upcoming today (scheduled today, not finished, and pickup time is still in the future!)
    const isUpcomingToday = isTodayScheduled && !isDriverCompletedToday && !isPastScheduledTime;

    // Late/concluded applies if completed today, past scheduled time today, or not scheduled today (off-day)
    const isLate = isDriverCompletedToday || isPastScheduledTime || (!isTodayScheduled && matchingScheds.length > 0);

    // Next collection day calculation
    const allDays = Array.from(new Set(matchingScheds.flatMap((s: any) => s.days || [])));
    let nextCollectionDayStr = 'Tomorrow';
    if (allDays.length > 0) {
      for (let offset = 1; offset <= 7; offset++) {
        const nextIdx = (dowIndex + offset) % 7;
        const nextDow = DOW_MAP[nextIdx];
        if (allDays.includes(nextDow)) {
          nextCollectionDayStr = offset === 1 ? 'Tomorrow' : DOW_NAMES[nextIdx];
          break;
        }
      }
      if (nextCollectionDayStr === todayDowName) {
        nextCollectionDayStr = 'Tomorrow';
      }
    }

    return {
      isTodayScheduled,
      isUpcomingToday,
      isPastScheduledTime,
      isLate,
      isDriverCompletedToday,
      scheduledTimeStr,
      todayDowName,
      scheduledTimeToday: latestScheduledTimeToday,
      collectionDays: allDays,
      wasteCategory,
      nextCollectionDayStr,
    };
  };

  const currentScheduleStatus = useMemo(() => {
    return getScheduleStatusForBarangay(barangay || userProfileBarangay);
  }, [barangay, userProfileBarangay, rawSchedulesList, completedSchedulesToday]);

  // 2. Fetch User Profile & Verification Status in real-time
  useEffect(() => {
    if (!auth.currentUser || !db) return;
    const unsub = onSnapshot(doc(db, 'users', auth.currentUser.uid), (userSnap) => {
      if (userSnap.exists()) {
        const data = userSnap.data();
        if (data.barangay) {
          setUserProfileBarangay(data.barangay);
          setBarangay((prev) => prev || data.barangay);
        }
        setVerificationStatus(data.verificationStatus || '');
        setRejectionReason(data.rejectionReason || '');
      }
    }, (err) => {
      console.warn("Error listening to user profile in report:", err);
    });
    return () => unsub();
  }, []);

  // Debug function to check Firebase configuration
  const checkFirebaseConfig = () => {
    console.log("=== Firebase Configuration Check ===");
    console.log("Auth available:", !!auth);
    console.log("DB available:", !!db);
    console.log("Storage available:", !!storage);
    console.log("Current user:", auth?.currentUser?.uid);
    console.log(
      "Storage bucket:",
      storage?._delegate?._host || "Not available"
    );
    console.log("=====================================");
  };

  // Enhanced error handling for Firestore operations
  const handleFirestoreError = (error: any, operation: string) => {
    console.error(`Firestore ${operation} error:`, error);

    if (error?.code === "unavailable") {
      Alert.alert(
        "Connection Error",
        "Unable to connect to the server. Please check your internet connection and try again.",
        [{ text: "OK" }]
      );
    } else if (error?.code === "permission-denied") {
      Alert.alert(
        "Permission Error",
        "You don't have permission to perform this action. Please contact support.",
        [{ text: "OK" }]
      );
    } else if (
      error?.message?.includes("QUIC") ||
      error?.message?.includes("protocol")
    ) {
      Alert.alert(
        "Network Error",
        "Network connection issue detected. Please try again in a moment.",
        [{ text: "OK" }]
      );
    } else {
      Alert.alert(
        "Error",
        `Failed to ${operation}: ${error?.message || "Unknown error"}`,
        [{ text: "OK" }]
      );
    }
  };

  // Test function to verify Firebase Storage
  const testStorageConnection = async () => {
    if (!storage || !auth.currentUser) {
      Alert.alert("Error", "Firebase Storage or user not available");
      return;
    }

    try {
      console.log("Testing Firebase Storage connection...");
      const testRef = ref(storage, `test/${auth.currentUser.uid}/test.txt`);
      const testBlob = new Blob(["test"], { type: "text/plain" });

      await uploadBytes(testRef, testBlob);
      const downloadURL = await getDownloadURL(testRef);

      console.log("Storage test successful!", downloadURL);
      Alert.alert("Success", "Firebase Storage is working correctly!");
    } catch (error) {
      console.error("Storage test failed:", error);

      // Check if it's a CORS error
      if (error instanceof Error && error.message.includes("CORS")) {
        Alert.alert(
          "CORS Error",
          "Firebase Storage is blocked by CORS policy. This is common in development. Reports will be saved without images for now.",
          [{ text: "OK" }]
        );
      } else {
        Alert.alert(
          "Error",
          `Storage test failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }
  };

  const BARANGAYS = useMemo(() => [...DANAO_CITY_BARANGAYS], []);

  const LANDMARKS = useMemo(
    () => ["Barangay Hall", "Market", "Church", "School", "Park", "Main Road"],
    []
  );

  // Retry mechanism for Firestore operations
  const retryFirestoreOperation = async (
    operation: () => Promise<any>,
    maxRetries = 3,
    delay = 1000
  ) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        console.log(`Firestore operation attempt ${attempt} failed:`, error);

        if (attempt === maxRetries) {
          throw error;
        }

        // Check if it's a network-related error that might benefit from retry
        if (
          error?.message?.includes("QUIC") ||
          error?.message?.includes("protocol") ||
          error?.code === "unavailable"
        ) {
          console.log(`Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
        } else {
          throw error; // Don't retry for non-network errors
        }
      }
    }
  };

  const handleSendReport = async (bypassLateCheck: boolean = false) => {
    // Debug Firebase configuration
    checkFirebaseConfig();

    if (verificationStatus === 'rejected') {
      Alert.alert(
        "Reporting Restricted",
        `Your residency verification document was rejected by City Administration.\n\nReason: ${rejectionReason || 'Document does not verify Danao City address'}\n\nWaste reporting is reserved for verified Danao City residents. Please update your document in your Profile to submit reports.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Fix in Profile", onPress: () => router.push('/(tabs)/profile?reupload=true' as any) },
        ]
      );
      return;
    }

    if (!auth.currentUser?.uid) {
      Alert.alert("Error", "You must be signed in to submit a report.");
      return;
    }
    if (!geoCoords) {
      Alert.alert("Location Required", "Please wait for your GPS location to be fetched before submitting.");
      return;
    }

    if (
      !title.trim() ||
      !barangay.trim() ||
      !street.trim()
    ) {
      Alert.alert("Error", "Please fill in all required fields (Title, Barangay, Street).");
      return;
    }

    if (!imageUri) {
      Alert.alert("Photo Required", "Please take a photo of the waste before submitting.");
      return;
    }
    
    if (isAnalyzingAI) {
      Alert.alert("Please Wait", "The AI is currently analyzing your photo. Please wait a moment before submitting.");
      return;
    }

    // Consultant Revision #4: Late report check
    // Prompt if the report submitted is done after the collection schedule
    if (!bypassLateCheck) {
      const scheduleStatus = getScheduleStatusForBarangay(barangay || userProfileBarangay);
      if (scheduleStatus && (scheduleStatus.isLate || scheduleStatus.isDriverCompletedToday)) {
        setLateReportDetails({
          scheduleTime: scheduleStatus.scheduledTimeStr,
          wasteCategory: scheduleStatus.wasteCategory,
          todayDow: scheduleStatus.todayDowName,
          barangayName: barangay || userProfileBarangay,
        });
        setShowLateReportModal(true);
        return;
      }
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      let imageURL = null;

      // Upload image to Cloudinary if available
      if (imageUri) {
        try {
          setUploadProgress(25);
          const uploadResult = await cloudinaryService.uploadImage(imageUri, {
            folder: UPLOAD_FOLDERS.REPORTS,
            preset: UPLOAD_PRESETS.REPORTS,
            transformation: IMAGE_TRANSFORMATIONS.REPORT,
          });
          if (uploadResult.success && uploadResult.url) {
            imageURL = uploadResult.url;
            setUploadProgress(75);
            console.log("Image uploaded to Cloudinary:", imageURL);
          } else {
            Alert.alert(
              "Upload Failed",
              "Could not upload the verification photo. Please check your network connection and try again."
            );
            return;
          }
        } catch (uploadError) {
          console.warn("Image upload exception:", uploadError);
          Alert.alert(
            "Upload Failed",
            "Could not upload the verification photo. Please check your network connection and try again."
          );
          return;
        }
      } else {
        Alert.alert("Photo Required", "Please capture a live verification photo before submitting.");
        return;
      }

      // Submit the report with verified image URL
      console.log("Submitting report to Firestore...");
      console.log("Image URL to be saved:", imageURL);
      console.log("Current user UID:", auth.currentUser.uid);
      console.log("DB available:", !!db);
      console.log("Proceeding with report submission...");

      const reportData = {
        title,
        barangay,
        street,
        landmark,
        description,
        imageURL,
        location: geoCoords,
        userId: auth.currentUser.uid,
        userEmail: auth.currentUser.email || "",
        createdAt: serverTimestamp(),
        createdAtIso: new Date().toISOString(),
        status: "pending", // Add status for admin management
        isLateSubmission: !!lateReportDetails,
        scheduledCollectionTime: lateReportDetails?.scheduleTime || null,
        lateSubmissionAcknowledged: !!lateReportDetails,
        submissionTimingStatus: lateReportDetails ? 'post_collection_backlog' : 'standard',
        aiAnalysis: aiResult ? {
          wasteType: aiResult.wasteType,
          wasteTypes: aiResult.wasteTypes || [aiResult.wasteType],
          collectionCategory: aiResult.collectionCategory || (aiResult.wasteType.includes('Organic') ? 'Biodegradable' : 'Non-Biodegradable'),
          isUnsegregated: Boolean(aiResult.isUnsegregated),
          rewardPoints: aiResult.rewardPoints ?? (aiResult.isUnsegregated ? 25 : 50),
          estimatedWeight: aiResult.estimatedWeight,
          confidence: aiResult.confidence,
          details: aiResult.details,
        } : null,
        wasteCategory: aiResult?.collectionCategory || (aiResult?.wasteType?.includes('Organic') ? 'Biodegradable' : 'Non-Biodegradable'),
        isUnsegregated: Boolean(aiResult?.isUnsegregated),
        rewardPoints: aiResult?.rewardPoints ?? (aiResult?.isUnsegregated ? 25 : 50),
      };

      console.log("Report data to be saved:", reportData);
      console.log(
        "User ID matches auth UID:",
        reportData.userId === auth.currentUser.uid
      );

      try {
        const docRef = await retryFirestoreOperation(async () => {
          return await addDoc(collection(db, "reports"), reportData);
        });
        console.log("Report created with ID:", docRef.id);

        // Auto-dispatch: if driver is on shift in this barangay, slot into route and notify driver immediately
        autoDispatchReportToActiveRoute({
          id: docRef.id,
          title: reportData.title,
          street: reportData.street,
          barangay: reportData.barangay,
          wasteCategory: reportData.wasteCategory,
          isUnsegregated: reportData.isUnsegregated,
          location: reportData.location,
          aiAnalysis: reportData.aiAnalysis,
          priority: ((reportData as any).priority || (aiResult as any)?.priority || "high") as any,
        }).catch((dispErr) => {
          console.warn("Auto-dispatch on submit error:", dispErr);
        });
      } catch (firestoreError) {
        console.error("Firestore error:", firestoreError);
        handleFirestoreError(firestoreError, "submit report");
        throw firestoreError;
      }

      setUploadProgress(100);
      console.log("Report submitted successfully!");

      // Show success message
      Alert.alert(
        "Success",
        lateReportDetails
          ? "Report submitted as post-collection backlog. CENRO dispatch notified. Points will be awarded once your report is resolved."
          : "Report submitted successfully! Points will be awarded once your report is resolved."
      );

      // Reset form
      setTitle("");
      setBarangay("");
      setStreet("");
      setLandmark("");
      setDescription("");
      setImageUri(null);
      setImageDataUrl(null);
      setGeoCoords(null);
      setAiResult(null);
      setLateReportDetails(null);
    } catch (err) {
      console.error("Report submission error:", err);
      Alert.alert(
        "Error",
        `Failed to submit report: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // Helper function to submit report without image
  const submitReportWithoutImage = async () => {
    try {
      let noImgDocId: string | null = null;
      await retryFirestoreOperation(async () => {
        const docRef = await addDoc(collection(db, "reports"), {
          title,
          barangay,
          street,
          landmark,
          description,
          imageURL: null,
          location: geoCoords,
          userId: auth.currentUser?.uid,
          userEmail: auth.currentUser?.email || "",
          createdAt: new Date().toISOString(),
          status: "pending",
        });
        noImgDocId = docRef.id;
        return docRef;
      });

      if (noImgDocId) {
        autoDispatchReportToActiveRoute({
          id: noImgDocId,
          title,
          street,
          barangay,
          location: geoCoords,
          priority: "normal",
        }).catch((dispErr) => {
          console.warn("Auto-dispatch without image error:", dispErr);
        });
      }

      Alert.alert("Success", "Report submitted successfully without image! Points will be awarded once your report is resolved.");

      // Reset form
      setTitle("");
      setBarangay("");
      setStreet("");
      setLandmark("");
      setDescription("");
      setImageUri(null);
      setGeoCoords(null);
    } catch (err) {
      console.error("Report submission error:", err);
      handleFirestoreError(err, "submit report");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const [geoCoords, setGeoCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Smart matcher against collection schedule / Danao barangays
  const matchBarangayFromGeocode = (
    geocodeResult: Location.LocationGeocodedAddress[],
    availableList: string[]
  ): string | null => {
    if (!geocodeResult || geocodeResult.length === 0) return null;
    const place = geocodeResult[0];

    const cleanCandidate = (str?: string | null) =>
      (str || '')
        .toLowerCase()
        .replace(/^brgy\.?\s*/i, '')
        .replace(/^barangay\s*/i, '')
        .replace(/\s*city$/i, '')
        .trim();

    const candidates = [
      cleanCandidate(place.district),
      cleanCandidate(place.subregion),
      cleanCandidate(place.name),
      cleanCandidate(place.street),
      cleanCandidate(place.city),
    ].filter(Boolean);

    // 1. Exact match against available list
    for (const cand of candidates) {
      const match = availableList.find(
        (b) => b.toLowerCase().trim() === cand
      );
      if (match) return match;
    }

    // 2. Substring match
    for (const cand of candidates) {
      if (cand.length < 3) continue;
      const match = availableList.find(
        (b) =>
          b.toLowerCase().includes(cand) ||
          cand.includes(b.toLowerCase())
      );
      if (match) return match;
    }

    return null;
  };

  const handleTakePhoto = async () => {
    try {
      const { status: cameraStatus } = await ImagePicker.requestCameraPermissionsAsync();
      if (cameraStatus !== 'granted') {
        Alert.alert(
          "Permission Denied",
          "Camera permission is required to capture the trash pile."
        );
        return;
      }

      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      if (locationStatus !== 'granted') {
        Alert.alert(
          "Permission Denied",
          "Location permission is required to geotag your report."
        );
        return;
      }

      // Capture trash pile photo with compressed quality for fast loading
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        const rawAsset = result.assets[0];
        const capturedUri = rawAsset.uri;
        const capturedBase64 = rawAsset.base64;

        setImageUri(capturedUri);

        // Trigger Hybrid Edge ML + Cloud AI analysis in parallel with location fetching
        setIsAnalyzingAI(true);
        setAiResult(null);
        analyzeWasteImage(capturedUri, capturedBase64, (instantPrediction) => {
          setAiResult(instantPrediction);
          if (instantPrediction?.wasteType && instantPrediction.wasteType !== 'Not waste' && instantPrediction.wasteType !== 'Unable to determine') {
            setTitle(`Report: ${instantPrediction.wasteType}`);
          }
        })
          .then((analysis) => {
            setAiResult(analysis);
            console.log('🤖 Hybrid AI final result:', analysis);
            if (analysis?.wasteType && analysis.wasteType !== 'Not waste' && analysis.wasteType !== 'Unable to determine') {
              setTitle(`Report: ${analysis.wasteType}`);
            }
          })
          .catch((err) => {
            console.error('🤖 AI analysis error:', err);
          })
          .finally(() => setIsAnalyzingAI(false));

        setIsFetchingLocation(true);
        
        try {
          let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
          if (!__DEV__ && (loc as any).mocked === true) {
            setImageUri(null);
            setGeoCoords(null);
            Alert.alert("Security Warning", "Mock GPS locations are not permitted for waste reporting.");
            return;
          }
          setGeoCoords({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          });

          // 1. First attempt OpenStreetMap Nominatim Reverse Geocoding (Works on Web, iOS, and Android)
          let resolved = false;
          try {
            const nominatimPlace = await reverseGeocodeCoords(loc.coords.latitude, loc.coords.longitude);
            if (nominatimPlace && (nominatimPlace.street || nominatimPlace.barangay)) {
              setLocationAddress(nominatimPlace.fullAddress);
              if (nominatimPlace.barangay) {
                setBarangay(nominatimPlace.barangay);
              } else if (userProfileBarangay) {
                setBarangay(userProfileBarangay);
              }
              setStreet(nominatimPlace.street || `${loc.coords.latitude.toFixed(5)}, ${loc.coords.longitude.toFixed(5)}`);
              resolved = true;
            }
          } catch (osmErr) {
            console.warn('Nominatim reverse geocode note:', osmErr);
          }

          // 2. Fallback to Expo Native reverse geocode if needed
          if (!resolved) {
            const geocode = await Location.reverseGeocodeAsync({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            });
            if (geocode && geocode.length > 0) {
              const place = geocode[0];
              const addressStr = [place.street, place.city, place.region].filter(Boolean).join(', ');
              setLocationAddress(addressStr || "Unknown Location");

              const matchedBgry = matchBarangayFromGeocode(geocode, availableBarangays);
              if (matchedBgry) {
                setBarangay(matchedBgry);
              } else if (place.district || place.subregion || place.city) {
                setBarangay(place.district || place.subregion || place.city || '');
              } else if (userProfileBarangay) {
                setBarangay(userProfileBarangay);
              } else {
                setBarangay('Unknown Area');
              }
              setStreet(place.street || place.name || `${loc.coords.latitude.toFixed(5)}, ${loc.coords.longitude.toFixed(5)}`);
            } else {
              setLocationAddress("Danao City, Cebu");
              if (userProfileBarangay) {
                setBarangay(userProfileBarangay);
              }
              setStreet(`${loc.coords.latitude.toFixed(5)}, ${loc.coords.longitude.toFixed(5)}`);
            }
          }
        } catch (locErr) {
          console.warn("Failed to get current location, trying last known:", locErr);
          try {
            let loc = await Location.getLastKnownPositionAsync({
              maxAge: 60000,
              requiredAccuracy: 100,
            });
            if (loc) {
              if (!__DEV__ && (loc as any).mocked === true) {
                setImageUri(null);
                setGeoCoords(null);
                Alert.alert("Security Warning", "Mock GPS locations are not permitted for waste reporting.");
                return;
              }
              setGeoCoords({
                lat: loc.coords.latitude,
                lng: loc.coords.longitude,
              });
              try {
                const nominatimPlace = await reverseGeocodeCoords(loc.coords.latitude, loc.coords.longitude);
                if (nominatimPlace) {
                  setLocationAddress(nominatimPlace.fullAddress);
                  if (nominatimPlace.barangay) setBarangay(nominatimPlace.barangay);
                  setStreet(nominatimPlace.street || '');
                }
              } catch {
                setLocationAddress("Danao City, Cebu");
                if (userProfileBarangay) setBarangay(userProfileBarangay);
              }
            } else {
              throw new Error("No recent accurate location");
            }
          } catch (fallbackErr) {
            console.warn("Failed to get fallback location:", fallbackErr);
            Alert.alert("Location Error", "Could not get your exact location. Are you on an emulator? Please set a mock location in the emulator settings.");
          }
        } finally {
          setIsFetchingLocation(false);
        }
      }
    } catch (err) {
      console.error("Error capturing photo or location:", err);
      Alert.alert("Error", "Failed to capture photo.");
      setIsFetchingLocation(false);
    }
  };

  // Helper functions for AI waste type display
  const getWasteTypeIcon = (wasteType: string): string => {
    if (wasteType.includes('Unsegregated') || wasteType.includes('Mixed')) return 'exclamationmark.triangle.fill';
    if (wasteType.includes('Solid')) return 'cube.fill';
    if (wasteType.includes('Liquid')) return 'drop.fill';
    if (wasteType.includes('Organic')) return 'leaf.fill';
    if (wasteType.includes('Recyclable')) return 'arrow.triangle.2.circlepath';
    if (wasteType.includes('Hazardous')) return 'exclamationmark.triangle.fill';
    if (wasteType.includes('Cannot determine')) return 'questionmark.circle.fill';
    if (wasteType.includes('Not waste')) return 'xmark.circle.fill';
    if (wasteType.includes('Temporarily')) return 'clock.fill';
    return 'sparkles';
  };

  const getWasteTypeColor = (wasteType: string): string => {
    if (wasteType.includes('Unsegregated') || wasteType.includes('Mixed')) return '#D97706';
    if (wasteType.includes('Solid')) return '#2563EB';
    if (wasteType.includes('Liquid')) return '#0891B2';
    if (wasteType.includes('Organic')) return '#059669';
    if (wasteType.includes('Recyclable')) return '#D97706';
    if (wasteType.includes('Hazardous')) return '#DC2626';
    if (wasteType.includes('Cannot determine')) return '#9CA3AF';
    if (wasteType.includes('Not waste')) return '#EF4444';
    if (wasteType.includes('Temporarily')) return '#6B7280';
    return '#4A6741';
  };

  const getCollectionCategoryStyle = (category?: string, isUnseg?: boolean) => {
    if (isUnseg || category === 'Unsegregated') {
      return { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A', label: 'UNSEGREGATED / MIXED' };
    }
    if (category === 'Biodegradable') {
      return { bg: '#DCFCE7', text: '#166534', border: '#BBF7D0', label: 'BIODEGRADABLE TRUCK' };
    }
    return { bg: '#DBEAFE', text: '#1E40AF', border: '#BFDBFE', label: 'NON-BIODEGRADABLE TRUCK' };
  };

  const filteredBarangays = useMemo(() => {
    const q = barangaySearchText.trim().toLowerCase();
    if (!q) return availableBarangays;
    return availableBarangays.filter((b) => b.toLowerCase().includes(q));
  }, [availableBarangays, barangaySearchText]);

  // Check if the current AI result allows submission
  const canSubmitReport = useMemo(() => {
    if (verificationStatus === 'rejected') return false;
    // No AI result yet — block submission
    if (!aiResult) return false;
    // Not waste — block submission
    if (aiResult.wasteType === 'Not waste') return false;
    // Temporarily unavailable — block submission
    if (aiResult.wasteType === 'Temporarily unavailable') return false;
    // Unable to determine (fallback) — block submission
    if (aiResult.wasteType === 'Unable to determine') return false;
    return true;
  }, [aiResult, verificationStatus]);

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 25}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 30), paddingBottom: Math.max(insets.bottom, 12) + 20 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Text style={styles.headerTitle}>Report a Trash Pile</Text>

          {/* Top Notice Banner: Concluded Collection / Route Completed */}
          {!!(barangay || userProfileBarangay) && !!currentScheduleStatus && (currentScheduleStatus.isLate || currentScheduleStatus.isDriverCompletedToday) && (
            <View style={styles.topLateNoticeBanner}>
              <View style={styles.topLateNoticeIconWrap}>
                <Ionicons name="information-circle" size={24} color="#B45309" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.topLateNoticeTitle}>
                  {currentScheduleStatus.isDriverCompletedToday
                    ? `Today's Collection Complete — Next Collection ${currentScheduleStatus.nextCollectionDayStr}`
                    : currentScheduleStatus.isPastScheduledTime
                    ? "After Collection Hours Notice"
                    : `No Scheduled Collection Today — Next Collection ${currentScheduleStatus.nextCollectionDayStr}`}
                </Text>
                <Text style={styles.topLateNoticeText}>
                  {currentScheduleStatus.isDriverCompletedToday
                    ? `Today's waste collection for Brgy. ${barangay || userProfileBarangay} is already done. Any trash reported now cannot be collected today — it will be scheduled for the next collection round (${currentScheduleStatus.nextCollectionDayStr}).`
                    : currentScheduleStatus.isPastScheduledTime
                    ? `Scheduled collection for Brgy. ${barangay || userProfileBarangay} concluded today at ${currentScheduleStatus.scheduledTimeStr}. Waste reported now cannot be collected today and will be queued for collection ${currentScheduleStatus.nextCollectionDayStr.toLowerCase()}.`
                    : `There is no regular collection scheduled today for Brgy. ${barangay || userProfileBarangay}. Waste reported today will be queued for collection on ${currentScheduleStatus.nextCollectionDayStr}.`}
                </Text>
              </View>
            </View>
          )}

          {/* Rejection Alert Banner if rejected */}
          {verificationStatus === 'rejected' && (
            <View style={{
              backgroundColor: '#FEF2F2',
              borderColor: '#FECACA',
              borderWidth: 1.5,
              borderRadius: 14,
              padding: 14,
              marginBottom: 16,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 12,
            }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="alert-circle" size={22} color="#DC2626" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: '#991B1B', marginBottom: 2 }}>
                  Waste Reporting Restricted
                </Text>
                <Text style={{ fontSize: 12, color: '#B91C1C', lineHeight: 16, marginBottom: 8 }}>
                  Your residency proof was rejected ({rejectionReason || 'document unverified'}). You can still view collection schedules and live trucks, but report submissions require an active Danao City residency verification.
                </Text>
                <TouchableOpacity
                  style={{
                    backgroundColor: '#DC2626',
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 6,
                    alignSelf: 'flex-start',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  }}
                  onPress={() => router.push('/(tabs)/profile?reupload=true' as any)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="document-attach" size={14} color="#FFFFFF" />
                  <Text style={{ color: '#FFFFFF', fontSize: 11.5, fontWeight: '700' }}>Fix Proof of Residency</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Photo upload placeholder */}
          <TouchableOpacity style={styles.photoCard} onPress={handleTakePhoto} disabled={isFetchingLocation}>
            {imageUri ? (
              <View style={{ width: "100%", height: "100%", position: 'relative' }}>
                <Image
                  source={{ uri: imageUri }}
                  style={{ width: "100%", height: "100%", borderRadius: 12 }}
                />
                {isFetchingLocation && (
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }}>
                    <ActivityIndicator size="large" color="#4A6741" />
                    <Text style={{ marginTop: 8, color: '#4A6741', fontWeight: 'bold' }}>Acquiring GPS...</Text>
                  </View>
                )}
                {geoCoords && !isFetchingLocation && (
                  <View style={{ position: 'absolute', bottom: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
                    <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>
                      {geoCoords.lat.toFixed(5)}, {geoCoords.lng.toFixed(5)}
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.photoPlaceholder}>
                <IconSymbol name="camera.fill" size={36} color="#4A6741" />
                <Text style={styles.photoTextMain}>Capture Trash Pile <Text style={{ color: '#EF4444', fontWeight: 'bold' }}>*</Text></Text>
                <Text style={styles.photoTextSub}>Tap to take a Geo-Photo</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* AI Suggestions */}
          <View style={styles.aiSectionHeader}>
            <IconSymbol name="sparkles" size={16} color="#4A6741" />
            <Text style={styles.aiSectionTitle}>AI SUGGESTIONS</Text>
            {aiResult?.confidence && aiResult.confidence !== 'none' && (
              <View style={[
                styles.confidenceBadge,
                { backgroundColor: aiResult.confidence === 'high' ? '#D1FAE5' : aiResult.confidence === 'medium' ? '#FEF3C7' : '#FEE2E2' }
              ]}>
                <Text style={[
                  styles.confidenceText,
                  { color: aiResult.confidence === 'high' ? '#065F46' : aiResult.confidence === 'medium' ? '#92400E' : '#991B1B' }
                ]}>
                  {aiResult.confidence.toUpperCase()} CONFIDENCE
                </Text>
              </View>
            )}
          </View>

          {aiResult ? (
            <>
              <View style={styles.aiRow}>
                <View style={styles.aiCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.aiCardLabel}>Waste Type</Text>
                    {isAnalyzingAI && (
                      <ActivityIndicator size="small" color="#4A6741" style={{ transform: [{ scale: 0.7 }] }} />
                    )}
                  </View>
                  <View style={styles.aiCardValueRow}>
                    <IconSymbol
                      name={getWasteTypeIcon(aiResult.wasteType)}
                      size={18}
                      color={getWasteTypeColor(aiResult.wasteType)}
                    />
                    <Text
                      style={[styles.aiCardValue, { color: getWasteTypeColor(aiResult.wasteType) }]}
                      numberOfLines={2}
                      ellipsizeMode="tail"
                    >
                      {aiResult.wasteType}
                    </Text>
                  </View>
                  {aiResult.wasteType !== 'Not waste' && aiResult.wasteType !== 'Unable to determine' && aiResult.wasteType !== 'Temporarily unavailable' && (() => {
                    const catStyle = getCollectionCategoryStyle(
                      aiResult.collectionCategory || (aiResult.wasteType.includes('Organic') ? 'Biodegradable' : 'Non-Biodegradable'),
                      aiResult.isUnsegregated
                    );
                    return (
                      <View style={{
                        marginTop: 6,
                        alignSelf: 'flex-start',
                        backgroundColor: catStyle.bg,
                        borderColor: catStyle.border,
                        borderWidth: 1,
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                        borderRadius: 6,
                      }}>
                        <Text style={{ fontSize: 9.5, fontWeight: '800', color: catStyle.text, letterSpacing: 0.3 }}>
                          {catStyle.label}
                        </Text>
                      </View>
                    );
                  })()}
                </View>
                <View style={styles.aiCard}>
                  <Text style={styles.aiCardLabel}>Estimated Weight</Text>
                  <View style={styles.aiCardValueRow}>
                    <IconSymbol name="scalemass.fill" size={18} color="#4A6741" />
                    <Text style={styles.aiCardValue} numberOfLines={2} ellipsizeMode="tail">
                      {formatWasteAmount(aiResult.estimatedWeight)}
                    </Text>
                  </View>
                  {aiResult.wasteType !== 'Not waste' && aiResult.wasteType !== 'Unable to determine' && aiResult.wasteType !== 'Temporarily unavailable' && (
                    <View style={{
                      marginTop: 6,
                      alignSelf: 'flex-start',
                      backgroundColor: aiResult.isUnsegregated ? '#FEF3C7' : '#ECFDF5',
                      borderColor: aiResult.isUnsegregated ? '#FDE68A' : '#A7F3D0',
                      borderWidth: 1,
                      paddingHorizontal: 7,
                      paddingVertical: 2,
                      borderRadius: 6,
                    }}>
                      <Text style={{
                        fontSize: 9.5,
                        fontWeight: '800',
                        color: aiResult.isUnsegregated ? '#B45309' : '#047857',
                        letterSpacing: 0.3,
                      }}>
                        {aiResult.isUnsegregated ? '+25 PTS (UNSEGREGATED)' : '+50 PTS (SEGREGATED)'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Multi-type detected physical tags if more than 1 physical stream */}
              {aiResult.wasteTypes && aiResult.wasteTypes.length > 1 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {aiResult.wasteTypes.map((wt, i) => (
                    <View
                      key={i}
                      style={{
                        backgroundColor: '#F3F4F6',
                        borderWidth: 1,
                        borderColor: '#E5E7EB',
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 8,
                      }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '600', color: '#374151' }}>{wt}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Yellow Notice Banner when Unsegregated Waste is detected */}
              {aiResult.isUnsegregated && (
                <View style={styles.lateScheduleBanner}>
                  <View style={styles.lateScheduleBannerIconWrap}>
                    <IconSymbol name="exclamationmark.triangle.fill" size={18} color="#D97706" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lateScheduleBannerTitle}>
                      Unsegregated Waste • Reduced Points (+25 pts)
                    </Text>
                    <Text style={styles.lateScheduleBannerText}>
                      Multiple mixed waste types ({(aiResult.wasteTypes || []).join(', ') || 'Mixed'}) were detected. Segregating Biodegradable and Non-Biodegradable waste earns the full +50 reward points and speeds up collector pickup!
                    </Text>
                  </View>
                </View>
              )}

              {aiResult.details && (
                <View style={styles.aiDetailsCard}>
                  <IconSymbol name="info.circle.fill" size={14} color="#6B7280" />
                  <Text style={styles.aiDetailsText}>{aiResult.details}</Text>
                </View>
              )}
            </>
          ) : isAnalyzingAI ? (
            <View style={styles.aiLoadingContainer}>
              <ActivityIndicator size="small" color="#4A6741" />
              <Text style={styles.aiLoadingText}>Analyzing waste with AI...</Text>
            </View>
          ) : (
            <View style={styles.aiEmptyContainer}>
              <IconSymbol name="camera.fill" size={20} color="#9CA3AF" />
              <Text style={styles.aiEmptyText}>Take a photo to get AI analysis</Text>
            </View>
          )}

          {/* Title */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Report Title <Text style={{ color: '#EF4444', fontWeight: 'bold' }}>*</Text></Text>
            <View style={styles.inputField}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="What are you reporting?"
                placeholderTextColor="#7C8E80"
                style={styles.inputText}
              />
            </View>
            <View style={styles.tagsRow}>
              <TouchableOpacity style={styles.tagBadge} onPress={() => setTitle("Illegal Dumping")}>
                <Text style={styles.tagText}>Illegal Dumping</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.tagBadge} onPress={() => setTitle("Missed Pickup")}>
                <Text style={styles.tagText}>Missed Pickup</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Location Map */}
          <View style={styles.mapContainer}>
            {geoCoords ? (
              <View style={{ height: 180, borderRadius: 16, overflow: 'hidden', position: 'relative' }}>
                <ErrorBoundary
                  fallback={
                    <View style={[styles.mockMapBg, { height: 180 }]}>
                      <IconSymbol name="mappin.circle.fill" size={36} color="#4A6741" />
                      <Text style={[styles.mapAddressText, { marginTop: 6 }]}>{locationAddress || 'Location attached'}</Text>
                    </View>
                  }
                >
                  <OpenStreetMap
                    style={{ width: '100%', height: '100%' }}
                    initialCenter={{ latitude: geoCoords.lat, longitude: geoCoords.lng }}
                    userCoordinate={{ latitude: geoCoords.lat, longitude: geoCoords.lng }}
                    zoom={16}
                    interactive={false}
                  />
                </ErrorBoundary>
                <View style={styles.mapAddressBadge}>
                  <IconSymbol name="location.fill" size={14} color="#4A6741" />
                  <Text style={styles.mapAddressText} numberOfLines={1}>{locationAddress}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.mockMapBg}>
                <View style={styles.mockMapPinContainer}>
                   <IconSymbol name="mappin.circle.fill" size={48} color="#4A6741" />
                </View>
                <View style={styles.mapAddressBadge}>
                  <IconSymbol name="location.fill" size={14} color="#4A6741" />
                  <Text style={styles.mapAddressText}>Location will appear here</Text>
                </View>
              </View>
            )}
          </View>

          {/* Barangay & Street Inputs (Auto-filled & Pickable from collection schedules) */}
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={styles.label}>Barangay <Text style={{ color: '#EF4444', fontWeight: 'bold' }}>*</Text></Text>
                {Boolean(barangay) && scheduleBarangaySet.has(barangay) && (
                  <View style={styles.inlineScheduleBadge}>
                    <Text style={styles.inlineScheduleBadgeText}>Scheduled</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                style={[styles.inputField, { paddingVertical: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
                onPress={() => {
                  setBarangaySearchText('');
                  setShowBarangay(true);
                }}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.inputText, !barangay && { color: "#7C8E80" }]}
                  numberOfLines={1}
                >
                  {barangay || "Select Barangay"}
                </Text>
                <Ionicons name="chevron-down" size={18} color="#4A6741" />
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { marginBottom: 8 }]}>Street <Text style={{ color: '#EF4444', fontWeight: 'bold' }}>*</Text></Text>
              <View style={[styles.inputField, { paddingVertical: 12, paddingHorizontal: 12 }]}>
                <TextInput
                  value={street}
                  onChangeText={setStreet}
                  placeholder="e.g. V. Rama Ave"
                  placeholderTextColor="#7C8E80"
                  style={styles.inputText}
                />
              </View>
            </View>
          </View>

          {/* Late Schedule Notice Banner */}
          {!!(barangay || userProfileBarangay) && !!currentScheduleStatus && (currentScheduleStatus.isLate || currentScheduleStatus.isDriverCompletedToday) && (
            <View style={styles.lateScheduleBanner}>
              <View style={styles.lateScheduleBannerIconWrap}>
                <Ionicons name="time" size={20} color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.lateScheduleBannerTitle}>
                  Heads-Up: Next Pickup {currentScheduleStatus.nextCollectionDayStr}
                </Text>
                <Text style={styles.lateScheduleBannerText}>
                  {currentScheduleStatus.isDriverCompletedToday
                    ? `Collection for ${barangay || userProfileBarangay} is concluded for today. This report cannot be picked up today and will be queued as backlog for ${currentScheduleStatus.nextCollectionDayStr}.`
                    : currentScheduleStatus.isPastScheduledTime
                    ? `Collection for ${barangay || userProfileBarangay} was scheduled at ${currentScheduleStatus.scheduledTimeStr} and has concluded for today. This report will be queued for ${currentScheduleStatus.nextCollectionDayStr.toLowerCase()}.`
                    : `No collection scheduled today for ${barangay || userProfileBarangay}. This report will be queued for ${currentScheduleStatus.nextCollectionDayStr}.`}
                </Text>
              </View>
            </View>
          )}

          {/* Upcoming Schedule Notice Banner: Pickup later today */}
          {!!(barangay || userProfileBarangay) && !!currentScheduleStatus && currentScheduleStatus.isUpcomingToday && (
            <View style={styles.upcomingScheduleBanner}>
              <View style={styles.upcomingScheduleBannerIconWrap}>
                <Ionicons name="checkmark-circle" size={20} color="#166534" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.upcomingScheduleBannerTitle}>
                  Pickup Scheduled Today at {currentScheduleStatus.scheduledTimeStr}
                </Text>
                <Text style={styles.upcomingScheduleBannerText}>
                  Collection for {barangay || userProfileBarangay} is scheduled for today at {currentScheduleStatus.scheduledTimeStr}. Reports submitted now can still be collected today!
                </Text>
              </View>
            </View>
          )}

          {/* Description */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Additional Notes <Text style={{ color: '#6B7280', fontSize: 12, fontWeight: 'normal' }}>(Optional)</Text></Text>
            <View style={styles.textArea}>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Any specific instructions for the pickup crew?"
                placeholderTextColor="#7C8E80"
                style={styles.textAreaInput}
                multiline
              />
            </View>
          </View>

          {/* Upload Progress */}
          {isUploading && (
            <View style={styles.progressContainer}>
              <Text style={styles.progressText}>
                {uploadProgress < 25
                  ? "Preparing..."
                  : uploadProgress < 75
                  ? "Uploading image..."
                  : "Submitting report..."}
              </Text>
              <View style={styles.progressBar}>
                <View
                  style={[styles.progressFill, { width: `${uploadProgress}%` }]}
                />
              </View>
            </View>
          )}

          {/* Points Badge & Submit */}
          <View style={styles.submitSection}>
            <View style={styles.pointsBadgeSubmit}>
               <IconSymbol name="star.circle.fill" size={16} color="#4A6741" />
               <Text style={styles.pointsBadgeText}>+50 POINTS WHEN RESOLVED</Text>
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, (isUploading || !canSubmitReport) && styles.submitBtnDisabled]}
              activeOpacity={0.8}
              onPress={() => handleSendReport(false)}
              disabled={isUploading || !canSubmitReport}
            >
              <Text style={styles.submitText}>
                {isUploading ? "Submitting..." : "Submit Report"}
              </Text>
              <IconSymbol name="paperplane.fill" size={16} color="white" />
            </TouchableOpacity>
            {!canSubmitReport && !isUploading && (
              <Text style={{ color: '#DC2626', fontSize: 12, textAlign: 'center', marginTop: 6 }}>
                {verificationStatus === 'rejected'
                  ? '🚫 Waste reporting is locked because your ID was rejected. Please re-upload in Profile.'
                  : !aiResult
                  ? '📸 Take a photo first so the AI can classify the waste'
                  : aiResult.wasteType === 'Not waste'
                  ? '🚫 This photo does not contain waste — please retake'
                  : '⚠️ AI could not determine waste type — please retake the photo'}
              </Text>
            )}
            <Text style={styles.submitFooterText}>
              By submitting, you&apos;ll earn 50 Community Points and help reach the &quot;Cleanest Quarter&quot; goal!
            </Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Barangay Selection Modal */}
      <Modal
        visible={showBarangay}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBarangay(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Select Barangay</Text>
                <Text style={styles.modalSubtitle}>From collection schedules &amp; Danao areas</Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setShowBarangay(false)}
              >
                <Ionicons name="close" size={22} color="#4A6741" />
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <View style={styles.modalSearchContainer}>
              <Ionicons name="search" size={18} color="#7C8E80" />
              <TextInput
                value={barangaySearchText}
                onChangeText={setBarangaySearchText}
                placeholder="Search barangay..."
                placeholderTextColor="#7C8E80"
                style={styles.modalSearchInput}
                autoFocus={false}
              />
              {barangaySearchText.length > 0 && (
                <TouchableOpacity onPress={() => setBarangaySearchText("")}>
                  <Ionicons name="close-circle" size={18} color="#7C8E80" />
                </TouchableOpacity>
              )}
            </View>

            {/* List of Barangays */}
            <FlatList
              data={filteredBarangays}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 360 }}
              renderItem={({ item }) => {
                const isSelected = barangay.toLowerCase().trim() === item.toLowerCase().trim();
                const isScheduled = scheduleBarangaySet.has(item);
                return (
                  <TouchableOpacity
                    style={[styles.barangayOption, isSelected && styles.barangayOptionSelected]}
                    onPress={() => {
                      setBarangay(item);
                      setShowBarangay(false);
                    }}
                  >
                    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Ionicons
                        name={isSelected ? "checkmark-circle" : "location-outline"}
                        size={18}
                        color={isSelected ? "#2E7D32" : "#4A6741"}
                      />
                      <Text style={[styles.barangayOptionText, isSelected && styles.barangayOptionTextSelected]}>
                        {item}
                      </Text>
                      {isScheduled && (
                        <View style={styles.scheduledBadge}>
                          <Text style={styles.scheduledBadgeText}>Scheduled Area</Text>
                        </View>
                      )}
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark" size={18} color="#2E7D32" />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={{ padding: 24, alignItems: "center" }}>
                  <Text style={{ color: "#7C8E80", fontSize: 14 }}>No barangays matching &quot;{barangaySearchText}&quot;</Text>
                </View>
              }
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Late Report Notice Modal (Consultant Revision #4) */}
      <Modal
        visible={showLateReportModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLateReportModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 440 }]}>
            <View style={styles.lateModalHeader}>
              <View style={styles.lateModalWarningBadge}>
                <Ionicons name="alert-circle" size={28} color="#D97706" />
              </View>
              <Text style={styles.lateModalTitle}>Collection Schedule Passed</Text>
              <Text style={styles.lateModalSubtitle}>
                Late Report Advisory • CENRO Dispatch Protocol
              </Text>
            </View>

            <View style={styles.lateModalCard}>
              <View style={styles.lateModalRow}>
                <Text style={styles.lateModalLabel}>BARANGAY SECTOR</Text>
                <Text style={styles.lateModalValue}>{lateReportDetails?.barangayName || barangay}</Text>
              </View>
              <View style={styles.lateModalRow}>
                <Text style={styles.lateModalLabel}>SCHEDULED ROUND</Text>
                <Text style={[styles.lateModalValue, { color: '#B45309', fontWeight: '800' }]}>
                  {lateReportDetails?.todayDow} at {lateReportDetails?.scheduleTime}
                </Text>
              </View>
              <View style={styles.lateModalRow}>
                <Text style={styles.lateModalLabel}>CURRENT TIME</Text>
                <Text style={styles.lateModalValue}>
                  {(() => {
                    try {
                      return new Date().toLocaleTimeString('en-US', {
                        timeZone: 'Asia/Manila',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      });
                    } catch {
                      const d = new Date(Date.now() + 8 * 3600000);
                      const h = d.getUTCHours();
                      const m = d.getUTCMinutes().toString().padStart(2, '0');
                      const ampm = h >= 12 ? 'PM' : 'AM';
                      const h12 = h % 12 || 12;
                      return `${h12}:${m} ${ampm}`;
                    }
                  })()}
                </Text>
              </View>
            </View>

            <Text style={styles.lateModalNoticeText}>
              Waste collection in <Text style={{ fontWeight: '700', color: '#1F2937' }}>{lateReportDetails?.barangayName || barangay || userProfileBarangay}</Text> is already finished for today. Trash <Text style={{ fontWeight: '700', color: '#DC2626' }}>cannot be collected today</Text>. Your report will be logged as a backlog and prioritized for the <Text style={{ fontWeight: '700', color: '#047857' }}>next collection round (Tomorrow)</Text>.
            </Text>

            <View style={styles.lateModalActions}>
              <TouchableOpacity
                style={styles.lateModalCancelBtn}
                onPress={() => setShowLateReportModal(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.lateModalCancelText}>Review Details</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.lateModalSubmitBtn}
                onPress={() => {
                  setShowLateReportModal(false);
                  handleSendReport(true);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.lateModalSubmitText}>Submit for Tomorrow</Text>
                <Ionicons name="paper-plane" size={15} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#E8F5E9" },
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, paddingTop: 60 },
  headerTitle: { fontSize: 24, fontWeight: "700", color: "#234033", marginBottom: 20 },
  
  photoCard: {
    height: 180,
    borderRadius: 16,
    backgroundColor: "#F0F6F0",
    borderWidth: 2,
    borderColor: "#C8D8CA",
    borderStyle: 'dashed',
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    overflow: 'hidden',
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoTextMain: {
    marginTop: 12,
    fontSize: 16,
    color: "#4A6741",
    fontWeight: "700",
  },
  photoTextSub: {
    marginTop: 4,
    fontSize: 13,
    color: "#7C8E80",
  },

  aiSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  aiSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4A6741',
    letterSpacing: 1,
  },
  aiRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  aiCard: {
    flex: 1,
    backgroundColor: '#E2EFE3',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    overflow: 'hidden',
  },
  aiCardLabel: {
    fontSize: 11,
    color: '#6B8C72',
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aiCardValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  aiCardValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#234033',
    flexShrink: 1,
  },

  fieldGroup: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: "700", color: "#4A6741", marginBottom: 8 },
  
  inputField: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#C8D8CA",
  },
  inputText: { fontSize: 15, color: "#234033" },
  
  tagsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  tagBadge: {
    backgroundColor: '#C8E6C9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tagText: {
    color: '#2E7D32',
    fontSize: 13,
    fontWeight: '600',
  },

  mapContainer: {
    marginBottom: 20,
  },
  mockMapBg: {
    backgroundColor: '#7C8E80',
    height: 140,
    borderRadius: 16,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mockMapPinContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  mapAddressBadge: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    backgroundColor: 'white',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapAddressText: {
    fontSize: 13,
    color: '#234033',
    fontWeight: '500',
  },

  textArea: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    minHeight: 100,
    borderWidth: 1,
    borderColor: "#C8D8CA",
  },
  textAreaInput: { fontSize: 15, color: "#234033", textAlignVertical: 'top' },

  submitSection: {
    alignItems: 'center',
    marginTop: 10,
  },
  pointsBadgeSubmit: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#C8E6C9',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    marginBottom: 16,
  },
  pointsBadgeText: {
    color: '#2E7D32',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: "#4A6741",
    paddingVertical: 16,
    width: '100%',
    borderRadius: 12,
    marginBottom: 16,
  },
  submitBtnDisabled: {
    backgroundColor: "#A0A0A0",
  },
  submitText: { color: "white", fontWeight: "700", fontSize: 16 },
  submitFooterText: {
    textAlign: 'center',
    color: '#4B5F4F',
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 20,
  },

  progressContainer: {
    marginBottom: 16,
  },
  progressText: {
    fontSize: 12,
    color: "#4B5F4F",
    textAlign: "center",
    marginBottom: 8,
  },
  progressBar: {
    height: 4,
    backgroundColor: "#E0E0E0",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#4E6E58",
    borderRadius: 2,
  },

  // AI Analysis styles
  aiLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F7F2',
    padding: 20,
    borderRadius: 12,
    marginBottom: 8,
    gap: 10,
  },
  aiLoadingText: {
    color: '#4A6741',
    fontSize: 14,
    fontWeight: '500',
  },
  aiEmptyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
    padding: 20,
    borderRadius: 12,
    marginBottom: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
  },
  aiEmptyText: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  aiDetailsCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    gap: 8,
  },
  aiDetailsText: {
    color: '#6B7280',
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginLeft: 'auto',
  },
  confidenceText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Barangay Schedule Badges & Modal Styles
  inlineScheduleBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  inlineScheduleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#166534',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#234033',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#7C8E80',
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 4,
    borderRadius: 20,
    backgroundColor: '#F0F6F0',
  },
  modalSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F6F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    gap: 8,
  },
  modalSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#234033',
    paddingVertical: 4,
  },
  barangayOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  barangayOptionSelected: {
    backgroundColor: '#E8F5E9',
  },
  barangayOptionText: {
    fontSize: 14,
    color: '#234033',
    fontWeight: '500',
  },
  barangayOptionTextSelected: {
    color: '#2E7D32',
    fontWeight: '700',
  },
  scheduledBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  scheduledBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#166534',
  },
  topLateNoticeBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1.5,
    borderColor: '#FCD34D',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  topLateNoticeIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  topLateNoticeTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#92400E',
    marginBottom: 2,
  },
  topLateNoticeText: {
    fontSize: 12,
    color: '#B45309',
    lineHeight: 17,
  },
  lateScheduleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  lateScheduleBannerIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FDE68A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lateScheduleBannerTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#92400E',
    marginBottom: 2,
  },
  lateScheduleBannerText: {
    fontSize: 11,
    color: '#B45309',
    lineHeight: 16,
  },
  upcomingScheduleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  upcomingScheduleBannerIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  upcomingScheduleBannerTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#166534',
    marginBottom: 2,
  },
  upcomingScheduleBannerText: {
    fontSize: 11,
    color: '#15803D',
    lineHeight: 16,
  },
  lateModalHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  lateModalWarningBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  lateModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
  },
  lateModalSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#D97706',
    marginTop: 2,
    letterSpacing: 0.3,
  },
  lateModalCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 12,
    marginBottom: 14,
    gap: 8,
  },
  lateModalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lateModalLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.5,
  },
  lateModalValue: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1F2937',
  },
  lateModalNoticeText: {
    fontSize: 12,
    color: '#4B5563',
    lineHeight: 18,
    marginBottom: 20,
    textAlign: 'center',
  },
  lateModalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  lateModalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lateModalCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4B5563',
  },
  lateModalSubmitBtn: {
    flex: 1.2,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#D97706',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lateModalSubmitText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
