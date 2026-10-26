import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

/**
 * Voice Announcement Service for Driver and Municipal Unit In-Cab Directives.
 * Uses expo-speech and Web Audio API synthesizer for cross-platform emergency audio alerts.
 */

let isAnnouncing = false;

/**
 * Synthesizes a crisp, high-priority emergency alert chime/siren using Web Audio API on web,
 * ensuring immediate auditory alerting even before speech starts.
 */
export function playEmergencyChime(): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      // Two-tone emergency siren chime: 880Hz (A5) -> 659Hz (E5)
      const now = ctx.currentTime;

      // Tone 1
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.exponentialRampToValueAtTime(1100, now + 0.18);
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.22);

      // Tone 2
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(659, now + 0.25);
      osc2.frequency.exponentialRampToValueAtTime(880, now + 0.45);
      gain2.gain.setValueAtTime(0.35, now + 0.25);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.25);
      osc2.stop(now + 0.5);
    } catch (err) {
      console.warn('VoiceAnnouncementService: chime error:', err);
    }
  }
}

/**
 * Stops any active speech or directive voiceover immediately.
 */
export function stopSpeaking(): void {
  isAnnouncing = false;
  try {
    Speech.stop();
  } catch {}

  if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}

/**
 * Speaks text using expo-speech with fallback to web SpeechSynthesis.
 */
export async function speakDirective(
  text: string,
  options: {
    rate?: number;
    pitch?: number;
    onDone?: () => void;
  } = {}
): Promise<void> {
  stopSpeaking();
  isAnnouncing = true;

  const cleanText = text.replace(/[*_#`~]/g, '').trim();
  if (!cleanText) return;

  const rate = options.rate ?? 0.95; // Slightly measured for clear in-cab comprehension
  const pitch = options.pitch ?? 1.0;

  try {
    // Play alert chime first
    playEmergencyChime();

    // Use expo-speech
    Speech.speak(cleanText, {
      language: 'en-US',
      pitch,
      rate,
      onDone: () => {
        isAnnouncing = false;
        options.onDone?.();
      },
      onError: (err) => {
        console.warn('expo-speech error, trying web fallback:', err);
        speakWebFallback(cleanText, rate, pitch, options.onDone);
      },
    });
  } catch (err) {
    console.warn('speakDirective error, falling back:', err);
    speakWebFallback(cleanText, rate, pitch, options.onDone);
  }
}

function speakWebFallback(
  text: string,
  rate: number,
  pitch: number,
  onDone?: () => void
): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.lang = 'en-US';
      utterance.onend = () => {
        isAnnouncing = false;
        onDone?.();
      };
      utterance.onerror = () => {
        isAnnouncing = false;
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      isAnnouncing = false;
    }
  } else {
    isAnnouncing = false;
  }
}

/**
 * High-priority voice announcement tailored for in-cab driver safety directives.
 */
export async function announceEmergencyBroadcast(
  subject: string,
  message: string,
  onDone?: () => void
): Promise<void> {
  const directiveSpeech = `Attention Driver. Emergency directive from CENRO: ${subject}. ${message}`;
  await speakDirective(directiveSpeech, { rate: 0.92, pitch: 1.02, onDone });
}

