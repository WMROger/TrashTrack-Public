import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useTheme } from '@/hooks/useTheme';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface ChatMessageProps {
  message: {
    role: 'user' | 'ai';
    text: string;
    timestamp?: Date;
  };
  onNavigate?: (route: string) => void;
}

type TabDestination = {
  key: string;
  label: string;
  route: string;
  icon: keyof typeof Ionicons.glyphMap;
  regex: RegExp;
};

const TAB_DESTINATIONS: TabDestination[] = [
  {
    key: 'schedule',
    label: 'Schedule Tab',
    route: '/(tabs)/schedule',
    icon: 'calendar',
    regex: /\b((?:the\s+)?(?:collection\s+)?schedule\s+(?:tab|screen|page))\b/i,
  },
  {
    key: 'report',
    label: 'Report Tab',
    route: '/(tabs)/report',
    icon: 'camera',
    regex: /\b((?:the\s+)?(?:waste\s+)?report\s+(?:tab|screen|page))\b/i,
  },
  {
    key: 'announcements',
    label: 'Announcements Tab',
    route: '/(tabs)/announcements',
    icon: 'megaphone',
    regex: /\b((?:the\s+)?(?:announcements?|announce)\s+(?:tab|screen|page))\b/i,
  },
  {
    key: 'home',
    label: 'Home Tab',
    route: '/(tabs)/home',
    icon: 'home',
    regex: /\b((?:the\s+)?(?:home|dashboard)\s+(?:tab|screen|page))\b/i,
  },
  {
    key: 'profile',
    label: 'Profile Tab',
    route: '/(tabs)/profile',
    icon: 'person',
    regex: /\b((?:the\s+)?profile\s+(?:tab|screen|page))\b/i,
  },
  {
    key: 'my-reports',
    label: 'My Reports',
    route: '/my-reports',
    icon: 'document-text',
    regex: /\b((?:the\s+)?my\s+reports\s+(?:tab|screen|page)?)\b/i,
  },
  {
    key: 'rewards',
    label: 'Rewards',
    route: '/rewards',
    icon: 'trophy',
    regex: /\b((?:the\s+)?rewards\s+(?:tab|screen|page)?)\b/i,
  },
];

// Regex matching any supported tab/screen mention
const COMBINED_TAB_REGEX = /\b((?:the\s+)?(?:(?:collection\s+)?schedule|(?:waste\s+)?report|announcements?|announce|home|dashboard|profile|my\s+reports|rewards)\s+(?:tab|screen|page))\b/gi;

function getDestinationForText(matchedText: string): TabDestination | null {
  const lower = matchedText.toLowerCase();
  for (const dest of TAB_DESTINATIONS) {
    if (dest.regex.test(matchedText)) {
      return dest;
    }
  }
  if (lower.includes('schedule')) {
    return TAB_DESTINATIONS.find((d) => d.key === 'schedule') || null;
  }
  if (lower.includes('report') && !lower.includes('my reports')) {
    return TAB_DESTINATIONS.find((d) => d.key === 'report') || null;
  }
  if (lower.includes('announce')) {
    return TAB_DESTINATIONS.find((d) => d.key === 'announcements') || null;
  }
  if (lower.includes('home') || lower.includes('dashboard')) {
    return TAB_DESTINATIONS.find((d) => d.key === 'home') || null;
  }
  if (lower.includes('profile')) {
    return TAB_DESTINATIONS.find((d) => d.key === 'profile') || null;
  }
  if (lower.includes('my reports')) {
    return TAB_DESTINATIONS.find((d) => d.key === 'my-reports') || null;
  }
  if (lower.includes('reward')) {
    return TAB_DESTINATIONS.find((d) => d.key === 'rewards') || null;
  }
  return null;
}

/**
 * Cleans extra asterisks and normalizes formatting
 */
function sanitizeMessageText(rawText: string): string {
  if (!rawText) return '';
  let text = rawText;

  // 1. Convert markdown bullet lists (* or -) at start of lines into clean bullet symbols
  text = text.replace(/^(\s*)[*\-]\s+/gm, '$1• ');

  // 2. Normalize bold-italic ***text*** to **text**
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '**$1**');

  // 3. Remove single-asterisk italics formatting (*text* -> text)
  text = text.replace(/(^|[^*])\*([^*\n]+)\*([^*]|$)/g, '$1$2$3');

  // 4. Remove isolated or dangling asterisks (e.g., " * ", trailing asterisks)
  text = text.replace(/(\s)\*+(\s)/g, '$1$2');
  text = text.replace(/\s*\*+\s*$/gm, '');
  text = text.replace(/^\s*\*+\s*/gm, '');

  return text;
}

export default function ChatMessage({ message, onNavigate }: ChatMessageProps) {
  const { theme } = useTheme();
  const colors = Colors[theme ?? 'light'];
  const isUser = message.role === 'user';

  const dynamicStyles = StyleSheet.create({
    container: {
      marginVertical: 6,
      paddingHorizontal: 16,
      width: '100%',
    },
    userContainer: {
      alignItems: 'flex-end',
    },
    aiContainer: {
      alignItems: 'flex-start',
    },
    aiHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 6,
      marginLeft: 4,
    },
    aiLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: '#4A6741',
      marginLeft: 6,
    },
    bubble: {
      maxWidth: '85%',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 3,
      elevation: 2,
    },
    userBubble: {
      backgroundColor: '#4A6741',
      borderBottomRightRadius: 4,
    },
    aiBubble: {
      backgroundColor: '#FFFFFF',
      borderBottomLeftRadius: 4,
      borderWidth: 1,
      borderColor: '#F3F4F6',
    },
    text: {
      fontSize: 15,
      lineHeight: 22,
    },
    userText: {
      color: '#FFFFFF',
    },
    aiText: {
      color: '#1F2937',
    },
    linkText: {
      color: '#2E7D32',
      fontWeight: '700',
      textDecorationLine: 'underline',
    },
    timestamp: {
      fontSize: 11,
      marginTop: 6,
      alignSelf: 'flex-end',
    },
    userTimestamp: {
      color: 'rgba(255,255,255,0.7)',
    },
    aiTimestamp: {
      color: '#9CA3AF',
    },
    actionChipsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 10,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: '#F3F4F6',
    },
    actionChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#E8F5E9',
      borderWidth: 1,
      borderColor: '#A5D6A7',
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 6,
      shadowColor: '#2E7D32',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
    actionChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: '#2E7D32',
    },
  });

  // Extract unique tabs mentioned in AI message for quick action buttons
  const detectedTabs: TabDestination[] = [];
  if (!isUser && onNavigate) {
    for (const dest of TAB_DESTINATIONS) {
      if (dest.regex.test(message.text)) {
        if (!detectedTabs.some((t) => t.route === dest.route)) {
          detectedTabs.push(dest);
        }
      }
    }
  }

  const renderFormattedText = (rawText: string) => {
    const cleanedText = sanitizeMessageText(rawText);

    // Split by **bold** markers
    const boldChunks = cleanedText.split(/(\*\*.*?\*\*)/g);

    return boldChunks.map((chunk, chunkIdx) => {
      const isBold = chunk.startsWith('**') && chunk.endsWith('**') && chunk.length >= 4;
      const innerText = isBold ? chunk.slice(2, -2) : chunk;

      // If user message, just render bold or plain text without clickable tab links
      if (isUser || !onNavigate) {
        return (
          <Text key={chunkIdx} style={isBold ? { fontWeight: '700' } : undefined}>
            {innerText}
          </Text>
        );
      }

      // Inside each chunk, search for tab mentions like "Schedule tab"
      const subParts = innerText.split(COMBINED_TAB_REGEX);

      return (
        <Text key={`chunk-${chunkIdx}`} style={isBold ? { fontWeight: '700' } : undefined}>
          {subParts.map((subPart, subIdx) => {
            if (!subPart) return null;
            const dest = getDestinationForText(subPart);
            if (dest) {
              return (
                <Text
                  key={`link-${chunkIdx}-${subIdx}`}
                  onPress={() => onNavigate(dest.route)}
                  style={dynamicStyles.linkText}
                >
                  {subPart} ↗
                </Text>
              );
            }
            return (
              <Text key={`txt-${chunkIdx}-${subIdx}`}>
                {subPart}
              </Text>
            );
          })}
        </Text>
      );
    });
  };

  return (
    <View style={[dynamicStyles.container, isUser ? dynamicStyles.userContainer : dynamicStyles.aiContainer]}>
      {!isUser && (
        <View style={dynamicStyles.aiHeader}>
          <IconSymbol name="sparkles" size={14} color="#4A6741" />
          <Text style={dynamicStyles.aiLabel}>Assistant</Text>
        </View>
      )}
      <View style={[dynamicStyles.bubble, isUser ? dynamicStyles.userBubble : dynamicStyles.aiBubble]}>
        <Text style={[dynamicStyles.text, isUser ? dynamicStyles.userText : dynamicStyles.aiText]}>
          {renderFormattedText(message.text)}
        </Text>

        {/* Quick-action buttons when a tab like Schedule tab is mentioned */}
        {detectedTabs.length > 0 && (
          <View style={dynamicStyles.actionChipsContainer}>
            {detectedTabs.map((tab, tabIdx) => (
              <TouchableOpacity
                key={`chip-${tab.key}-${tabIdx}`}
                style={dynamicStyles.actionChip}
                onPress={() => onNavigate?.(tab.route)}
                activeOpacity={0.7}
              >
                <Ionicons name={tab.icon} size={15} color="#2E7D32" style={{ marginRight: 6 }} />
                <Text style={dynamicStyles.actionChipText}>Open {tab.label}</Text>
                <Ionicons name="arrow-forward" size={13} color="#2E7D32" style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {message.timestamp && (
          <Text style={[dynamicStyles.timestamp, isUser ? dynamicStyles.userTimestamp : dynamicStyles.aiTimestamp]}>
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        )}
      </View>
    </View>
  );
}