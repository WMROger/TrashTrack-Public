import EmailVerificationModal from "@/components/EmailVerificationModal";
import { auth, db } from "@/config/firebase";
import { signInWithFacebook, signInWithGoogle } from "@/config/socialAuth";
import { sendResidentWelcomeEmail } from "@/services/emailNotificationService";
import { takePendingAuthRequest } from "@/services/pendingAuthService";
import { IncomingCollectionService } from "@/services/incomingCollectionService";
import { residentNotificationService } from "@/services/residentNotificationService";
import { NotificationService } from "@/services/notificationService";
import { clearDriverSessionOrigin } from "@/services/driverQrService";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import ErrorModal from "../../components/ErrorModal";

const { width, height } = Dimensions.get("window");

export default function LoadingPage() {
  const router = useRouter();
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.8));
  const [loadingText, setLoadingText] = useState("Initializing...");
  const [progress, setProgress] = useState(0);
  const [errorModal, setErrorModal] = useState({
    visible: false,
    title: "Error",
    message: "",
    type: "error" as "error" | "warning" | "info" | "success",
  });

  // Show error modal
  const showError = (
    message: string,
    title = "Error",
    type: "error" | "warning" | "info" | "success" = "error",
  ) => {
    setErrorModal({
      visible: true,
      title,
      message,
      type,
    });
  };

  // Close error modal
  const closeErrorModal = () => {
    setErrorModal((prev) => ({ ...prev, visible: false }));
  };

  // Activation modal state for unverified accounts
  const [activationModalVisible, setActivationModalVisible] = useState(false);
  const [activationEmail, setActivationEmail] = useState("");
  const [activationExpectedPin, setActivationExpectedPin] = useState("");
  const [activationUid, setActivationUid] = useState("");
  const [activationResidentName, setActivationResidentName] =
    useState("Resident");
  const [activationBarangay, setActivationBarangay] = useState("Poblacion");
  const [isResendingPin, setIsResendingPin] = useState(false);
  const [pendingActivationUser, setPendingActivationUser] = useState<{
    user: any;
    cachedProfileData: any;
    isPasswordProvider: boolean;
  } | null>(null);

  // Resend 6-digit activation PIN
  const handleResendActivationPin = async () => {
    if (!activationUid || !activationEmail) return;
    setIsResendingPin(true);
    try {
      const newPin = Math.floor(100000 + Math.random() * 900000).toString();
      if (db) {
        const userRef = doc(db, "users", activationUid);
        await updateDoc(userRef, {
          verificationCode: newPin,
          verificationCodeExpiresAt: new Date(
            Date.now() + 15 * 60 * 1000,
          ).toISOString(),
          updatedAt: serverTimestamp(),
        });
      }
      setActivationExpectedPin(newPin);
      await sendResidentWelcomeEmail({
        toEmail: activationEmail,
        residentName: activationResidentName,
        barangay: activationBarangay,
        verificationCode: newPin,
        uid: activationUid,
      });
    } catch (err) {
      console.error("Error resending activation PIN:", err);
    } finally {
      setIsResendingPin(false);
    }
  };

  // Called when PIN is successfully verified in the modal
  const handleActivationSuccess = async () => {
    setActivationModalVisible(false);
    setLoadingText("Setting up profile...");
    setProgress(90);

    const updatedProfile = {
      ...(pendingActivationUser?.cachedProfileData || {}),
      verified: true,
    };

    // Update user profile asynchronously with updated data
    await upsertUserProfile(
      pendingActivationUser?.isPasswordProvider ? "password" : "oauth",
      updatedProfile,
    );

    setLoadingText("Almost ready...");
    setProgress(100);

    // Navigate based on role immediately using updated data
    await navigateBasedOnRole(updatedProfile);
  };

  // Called if user dismisses or cancels the activation modal
  const handleActivationModalClose = async () => {
    setActivationModalVisible(false);
    try {
      await signOut(auth);
    } catch {}
    router.replace("/(auth)/login" as any);
  };

  // Helper function to update user profile in Firestore
  const upsertUserProfile = async (provider: string, cachedData?: any) => {
    try {
      const user = auth?.currentUser;
      if (!user || !db) return;

      const userRef = doc(db, "users", user.uid);
      let existingData = cachedData;
      if (existingData === undefined) {
        const userSnap = await getDoc(userRef);
        existingData = userSnap.exists() ? userSnap.data() : null;
      }

      if (!existingData) {
        // New user - create profile adhering strictly to security rules
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email || "",
          displayName: user.displayName || user.email?.split("@")[0] || "User",
          name: user.displayName || user.email?.split("@")[0] || "User",
          verified: user.emailVerified === true,
          role: "user", // Default role
          provider: provider,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        console.log("Created new user profile");
      } else {
        // Existing user - update login timestamp
        const emailLower = (
          user.email ||
          existingData?.email ||
          ""
        ).toLowerCase();
        const isSeedResident =
          emailLower.startsWith("luthar") &&
          emailLower.includes("trashtrack.com");
        const isSpecialVerified =
          existingData?.verified === true ||
          existingData?.role === "driver" ||
          existingData?.role === "admin" ||
          existingData?.role === "cenro" ||
          existingData?.role === "cicto" ||
          existingData?.role === "coordinator" ||
          isSeedResident;
        await setDoc(
          userRef,
          {
            email: user.email || existingData?.email || "",
            displayName:
              user.displayName ||
              existingData?.displayName ||
              existingData?.name ||
              "User",
            verified: isSpecialVerified ? true : user.emailVerified === true,
            updatedAt: serverTimestamp(),
            lastLogin: serverTimestamp(),
          },
          { merge: true },
        );
        console.log("Updated existing user profile");
      }
    } catch (error) {
      console.warn("Upserting user profile note:", error);
    }
  };

  useEffect(() => {
    // Start animations
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();

    // Start authentication process
    const handleAuthentication = async () => {
      try {
        const pendingAuth = takePendingAuthRequest();

        if (pendingAuth?.kind === "email") {
          await handleEmailPasswordAuth(pendingAuth);
        } else if (pendingAuth?.kind === "social") {
          await handleSocialAuth(pendingAuth.provider);
        } else {
          // No authentication data found - this shouldn't happen
          showError(
            "No authentication data found. Please try logging in again.",
            "Authentication Error",
            "error",
          );
          setTimeout(() => {
            router.replace("/(auth)/login" as any);
          }, 2000);
        }
      } catch (error: any) {
        console.error("Error during authentication:", error);
        showError(
          "Authentication failed. Please try again.",
          "Authentication Error",
          "error",
        );
        setTimeout(() => {
          router.replace("/(auth)/login" as any);
        }, 2000);
      }
    };

    // Start authentication immediately after UI mount
    const authTimeout = setTimeout(handleAuthentication, 100);

    return () => {
      clearTimeout(authTimeout);
    };
  }, [router, fadeAnim, scaleAnim]);

  // Handle email/password authentication
  const handleEmailPasswordAuth = async (credentials: any) => {
    try {
      setLoadingText("Verifying credentials...");
      setProgress(25);

      if (!auth) {
        throw new Error("Firebase auth not available");
      }

      if (!process.env.EXPO_PUBLIC_FIREBASE_API_KEY) {
        throw new Error("missing-firebase-config");
      }

      // Add a 30-second timeout race to prevent indefinite hang on Android network issues
      const authPromise = signInWithEmailAndPassword(
        auth,
        credentials.email,
        credentials.password,
      );
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("auth/timeout")), 30000),
      );

      const userCredential = (await Promise.race([
        authPromise,
        timeoutPromise,
      ])) as any;
      const user = userCredential.user;
      console.log("User logged in successfully:", user.email);

      setLoadingText("Checking user role...");
      setProgress(50);

      const normEmail = (credentials?.email || user.email || "").toLowerCase();
      const isSeedResident =
        normEmail.startsWith("luthar") && normEmail.includes("trashtrack.com");
      let isDriverOrPreVerified = isSeedResident;

      let cachedProfileData: any = null;
      // Check user role from Firestore and route properly
      if (db) {
        try {
          await user.getIdToken(true);
        } catch {}
        let snap: any = null;
        try {
          snap = await getDoc(doc(db, "users", user.uid));
        } catch (getDocErr) {
          console.warn("loading.tsx: primary profile getDoc error:", getDocErr);
        }

        if ((!snap || !snap.exists()) && normEmail) {
          try {
            const { query, collection, where, limit, getDocs } = await import("firebase/firestore");
            const q = query(collection(db, "users"), where("email", "==", normEmail), limit(1));
            const querySnap = await getDocs(q);
            if (!querySnap.empty) {
              snap = querySnap.docs[0];
            }
          } catch (queryErr) {
            console.warn("loading.tsx: fallback email query error:", queryErr);
          }
        }

        if (snap && snap.exists()) {
          cachedProfileData = snap.data();
          const userRole = String((cachedProfileData as any)?.role || "user")
            .toLowerCase()
            .trim();
          const isStaffRole =
            userRole === "driver" ||
            userRole === "admin" ||
            userRole === "cicto" ||
            userRole === "cenro" ||
            userRole === "coordinator";

          const isVerifiedAccount =
            (cachedProfileData as any)?.verified === true ||
            (cachedProfileData as any)?.verified === "true" ||
            (cachedProfileData as any)?.verificationStatus === "verified" ||
            (cachedProfileData as any)?.confirmedByCenro === true ||
            ((cachedProfileData as any)?.verificationCode === null && (cachedProfileData as any)?.verified !== false);

          if (
            isStaffRole ||
            isVerifiedAccount ||
            isSeedResident
          ) {
            isDriverOrPreVerified = true;
          } else {
            isDriverOrPreVerified = false;
          }

          // Handle admin, coordinator, and cicto logins
          if (userRole === "cicto" || userRole === "cicto_admin") {
            if (Platform.OS === "web") {
              router.replace("/cicto/dashboard" as any);
              return;
            } else {
              try {
                await signOut(auth);
              } catch {}

              showError(
                "CICTO access is restricted to the desktop website. Please log in on a computer.",
                "Restricted Access",
                "warning",
              );
              setTimeout(() => {
                router.replace("/(auth)/login" as any);
              }, 4000);
              return;
            }
          } else if (
            userRole === "admin" ||
            userRole === "cenro" ||
            userRole === "coordinator" ||
            userRole === "barangay_coordinator"
          ) {
            if (Platform.OS === "web") {
              router.replace("/admin/dashboard" as any);
              return;
            } else {
              try {
                await signOut(auth);
              } catch {}

              const message =
                userRole === "coordinator" ||
                userRole === "barangay_coordinator"
                  ? "Barangay Coordinator access is restricted to the desktop website. Please log in on a computer."
                  : "Admin access is restricted to the desktop website. Please log in on a computer.";
              showError(message, "Restricted Access", "warning");
              setTimeout(() => {
                router.replace("/(auth)/login" as any);
              }, 4000);
              return;
            }
          }
        }
      }

      setLoadingText("Verifying credentials...");
      setProgress(75);

      // Password accounts must verify their email before proceeding (unless pre-verified or driver).
      const isPasswordProvider =
        Array.isArray(user.providerData) &&
        user.providerData.some((p: any) => p?.providerId === "password");

      const isAlreadyVerified =
        isDriverOrPreVerified ||
        user.emailVerified ||
        cachedProfileData?.verified === true ||
        cachedProfileData?.verified === "true" ||
        cachedProfileData?.verificationStatus === "verified" ||
        cachedProfileData?.confirmedByCenro === true ||
        (cachedProfileData?.verificationCode === null && cachedProfileData?.verified !== false);

      if (isPasswordProvider && !isAlreadyVerified) {
        setPendingActivationUser({
          user,
          cachedProfileData,
          isPasswordProvider,
        });
        setActivationEmail(user.email || normEmail);
        setActivationUid(user.uid);
        setActivationExpectedPin(
          cachedProfileData?.verificationCode
            ? String(cachedProfileData.verificationCode)
            : "",
        );
        setActivationResidentName(
          cachedProfileData?.displayName ||
            cachedProfileData?.name ||
            user.displayName ||
            "Resident",
        );
        setActivationBarangay(
          cachedProfileData?.barangay ||
            cachedProfileData?.assignedBarangay ||
            "Poblacion",
        );
        setActivationModalVisible(true);
        return;
      }

      setLoadingText("Setting up profile...");
      setProgress(90);

      // Update user profile asynchronously with cached data (non-blocking)
      upsertUserProfile(
        isPasswordProvider ? "password" : "oauth",
        cachedProfileData,
      );

      setLoadingText("Almost ready...");
      setProgress(100);

      // Navigate based on role immediately using already-resolved data
      await navigateBasedOnRole(cachedProfileData);
    } catch (error: any) {
      console.warn("Email/password authentication error:", error);
      let errorMessage = "Login failed. Please try again.";
      let errorTitle = "Authentication Failed";

      const isQuota =
        error?.code === "resource-exhausted" ||
        error?.message?.includes("Quota exceeded") ||
        error?.message?.includes("resource-exhausted");

      if (error?.message === "missing-firebase-config") {
        errorTitle = "App Configuration Missing";
        errorMessage =
          "Firebase credentials were not found in this app build. Please verify that build environment variables were included.";
      } else if (
        error?.message === "auth/timeout" ||
        error?.code === "auth/timeout"
      ) {
        errorTitle = "Connection Timeout";
        errorMessage =
          "Connecting to authentication server timed out (30s). If you updated this app over an older version, please UNINSTALL the app from your phone first and reinstall it freshly.";
      } else if (isQuota) {
        errorTitle = "Database Quota Exceeded";
        errorMessage =
          "Firebase free daily database quota has been reached for today. Operations will resume once the daily quota resets (~3:00 PM PHT) or when upgraded to the Blaze plan.";
      } else if (error.code === "auth/invalid-credential") {
        errorMessage =
          "Invalid email, username, or password. Please verify your credentials and try again.";
      } else if (error.code === "auth/user-not-found") {
        errorMessage = "No account found with this email or username.";
      } else if (error.code === "auth/wrong-password") {
        errorMessage = "Incorrect password. Please try again.";
      } else if (error.code === "auth/invalid-email") {
        errorMessage = "Invalid email address.";
      } else if (error.code === "auth/too-many-requests") {
        errorMessage = "Too many failed attempts. Please try again later.";
      } else if (error.code === "auth/network-request-failed") {
        errorMessage =
          "Network error connecting to Firebase. Please check your internet connection or reinstall the app.";
      } else if (error.code === "auth/user-disabled") {
        errorMessage = "This account has been disabled.";
      }

      showError(errorMessage, errorTitle, isQuota ? "warning" : "error");
      setTimeout(
        () => {
          router.replace("/(auth)/login" as any);
        },
        isQuota ? 6000 : 5000,
      );
    }
  };

  // Handle social authentication
  const handleSocialAuth = async (authType: string) => {
    try {
      setLoadingText(`Signing in with ${authType}...`);
      setProgress(25);

      let result;
      if (authType === "google") {
        result = await signInWithGoogle();
      } else if (authType === "facebook") {
        result = await signInWithFacebook();
      } else {
        throw new Error("Unsupported authentication type");
      }

      if (!result.success) {
        throw new Error(result.error || `${authType} sign-in failed`);
      }

      setLoadingText("Setting up profile...");
      setProgress(75);

      let cachedSocialData: any = null;
      if (db && auth?.currentUser) {
        const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
        if (snap.exists()) cachedSocialData = snap.data();
      }

      upsertUserProfile(authType, cachedSocialData);

      setLoadingText("Almost ready...");
      setProgress(100);

      // Navigate based on role using cached profile
      await navigateBasedOnRole(cachedSocialData);
    } catch (error: any) {
      console.warn(`${authType} authentication error:`, error);
      showError(
        error.message || `${authType} sign-in failed`,
        "Authentication Failed",
        "error",
      );
      setTimeout(() => {
        router.replace("/(auth)/login" as any);
      }, 3000);
    }
  };

  // Navigate based on user role
  const navigateBasedOnRole = async (cachedData?: any) => {
    try {
      const currentUser = auth?.currentUser;
      if (currentUser) {
        let userData = cachedData;
        if ((!userData || !userData.role) && db) {
          try {
            await currentUser.getIdToken(true);
            const snap = await getDoc(doc(db, "users", currentUser.uid));
            if (snap.exists()) {
              userData = snap.data();
            }
          } catch (retryErr) {
            console.warn(
              "loading.tsx: fallback profile fetch error:",
              retryErr,
            );
          }
        }
        userData = userData || {};
        const role = String(userData?.role || "user")
          .toLowerCase()
          .trim();

        // Check if temporary access code/password has expired (5-minute limit)
        const nowMillis = Date.now();
        const expiresAtMillis = userData?.temporaryPasswordExpiresAt?.toMillis
          ? userData.temporaryPasswordExpiresAt.toMillis()
          : userData?.temporaryPasswordExpiresAt
            ? new Date(userData.temporaryPasswordExpiresAt).getTime()
            : null;

        if (
          userData?.mustChangePassword === true &&
          expiresAtMillis &&
          nowMillis > expiresAtMillis
        ) {
          try {
            await signOut(auth);
          } catch {}
          showError(
            "Your temporary access code/password has expired (valid for 5 minutes). Please contact your administrator to re-provision credentials.",
            "Access Code Expired",
            "error",
          );
          setTimeout(() => {
            router.replace("/(auth)/login" as any);
          }, 3500);
          return;
        }

        if (role === "cicto" || role === "cicto_admin") {
          if (Platform.OS !== "web") {
            try {
              await signOut(auth);
            } catch {}
            showError(
              "CICTO access is restricted to the desktop website. Please log in on a computer.",
              "Restricted Access",
              "warning",
            );
            setTimeout(() => {
              router.replace("/(auth)/login" as any);
            }, 3000);
            return;
          }
          console.log("CICTO user detected, redirecting to CICTO dashboard");
          router.replace("/cicto/dashboard" as any);
        } else if (
          role === "admin" ||
          role === "cenro" ||
          role === "coordinator" ||
          role === "barangay_coordinator"
        ) {
          if (Platform.OS !== "web") {
            try {
              await signOut(auth);
            } catch {}
            const message =
              role === "coordinator" || role === "barangay_coordinator"
                ? "Barangay Coordinator access is restricted to the desktop website. Please log in on a computer."
                : "Admin access is restricted to the desktop website. Please log in on a computer.";
            showError(message, "Restricted Access", "warning");
            setTimeout(() => {
              router.replace("/(auth)/login" as any);
            }, 3000);
            return;
          }
          console.log(
            "CENRO admin or coordinator user detected, redirecting to admin dashboard",
          );
          router.replace("/admin/dashboard" as any);
        } else if (role === "driver") {
          console.log(
            "Driver logged in via email/password, redirecting to resident tab off-duty",
          );
          IncomingCollectionService.setUserRole(currentUser.uid, "driver");
          residentNotificationService.setUserRole("driver");
          NotificationService.dismissDriverProximityAlerts();
          if (db) {
            try {
              await updateDoc(doc(db, "users", currentUser.uid), {
                dutyStatus: "off_duty",
                currentTruckId: null,
                currentTruckPlate: null,
                updatedAt: serverTimestamp(),
              });
            } catch (driverResetErr) {
              console.warn(
                "Could not reset driver duty on password login:",
                driverResetErr,
              );
            }
          }
          await clearDriverSessionOrigin();
          router.replace("/(tabs)/home" as any);
        } else {
          console.log("Regular user detected, redirecting to home");
          router.replace("/(tabs)/home" as any);
        }
      } else {
        throw new Error("Authentication profile services are unavailable.");
      }
    } catch (error: any) {
      console.error("Error during navigation decision:", error);
      showError(
        "Failed to load user profile. Please try logging in again.",
        "Navigation Error",
        "error",
      );
      setTimeout(() => {
        router.replace("/(auth)/login" as any);
      }, 3000);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* App Icon/Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoBackground}>
            <Ionicons name="trash" size={60} color="#4f6b4f" />
          </View>
        </View>

        {/* App Name */}
        <Text style={styles.appName}>TrashTrack</Text>
        <Text style={styles.welcomeText}>Welcome back!</Text>

        {/* Loading Animation */}
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4f6b4f" />
          <Text style={styles.loadingText}>{loadingText}</Text>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressText}>{progress}%</Text>
        </View>

        {/* Loading Dots Animation */}
        <View style={styles.dotsContainer}>
          <Animated.View style={[styles.dot, styles.dot1]} />
          <Animated.View style={[styles.dot, styles.dot2]} />
          <Animated.View style={[styles.dot, styles.dot3]} />
        </View>
      </Animated.View>

      {/* Error Modal */}
      <ErrorModal
        visible={errorModal.visible}
        title={errorModal.title}
        message={errorModal.message}
        type={errorModal.type}
        onClose={closeErrorModal}
        autoClose={true}
        autoCloseDelay={5000}
        actionButton={{
          text: "Go to Login",
          onPress: () => {
            closeErrorModal();
            router.replace("/(auth)/login" as any);
          },
        }}
      />

      {/* Email Verification / Account Activation Modal */}
      <EmailVerificationModal
        visible={activationModalVisible}
        email={activationEmail}
        expectedCode={activationExpectedPin}
        userId={activationUid}
        isResending={isResendingPin}
        onClose={handleActivationModalClose}
        onVerified={handleActivationSuccess}
        onResend={handleResendActivationPin}
        title="Account Activation Required"
        description="Account activation required. Please check your email for the official 6-digit activation PIN sent to your registered address."
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#E8F5E8",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    alignItems: "center",
    paddingHorizontal: 40,
  },
  logoContainer: {
    marginBottom: 30,
  },
  logoBackground: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  appName: {
    fontSize: 32,
    fontWeight: "700",
    color: "#2f3a31",
    marginBottom: 8,
    textAlign: "center",
  },
  welcomeText: {
    fontSize: 16,
    color: "#6b6b6b",
    marginBottom: 40,
    textAlign: "center",
  },
  loadingContainer: {
    alignItems: "center",
    marginBottom: 30,
  },
  loadingText: {
    fontSize: 16,
    color: "#4f6b4f",
    marginTop: 16,
    textAlign: "center",
    fontWeight: "500",
  },
  progressContainer: {
    width: "100%",
    alignItems: "center",
    marginBottom: 30,
  },
  progressBar: {
    width: "100%",
    height: 6,
    backgroundColor: "rgba(79, 107, 79, 0.2)",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#4f6b4f",
    borderRadius: 3,
  },
  progressText: {
    fontSize: 14,
    color: "#4f6b4f",
    fontWeight: "600",
  },
  dotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4f6b4f",
    marginHorizontal: 4,
  },
  dot1: {
    opacity: 0.4,
  },
  dot2: {
    opacity: 0.7,
  },
  dot3: {
    opacity: 1,
  },
});
