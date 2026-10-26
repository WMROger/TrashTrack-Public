import { useRouter } from "expo-router";
import React from "react";
import {
  Image,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { trackFunnelEvent } from "@/services/analyticsService";

export default function AuthScreen() {
  const router = useRouter();

  const handleLogin = () => {
    router.push("/(auth)/login");
  };

  const handleSignUp = () => {
    trackFunnelEvent("signup_started", { source: "auth_landing" });
    router.push("/(auth)/signup");
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ECFEE5" />

      {/* Full screen image */}
      <View style={styles.imageContainer}>
        <Image
          source={require("@/assets/images/Auth-Header2.png")}
          style={styles.heroImage}
          resizeMode="cover"
        />

        {/* Text overlay */}
        <View style={styles.textOverlay}>
          <Text style={styles.headline}>
            Know the Waste,{"\n"}Clean with{"\n"}Haste.
          </Text>
        </View>
      </View>

      {/* Button section */}
      <View style={styles.buttonSection}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleLogin}
          activeOpacity={0.9}
        >
          <Text style={styles.primaryButtonText}>Login</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleSignUp}
          activeOpacity={0.9}
        >
          <Text style={styles.secondaryButtonText}>Create an Account</Text>
        </TouchableOpacity>

        {/* Legal & Support Links (#15, #19) */}
        <View style={styles.legalLinksRow}>
          <TouchableOpacity onPress={() => router.push("/privacy" as any)}>
            <Text style={styles.legalLinkText}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={styles.legalDot}>•</Text>
          <TouchableOpacity onPress={() => router.push("/terms" as any)}>
            <Text style={styles.legalLinkText}>Terms of Service</Text>
          </TouchableOpacity>
          <Text style={styles.legalDot}>•</Text>
          <TouchableOpacity onPress={() => router.push("/contact" as any)}>
            <Text style={styles.legalLinkText}>Contact Support</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ECFEE5",
  },
  imageContainer: {
    flex: 1,
    position: "relative",
  },
  heroImage: {
    width: "100%",
    height: "100%",
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  textOverlay: {
    position: "absolute",
    top: 80,
    left: 24,
    right: 24,
    zIndex: 1,
  },
  headline: {
    fontSize: 28,
    lineHeight: 36,
    color: "#2D5A3D",
    fontWeight: "600",
    textAlign: "left",
    textShadowColor: "rgba(255, 255, 255, 0.8)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  buttonSection: {
    position: "absolute",
    bottom: 44,
    left: 24,
    right: 24,
    gap: 14,
  },
  primaryButton: {
    backgroundColor: "#4E6C50",
    borderRadius: 25,
    paddingVertical: 16,
    alignItems: "center",
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 16,
  },
  secondaryButton: {
    borderColor: "#4E6C50",
    borderWidth: 2,
    borderRadius: 25,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: "transparent",
    width: "100%",
  },
  secondaryButtonText: {
    color: "#4E6C50",
    fontWeight: "600",
    fontSize: 16,
  },
  legalLinksRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  legalLinkText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#2D5A3D",
    textDecorationLine: "underline",
  },
  legalDot: {
    fontSize: 12,
    color: "#4E6C50",
  },
});
