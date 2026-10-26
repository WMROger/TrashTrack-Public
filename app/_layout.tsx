import { AuthProvider, useAuthContext } from "@/components/AuthContext";
import GlobalErrorBoundary from "@/components/GlobalErrorBoundary";
import RequireChangePasswordModal from "@/components/RequireChangePasswordModal";
import { db } from "@/config/firebase";
import { isCictoEmail } from "@/constants/cictoConfig";
import { ThemeProvider } from "@/hooks/useTheme";
import { initGlobalErrorTracking } from "@/services/errorTrackingService";
import "@/services/notificationService";
import { getTransitionConfig } from "@/utils/transitions";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { LogBox, Platform } from "react-native";

SplashScreen.preventAutoHideAsync().catch(() => {});
initGlobalErrorTracking();

async function ensureCenroProfileInFirestore(
  uid: string,
  email: string,
  displayName: string = "CENRO Admin",
): Promise<void> {
  if (!db) return;
  const normEmail = email.toLowerCase().trim();
  if (isCictoEmail(normEmail) || normEmail.includes("cicto")) {
    console.warn(
      "ensureCenroProfileInFirestore: Refusing to create CENRO profile for CICTO email:",
      email,
    );
    return;
  }
  try {
    const userRef = doc(db, "users", uid);
    await setDoc(
      userRef,
      {
        uid,
        email,
        displayName,
        name: displayName,
        role: "admin",
        verified: true,
        status: "active",
        department:
          "City Environment and Natural Resources Office (CENRO Danao)",
        agency: "CENRO Danao City",
        updatedAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    console.warn("Could not auto-heal CENRO profile in layout:", error);
  }
}

LogBox.ignoreLogs([
  "You are initializing Firebase Auth for React Native without providing AsyncStorage",
  "expo-notifications: Android Push notifications",
  "`expo-notifications` functionality is not fully supported in Expo Go",
  "setBackgroundColorAsync is not supported with edge-to-edge enabled",
  "`setBackgroundColorAsync` is not supported with edge-to-edge enabled",
  "SafeAreaView has been deprecated",
  "TouchableMixin is deprecated",
  "Invalid DOM property `transform-origin`",
  "Unknown event handler property `onStartShouldSetResponder`",
  "Unknown event handler property `onResponderGrant`",
  "Unknown event handler property `onResponderMove`",
  "Unknown event handler property `onResponderRelease`",
  "Unknown event handler property `onResponderTerminate`",
  "Unknown event handler property `onResponderTerminationRequest`",
]);

const isIgnoredExpoNotificationNotice = (args: any[]) => {
  const text = args
    .map((a) => (typeof a === "string" ? a : a?.message || ""))
    .join(" ");
  return (
    text.includes("expo-notifications: Android Push notifications") ||
    text.includes(
      "expo-notifications functionality is not fully supported in Expo Go",
    ) ||
    text.includes(
      "`expo-notifications` functionality is not fully supported in Expo Go",
    )
  );
};

// Filter out benign React DOM web warnings caused by third-party react-native-chart-kit SVG elements
const isBenignWebWarning = (args: any[]) => {
  const text = args
    .map((a) => (typeof a === "string" ? a : a?.message || ""))
    .join(" ");
  return (
    text.includes("transform-origin") ||
    text.includes("onResponder") ||
    text.includes("onStartShouldSetResponder") ||
    text.includes("onPressIn") ||
    text.includes("TouchableMixin") ||
    text.includes("pointerEvents is deprecated") ||
    text.includes("useNativeDriver` is not supported")
  );
};

const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  if (isIgnoredExpoNotificationNotice(args)) return;
  if (Platform.OS === "web" && isBenignWebWarning(args)) return;
  originalConsoleError(...args);
};

const originalConsoleWarn = console.warn;
console.warn = (...args: any[]) => {
  if (isIgnoredExpoNotificationNotice(args)) return;
  if (Platform.OS === "web" && isBenignWebWarning(args)) return;
  originalConsoleWarn(...args);
};

function RootLayoutNav() {
  const { loading, isAuthenticated, user } = useAuthContext();
  const segments = useSegments();
  const router = useRouter();
  const [isLayoutMounted, setIsLayoutMounted] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleResolvedForUid, setRoleResolvedForUid] = useState<string | null>(
    null,
  );
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [bootTimeoutReached, setBootTimeoutReached] = useState(false);

  const [loaded, fontError] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  useEffect(() => {
    setIsLayoutMounted(true);
    // Guarantee app startup never blocks longer than 2.5s on slow 3G / cheap Android (#12, #13)
    const timer = setTimeout(() => {
      setBootTimeoutReached(true);
      SplashScreen.hideAsync().catch(() => {});
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (loaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [loaded, fontError]);

  // Listen for mustChangePassword and 24-hour snooze time limit on authenticated user profile
  useEffect(() => {
    if (!user?.uid || !db) {
      setMustChangePassword(false);
      return;
    }

    const evaluatePasswordRequirement = (data: any) => {
      if (data?.mustChangePassword === true) {
        const now = Date.now();
        let isSnoozed = false;

        const firestoreSnooze =
          typeof data?.passwordChangeSnoozedUntil === "number"
            ? data.passwordChangeSnoozedUntil
            : data?.passwordChangeSnoozedUntil?.toMillis
              ? data.passwordChangeSnoozedUntil.toMillis()
              : null;

        if (firestoreSnooze && now < firestoreSnooze) {
          isSnoozed = true;
        }

        setMustChangePassword(!isSnoozed);
      } else {
        setMustChangePassword(false);
      }
    };

    const userRef = doc(db, "users", user.uid);
    const unsub = onSnapshot(
      userRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          evaluatePasswordRequirement(data);
        } else {
          setMustChangePassword(false);
        }
      },
      (err) => {
        if (err?.code !== "permission-denied") {
          console.warn("RootLayoutNav: user profile listener error:", err);
        }
      },
    );
    return () => unsub();
  }, [user?.uid]);

  const [driverHasShift, setDriverHasShift] = useState(false);

  // Resolve user role for access control with a 2.5s fallback so slow connections never hang (#13)
  useEffect(() => {
    let isMounted = true;
    if (!user || !db) {
      setUserRole(null);
      setDriverHasShift(false);
      setRoleResolvedForUid(null);
      setRoleLoading(false);
      return;
    }

    setRoleLoading(true);
    const fallbackTimer = setTimeout(() => {
      if (!isMounted) return;
      setUserRole((prev) => prev || "user");
      setRoleResolvedForUid(user.uid);
      setRoleLoading(false);
    }, 2500);

    const userRef = doc(db, "users", user.uid);
    const unsub = onSnapshot(
      userRef,
      (userSnap) => {
        if (!isMounted) return;
        clearTimeout(fallbackTimer);
        if (userSnap.exists()) {
          const data = userSnap.data();
          const r = String(data?.role || "user").toLowerCase().trim();
          setUserRole(r);
          const hasShift =
            (data?.dutyStatus === "on_duty" || data?.status === "on_duty") &&
            Boolean(data?.currentTruckId);
          setDriverHasShift(hasShift);
        } else {
          setUserRole("user");
          setDriverHasShift(false);
        }
        setRoleResolvedForUid(user.uid);
        setRoleLoading(false);
      },
      (error) => {
        if (!isMounted) return;
        clearTimeout(fallbackTimer);
        console.warn("Error checking user role:", error);
        setUserRole("user");
        setDriverHasShift(false);
        setRoleResolvedForUid(user.uid);
        setRoleLoading(false);
      },
    );

    return () => {
      isMounted = false;
      clearTimeout(fallbackTimer);
      unsub();
    };
  }, [user?.uid]);

  // Strict route-level auth & role guard on EVERY route (#4)
  useEffect(() => {
    const fontsReady = loaded || fontError || bootTimeoutReached;
    if (
      !isLayoutMounted ||
      !fontsReady ||
      loading ||
      (user && (roleLoading || roleResolvedForUid !== user?.uid))
    )
      return;

    const segmentList = segments as string[];
    const currentSegment = segmentList[0];
    const secondSegment = segmentList[1];

    // Never hijack the (auth)/loading screen
    if (currentSegment === "(auth)" && secondSegment === "loading") return;

    const segmentStr = String(currentSegment || "");
    const lowerSegment = segmentStr.toLowerCase();

    // Public legal & support pages are accessible to all users (#15, #19)
    if (
      lowerSegment === "privacy" ||
      lowerSegment === "terms" ||
      lowerSegment === "contact" ||
      lowerSegment === "+not-found"
    ) {
      return;
    }

    if (!isAuthenticated) {
      // Unauthenticated access: strictly block dashboard routes even under /admin, /cenro, /cicto (#4)
      if (lowerSegment === "admin" || lowerSegment === "cenro") {
        if (secondSegment === "dashboard") {
          router.replace("/admin/login" as any);
          return;
        }
        return;
      }
      if (lowerSegment === "cicto") {
        if (secondSegment === "dashboard") {
          router.replace("/cicto/login" as any);
          return;
        }
        return;
      }
      if (
        !currentSegment ||
        segmentStr === "splash" ||
        segmentStr === "auth" ||
        segmentStr === "(auth)" ||
        segmentStr === "driver-login"
      ) {
        return;
      }
      // Block unauthenticated access to any protected resident/driver route
      router.replace("/auth" as any);
    } else {
      const isCictoAdmin = userRole === "cicto" || userRole === "cicto_admin";
      const isCenroAdmin =
        userRole === "admin" ||
        userRole === "cenro" ||
        userRole === "coordinator" ||
        userRole === "barangay_coordinator" ||
        userRole === "cenro_officer" ||
        userRole === "mayor";
      const isDriver = userRole === "driver";

      // Authenticated route & role enforcement (#4)
      if (lowerSegment === "admin" || lowerSegment === "cenro") {
        if (secondSegment === "dashboard") {
          if (!isCenroAdmin) {
            if (isDriver) {
              router.replace("/(driver)" as any);
            } else if (isCictoAdmin) {
              router.replace("/cicto/dashboard" as any);
            } else {
              router.replace("/(tabs)/home" as any);
            }
          }
        } else if (isCictoAdmin) {
          router.replace("/cicto/dashboard" as any);
        } else if (
          isCenroAdmin &&
          (lowerSegment === "cenro" ||
            secondSegment === "login" ||
            secondSegment === "index" ||
            !secondSegment)
        ) {
          router.replace("/admin/dashboard" as any);
        } else if (!isCenroAdmin) {
          router.replace(isDriver ? ("/(driver)" as any) : ("/(tabs)/home" as any));
        }
      } else if (lowerSegment === "cicto") {
        if (secondSegment === "dashboard") {
          if (!isCictoAdmin) {
            router.replace(
              isCenroAdmin
                ? ("/admin/dashboard" as any)
                : isDriver
                  ? ("/(driver)" as any)
                  : ("/(tabs)/home" as any),
            );
          }
        } else if (isCenroAdmin) {
          router.replace("/admin/dashboard" as any);
        } else if (
          isCictoAdmin &&
          (segmentList.length === 1 ||
            secondSegment === "login" ||
            secondSegment === "index" ||
            !secondSegment)
        ) {
          router.replace("/cicto/dashboard" as any);
        } else if (!isCictoAdmin) {
          router.replace(isDriver ? ("/(driver)" as any) : ("/(tabs)/home" as any));
        }
      } else if (segmentStr === "(driver)") {
        // Strictly block non-drivers from accessing driver routes (#4)
        if (!isDriver) {
          if (isCictoAdmin) {
            router.replace("/cicto/dashboard" as any);
          } else if (isCenroAdmin) {
            router.replace("/admin/dashboard" as any);
          } else {
            router.replace("/(tabs)/home" as any);
          }
        }
      } else {
        // Resident / general routes
        if (isDriver) {
          if (
            currentSegment === "splash" ||
            currentSegment === "auth" ||
            currentSegment === "(auth)" ||
            currentSegment === "driver-login" ||
            currentSegment === "(tabs)" ||
            currentSegment === "rewards" ||
            currentSegment === "my-reports" ||
            (!currentSegment && segmentList.length === 0)
          ) {
            router.replace("/(driver)" as any);
          }
        } else if (isCenroAdmin) {
          if (
            currentSegment === "splash" ||
            currentSegment === "auth" ||
            currentSegment === "(auth)" ||
            currentSegment === "driver-login"
          ) {
            router.replace("/admin/dashboard" as any);
          }
        } else if (isCictoAdmin) {
          if (
            currentSegment === "splash" ||
            currentSegment === "auth" ||
            currentSegment === "(auth)" ||
            currentSegment === "driver-login"
          ) {
            router.replace("/cicto/dashboard" as any);
          }
        } else {
          // Resident user
          if (
            currentSegment === "splash" ||
            currentSegment === "auth" ||
            currentSegment === "(auth)" ||
            currentSegment === "driver-login"
          ) {
            router.replace("/(tabs)/home" as any);
          }
        }
      }
    }
  }, [
    userRole,
    driverHasShift,
    isAuthenticated,
    loading,
    roleLoading,
    roleResolvedForUid,
    segments,
    router,
    user?.uid,
    loaded,
    fontError,
    bootTimeoutReached,
    isLayoutMounted,
  ]);

  // Route-scoped global font: Poppins on admin/cicto/cenro, Plus Jakarta Sans & Inter elsewhere
  useEffect(() => {
    const segmentStr = String(segments[0] || "").toLowerCase();
    const isAdminRoute =
      segmentStr === "admin" ||
      segmentStr === "cicto" ||
      segmentStr === "cenro";

    const adminFont = Platform.select({
      web: "'Poppins', 'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      ios: "Poppins",
      android: "Poppins",
      default: "System",
    }) as string;

    const modernFontStack = Platform.select({
      web: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      ios: "System",
      android: "Roboto",
      default: "System",
    }) as string;

    const targetFont = isAdminRoute ? adminFont : modernFontStack;

    if (Platform.OS === "web" && typeof document !== "undefined") {
      const style = document.createElement("style");
      style.textContent = `
        body, button, input, select, textarea,
        p, span, div, h1, h2, h3, h4, h5, h6, a, label, li, td, th {
          font-family: ${targetFont};
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
        }
      `;
      document.head.appendChild(style);

      return () => {
        if (document.head.contains(style)) {
          document.head.removeChild(style);
        }
      };
    }
  }, [segments]);

  return (
    <>
      <Stack
        initialRouteName="splash"
        screenOptions={{
          headerShown: false,
          ...getTransitionConfig("slideFromRight"),
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            headerShown: false,
            ...getTransitionConfig("fade"),
          }}
        />
        <Stack.Screen
          name="splash"
          options={{
            headerShown: false,
            ...getTransitionConfig("fade"),
          }}
        />
        <Stack.Screen
          name="auth"
          options={{
            headerShown: false,
            ...getTransitionConfig("slideFromRight"),
          }}
        />
        <Stack.Screen
          name="(auth)"
          options={{
            headerShown: false,
            ...getTransitionConfig("auth"),
          }}
        />
        <Stack.Screen
          name="(tabs)"
          options={{
            headerShown: false,
            ...getTransitionConfig("slideFromRight"),
          }}
        />
        <Stack.Screen
          name="(driver)"
          options={{
            headerShown: false,
            ...getTransitionConfig("slideFromRight"),
          }}
        />
        <Stack.Screen
          name="my-reports"
          options={{
            headerShown: false,
            ...getTransitionConfig("slideFromRight"),
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            headerShown: false,
            ...getTransitionConfig("slideFromRight"),
          }}
        />
        <Stack.Screen
          name="admin"
          options={{
            headerShown: false,
            ...getTransitionConfig("admin"),
          }}
        />
        <Stack.Screen
          name="cenro"
          options={{
            headerShown: false,
            ...getTransitionConfig("admin"),
          }}
        />
        <Stack.Screen
          name="rewards"
          options={{
            headerShown: false,
            ...getTransitionConfig("slideFromRight"),
          }}
        />
        <Stack.Screen
          name="cicto"
          options={{
            headerShown: false,
            ...getTransitionConfig("admin"),
          }}
        />
        <Stack.Screen
          name="privacy"
          options={{
            headerShown: false,
            ...getTransitionConfig("slideFromRight"),
          }}
        />
        <Stack.Screen
          name="terms"
          options={{
            headerShown: false,
            ...getTransitionConfig("slideFromRight"),
          }}
        />
        <Stack.Screen
          name="contact"
          options={{
            headerShown: false,
            ...getTransitionConfig("slideFromRight"),
          }}
        />
        <Stack.Screen
          name="+not-found"
          options={{
            headerShown: false,
            ...getTransitionConfig("fade"),
          }}
        />
      </Stack>
      <RequireChangePasswordModal
        visible={mustChangePassword}
        user={user}
        onSuccess={() => setMustChangePassword(false)}
        onSnooze={() => setMustChangePassword(false)}
      />
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const defaultFont =
        "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

      const style = document.createElement("style");
      style.textContent = `
        body, button, input, select, textarea,
        p, span, div, h1, h2, h3, h4, h5, h6, a, label, li, td, th {
          font-family: ${defaultFont};
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
        }
        .material-icons {
          font-family: 'Material Icons' !important;
          font-feature-settings: 'liga';
          -webkit-font-feature-settings: 'liga';
        }
      `;
      document.head.appendChild(style);

      return () => {
        if (document.head.contains(style)) {
          document.head.removeChild(style);
        }
      };
    }
  }, []);

  return (
    <GlobalErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <RootLayoutNav />
        </AuthProvider>
      </ThemeProvider>
    </GlobalErrorBoundary>
  );
}
