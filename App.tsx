import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import type { ListRenderItemInfo, StyleProp, ViewStyle } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  IOSCategory,
  IOSCategoryMode,
  RepeatMode,
  State,
  isPlaying as readIsPlaying,
  useActiveTrack,
  useIsPlaying,
  useProgress,
  useTrackPlayerEvents,
} from 'react-native-track-player';
import type { AddTrack } from 'react-native-track-player';

/* -------------------------------------------------------------------------- */
/*  Types and constants                                                       */
/* -------------------------------------------------------------------------- */

type IconName = ComponentProps<typeof Ionicons>['name'];
type FilterKey = 'playlists' | 'songs' | 'downloaded';

interface LibraryTrack {
  id: string;
  title: string;
  artist: string;
  uri: string;
  artwork: string | null;
  liked: boolean;
}

interface AccentOption {
  key: string;
  label: string;
  color: string;
}

const PALETTE = {
  background: '#000000',
  card: '#121212',
  subCard: '#242424',
  text: '#FFFFFF',
  textSecondary: '#B3B3B3',
} as const;

const ACCENTS: readonly AccentOption[] = [
  { key: 'green', label: 'Green', color: '#1DB954' },
  { key: 'blue', label: 'Blue', color: '#2E8BFF' },
  { key: 'purple', label: 'Purple', color: '#8352F5' },
  { key: 'pink', label: 'Pink', color: '#FF2E93' },
  { key: 'orange', label: 'Orange', color: '#FF7A1A' },
];

const FILTERS: readonly { key: FilterKey; label: string }[] = [
  { key: 'playlists', label: 'Playlists' },
  { key: 'songs', label: 'Songs' },
  { key: 'downloaded', label: 'Downloaded' },
];

const DOC_DIR = FileSystem.documentDirectory ?? '';
const METADATA_URI = `${DOC_DIR}tracks_metadata.json`;
const SKIN_URI = `${DOC_DIR}skin_settings.json`;
const DEFAULT_ARTIST = 'Unknown Artist';

const MINI_PLAYER_HEIGHT = 64;
const MINI_PLAYER_BOTTOM_OFFSET = 8;
const MINI_PLAYER_SIDE_MARGIN = 8;
const TRAY_HEIGHT = 72;

const REMOTE_CAPABILITIES: Capability[] = [
  Capability.Play,
  Capability.Pause,
  Capability.SkipToNext,
  Capability.SkipToPrevious,
  Capability.SeekTo,
];

const REMOTE_EVENTS: Event[] = [
  Event.RemotePlay,
  Event.RemotePause,
  Event.RemoteNext,
  Event.RemotePrevious,
  Event.RemoteSeek,
];

const AUDIO_MIME_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/aiff': 'aiff',
  'audio/x-aiff': 'aiff',
};

const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/* -------------------------------------------------------------------------- */
/*  Pure helpers                                                              */
/* -------------------------------------------------------------------------- */

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const value = parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function scaleColor(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n * factor)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function onAccentColor(hex: string): '#000000' | '#FFFFFF' {
  const luminance = relativeLuminance(hex);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  return contrastWithBlack >= contrastWithWhite ? '#000000' : '#FFFFFF';
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const held = copy[i];
    copy[i] = copy[j];
    copy[j] = held;
  }
  return copy;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fileExtension(
  name: string,
  mimeType: string | undefined,
  mimeMap: Record<string, string>,
  fallback: string,
): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  if (match) {
    return match[1].toLowerCase();
  }
  if (mimeType && mimeMap[mimeType]) {
    return mimeMap[mimeType];
  }
  return fallback;
}

function parseTrackNames(fileName: string): { title: string; artist: string } {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/_/g, ' ').trim();
  const parts = base.split(' - ');
  if (parts.length >= 2) {
    const artist = parts[0].trim();
    const title = parts.slice(1).join(' - ').trim();
    if (artist.length > 0 && title.length > 0) {
      return { title, artist };
    }
  }
  return { title: base.length > 0 ? base : 'Untitled', artist: DEFAULT_ARTIST };
}

function toPlayerTrack(track: LibraryTrack): AddTrack {
  return {
    id: track.id,
    url: track.uri,
    title: track.title,
    artist: track.artist,
    artwork: track.artwork ?? undefined,
  };
}

/* -------------------------------------------------------------------------- */
/*  Sandbox storage layer                                                     */
/* -------------------------------------------------------------------------- */

let writeChain: Promise<void> = Promise.resolve();

function persistJson(uri: string, value: unknown): Promise<void> {
  writeChain = writeChain
    .then(() => FileSystem.writeAsStringAsync(uri, JSON.stringify(value)))
    .catch((error: unknown) => {
      console.warn(`Could not write ${uri}`, error);
    });
  return writeChain;
}

function rebaseUri(stored: string): string {
  const name = stored.split('/').pop();
  return name ? `${DOC_DIR}${name}` : stored;
}

interface StoredTrack {
  id: string;
  title: string;
  artist: string;
  uri: string;
  artwork: string | null;
  liked?: boolean;
}

function isStoredTrack(value: unknown): value is StoredTrack {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.artist === 'string' &&
    typeof candidate.uri === 'string' &&
    (typeof candidate.artwork === 'string' || candidate.artwork === null)
  );
}

async function fileExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
}

async function removeFile(uri: string | null): Promise<void> {
  if (!uri) {
    return;
  }
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (error) {
    console.warn(`Could not delete ${uri}`, error);
  }
}

async function loadLibrary(): Promise<LibraryTrack[]> {
  try {
    if (!(await fileExists(METADATA_URI))) {
      return [];
    }
    const raw = await FileSystem.readAsStringAsync(METADATA_URI);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const loaded: LibraryTrack[] = [];
    let changed = false;
    for (const item of parsed) {
      if (!isStoredTrack(item)) {
        changed = true;
        continue;
      }
      const uri = rebaseUri(item.uri);
      if (!(await fileExists(uri))) {
        changed = true;
        continue;
      }
      let artwork: string | null = null;
      if (item.artwork) {
        const candidate = rebaseUri(item.artwork);
        artwork = (await fileExists(candidate)) ? candidate : null;
      }
      if (uri !== item.uri || artwork !== item.artwork) {
        changed = true;
      }
      loaded.push({
        id: item.id,
        title: item.title,
        artist: item.artist,
        uri,
        artwork,
        liked: item.liked === true,
      });
    }
    if (changed) {
      await persistJson(METADATA_URI, loaded);
    }
    return loaded;
  } catch (error) {
    console.warn('Could not read the library file', error);
    return [];
  }
}

async function loadAccent(): Promise<string | null> {
  try {
    if (!(await fileExists(SKIN_URI))) {
      return null;
    }
    const parsed: unknown = JSON.parse(await FileSystem.readAsStringAsync(SKIN_URI));
    if (typeof parsed === 'object' && parsed !== null) {
      const accent = (parsed as Record<string, unknown>).accent;
      if (typeof accent === 'string' && ACCENTS.some((option) => option.color === accent)) {
        return accent;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  TrackPlayer lifecycle and transport                                       */
/* -------------------------------------------------------------------------- */

let playerSetup: Promise<void> | null = null;

function setupTrackPlayer(): Promise<void> {
  if (playerSetup) {
    return playerSetup;
  }
  playerSetup = (async () => {
    try {
      await TrackPlayer.setupPlayer({
        iosCategory: IOSCategory.Playback,
        iosCategoryMode: IOSCategoryMode.Default,
        autoHandleInterruptions: true,
        autoUpdateMetadata: true,
      });
    } catch (error) {
      if (!/already.*initiali[sz]ed/i.test(errorMessage(error))) {
        throw error;
      }
    }
    await TrackPlayer.updateOptions({
      capabilities: REMOTE_CAPABILITIES,
      notificationCapabilities: REMOTE_CAPABILITIES,
      compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
      android: { appKilledPlaybackBehavior: AppKilledPlaybackBehavior.PausePlayback },
    });
  })().catch((error: unknown) => {
    playerSetup = null;
    throw error;
  });
  return playerSetup;
}

async function playbackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.PlaybackError, (event) => {
    console.warn(`Playback error ${event.code}: ${event.message}`);
  });
}

TrackPlayer.registerPlaybackService(() => playbackService);

async function transportPlay(): Promise<void> {
  try {
    const { state } = await TrackPlayer.getPlaybackState();
    if (state === State.Ended) {
      await TrackPlayer.skip(0);
    }
    await TrackPlayer.play();
  } catch (error) {
    console.warn('play failed', error);
  }
}

async function transportPause(): Promise<void> {
  try {
    await TrackPlayer.pause();
  } catch (error) {
    console.warn('pause failed', error);
  }
}

async function transportToggle(): Promise<void> {
  try {
    const { playing } = await readIsPlaying();
    if (playing) {
      await TrackPlayer.pause();
    } else {
      await transportPlay();
    }
  } catch (error) {
    console.warn('toggle failed', error);
  }
}

async function transportNext(): Promise<void> {
  try {
    await TrackPlayer.skipToNext();
  } catch {
    try {
      await TrackPlayer.skip(0);
    } catch (error) {
      console.warn('next failed', error);
    }
  }
}

async function transportPrevious(): Promise<void> {
  try {
    const position = await TrackPlayer.getPosition();
    if (position > 3) {
      await TrackPlayer.seekTo(0);
      return;
    }
    await TrackPlayer.skipToPrevious();
  } catch {
    try {
      await TrackPlayer.seekTo(0);
    } catch (error) {
      console.warn('previous failed', error);
    }
  }
}

async function transportSeek(position: number): Promise<void> {
  try {
    await TrackPlayer.seekTo(Math.max(0, position));
  } catch (error) {
    console.warn('seek failed', error);
  }
}

async function appendToQueue(added: LibraryTrack[]): Promise<void> {
  try {
    await setupTrackPlayer();
    const queue = await TrackPlayer.getQueue();
    if (queue.length > 0) {
      await TrackPlayer.add(added.map(toPlayerTrack));
    }
  } catch (error) {
    console.warn('Could not extend the queue', error);
  }
}

async function syncQueueMetadata(track: LibraryTrack): Promise<void> {
  try {
    const queue = await TrackPlayer.getQueue();
    const index = queue.findIndex((item) => item.id === track.id);
    if (index >= 0) {
      await TrackPlayer.updateMetadataForTrack(index, {
        title: track.title,
        artist: track.artist,
        artwork: track.artwork ?? undefined,
      });
    }
  } catch (error) {
    console.warn('Could not update queue metadata', error);
  }
}

async function removeFromQueue(id: string): Promise<void> {
  try {
    const queue = await TrackPlayer.getQueue();
    const index = queue.findIndex((item) => item.id === id);
    if (index >= 0) {
      await TrackPlayer.remove(index);
    }
  } catch (error) {
    console.warn('Could not remove from the queue', error);
  }
}

async function reorderUpcoming(library: LibraryTrack[], shuffle: boolean): Promise<void> {
  try {
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    if (activeIndex === undefined) {
      return;
    }
    const queue = await TrackPlayer.getQueue();
    const active = queue[activeIndex];
    if (!active) {
      return;
    }
    const queuedIds = new Set(queue.map((item) => item.id));
    const ordered = library.filter((track) => queuedIds.has(track.id));
    if (activeIndex > 0) {
      await TrackPlayer.remove(Array.from({ length: activeIndex }, (_, i) => i));
    }
    await TrackPlayer.removeUpcomingTracks();
    const others = ordered.filter((track) => track.id !== active.id);
    if (shuffle) {
      await TrackPlayer.add(shuffled(others).map(toPlayerTrack));
      return;
    }
    const position = ordered.findIndex((track) => track.id === active.id);
    const before = position > 0 ? ordered.slice(0, position) : [];
    const after = position >= 0 ? ordered.slice(position + 1) : others;
    if (after.length > 0) {
      await TrackPlayer.add(after.map(toPlayerTrack));
    }
    if (before.length > 0) {
      await TrackPlayer.add(before.map(toPlayerTrack), 0);
    }
  } catch (error) {
    console.warn('Could not reorder the queue', error);
  }
}

/* -------------------------------------------------------------------------- */
/*  Skin color engine                                                         */
/* -------------------------------------------------------------------------- */

interface ThemeContextValue {
  accent: string;
  onAccent: string;
  setAccent: (color: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  accent: ACCENTS[0].color,
  onAccent: onAccentColor(ACCENTS[0].color),
  setAccent: () => undefined,
});

function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const [accent, setAccentState] = useState<string>(ACCENTS[0].color);
  const chosenByUser = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadAccent().then((saved) => {
      if (!cancelled && saved && !chosenByUser.current) {
        setAccentState(saved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setAccent = useCallback((color: string) => {
    chosenByUser.current = true;
    setAccentState(color);
    void persistJson(SKIN_URI, { accent: color });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ accent, onAccent: onAccentColor(accent), setAccent }),
    [accent, setAccent],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/* -------------------------------------------------------------------------- */
/*  Small shared components                                                   */
/* -------------------------------------------------------------------------- */

interface IconButtonProps {
  name: IconName;
  size: number;
  color: string;
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

function IconButton({ name, size, color, label, onPress, style }: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconButton, style, pressed && styles.pressed]}
    >
      <Ionicons name={name} size={size} color={color} />
    </Pressable>
  );
}

interface ArtworkProps {
  uri: string | null;
  size: number;
  radius: number;
  iconSize: number;
}

const Artwork = memo(function Artwork({ uri, size, radius, iconSize }: ArtworkProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: PALETTE.subCard,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Ionicons name="musical-note" size={iconSize} color={PALETTE.textSecondary} />
      )}
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/*  Library screen pieces                                                     */
/* -------------------------------------------------------------------------- */

function ThemeTray({ open }: { open: boolean }) {
  const { accent, setAccent } = useTheme();
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [open, progress]);

  const height = progress.interpolate({ inputRange: [0, 1], outputRange: [0, TRAY_HEIGHT] });

  return (
    <Animated.View style={[styles.tray, { height, opacity: progress }]}>
      {ACCENTS.map((option) => {
        const selected = option.color === accent;
        return (
          <Pressable
            key={option.key}
            onPress={() => setAccent(option.color)}
            style={styles.swatchWrap}
            accessibilityRole="button"
            accessibilityLabel={`${option.label} accent color`}
            accessibilityState={{ selected }}
          >
            <View
              style={[
                styles.swatch,
                { backgroundColor: option.color },
                selected && styles.swatchSelected,
              ]}
            >
              {selected ? (
                <Ionicons name="checkmark" size={18} color={onAccentColor(option.color)} />
              ) : null}
            </View>
            <Text style={[styles.swatchLabel, selected && styles.swatchLabelSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function FilterChip({ label, selected, onPress }: FilterChipProps) {
  const { accent, onAccent } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        selected && { backgroundColor: accent },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipText, selected && { color: onAccent }]}>{label}</Text>
    </Pressable>
  );
}

interface LibraryHeaderProps {
  trayOpen: boolean;
  importing: boolean;
  filter: FilterKey | null;
  onToggleTray: () => void;
  onImport: () => void;
  onSelectFilter: (key: FilterKey) => void;
}

function LibraryHeader({
  trayOpen,
  importing,
  filter,
  onToggleTray,
  onImport,
  onSelectFilter,
}: LibraryHeaderProps) {
  const insets = useSafeAreaInsets();
  const { accent } = useTheme();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Your Library</Text>
        <View style={styles.headerActions}>
          <IconButton
            name={trayOpen ? 'color-palette' : 'color-palette-outline'}
            size={24}
            color={trayOpen ? accent : PALETTE.text}
            label="Change accent color"
            onPress={onToggleTray}
          />
          {importing ? (
            <View style={styles.iconButton}>
              <ActivityIndicator color={PALETTE.text} />
            </View>
          ) : (
            <IconButton
              name="add"
              size={30}
              color={PALETTE.text}
              label="Import songs"
              onPress={onImport}
            />
          )}
        </View>
      </View>
      <ThemeTray open={trayOpen} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {FILTERS.map((item) => (
          <FilterChip
            key={item.key}
            label={item.label}
            selected={filter === item.key}
            onPress={() => onSelectFilter(item.key)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

interface LibraryGridProps {
  likedCount: number;
  likedActive: boolean;
  importing: boolean;
  onOpenLiked: () => void;
  onImport: () => void;
}

function LibraryGrid({ likedCount, likedActive, importing, onOpenLiked, onImport }: LibraryGridProps) {
  const { accent } = useTheme();
  const { width } = useWindowDimensions();
  const tileSize = Math.floor((width - 32 - 12) / 2);

  return (
    <View style={styles.grid}>
      <Pressable
        onPress={onOpenLiked}
        accessibilityRole="button"
        accessibilityLabel="Liked Songs"
        style={({ pressed }) => [{ width: tileSize }, pressed && styles.pressed]}
      >
        <View
          style={[
            styles.tileArt,
            { width: tileSize, height: tileSize },
            likedActive && { borderWidth: 2, borderColor: accent },
          ]}
        >
          <LinearGradient
            colors={['#35108F', '#8057F0']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Ionicons name="heart" size={tileSize * 0.42} color="#FFFFFF" />
        </View>
        <Text style={[styles.tileTitle, likedActive && { color: accent }]} numberOfLines={1}>
          Liked Songs
        </Text>
        <Text style={styles.tileSubtitle} numberOfLines={1}>
          {`Playlist • ${likedCount} ${likedCount === 1 ? 'song' : 'songs'}`}
        </Text>
      </Pressable>
      <Pressable
        onPress={onImport}
        accessibilityRole="button"
        accessibilityLabel="Add songs"
        style={({ pressed }) => [{ width: tileSize }, pressed && styles.pressed]}
      >
        <View style={[styles.tileArt, styles.addTile, { width: tileSize, height: tileSize }]}>
          {importing ? (
            <ActivityIndicator color={accent} />
          ) : (
            <Ionicons name="add" size={tileSize * 0.42} color={accent} />
          )}
        </View>
        <Text style={styles.tileTitle} numberOfLines={1}>
          Add songs
        </Text>
        <Text style={styles.tileSubtitle} numberOfLines={1}>
          Import from Files
        </Text>
      </Pressable>
    </View>
  );
}

interface TrackRowProps {
  track: LibraryTrack;
  active: boolean;
  playing: boolean;
  accent: string;
  showDownloaded: boolean;
  onPress: (id: string) => void;
  onMore: (id: string) => void;
}

const TrackRow = memo(function TrackRow({
  track,
  active,
  playing,
  accent,
  showDownloaded,
  onPress,
  onMore,
}: TrackRowProps) {
  return (
    <Pressable
      onPress={() => onPress(track.id)}
      accessibilityRole="button"
      accessibilityLabel={`${track.title} by ${track.artist}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Artwork uri={track.artwork} size={48} radius={4} iconSize={22} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, active && { color: accent }]}>
          {track.title}
        </Text>
        <View style={styles.rowSubtitleLine}>
          {showDownloaded ? (
            <Ionicons
              name="arrow-down-circle"
              size={14}
              color={accent}
              style={styles.rowBadge}
            />
          ) : null}
          {active && playing ? (
            <Ionicons name="volume-high" size={14} color={accent} style={styles.rowBadge} />
          ) : null}
          <Text numberOfLines={1} style={styles.rowSubtitle}>
            {track.artist}
          </Text>
        </View>
      </View>
      <Pressable
        onPress={() => onMore(track.id)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`More options for ${track.title}`}
        style={({ pressed }) => [styles.rowMore, pressed && styles.pressed]}
      >
        <Ionicons name="ellipsis-horizontal" size={20} color={PALETTE.textSecondary} />
      </Pressable>
    </Pressable>
  );
});

/* -------------------------------------------------------------------------- */
/*  Mini player                                                               */
/* -------------------------------------------------------------------------- */

interface MiniPlayerProps {
  track: LibraryTrack;
  onOpen: () => void;
  onToggleLike: (id: string) => void;
}

function MiniPlayer({ track, onOpen, onToggleLike }: MiniPlayerProps) {
  const { accent } = useTheme();
  const insets = useSafeAreaInsets();
  const { playing } = useIsPlaying();
  const { position, duration } = useProgress(500);
  const ratio = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  return (
    <View
      style={[
        styles.miniWrap,
        { bottom: insets.bottom + MINI_PLAYER_BOTTOM_OFFSET },
      ]}
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Now playing ${track.title}. Open player`}
        style={styles.miniCapsule}
      >
        <View style={styles.miniProgressTrack}>
          <View
            style={[
              styles.miniProgressFill,
              { width: `${ratio * 100}%`, backgroundColor: accent },
            ]}
          />
        </View>
        <View style={styles.miniContent}>
          <Artwork uri={track.artwork} size={40} radius={6} iconSize={18} />
          <View style={styles.miniText}>
            <Text numberOfLines={1} style={styles.miniTitle}>
              {track.title}
            </Text>
            <Text numberOfLines={1} style={styles.miniArtist}>
              {track.artist}
            </Text>
          </View>
          <IconButton
            name={track.liked ? 'heart' : 'heart-outline'}
            size={24}
            color={track.liked ? accent : PALETTE.text}
            label={track.liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
            onPress={() => onToggleLike(track.id)}
          />
          <IconButton
            name={playing ? 'pause' : 'play'}
            size={28}
            color={PALETTE.text}
            label={playing ? 'Pause' : 'Play'}
            onPress={() => void transportToggle()}
          />
        </View>
      </Pressable>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*  Track options overlay                                                     */
/* -------------------------------------------------------------------------- */

interface OptionsOverlayProps {
  visible: boolean;
  track: LibraryTrack | null;
  onClose: () => void;
  onToggleLike: (id: string) => void;
  onSaveDetails: (id: string, title: string, artist: string) => void;
  onPickArtwork: (id: string) => void;
  onRemove: (id: string) => void;
}

function TrackOptionsOverlay(props: OptionsOverlayProps) {
  if (!props.visible || !props.track) {
    return null;
  }
  return <OptionsSheet key={props.track.id} {...props} track={props.track} />;
}

interface OptionsSheetProps extends OptionsOverlayProps {
  track: LibraryTrack;
}

function OptionsSheet({
  track,
  onClose,
  onToggleLike,
  onSaveDetails,
  onPickArtwork,
  onRemove,
}: OptionsSheetProps) {
  const { accent, onAccent } = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'menu' | 'edit'>('menu');
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const slide = useRef(new Animated.Value(48)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slide, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [slide, fade]);

  const runAndClose = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlayBackdrop, { opacity: fade }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.flex}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close options"
        />
        <Animated.View
          style={[
            styles.optionsSheet,
            { paddingBottom: insets.bottom + 16, transform: [{ translateY: slide }] },
          ]}
        >
          <View style={styles.optionsHeader}>
            <Artwork uri={track.artwork} size={48} radius={4} iconSize={22} />
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={styles.optionsTitle}>
                {track.title}
              </Text>
              <Text numberOfLines={1} style={styles.rowSubtitle}>
                {track.artist}
              </Text>
            </View>
          </View>
          {mode === 'menu' ? (
            <View>
              <OptionRow
                icon={track.liked ? 'heart-dislike-outline' : 'heart-outline'}
                label={track.liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
                onPress={runAndClose(() => onToggleLike(track.id))}
              />
              <OptionRow
                icon="create-outline"
                label="Edit title and artist"
                onPress={() => setMode('edit')}
              />
              <OptionRow
                icon="image-outline"
                label="Choose artwork"
                onPress={runAndClose(() => onPickArtwork(track.id))}
              />
              <OptionRow
                icon="trash-outline"
                label="Remove from library"
                onPress={runAndClose(() => onRemove(track.id))}
              />
            </View>
          ) : (
            <View style={styles.editForm}>
              <Text style={styles.fieldLabel}>Title</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                style={styles.input}
                placeholder="Title"
                placeholderTextColor={PALETTE.textSecondary}
                selectionColor={accent}
                autoCapitalize="words"
                returnKeyType="next"
              />
              <Text style={styles.fieldLabel}>Artist</Text>
              <TextInput
                value={artist}
                onChangeText={setArtist}
                style={styles.input}
                placeholder="Artist"
                placeholderTextColor={PALETTE.textSecondary}
                selectionColor={accent}
                autoCapitalize="words"
                returnKeyType="done"
              />
              <View style={styles.editActions}>
                <Pressable
                  onPress={() => setMode('menu')}
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    onSaveDetails(track.id, title, artist);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: accent },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.primaryButtonText, { color: onAccent }]}>Save</Text>
                </Pressable>
              </View>
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

function OptionRow({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.optionRow, pressed && styles.rowPressed]}
    >
      <Ionicons name={icon} size={24} color={PALETTE.text} />
      <Text style={styles.optionLabel}>{label}</Text>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/*  Now Playing sheet                                                         */
/* -------------------------------------------------------------------------- */

interface NowPlayingProps {
  visible: boolean;
  track: LibraryTrack | null;
  shuffleOn: boolean;
  repeatMode: RepeatMode;
  optionsOverlay: ReactNode;
  onClose: () => void;
  onToggleLike: (id: string) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onMore: (id: string) => void;
}

function NowPlayingSheet(props: NowPlayingProps) {
  const { visible, track, onClose } = props;
  return (
    <Modal
      visible={visible && track !== null}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {track ? <NowPlayingContent {...props} track={track} /> : null}
    </Modal>
  );
}

interface NowPlayingContentProps extends NowPlayingProps {
  track: LibraryTrack;
}

function NowPlayingContent({
  track,
  shuffleOn,
  repeatMode,
  optionsOverlay,
  onClose,
  onToggleLike,
  onToggleShuffle,
  onCycleRepeat,
  onMore,
}: NowPlayingContentProps) {
  const { accent, onAccent } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { playing } = useIsPlaying();
  const { position, duration } = useProgress(250);
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const scrubbing = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dy > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5,
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > 90 || gesture.vy > 0.9) {
          closeRef.current();
        }
      },
    }),
  ).current;

  const artSize = Math.min(width - 56, height * 0.4, 460);
  const elapsed = scrubValue ?? position;
  const sliderMax = Math.max(duration, 1);

  const handleSlidingStart = useCallback((value: number) => {
    scrubbing.current = true;
    setScrubValue(value);
  }, []);

  const handleValueChange = useCallback((value: number) => {
    if (scrubbing.current) {
      setScrubValue(value);
    }
  }, []);

  const handleSlidingComplete = useCallback(async (value: number) => {
    await transportSeek(value);
    setTimeout(() => {
      scrubbing.current = false;
      setScrubValue(null);
    }, 300);
  }, []);

  const repeatActive = repeatMode !== RepeatMode.Off;

  return (
    <View style={styles.npBackdrop}>
      <View style={[styles.npShadow, { marginTop: insets.top + 6 }]}>
        <View style={styles.npSheet}>
          <LinearGradient
            colors={[scaleColor(accent, 0.55), PALETTE.card, PALETTE.background]}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.npTopBar} {...panResponder.panHandlers}>
            <IconButton
              name="chevron-down"
              size={28}
              color={PALETTE.text}
              label="Close player"
              onPress={onClose}
            />
            <View style={styles.npTopCenter}>
              <Text style={styles.npPlayingFrom}>PLAYING FROM YOUR LIBRARY</Text>
              <Text style={styles.npPlayingName} numberOfLines={1}>
                Local Songs
              </Text>
            </View>
            <IconButton
              name="ellipsis-horizontal"
              size={24}
              color={PALETTE.text}
              label="More options"
              onPress={() => onMore(track.id)}
            />
          </View>

          <View style={styles.npArtArea}>
            <View style={[styles.npArtShadow, { width: artSize, height: artSize }]}>
              <Artwork uri={track.artwork} size={artSize} radius={20} iconSize={artSize * 0.3} />
            </View>
          </View>

          <View style={styles.npInfoRow}>
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={styles.npTitle}>
                {track.title}
              </Text>
              <Text numberOfLines={1} style={styles.npArtist}>
                {track.artist}
              </Text>
            </View>
            <IconButton
              name={track.liked ? 'heart' : 'heart-outline'}
              size={28}
              color={track.liked ? accent : PALETTE.text}
              label={track.liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
              onPress={() => onToggleLike(track.id)}
            />
          </View>

          <View style={styles.npSliderBlock}>
            <Slider
              style={styles.npSlider}
              minimumValue={0}
              maximumValue={sliderMax}
              value={Math.min(elapsed, sliderMax)}
              minimumTrackTintColor={accent}
              maximumTrackTintColor="rgba(255,255,255,0.28)"
              thumbTintColor={PALETTE.text}
              onSlidingStart={handleSlidingStart}
              onValueChange={handleValueChange}
              onSlidingComplete={handleSlidingComplete}
              accessibilityLabel="Playback position"
            />
            <View style={styles.npTimes}>
              <Text style={styles.npTime}>{formatTime(elapsed)}</Text>
              <Text style={styles.npTime}>{formatTime(duration)}</Text>
            </View>
          </View>

          <View style={[styles.npControls, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.controlSlot}>
              <IconButton
                name="shuffle"
                size={26}
                color={shuffleOn ? accent : PALETTE.textSecondary}
                label={shuffleOn ? 'Turn shuffle off' : 'Turn shuffle on'}
                onPress={onToggleShuffle}
              />
              {shuffleOn ? <View style={[styles.activeDot, { backgroundColor: accent }]} /> : null}
            </View>
            <IconButton
              name="play-skip-back"
              size={34}
              color={PALETTE.text}
              label="Previous track"
              onPress={() => void transportPrevious()}
            />
            <Pressable
              onPress={() => void transportToggle()}
              accessibilityRole="button"
              accessibilityLabel={playing ? 'Pause' : 'Play'}
              style={({ pressed }) => [
                styles.playWheel,
                { backgroundColor: accent, shadowColor: accent },
                pressed && styles.wheelPressed,
              ]}
            >
              <Ionicons
                name={playing ? 'pause' : 'play'}
                size={36}
                color={onAccent}
                style={playing ? undefined : styles.playGlyphNudge}
              />
            </Pressable>
            <IconButton
              name="play-skip-forward"
              size={34}
              color={PALETTE.text}
              label="Next track"
              onPress={() => void transportNext()}
            />
            <View style={styles.controlSlot}>
              <IconButton
                name="repeat"
                size={26}
                color={repeatActive ? accent : PALETTE.textSecondary}
                label="Change repeat mode"
                onPress={onCycleRepeat}
              />
              {repeatMode === RepeatMode.Track ? (
                <Text style={[styles.repeatBadge, { color: accent }]}>1</Text>
              ) : null}
              {repeatActive ? <View style={[styles.activeDot, { backgroundColor: accent }]} /> : null}
            </View>
          </View>
          {optionsOverlay}
        </View>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*  App shell                                                                 */
/* -------------------------------------------------------------------------- */

function AppShell() {
  const { accent, onAccent } = useTheme();
  const insets = useSafeAreaInsets();
  const activeTrack = useActiveTrack();
  const { playing } = useIsPlaying();

  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey | null>(null);
  const [likedOnly, setLikedOnly] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [optionsId, setOptionsId] = useState<string | null>(null);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(RepeatMode.Off);

  const tracksRef = useRef<LibraryTrack[]>([]);
  const visibleRef = useRef<LibraryTrack[]>([]);
  const importingRef = useRef(false);

  useTrackPlayerEvents(REMOTE_EVENTS, (event) => {
    switch (event.type) {
      case Event.RemotePlay:
        void transportPlay();
        break;
      case Event.RemotePause:
        void transportPause();
        break;
      case Event.RemoteNext:
        void transportNext();
        break;
      case Event.RemotePrevious:
        void transportPrevious();
        break;
      case Event.RemoteSeek:
        void transportSeek(event.position);
        break;
      default:
        break;
    }
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await setupTrackPlayer();
        const mode = await TrackPlayer.getRepeatMode();
        if (!cancelled) {
          setRepeatMode(mode);
        }
      } catch (error) {
        if (!cancelled) {
          setPlayerError(errorMessage(error));
        }
      }
      const loaded = await loadLibrary();
      if (!cancelled) {
        tracksRef.current = loaded;
        setTracks(loaded);
        setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const commitTracks = useCallback((updater: (previous: LibraryTrack[]) => LibraryTrack[]) => {
    const next = updater(tracksRef.current);
    tracksRef.current = next;
    setTracks(next);
    void persistJson(METADATA_URI, next);
  }, []);

  const visibleTracks = useMemo(
    () => (likedOnly ? tracks.filter((track) => track.liked) : tracks),
    [tracks, likedOnly],
  );
  visibleRef.current = visibleTracks;

  const likedCount = useMemo(() => tracks.filter((track) => track.liked).length, [tracks]);
  const currentTrack = useMemo(
    () => tracks.find((track) => track.id === activeTrack?.id) ?? null,
    [tracks, activeTrack?.id],
  );
  const optionsTrack = useMemo(
    () => tracks.find((track) => track.id === optionsId) ?? null,
    [tracks, optionsId],
  );

  useEffect(() => {
    if (!currentTrack && nowPlayingOpen) {
      setNowPlayingOpen(false);
    }
  }, [currentTrack, nowPlayingOpen]);

  const importSongs = useCallback(async () => {
    if (importingRef.current) {
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }
      importingRef.current = true;
      setImporting(true);
      const stamp = Date.now();
      const added: LibraryTrack[] = [];
      const skipped: string[] = [];
      for (let index = 0; index < result.assets.length; index += 1) {
        const asset = result.assets[index];
        const id = `${stamp}-${index}`;
        const extension = fileExtension(asset.name, asset.mimeType, AUDIO_MIME_EXTENSIONS, 'mp3');
        const destination = `${DOC_DIR}${id}.${extension}`;
        try {
          await FileSystem.copyAsync({ from: asset.uri, to: destination });
          const names = parseTrackNames(asset.name);
          added.push({
            id,
            title: names.title,
            artist: names.artist,
            uri: destination,
            artwork: null,
            liked: false,
          });
        } catch {
          skipped.push(asset.name);
        } finally {
          await removeFile(asset.uri);
        }
      }
      if (added.length > 0) {
        commitTracks((previous) => [...previous, ...added]);
        await appendToQueue(added);
      }
      if (skipped.length > 0) {
        Alert.alert('Some files were skipped', skipped.join('\n'));
      }
    } catch (error) {
      Alert.alert('Import failed', errorMessage(error));
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }, [commitTracks]);

  const playTrack = useCallback(async (id: string) => {
    try {
      await setupTrackPlayer();
      const context = visibleRef.current;
      const index = context.findIndex((track) => track.id === id);
      if (index < 0) {
        return;
      }
      const active = await TrackPlayer.getActiveTrack();
      if (active?.id === id) {
        await transportToggle();
        return;
      }
      const queue = await TrackPlayer.getQueue();
      const queuedIds = new Set(queue.map((item) => item.id));
      const sameContext =
        queue.length === context.length && context.every((track) => queuedIds.has(track.id));
      if (sameContext) {
        await TrackPlayer.skip(queue.findIndex((item) => item.id === id));
      } else {
        await TrackPlayer.reset();
        await TrackPlayer.add(context.map(toPlayerTrack));
        await TrackPlayer.skip(index);
        if (shuffleOn) {
          await reorderUpcoming(tracksRef.current, true);
        }
      }
      await TrackPlayer.play();
    } catch (error) {
      Alert.alert('Playback failed', errorMessage(error));
    }
  }, [shuffleOn]);

  const toggleLike = useCallback(
    (id: string) => {
      commitTracks((previous) =>
        previous.map((track) => (track.id === id ? { ...track, liked: !track.liked } : track)),
      );
    },
    [commitTracks],
  );

  const saveDetails = useCallback(
    (id: string, title: string, artist: string) => {
      const existing = tracksRef.current.find((track) => track.id === id);
      if (!existing) {
        return;
      }
      const updated: LibraryTrack = {
        ...existing,
        title: title.trim() || existing.title,
        artist: artist.trim() || DEFAULT_ARTIST,
      };
      commitTracks((previous) => previous.map((track) => (track.id === id ? updated : track)));
      void syncQueueMetadata(updated);
    },
    [commitTracks],
  );

  const pickArtwork = useCallback(
    async (id: string) => {
      try {
        const result = await DocumentPicker.getDocumentAsync({
          type: 'image/*',
          multiple: false,
          copyToCacheDirectory: true,
        });
        if (result.canceled) {
          return;
        }
        const asset = result.assets[0];
        const existing = tracksRef.current.find((track) => track.id === id);
        if (!existing) {
          await removeFile(asset.uri);
          return;
        }
        const extension = fileExtension(asset.name, asset.mimeType, IMAGE_MIME_EXTENSIONS, 'jpg');
        const destination = `${DOC_DIR}${id}-art-${Date.now()}.${extension}`;
        await FileSystem.copyAsync({ from: asset.uri, to: destination });
        await removeFile(asset.uri);
        await removeFile(existing.artwork);
        commitTracks((previous) =>
          previous.map((track) => (track.id === id ? { ...track, artwork: destination } : track)),
        );
        const updated = tracksRef.current.find((track) => track.id === id);
        if (updated) {
          await syncQueueMetadata(updated);
        }
      } catch (error) {
        Alert.alert('Artwork failed', errorMessage(error));
      }
    },
    [commitTracks],
  );

  const removeTrack = useCallback(
    async (id: string) => {
      const target = tracksRef.current.find((track) => track.id === id);
      if (!target) {
        return;
      }
      await removeFromQueue(id);
      commitTracks((previous) => previous.filter((track) => track.id !== id));
      await removeFile(target.uri);
      await removeFile(target.artwork);
    },
    [commitTracks],
  );

  const confirmRemove = useCallback(
    (id: string) => {
      const target = tracksRef.current.find((track) => track.id === id);
      if (!target) {
        return;
      }
      Alert.alert('Remove from library', `"${target.title}" will be deleted from this device.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void removeTrack(id) },
      ]);
    },
    [removeTrack],
  );

  const toggleShuffle = useCallback(() => {
    const next = !shuffleOn;
    setShuffleOn(next);
    void reorderUpcoming(tracksRef.current, next);
  }, [shuffleOn]);

  const cycleRepeat = useCallback(async () => {
    const next =
      repeatMode === RepeatMode.Off
        ? RepeatMode.Queue
        : repeatMode === RepeatMode.Queue
          ? RepeatMode.Track
          : RepeatMode.Off;
    try {
      const applied = await TrackPlayer.setRepeatMode(next);
      setRepeatMode(applied);
    } catch (error) {
      console.warn('Could not change repeat mode', error);
    }
  }, [repeatMode]);

  const selectFilter = useCallback((key: FilterKey) => {
    setLikedOnly(false);
    setFilter((previous) => (previous === key ? null : key));
  }, []);

  const openLiked = useCallback(() => {
    setFilter(null);
    setLikedOnly((previous) => !previous);
  }, []);

  const openOptions = useCallback((id: string) => setOptionsId(id), []);
  const closeOptions = useCallback(() => setOptionsId(null), []);
  const openNowPlaying = useCallback(() => setNowPlayingOpen(true), []);
  const closeNowPlaying = useCallback(() => setNowPlayingOpen(false), []);
  const toggleTray = useCallback(() => setTrayOpen((previous) => !previous), []);

  const showGrid = filter === null || filter === 'playlists';
  const listData = filter === 'playlists' ? [] : visibleTracks;
  const showDownloaded = filter === 'downloaded';

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<LibraryTrack>) => (
      <TrackRow
        track={item}
        active={item.id === activeTrack?.id}
        playing={playing === true}
        accent={accent}
        showDownloaded={showDownloaded}
        onPress={playTrack}
        onMore={openOptions}
      />
    ),
    [activeTrack?.id, playing, accent, showDownloaded, playTrack, openOptions],
  );

  const keyExtractor = useCallback((item: LibraryTrack) => item.id, []);

  const listHeader = (
    <View>
      {showGrid ? (
        <LibraryGrid
          likedCount={likedCount}
          likedActive={likedOnly}
          importing={importing}
          onOpenLiked={openLiked}
          onImport={() => void importSongs()}
        />
      ) : null}
      {likedOnly ? (
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Liked Songs</Text>
          <Pressable onPress={openLiked} hitSlop={10} accessibilityRole="button">
            <Text style={[styles.sectionAction, { color: accent }]}>Show all</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  const emptyState = !hydrated ? (
    <View style={styles.empty}>
      <ActivityIndicator color={accent} />
    </View>
  ) : filter === 'playlists' ? null : likedOnly ? (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No liked songs yet</Text>
      <Text style={styles.emptyBody}>Tap the heart on any track to save it here.</Text>
    </View>
  ) : (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>Your songs live here</Text>
      <Text style={styles.emptyBody}>
        Import audio files from the Files app. They are copied into the app and stay available
        offline.
      </Text>
      <Pressable
        onPress={() => void importSongs()}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.primaryButton,
          styles.emptyButton,
          { backgroundColor: accent },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.primaryButtonText, { color: onAccent }]}>Import songs</Text>
      </Pressable>
    </View>
  );

  const listBottomPadding = currentTrack
    ? MINI_PLAYER_HEIGHT + MINI_PLAYER_BOTTOM_OFFSET + insets.bottom + 24
    : insets.bottom + 24;

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <LibraryHeader
        trayOpen={trayOpen}
        importing={importing}
        filter={filter}
        onToggleTray={toggleTray}
        onImport={() => void importSongs()}
        onSelectFilter={selectFilter}
      />
      {playerError ? (
        <Text style={styles.errorBanner}>{`Player unavailable: ${playerError}`}</Text>
      ) : null}
      <FlatList
        data={listData}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={emptyState ?? undefined}
        contentContainerStyle={{ paddingBottom: listBottomPadding }}
        initialNumToRender={14}
        windowSize={9}
        keyboardShouldPersistTaps="handled"
      />
      {currentTrack ? (
        <MiniPlayer track={currentTrack} onOpen={openNowPlaying} onToggleLike={toggleLike} />
      ) : null}
      <NowPlayingSheet
        visible={nowPlayingOpen}
        track={currentTrack}
        shuffleOn={shuffleOn}
        repeatMode={repeatMode}
        onClose={closeNowPlaying}
        onToggleLike={toggleLike}
        onToggleShuffle={toggleShuffle}
        onCycleRepeat={() => void cycleRepeat()}
        onMore={openOptions}
        optionsOverlay={
          <TrackOptionsOverlay
            visible={nowPlayingOpen && optionsId !== null}
            track={optionsTrack}
            onClose={closeOptions}
            onToggleLike={toggleLike}
            onSaveDetails={saveDetails}
            onPickArtwork={(id) => void pickArtwork(id)}
            onRemove={confirmRemove}
          />
        }
      />
      <TrackOptionsOverlay
        visible={!nowPlayingOpen && optionsId !== null}
        track={optionsTrack}
        onClose={closeOptions}
        onToggleLike={toggleLike}
        onSaveDetails={saveDetails}
        onPickArtwork={(id) => void pickArtwork(id)}
        onRemove={confirmRemove}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/* -------------------------------------------------------------------------- */
/*  Styles                                                                    */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: PALETTE.background },
  pressed: { opacity: 0.6 },
  wheelPressed: { transform: [{ scale: 0.96 }] },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  header: { backgroundColor: PALETTE.background },
  headerRow: {
    height: 48,
    paddingLeft: 16,
    paddingRight: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { color: PALETTE.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  tray: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  swatchWrap: { width: 64, alignItems: 'center', paddingTop: 6 },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchSelected: { borderColor: PALETTE.text },
  swatchLabel: { color: PALETTE.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 4 },
  swatchLabelSelected: { color: PALETTE.text },
  chipRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: PALETTE.subCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { color: PALETTE.text, fontSize: 14, fontWeight: '500' },

  grid: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 12 },
  tileArt: {
    borderRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    backgroundColor: PALETTE.card,
    borderWidth: 1.5,
    borderColor: '#3A3A3A',
    borderStyle: 'dashed',
  },
  tileTitle: { color: PALETTE.text, fontSize: 16, fontWeight: '700', marginTop: 8 },
  tileSubtitle: { color: PALETTE.textSecondary, fontSize: 13, marginTop: 2 },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionTitle: { color: PALETTE.text, fontSize: 20, fontWeight: '800' },
  sectionAction: { fontSize: 14, fontWeight: '700' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.07)' },
  rowText: { flex: 1 },
  rowTitle: { color: PALETTE.text, fontSize: 16, fontWeight: '700' },
  rowSubtitleLine: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  rowBadge: { marginRight: 5 },
  rowSubtitle: { color: PALETTE.textSecondary, fontSize: 14, flexShrink: 1 },
  rowMore: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  empty: { paddingHorizontal: 32, paddingTop: 32, alignItems: 'center' },
  emptyTitle: { color: PALETTE.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  emptyBody: {
    color: PALETTE.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
  },
  emptyButton: { marginTop: 20 },
  errorBanner: {
    color: PALETTE.text,
    backgroundColor: '#8B1E2D',
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },

  miniWrap: {
    position: 'absolute',
    left: MINI_PLAYER_SIDE_MARGIN,
    right: MINI_PLAYER_SIDE_MARGIN,
    height: MINI_PLAYER_HEIGHT,
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  miniCapsule: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(30,30,30,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  miniProgressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  miniProgressFill: { height: 2 },
  miniContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 4,
    gap: 10,
  },
  miniText: { flex: 1 },
  miniTitle: { color: PALETTE.text, fontSize: 14, fontWeight: '700' },
  miniArtist: { color: PALETTE.textSecondary, fontSize: 12, marginTop: 1 },

  overlayBackdrop: { backgroundColor: 'rgba(0,0,0,0.6)' },
  optionsSheet: {
    backgroundColor: '#282828',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
  },
  optionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.18)',
  },
  optionsTitle: { color: PALETTE.text, fontSize: 16, fontWeight: '700' },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    height: 56,
  },
  optionLabel: { color: PALETTE.text, fontSize: 16, fontWeight: '500' },
  editForm: { paddingHorizontal: 16, paddingTop: 12 },
  fieldLabel: {
    color: PALETTE.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    height: 46,
    borderRadius: 6,
    paddingHorizontal: 12,
    backgroundColor: '#3E3E3E',
    color: PALETTE.text,
    fontSize: 16,
  },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 20 },
  primaryButton: {
    height: 44,
    minWidth: 96,
    paddingHorizontal: 22,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { fontSize: 15, fontWeight: '800' },
  secondaryButton: {
    height: 44,
    minWidth: 96,
    paddingHorizontal: 22,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: PALETTE.text, fontSize: 15, fontWeight: '700' },

  npBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  npShadow: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: PALETTE.card,
    shadowColor: '#000000',
    shadowOpacity: 0.85,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -10 },
    elevation: 32,
  },
  npSheet: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  npTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  npTopCenter: { flex: 1, alignItems: 'center' },
  npPlayingFrom: {
    color: PALETTE.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  npPlayingName: { color: PALETTE.text, fontSize: 13, fontWeight: '700', marginTop: 2 },
  npArtArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  npArtShadow: {
    borderRadius: 20,
    backgroundColor: PALETTE.subCard,
    shadowColor: '#000000',
    shadowOpacity: 0.7,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 16 },
    elevation: 24,
  },
  npInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 28,
    paddingRight: 20,
    gap: 12,
  },
  npTitle: { color: PALETTE.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  npArtist: { color: PALETTE.textSecondary, fontSize: 16, fontWeight: '500', marginTop: 2 },
  npSliderBlock: { paddingHorizontal: 20, paddingTop: 12 },
  npSlider: { width: '100%', height: 40 },
  npTimes: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
  npTime: { color: PALETTE.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
  npControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  controlSlot: { width: 44, alignItems: 'center', justifyContent: 'center' },
  activeDot: { width: 4, height: 4, borderRadius: 2, marginTop: -4 },
  repeatBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    fontSize: 10,
    fontWeight: '900',
  },
  playWheel: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  playGlyphNudge: { marginLeft: 4 },
});
