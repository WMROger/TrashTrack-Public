import { Platform, Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { Asset } from 'expo-asset';

const ARRIVAL_SOUND_ASSET = require('@/assets/sounds/arrival_chime.wav');
const EMERGENCY_SOUND_ASSET = require('@/assets/sounds/emergency_siren.wav');

const SOUND_ALERTS_KEY = '@trashtrack_sound_alerts_enabled';

// In-memory cache for instant synchronous reading
let cachedSoundEnabled: boolean | null = null;
let activeSoundInstance: Audio.Sound | null = null;

/**
 * Creates a base64 Data URI for a PCM WAV audio buffer.
 */
function createWavDataUri(sampleRate: number, durationSec: number, sampleFn: (t: number) => number): string {
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 1 channel (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.max(-1, Math.min(1, sampleFn(t)));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  if (typeof btoa !== 'undefined') {
    return 'data:audio/wav;base64,' + btoa(binary);
  }
  // Node / fallback
  return 'data:audio/wav;base64,' + Buffer.from(buffer).toString('base64');
}

// 1. Friendly 3-Tone Fleet Arrival Chime: C5 (523Hz) -> E5 (659Hz) -> G5 (784Hz)
const ARRIVAL_WAV_URI = createWavDataUri(22050, 0.75, (t) => {
  let s = 0;
  if (t < 0.22) {
    s += Math.sin(2 * Math.PI * 523.25 * t) * Math.exp(-t * 8);
    s += 0.25 * Math.sin(4 * Math.PI * 523.25 * t) * Math.exp(-t * 12);
  }
  if (t >= 0.18 && t < 0.42) {
    const dt = t - 0.18;
    s += Math.sin(2 * Math.PI * 659.25 * dt) * Math.exp(-dt * 8);
    s += 0.25 * Math.sin(4 * Math.PI * 659.25 * dt) * Math.exp(-dt * 12);
  }
  if (t >= 0.38) {
    const dt = t - 0.38;
    s += Math.sin(2 * Math.PI * 783.99 * dt) * Math.exp(-dt * 6);
    s += 0.25 * Math.sin(4 * Math.PI * 783.99 * dt) * Math.exp(-dt * 10);
  }
  return s * 0.48;
});

// 2. Urgent 2-Tone Emergency Siren Chime: 880Hz -> 659Hz alternating
const EMERGENCY_WAV_URI = createWavDataUri(22050, 0.85, (t) => {
  let s = 0;
  if (t < 0.22) {
    const freq = 880 + (t / 0.22) * 220;
    s += Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 2);
  }
  if (t >= 0.22 && t < 0.45) {
    const dt = t - 0.22;
    const freq = 659 + (dt / 0.23) * 220;
    s += Math.sin(2 * Math.PI * freq * dt) * Math.exp(-dt * 2);
  }
  if (t >= 0.45 && t < 0.65) {
    const dt = t - 0.45;
    const freq = 880 + (dt / 0.20) * 220;
    s += Math.sin(2 * Math.PI * freq * dt) * Math.exp(-dt * 2);
  }
  if (t >= 0.65) {
    const dt = t - 0.65;
    const freq = 659 + (dt / 0.20) * 220;
    s += Math.sin(2 * Math.PI * freq * dt) * Math.exp(-dt * 4);
  }
  return s * 0.55;
});

class SoundAlertService {
  /**
   * Checks if audible sound alerts are enabled by the resident.
   * Defaults to true.
   */
  public async isSoundAlertsEnabled(): Promise<boolean> {
    if (cachedSoundEnabled !== null) {
      return cachedSoundEnabled;
    }
    try {
      const stored = await AsyncStorage.getItem(SOUND_ALERTS_KEY);
      if (stored !== null) {
        cachedSoundEnabled = stored === 'true';
        return cachedSoundEnabled;
      }
    } catch {
      // Default to true
    }
    cachedSoundEnabled = true;
    return true;
  }

  /**
   * Sets whether audible sound alerts are enabled.
   */
  public async setSoundAlertsEnabled(enabled: boolean): Promise<void> {
    cachedSoundEnabled = enabled;
    try {
      await AsyncStorage.setItem(SOUND_ALERTS_KEY, String(enabled));
    } catch {
      // safe ignore
    }
  }

  /**
   * Plays the friendly 3-tone chime for Fleet Arrival notifications:
   * Used for both ~30-min incoming warning and immediate neighborhood arrival (<500m).
   * Also performs an audible Voice Announcement via expo-speech.
   */
  public async playFleetArrivalChime(barangay?: string): Promise<void> {
    const isEnabled = await this.isSoundAlertsEnabled();
    if (!isEnabled) {
      return;
    }

    // Tactile vibration
    try {
      Vibration.vibrate([0, 150, 100, 150]);
    } catch {}

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      this.playWebArrivalChime();
      return;
    }

    // 1. Play physical .wav audio asset via expo-av with explicit Android extension extractor
    this.playNativeAsset(ARRIVAL_SOUND_ASSET, 'wav').catch(() => {});

    // 2. Audible voice announcement via expo-speech
    try {
      Speech.stop();
      const announceText = barangay
        ? `Trash collection truck is approaching your area in Barangay ${barangay}.`
        : 'Trash collection truck is approaching your area.';
      Speech.speak(announceText, {
        language: 'en-US',
        pitch: 1.05,
        rate: 0.95,
      });
    } catch (speechErr) {
      console.warn('SoundAlertService: speech announcement error:', speechErr);
    }
  }

  /**
   * Plays the urgent 2-tone emergency siren chime for City Emergency Advisories.
   * Also performs an audible Emergency Voice Announcement via expo-speech.
   */
  public async playEmergencyAlertSiren(message?: string): Promise<void> {
    const isEnabled = await this.isSoundAlertsEnabled();
    if (!isEnabled) {
      return;
    }

    // Urgent tactile vibration pattern
    try {
      Vibration.vibrate([0, 500, 200, 500, 200, 500]);
    } catch {}

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      this.playWebEmergencySiren();
      return;
    }

    // 1. Play physical .wav emergency audio asset via expo-av
    this.playNativeAsset(EMERGENCY_SOUND_ASSET, 'wav').catch(() => {});

    // 2. Audible emergency voice announcement via expo-speech
    try {
      Speech.stop();
      const announceText = message
        ? `City emergency advisory: ${message}`
        : 'City emergency advisory. Please check your notifications.';
      Speech.speak(announceText, {
        language: 'en-US',
        pitch: 1.0,
        rate: 0.95,
      });
    } catch (speechErr) {
      console.warn('SoundAlertService: emergency speech error:', speechErr);
    }
  }

  /**
   * Play audio asset via expo-av on native platforms (Android / iOS).
   * Resolves local disk URI and forces the correct Android extractor to prevent
   * ExoPlayer query-param extractor errors.
   */
  private async playNativeAsset(assetSource: any, ext: string = 'wav'): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        staysActiveInBackground: true,
        playThroughEarpieceAndroid: false,
      });

      if (activeSoundInstance) {
        try {
          await activeSoundInstance.stopAsync();
          await activeSoundInstance.unloadAsync();
        } catch {}
        activeSoundInstance = null;
      }

      let targetSource: any = assetSource;
      try {
        const [loadedAsset] = await Asset.loadAsync(assetSource);
        if (loadedAsset) {
          const fileUri = loadedAsset.localUri || loadedAsset.uri;
          targetSource = {
            uri: fileUri,
            overrideFileExtensionAndroid: ext,
          };
        }
      } catch (assetErr) {
        console.warn('SoundAlertService: Asset.loadAsync warning, using fallback source:', assetErr);
        targetSource = {
          uri: typeof assetSource === 'object' && assetSource?.uri ? assetSource.uri : undefined,
          overrideFileExtensionAndroid: ext,
        };
        if (!targetSource.uri) {
          targetSource = assetSource;
        }
      }

      const { sound } = await Audio.Sound.createAsync(
        targetSource,
        { shouldPlay: true, volume: 1.0 },
        null,
        true
      );

      activeSoundInstance = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          if (activeSoundInstance === sound) {
            activeSoundInstance = null;
          }
        }
      });
    } catch (e) {
      console.warn('SoundAlertService: native audio asset playback error:', e);
    }
  }

  /**
   * Fallback for raw data URI strings if needed
   */
  private async playNativeSound(dataUri: string): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        staysActiveInBackground: true,
        playThroughEarpieceAndroid: false,
      });

      if (activeSoundInstance) {
        try {
          await activeSoundInstance.stopAsync();
          await activeSoundInstance.unloadAsync();
        } catch {}
        activeSoundInstance = null;
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: dataUri },
        { shouldPlay: true, volume: 1.0 }
      );

      activeSoundInstance = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          if (activeSoundInstance === sound) {
            activeSoundInstance = null;
          }
        }
      });
    } catch (e) {
      console.warn('SoundAlertService: native audio playback error:', e);
    }
  }

  /**
   * Synthesize friendly 3-tone chime via Web Audio API on web browsers.
   */
  private playWebArrivalChime(): void {
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      // Note 1: C5 (523.25 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, now);
      gain1.gain.setValueAtTime(0.35, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.22);

      // Note 2: E5 (659.25 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(659.25, now + 0.16);
      gain2.gain.setValueAtTime(0.38, now + 0.16);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.40);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.16);
      osc2.stop(now + 0.40);

      // Note 3: G5 (783.99 Hz)
      const osc3 = ctx.createOscillator();
      const gain3 = ctx.createGain();
      osc3.type = 'triangle';
      osc3.frequency.setValueAtTime(783.99, now + 0.34);
      gain3.gain.setValueAtTime(0.42, now + 0.34);
      gain3.gain.exponentialRampToValueAtTime(0.005, now + 0.72);
      osc3.connect(gain3);
      gain3.connect(ctx.destination);
      osc3.start(now + 0.34);
      osc3.stop(now + 0.72);
    } catch (e) {
      console.warn('SoundAlertService: web arrival chime error:', e);
    }
  }

  /**
   * Synthesize urgent 2-tone emergency siren via Web Audio API on web browsers.
   */
  private playWebEmergencySiren(): void {
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      // Tone 1: 880Hz -> 1100Hz
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.exponentialRampToValueAtTime(1100, now + 0.18);
      gain1.gain.setValueAtTime(0.4, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.22);

      // Tone 2: 659Hz -> 880Hz
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(659, now + 0.24);
      osc2.frequency.exponentialRampToValueAtTime(880, now + 0.44);
      gain2.gain.setValueAtTime(0.45, now + 0.24);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.48);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.24);
      osc2.stop(now + 0.48);

      // Tone 3: 880Hz -> 1100Hz repeat
      const osc3 = ctx.createOscillator();
      const gain3 = ctx.createGain();
      osc3.type = 'triangle';
      osc3.frequency.setValueAtTime(880, now + 0.50);
      osc3.frequency.exponentialRampToValueAtTime(1100, now + 0.68);
      gain3.gain.setValueAtTime(0.4, now + 0.50);
      gain3.gain.exponentialRampToValueAtTime(0.01, now + 0.72);
      osc3.connect(gain3);
      gain3.connect(ctx.destination);
      osc3.start(now + 0.50);
      osc3.stop(now + 0.72);
    } catch (e) {
      console.warn('SoundAlertService: web emergency siren error:', e);
    }
  }
}

export const soundAlertService = new SoundAlertService();

