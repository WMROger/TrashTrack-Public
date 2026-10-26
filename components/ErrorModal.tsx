import { Ionicons } from "@expo/vector-icons";
import React, { useEffect } from "react";
import {
    Animated,
    Dimensions,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

const { width, height } = Dimensions.get("window");

interface ErrorModalProps {
  visible: boolean;
  title?: string;
  message: string;
  type?: "error" | "warning" | "info" | "success";
  onClose: () => void;
  autoClose?: boolean;
  autoCloseDelay?: number;
  showCloseButton?: boolean;
  actionButton?: {
    text: string;
    onPress: () => void;
  };
}

export default function ErrorModal({
  visible,
  title = "Error",
  message,
  type = "error",
  onClose,
  autoClose = true,
  autoCloseDelay = 4000,
  showCloseButton = true,
  actionButton,
}: ErrorModalProps) {
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const scaleAnim = React.useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    if (visible) {
      // Show animation
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto close if enabled
      if (autoClose) {
        const timer = setTimeout(() => {
          handleClose();
        }, autoCloseDelay);

        return () => clearTimeout(timer);
      }
    } else {
      // Hide animation
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.8,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, autoClose, autoCloseDelay]);

  // Add escape key handling for web
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (event: any) => {
      if (event.key === "Escape") {
        handleClose();
      }
    };

    if (Platform.OS === "web") {
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [visible]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.8,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose();
    });
  };

  const getIconAndColor = () => {
    switch (type) {
      case "error":
        return {
          icon: "alert-circle-outline",
          color: "#EF4444",
          bgColor: "#FEF2F2",
        };
      case "warning":
        return {
          icon: "warning-outline",
          color: "#F59E0B",
          bgColor: "#FFFBEB",
        };
      case "info":
        return {
          icon: "information-circle-outline",
          color: "#3B82F6",
          bgColor: "#EFF6FF",
        };
      case "success":
        return {
          icon: "checkmark-circle",
          color: "#10B981",
          bgColor: "#ECFDF5",
        };
      default:
        return {
          icon: "alert-circle-outline",
          color: "#EF4444",
          bgColor: "#FEF2F2",
        };
    }
  };

  const { icon, color, bgColor } = getIconAndColor();

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={handleClose}
    >
      <Pressable onPress={handleClose} style={styles.overlay}>
        <Pressable 
          onPress={(event) => event.stopPropagation()} 
          style={{ width: '100%', alignItems: 'center' }}
        >
          <Animated.View
            style={[
              styles.modalContainer,
              {
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            <View style={[styles.modal, { backgroundColor: bgColor }]}>
                {/* Close Button */}
                {showCloseButton && (
                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={handleClose}
                  >
                    <Text style={styles.closeButtonText}>×</Text>
                  </TouchableOpacity>
                )}

                {/* Content with Icon */}
                <View style={styles.contentWithIcon}>
                  <View
                    style={[styles.iconContainer, { backgroundColor: color }]}
                  >
                    {type === "success" ? (
                      <Text style={styles.checkmarkText}>✓</Text>
                    ) : (
                      <Ionicons name={icon as any} size={24} color="white" />
                    )}
                  </View>
                  <View style={styles.textContent}>
                    <Text style={[styles.title, { color }]}>{title}</Text>
                    <Text style={styles.message}>{message}</Text>
                  </View>
                </View>

                {/* Action Button */}
                {actionButton && (
                  <View style={styles.actionContainer}>
                    <TouchableOpacity
                      style={[styles.actionButton, { backgroundColor: color }]}
                      onPress={actionButton.onPress}
                    >
                      <Text style={styles.actionButtonText}>
                        {actionButton.text}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  modalContainer: {
    width: "100%",
    maxWidth: 400,
  },
  modal: {
    borderRadius: 16,
    padding: 24,
    position: "relative",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  closeButton: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0, 0, 0, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  contentWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 16,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
    alignSelf: "center",
  },
  textContent: {
    flex: 1,
    paddingRight: 24,
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  message: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
  },
  actionContainer: {
    marginTop: 16,
  },
  actionButton: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  actionButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  checkmarkText: {
    color: "white",
    fontSize: 24,
    fontWeight: "bold",
  },
  closeButtonText: {
    color: "#666",
    fontSize: 20,
    fontWeight: "bold",
  },
});
