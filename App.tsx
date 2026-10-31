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
import type { ComponentProps, ComponentRef, ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
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
import type {
  AlertButton,
  LayoutChangeEvent,
  ListRenderItemInfo,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import * as DocumentPicker from 'expo-document-picker';
import {
  getAppIconName,
  setAlternateAppIcon,
  supportsAlternateIcons,
} from 'expo-alternate-app-icons';
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
import type { AddTrack, Track } from 'react-native-track-player';

/* -------------------------------------------------------------------------- */
/*  Types and constants                                                       */
/* -------------------------------------------------------------------------- */

type IconName = ComponentProps<typeof Ionicons>['name'];
type FilterKey = 'songs' | 'downloaded';
type TabKey = 'songs' | 'playlists';
type SortKey = 'custom' | 'added' | 'recent' | 'title' | 'artist';

interface LibraryTrack {
  id: string;
  title: string;
  artist: string;
  uri: string;
  artwork: string | null;
  liked: boolean;
  sourceName: string;
  album: string;
}

interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  cover: string | null;
  sort: SortKey;
}

interface AccentOption {
  key: string;
  label: string;
  color: string;
  icon: string | null;
}

interface IncomingFile {
  uri: string;
  name: string;
  mimeType?: string;
  /** copy: copy then delete the source. move: relocate it. keep: copy and leave the source alone. */
  mode: 'copy' | 'move' | 'keep';
}

const PALETTE = {
  background: '#000000',
  card: '#121212',
  subCard: '#242424',
  text: '#FFFFFF',
  textSecondary: '#B3B3B3',
} as const;

const ACCENTS: readonly AccentOption[] = [
  { key: 'green', label: 'Green', color: '#1DB954', icon: null },
  { key: 'blue', label: 'Blue', color: '#2E8BFF', icon: 'Blue' },
  { key: 'purple', label: 'Purple', color: '#8352F5', icon: 'Purple' },
  { key: 'pink', label: 'Pink', color: '#FF2E93', icon: 'Pink' },
  { key: 'orange', label: 'Orange', color: '#FF7A1A', icon: 'Orange' },
];

const ICON_SWITCH_DELAY_MS = 900;

const FILTERS: readonly { key: FilterKey; label: string }[] = [
  { key: 'songs', label: 'Songs' },
  { key: 'downloaded', label: 'Downloaded' },
];

const DOC_DIR = FileSystem.documentDirectory ?? '';
const METADATA_URI = `${DOC_DIR}tracks_metadata.json`;
const SKIN_URI = `${DOC_DIR}skin_settings.json`;
const PLAYLISTS_URI = `${DOC_DIR}playlists.json`;
const INBOX_URI = `${DOC_DIR}Inbox/`;
const SONGS_DIR = `${DOC_DIR}Songs/`;
const ART_DIR = `${DOC_DIR}Artwork/`;
const LIBRARY_SETTINGS_URI = `${DOC_DIR}library_settings.json`;
const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp3',
  'm4a',
  'aac',
  'wav',
  'flac',
  'aiff',
  'aif',
  'caf',
]);
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);
const DEFAULT_ARTIST = 'Unknown Artist';
/** Shown on car displays and lock screens when a song has no album, instead of N/A. */
const DEFAULT_ALBUM = 'Local Files';

const SORT_LABELS: Record<SortKey, string> = {
  custom: 'Custom order',
  added: 'Import order',
  recent: 'Recently added',
  title: 'Title',
  artist: 'Artist',
};
const LIBRARY_SORTS: readonly SortKey[] = ['added', 'recent', 'title', 'artist'];
const PLAYLIST_SORTS: readonly SortKey[] = ['custom', 'recent', 'title', 'artist'];
const MAX_PLAYLIST_NAME = 60;

const MINI_PLAYER_HEIGHT = 64;
const MINI_PLAYER_BOTTOM_OFFSET = 8;
const TAB_BAR_HEIGHT = 56;
const ROW_HEIGHT = 56;
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

function isAudioName(name: string): boolean {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return match !== null && AUDIO_EXTENSIONS.has(match[1].toLowerCase());
}

function stripExtension(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
}

function isImageName(name: string): boolean {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return match !== null && IMAGE_EXTENSIONS.has(match[1].toLowerCase());
}

function isSortKey(value: unknown): value is SortKey {
  return (
    value === 'custom' ||
    value === 'added' ||
    value === 'recent' ||
    value === 'title' ||
    value === 'artist'
  );
}

/** Lower-case name without extension, so "Song.mp3" and "song.JPG" share a key. */
function baseKey(name: string): string {
  return stripExtension(name).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** URL-safe readable suffix for stored file names, so the Files app shows something useful. */
function slugSuffix(name: string): string {
  const slug = stripExtension(name)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug ? `-${slug}` : '';
}

function trackKeys(track: LibraryTrack): string[] {
  const keys = [baseKey(track.title), baseKey(`${track.artist} - ${track.title}`)];
  if (track.sourceName) {
    keys.push(baseKey(track.sourceName));
  }
  return keys;
}

function addedAtOf(track: LibraryTrack): number {
  const stamp = Number(track.id.split('-')[0]);
  return Number.isFinite(stamp) ? stamp : 0;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

function sortTracks(list: LibraryTrack[], sort: SortKey): LibraryTrack[] {
  if (sort === 'custom' || sort === 'added') {
    return list;
  }
  const indexed = list.map((track, index) => ({ track, index }));
  indexed.sort((a, b) => {
    let result: number;
    if (sort === 'recent') {
      result = addedAtOf(b.track) - addedAtOf(a.track);
    } else if (sort === 'title') {
      result = compareText(a.track.title, b.track.title);
    } else {
      result = compareText(a.track.artist, b.track.artist) || compareText(a.track.title, b.track.title);
    }
    if (result !== 0) {
      return result;
    }
    return sort === 'recent' ? b.index - a.index : a.index - b.index;
  });
  return indexed.map((entry) => entry.track);
}

let trackCounter = 0;

function nextTrackId(): string {
  trackCounter += 1;
  return `${Date.now()}-${trackCounter}`;
}

function nextPlaylistId(): string {
  trackCounter += 1;
  return `pl-${Date.now()}-${trackCounter}`;
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? 'song' : 'songs'}`;
}

function reportSkipped(skipped: string[]): void {
  if (skipped.length > 0) {
    Alert.alert('Some files were skipped', skipped.join('\n'));
  }
}

/** "Artist - Title - Album", "Artist - Title" or just "Title". */
function parseTrackNames(fileName: string): { title: string; artist: string; album: string } {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/_/g, ' ').trim();
  const parts = base.split(' - ').map((part) => part.trim());
  if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
    return {
      artist: parts[0],
      title: parts.slice(1, -1).join(' - '),
      album: parts[parts.length - 1],
    };
  }
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return { artist: parts[0], title: parts.slice(1).join(' - '), album: '' };
  }
  return { title: base.length > 0 ? base : 'Untitled', artist: DEFAULT_ARTIST, album: '' };
}

function toPlayerTrack(track: LibraryTrack): AddTrack {
  return {
    id: track.id,
    url: track.uri,
    title: track.title,
    artist: track.artist,
    album: track.album || DEFAULT_ALBUM,
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

/** iOS changes the app container path between installs, so keep only what follows Documents/. */
function rebaseUri(stored: string): string {
  const marker = '/Documents/';
  const index = stored.lastIndexOf(marker);
  if (index >= 0) {
    return `${DOC_DIR}${stored.slice(index + marker.length)}`;
  }
  const name = stored.split('/').pop();
  return name ? `${DOC_DIR}${name}` : stored;
}

/**
 * Finds a stored file even if it was moved between the app folder, Songs, Artwork or Inbox,
 * and moves loose files from the main folder into the tidy subfolder.
 */
async function locateFile(stored: string, preferredDir: string): Promise<string | null> {
  const rebased = rebaseUri(stored);
  const name = rebased.split('/').pop() ?? '';
  if (!name) {
    return null;
  }
  const candidates = [rebased, `${preferredDir}${name}`, `${DOC_DIR}${name}`, `${INBOX_URI}${name}`];
  for (const candidate of candidates) {
    if (!(await fileExists(candidate))) {
      continue;
    }
    if (candidate.startsWith(preferredDir)) {
      return candidate;
    }
    const target = `${preferredDir}${name}`;
    if (!(await fileExists(target))) {
      try {
        await FileSystem.moveAsync({ from: candidate, to: target });
        return target;
      } catch (error) {
        console.warn(`Could not move ${name}`, error);
      }
    }
    return candidate;
  }
  return null;
}

interface StoredTrack {
  id: string;
  title: string;
  artist: string;
  uri: string;
  artwork: string | null;
  liked?: boolean;
  sourceName?: string;
  album?: string;
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
      const uri = await locateFile(item.uri, SONGS_DIR);
      if (!uri) {
        changed = true;
        continue;
      }
      let artwork: string | null = null;
      if (item.artwork) {
        artwork = await locateFile(item.artwork, ART_DIR);
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
        sourceName: typeof item.sourceName === 'string' ? item.sourceName : '',
        album: typeof item.album === 'string' ? item.album : '',
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

interface StoredPlaylist {
  id: string;
  name: string;
  trackIds: string[];
  cover?: unknown;
  sort?: unknown;
}

function isStoredPlaylist(value: unknown): value is StoredPlaylist {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    Array.isArray(candidate.trackIds) &&
    candidate.trackIds.every((entry) => typeof entry === 'string')
  );
}

async function loadPlaylists(validIds: ReadonlySet<string>): Promise<Playlist[]> {
  try {
    if (!(await fileExists(PLAYLISTS_URI))) {
      return [];
    }
    const parsed: unknown = JSON.parse(await FileSystem.readAsStringAsync(PLAYLISTS_URI));
    if (!Array.isArray(parsed)) {
      return [];
    }
    // An empty library usually means it failed to load, so never prune against it.
    const prune = validIds.size > 0;
    const loaded: Playlist[] = [];
    let changed = false;
    for (const item of parsed) {
      if (!isStoredPlaylist(item)) {
        changed = true;
        continue;
      }
      const trackIds = item.trackIds.filter(
        (id, index, all) => all.indexOf(id) === index && (!prune || validIds.has(id)),
      );
      if (trackIds.length !== item.trackIds.length) {
        changed = true;
      }
      let cover: string | null = null;
      if (typeof item.cover === 'string' && item.cover) {
        cover = await locateFile(item.cover, ART_DIR);
        if (cover !== item.cover) {
          changed = true;
        }
      }
      loaded.push({
        id: item.id,
        name: item.name,
        trackIds,
        cover,
        sort: isSortKey(item.sort) ? item.sort : 'custom',
      });
    }
    if (changed && prune) {
      await persistJson(PLAYLISTS_URI, loaded);
    }
    return loaded;
  } catch (error) {
    console.warn('Could not read the playlists file', error);
    return [];
  }
}

async function ensureDirectories(): Promise<void> {
  for (const directory of [SONGS_DIR, ART_DIR, INBOX_URI]) {
    try {
      const info = await FileSystem.getInfoAsync(directory);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      }
    } catch (error) {
      console.warn(`Could not prepare ${directory}`, error);
    }
  }
}

/** Audio files and pictures dropped into the app's folder (or the Inbox) but not yet imported. */
async function findDroppedFiles(
  library: LibraryTrack[],
  playlists: Playlist[],
): Promise<IncomingFile[]> {
  const known = new Set<string>();
  for (const track of library) {
    known.add(track.uri);
    if (track.artwork) {
      known.add(track.artwork);
    }
  }
  for (const playlist of playlists) {
    if (playlist.cover) {
      known.add(playlist.cover);
    }
  }
  const found: IncomingFile[] = [];
  for (const directory of [DOC_DIR, INBOX_URI, SONGS_DIR, ART_DIR]) {
    let names: string[];
    try {
      names = await FileSystem.readDirectoryAsync(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      const uri = `${directory}${name}`;
      if (known.has(uri)) {
        continue;
      }
      if (isAudioName(name) || isImageName(name)) {
        found.push({ uri, name, mode: 'move' });
      }
    }
  }
  return found;
}

async function transferFile(file: IncomingFile, destination: string): Promise<void> {
  if (file.mode === 'move') {
    await FileSystem.moveAsync({ from: file.uri, to: destination });
    return;
  }
  try {
    await FileSystem.copyAsync({ from: file.uri, to: destination });
  } finally {
    if (file.mode === 'copy') {
      await removeFile(file.uri);
    }
  }
}

async function importArtwork(image: IncomingFile, ownerId: string): Promise<string | null> {
  if (!(await fileExists(image.uri))) {
    return null;
  }
  const extension = fileExtension(image.name, image.mimeType, IMAGE_MIME_EXTENSIONS, 'jpg');
  const destination = `${ART_DIR}${ownerId}-art-${Date.now()}.${extension}`;
  await transferFile(image, destination);
  return destination;
}

async function loadLibrarySort(): Promise<SortKey> {
  try {
    if (!(await fileExists(LIBRARY_SETTINGS_URI))) {
      return 'added';
    }
    const parsed: unknown = JSON.parse(await FileSystem.readAsStringAsync(LIBRARY_SETTINGS_URI));
    if (typeof parsed === 'object' && parsed !== null) {
      const sort = (parsed as Record<string, unknown>).sort;
      if (isSortKey(sort) && sort !== 'custom') {
        return sort;
      }
    }
    return 'added';
  } catch {
    return 'added';
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
        album: track.album || DEFAULT_ALBUM,
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

/** Queues a song after the current one (playNext) or at the end. Returns a short message. */
async function enqueueTrack(track: LibraryTrack, playNext: boolean): Promise<string> {
  await setupTrackPlayer();
  const queue = await TrackPlayer.getQueue();
  if (queue.length === 0) {
    await TrackPlayer.add(toPlayerTrack(track));
    await TrackPlayer.play();
    return 'Playing now';
  }
  const activeIndex = (await TrackPlayer.getActiveTrackIndex()) ?? -1;
  const existing = queue.findIndex((item) => item.id === track.id);
  if (existing >= 0 && existing === activeIndex) {
    return 'Already playing';
  }
  if (!playNext) {
    if (existing >= 0) {
      return 'Already in the queue';
    }
    await TrackPlayer.add(toPlayerTrack(track));
    return 'Added to queue';
  }
  const target = activeIndex + 1;
  if (existing >= 0) {
    if (existing === target) {
      return 'Already playing next';
    }
    await TrackPlayer.move(existing, existing > activeIndex ? target : activeIndex);
    return 'Playing next';
  }
  await TrackPlayer.add(toPlayerTrack(track), target);
  return 'Playing next';
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

async function syncAppIcon(color: string): Promise<void> {
  try {
    if (!supportsAlternateIcons) {
      return;
    }
    const wanted = ACCENTS.find((option) => option.color === color)?.icon ?? null;
    if (getAppIconName() === wanted) {
      return;
    }
    await setAlternateAppIcon(wanted);
  } catch (error) {
    console.warn('Could not change the app icon', error);
  }
}

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

  const iconTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (iconTimer.current) {
        clearTimeout(iconTimer.current);
      }
    },
    [],
  );

  const setAccent = useCallback((color: string) => {
    chosenByUser.current = true;
    setAccentState(color);
    void persistJson(SKIN_URI, { accent: color });
    if (iconTimer.current) {
      clearTimeout(iconTimer.current);
    }
    iconTimer.current = setTimeout(() => {
      void syncAppIcon(color);
    }, ICON_SWITCH_DELAY_MS);
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
  tab: TabKey;
  onToggleTray: () => void;
  onImport: () => void;
  onSelectFilter: (key: FilterKey) => void;
}

function LibraryHeader({
  trayOpen,
  importing,
  filter,
  tab,
  onToggleTray,
  onImport,
  onSelectFilter,
}: LibraryHeaderProps) {
  const insets = useSafeAreaInsets();
  const { accent } = useTheme();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>{tab === 'songs' ? 'Your Library' : 'Playlists'}</Text>
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
      {tab === 'songs' ? (
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
      ) : null}
    </View>
  );
}

function SearchBar({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const { accent } = useTheme();
  return (
    <View style={styles.searchBar}>
      <Ionicons name="search" size={18} color={PALETTE.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChange}
        style={styles.searchInput}
        placeholder="Search your songs"
        placeholderTextColor={PALETTE.textSecondary}
        selectionColor={accent}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
        accessibilityLabel="Search your songs"
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Ionicons name="close-circle" size={18} color={PALETTE.textSecondary} />
        </Pressable>
      ) : null}
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
        { bottom: insets.bottom + TAB_BAR_HEIGHT + MINI_PLAYER_BOTTOM_OFFSET },
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
/*  Sheets, playlist rows and track options                                   */
/* -------------------------------------------------------------------------- */

interface SheetFrameProps {
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
}

function SheetFrame({ onClose, closeLabel, children }: SheetFrameProps) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(48)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slide, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [slide, fade]);

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
          accessibilityLabel={closeLabel}
        />
        <Animated.View
          style={[
            styles.optionsSheet,
            { paddingBottom: insets.bottom + 16, transform: [{ translateY: slide }] },
          ]}
        >
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

function CheckCircle({ checked }: { checked: boolean }) {
  const { accent, onAccent } = useTheme();
  return (
    <View
      style={[styles.checkCircle, checked && { backgroundColor: accent, borderColor: accent }]}
    >
      {checked ? <Ionicons name="checkmark" size={16} color={onAccent} /> : null}
    </View>
  );
}

interface SelectRowProps {
  title: string;
  subtitle: string;
  artwork: string | null;
  checked: boolean;
  onPress: () => void;
}

function SelectRow({ title, subtitle, artwork, checked, onPress }: SelectRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => [styles.selectRow, pressed && styles.rowPressed]}
    >
      <Artwork uri={artwork} size={40} radius={4} iconSize={18} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.rowSubtitle, styles.rowSubtitleTop]}>
          {subtitle}
        </Text>
      </View>
      <CheckCircle checked={checked} />
    </Pressable>
  );
}

interface NameFormProps {
  initial: string;
  confirmLabel: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

function NameForm({ initial, confirmLabel, onCancel, onSubmit }: NameFormProps) {
  const { accent, onAccent } = useTheme();
  const [value, setValue] = useState(initial);

  return (
    <View style={styles.editForm}>
      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        style={styles.input}
        placeholder="Playlist name"
        placeholderTextColor={PALETTE.textSecondary}
        selectionColor={accent}
        autoCapitalize="words"
        autoFocus
        maxLength={MAX_PLAYLIST_NAME}
        returnKeyType="done"
        onSubmitEditing={() => onSubmit(value)}
      />
      <View style={styles.editActions}>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => onSubmit(value)}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: accent },
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
        >
          <Text style={[styles.primaryButtonText, { color: onAccent }]}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ----------------------------- Playlist rows ------------------------------ */

interface ShortcutRowProps {
  leading: ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
}

function ShortcutRow({ leading, title, subtitle, onPress }: ShortcutRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {leading}
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.rowSubtitle, styles.rowSubtitleTop]}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

interface PlaylistRowProps {
  playlist: Playlist;
  artwork: string | null;
  onPress: (id: string) => void;
  onMore: (id: string) => void;
}

const PlaylistRow = memo(function PlaylistRow({
  playlist,
  artwork,
  onPress,
  onMore,
}: PlaylistRowProps) {
  const subtitle = `Playlist • ${countLabel(playlist.trackIds.length)}`;
  return (
    <Pressable
      onPress={() => onPress(playlist.id)}
      accessibilityRole="button"
      accessibilityLabel={`${playlist.name}. ${subtitle}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Artwork uri={artwork} size={48} radius={4} iconSize={22} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {playlist.name}
        </Text>
        <Text numberOfLines={1} style={[styles.rowSubtitle, styles.rowSubtitleTop]}>
          {subtitle}
        </Text>
      </View>
      <Pressable
        onPress={() => onMore(playlist.id)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`More options for ${playlist.name}`}
        style={({ pressed }) => [styles.rowMore, pressed && styles.pressed]}
      >
        <Ionicons name="ellipsis-horizontal" size={20} color={PALETTE.textSecondary} />
      </Pressable>
    </Pressable>
  );
});

interface PillProps {
  icon: IconName;
  label: string;
  active?: boolean;
  onPress: () => void;
}

function Pill({ icon, label, active = false, onPress }: PillProps) {
  const { accent } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.plAddButton,
        active && { borderColor: accent },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={18} color={active ? accent : PALETTE.text} />
      <Text style={[styles.plAddText, active && { color: accent }]}>{label}</Text>
    </Pressable>
  );
}

interface PlaylistHeaderProps {
  playlist: Playlist;
  trackCount: number;
  cover: string | null;
  sortLabel: string;
  reordering: boolean;
  onBack: () => void;
  onPlay: () => void;
  onShuffle: () => void;
  onAddSongs: () => void;
  onSort: () => void;
  onReorder: () => void;
  onMore: () => void;
}

function PlaylistHeader({
  playlist,
  trackCount,
  cover,
  sortLabel,
  reordering,
  onBack,
  onPlay,
  onShuffle,
  onAddSongs,
  onSort,
  onReorder,
  onMore,
}: PlaylistHeaderProps) {
  const { accent, onAccent } = useTheme();
  const empty = trackCount === 0;

  return (
    <View style={styles.plHeader}>
      <View style={styles.plTopRow}>
        <IconButton
          name="chevron-back"
          size={26}
          color={PALETTE.text}
          label="Back to playlists"
          onPress={onBack}
        />
        <IconButton
          name="ellipsis-horizontal"
          size={22}
          color={PALETTE.text}
          label="Playlist options"
          onPress={onMore}
        />
      </View>
      <View style={styles.plCoverWrap}>
        <View style={styles.plCoverShadow}>
          <Artwork uri={cover} size={176} radius={8} iconSize={64} />
        </View>
      </View>
      <Text numberOfLines={2} style={styles.plTitle}>
        {playlist.name}
      </Text>
      <Text style={styles.plMeta}>{countLabel(trackCount)}</Text>
      <View style={styles.plPills}>
        <Pill icon="add" label="Add songs" onPress={onAddSongs} />
        <Pill icon="swap-vertical" label={sortLabel} onPress={onSort} />
        {trackCount > 1 ? (
          <Pill
            icon={reordering ? 'checkmark' : 'reorder-three'}
            label={reordering ? 'Done' : 'Reorder'}
            active={reordering}
            onPress={onReorder}
          />
        ) : null}
      </View>
      <View style={styles.plPlayGroup}>
        <IconButton
          name="shuffle"
          size={26}
          color={empty ? '#5A5A5A' : PALETTE.text}
          label="Shuffle play"
          onPress={onShuffle}
        />
        <Pressable
          onPress={onPlay}
          disabled={empty}
          accessibilityRole="button"
          accessibilityLabel="Play playlist"
          style={({ pressed }) => [
            styles.plPlayButton,
            { backgroundColor: accent },
            empty && styles.plPlayDisabled,
            pressed && styles.wheelPressed,
          ]}
        >
          <Ionicons name="play" size={28} color={onAccent} style={styles.playGlyphNudge} />
        </Pressable>
      </View>
    </View>
  );
}

/* ------------------------------ Sorting UI -------------------------------- */

function SortRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Sort songs. Current order: ${label}`}
      style={({ pressed }) => [styles.sortRow, pressed && styles.pressed]}
    >
      <Ionicons name="swap-vertical" size={16} color={PALETTE.text} />
      <Text style={styles.sortRowText}>{label}</Text>
    </Pressable>
  );
}

interface SortSheetProps {
  title: string;
  options: readonly SortKey[];
  value: SortKey;
  onSelect: (key: SortKey) => void;
  onClose: () => void;
}

function SortSheet({ title, options, value, onSelect, onClose }: SortSheetProps) {
  const { accent } = useTheme();
  return (
    <SheetFrame onClose={onClose} closeLabel="Close sort options">
      <Text style={[styles.sheetTitle, styles.sheetTitleSolo]}>{title}</Text>
      {options.map((key) => {
        const selected = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => {
              onSelect(key);
              onClose();
            }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={({ pressed }) => [styles.optionRow, pressed && styles.rowPressed]}
          >
            <Text style={[styles.optionLabel, styles.sortOptionText, selected && { color: accent }]}>
              {SORT_LABELS[key]}
            </Text>
            {selected ? <Ionicons name="checkmark" size={22} color={accent} /> : null}
          </Pressable>
        );
      })}
    </SheetFrame>
  );
}

/* ----------------------------- Drag to reorder ---------------------------- */

interface DragState {
  from: number;
  to: number;
}

/**
 * Drag-to-reorder for rows of a fixed height inside a FlatList. The dragged row follows the
 * finger, the rows in between slide out of the way, and the list scrolls near its edges.
 */
function useDragReorder<T>(count: number, onCommit: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const info = useRef<{ from: number; to: number; dy: number; moveY: number; startScroll: number } | null>(
    null,
  );
  const dragFromRef = useRef<number | null>(null);
  dragFromRef.current = drag?.from ?? null;
  const countRef = useRef(count);
  countRef.current = count;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const listRef = useRef<FlatList<T>>(null);
  const boxRef = useRef<ComponentRef<typeof View>>(null);
  const scrollOffset = useRef(0);
  const contentHeight = useRef(0);
  const viewHeight = useRef(0);
  const boxRect = useRef({ top: 0, height: 0 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopAutoScroll = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  const refresh = useCallback(() => {
    const current = info.current;
    if (!current) {
      return;
    }
    const total = current.dy + (scrollOffset.current - current.startScroll);
    dragY.setValue(total);
    const to = Math.max(
      0,
      Math.min(countRef.current - 1, current.from + Math.round(total / ROW_HEIGHT)),
    );
    if (to !== current.to) {
      current.to = to;
      setDrag({ from: current.from, to });
    }
  }, [dragY]);

  const startDrag = useCallback(
    (index: number) => {
      info.current = { from: index, to: index, dy: 0, moveY: 0, startScroll: scrollOffset.current };
      dragY.setValue(0);
      setDrag({ from: index, to: index });
      boxRef.current?.measureInWindow((_x: number, y: number, _width: number, height: number) => {
        boxRect.current = { top: y, height };
      });
      stopAutoScroll();
      timer.current = setInterval(() => {
        const current = info.current;
        const { top, height } = boxRect.current;
        if (!current || current.moveY === 0 || height === 0) {
          return;
        }
        const edge = 90;
        let delta = 0;
        if (current.moveY < top + edge) {
          delta = -14;
        } else if (current.moveY > top + height - edge) {
          delta = 14;
        }
        if (delta === 0) {
          return;
        }
        const max = Math.max(0, contentHeight.current - viewHeight.current);
        const next = Math.max(0, Math.min(max, scrollOffset.current + delta));
        if (next !== scrollOffset.current) {
          scrollOffset.current = next;
          listRef.current?.scrollToOffset({ offset: next, animated: false });
          refresh();
        }
      }, 16);
    },
    [dragY, refresh, stopAutoScroll],
  );

  const moveDrag = useCallback(
    (dy: number, moveY: number) => {
      const current = info.current;
      if (!current) {
        return;
      }
      current.dy = dy;
      current.moveY = moveY;
      refresh();
    },
    [refresh],
  );

  const endDrag = useCallback(() => {
    const current = info.current;
    info.current = null;
    stopAutoScroll();
    dragY.setValue(0);
    setDrag(null);
    if (current && current.to !== current.from) {
      commitRef.current(current.from, current.to);
    }
  }, [dragY, stopAutoScroll]);

  const shiftFor = useCallback(
    (index: number): number => {
      if (!drag || index === drag.from) {
        return 0;
      }
      if (drag.from < drag.to && index > drag.from && index <= drag.to) {
        return -ROW_HEIGHT;
      }
      if (drag.from > drag.to && index < drag.from && index >= drag.to) {
        return ROW_HEIGHT;
      }
      return 0;
    },
    [drag],
  );

  const cell = useMemo(
    () =>
      function DragCell(props: {
        children?: ReactNode;
        index: number;
        style?: StyleProp<ViewStyle>;
        onLayout?: (event: LayoutChangeEvent) => void;
      }) {
        return (
          <View
            style={[props.style, props.index === dragFromRef.current && styles.dragCell]}
            onLayout={props.onLayout}
          >
            {props.children}
          </View>
        );
      },
    [],
  );

  const listProps = {
    extraData: drag,
    scrollEnabled: drag === null,
    scrollEventThrottle: 16,
    CellRendererComponent: cell,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollOffset.current = event.nativeEvent.contentOffset.y;
    },
    onContentSizeChange: (_width: number, height: number) => {
      contentHeight.current = height;
    },
    onLayout: (event: LayoutChangeEvent) => {
      viewHeight.current = event.nativeEvent.layout.height;
    },
  };

  return { drag, dragY, startDrag, moveDrag, endDrag, shiftFor, listRef, boxRef, listProps };
}

/* ----------------------------- Reorder helpers ---------------------------- */

interface ReorderRowProps {
  index: number;
  title: string;
  artist: string;
  artwork: string | null;
  dragging: boolean;
  shift: number;
  dragY: Animated.Value;
  onStart: (index: number) => void;
  onMove: (dy: number, moveY: number) => void;
  onEnd: () => void;
  onRemove: () => void;
}

function ReorderRow(props: ReorderRowProps) {
  const { title, artist, artwork, dragging, shift, dragY, onRemove } = props;
  const propsRef = useRef(props);
  propsRef.current = props;
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => propsRef.current.onStart(propsRef.current.index),
      onPanResponderMove: (_event, gesture) => propsRef.current.onMove(gesture.dy, gesture.moveY),
      onPanResponderRelease: () => propsRef.current.onEnd(),
      onPanResponderTerminate: () => propsRef.current.onEnd(),
    }),
  ).current;

  return (
    <Animated.View
      style={[
        styles.reorderRow,
        dragging && styles.reorderRowDragging,
        { transform: [{ translateY: dragging ? dragY : shift }] },
      ]}
    >
      <Artwork uri={artwork} size={40} radius={4} iconSize={18} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.rowSubtitle, styles.rowSubtitleTop]}>
          {artist}
        </Text>
      </View>
      <IconButton
        name="close"
        size={22}
        color={PALETTE.textSecondary}
        label={`Remove ${title}`}
        onPress={onRemove}
        style={styles.smallIcon}
      />
      <View
        {...responder.panHandlers}
        accessible
        accessibilityLabel={`Drag ${title} to reorder`}
        style={styles.dragHandle}
      >
        <Ionicons name="reorder-three" size={28} color={PALETTE.textSecondary} />
      </View>
    </Animated.View>
  );
}

function TabBar({ tab, onSelect }: { tab: TabKey; onSelect: (tab: TabKey) => void }) {
  const insets = useSafeAreaInsets();
  const { accent } = useTheme();
  const items: { key: TabKey; label: string; on: IconName; off: IconName }[] = [
    { key: 'songs', label: 'Songs', on: 'musical-notes', off: 'musical-notes-outline' },
    { key: 'playlists', label: 'Playlists', on: 'albums', off: 'albums-outline' },
  ];
  return (
    <View style={[styles.tabBar, { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]}>
      {items.map((item) => {
        const selected = tab === item.key;
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={item.label}
            style={({ pressed }) => [styles.tabItem, pressed && styles.pressed]}
          >
            <Ionicons
              name={selected ? item.on : item.off}
              size={24}
              color={selected ? accent : PALETTE.textSecondary}
            />
            <Text style={[styles.tabLabel, selected && { color: accent }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* --------------------------------- Toast ---------------------------------- */

interface ToastProps {
  text: string;
  bottom: number;
  onDone: () => void;
}

function Toast({ text, bottom, onDone }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(1500),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) {
        onDone();
      }
    });
  }, [opacity, onDone]);

  return (
    <Animated.View pointerEvents="none" style={[styles.toastWrap, { bottom, opacity }]}>
      <View style={styles.toast}>
        <Text style={styles.toastText}>{text}</Text>
      </View>
    </Animated.View>
  );
}

/* -------------------------------- Queue sheet ----------------------------- */

function QueueSheet({ onClose }: { onClose: () => void }) {
  const { accent } = useTheme();
  const active = useActiveTrack();
  const [queue, setQueue] = useState<Track[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [editing, setEditing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [items, index] = await Promise.all([
        TrackPlayer.getQueue(),
        TrackPlayer.getActiveTrackIndex(),
      ]);
      setQueue(items);
      setActiveIndex(index ?? -1);
    } catch (error) {
      console.warn('Could not read the queue', error);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, active?.id]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        console.warn('Queue change failed', error);
      }
      await refresh();
    },
    [refresh],
  );

  const base = activeIndex + 1;
  const upcoming = queue.slice(base);
  const commitQueueDrag = useCallback(
    (from: number, to: number) => {
      setQueue((previous) => {
        const next = [...previous];
        const [moved] = next.splice(base + from, 1);
        if (moved) {
          next.splice(base + to, 0, moved);
        }
        return next;
      });
      void run(() => TrackPlayer.move(base + from, base + to));
    },
    [base, run],
  );
  const dnd = useDragReorder<Track>(upcoming.length, commitQueueDrag);
  const nowTrack = activeIndex >= 0 ? queue[activeIndex] : undefined;

  const renderItem = ({ item, index }: ListRenderItemInfo<Track>) => {
    const absolute = base + index;
    const title = item.title ?? 'Untitled';
    const artist = item.artist ?? DEFAULT_ARTIST;
    const artwork = item.artwork ?? null;
    if (editing) {
      return (
        <ReorderRow
          index={index}
          title={title}
          artist={artist}
          artwork={artwork}
          dragging={dnd.drag?.from === index}
          shift={dnd.shiftFor(index)}
          dragY={dnd.dragY}
          onStart={dnd.startDrag}
          onMove={dnd.moveDrag}
          onEnd={dnd.endDrag}
          onRemove={() => void run(() => TrackPlayer.remove(absolute))}
        />
      );
    }
    return (
      <Pressable
        onPress={() =>
          void run(async () => {
            await TrackPlayer.skip(absolute);
            await TrackPlayer.play();
          })
        }
        accessibilityRole="button"
        accessibilityLabel={`Play ${title} by ${artist}`}
        style={({ pressed }) => [styles.selectRow, pressed && styles.rowPressed]}
      >
        <Artwork uri={artwork} size={40} radius={4} iconSize={18} />
        <View style={styles.rowText}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[styles.rowSubtitle, styles.rowSubtitleTop]}>
            {artist}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <SheetFrame onClose={onClose} closeLabel="Close queue">
      <View style={styles.queueHeadRow}>
        <Text style={styles.sheetTitle}>Queue</Text>
        {upcoming.length > 1 || editing ? (
          <Pill
            icon={editing ? 'checkmark' : 'create-outline'}
            label={editing ? 'Done' : 'Edit'}
            active={editing}
            onPress={() => setEditing((previous) => !previous)}
          />
        ) : null}
      </View>
      {nowTrack ? (
        <View style={styles.queueNow}>
          <Text style={styles.queueLabel}>NOW PLAYING</Text>
          <View style={styles.queueNowRow}>
            <Artwork uri={nowTrack.artwork ?? null} size={40} radius={4} iconSize={18} />
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: accent }]}>
                {nowTrack.title ?? 'Untitled'}
              </Text>
              <Text numberOfLines={1} style={[styles.rowSubtitle, styles.rowSubtitleTop]}>
                {nowTrack.artist ?? DEFAULT_ARTIST}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
      <Text style={[styles.queueLabel, styles.queueNextLabel]}>
        {`NEXT UP • ${upcoming.length}`}
      </Text>
      {upcoming.length === 0 ? (
        <Text style={styles.sheetHint}>
          Nothing is queued next. Use Play next or Add to queue from any song menu.
        </Text>
      ) : (
        <View ref={dnd.boxRef} collapsable={false} style={styles.sheetListTall}>
          <FlatList
            ref={dnd.listRef}
            data={upcoming}
            {...dnd.listProps}
            extraData={{ editing, drag: dnd.drag }}
            keyExtractor={(item, index) => `${base + index}-${String(item.id)}`}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
          />
        </View>
      )}
      <View style={styles.sheetActions}>
        <Pressable
          onPress={() =>
            void run(async () => {
              if (upcoming.length < 2) {
                return;
              }
              await TrackPlayer.removeUpcomingTracks();
              await TrackPlayer.add(shuffled(upcoming));
            })
          }
          accessibilityRole="button"
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryButtonText}>Shuffle next</Text>
        </Pressable>
        <Pressable
          onPress={() => void run(() => TrackPlayer.removeUpcomingTracks())}
          accessibilityRole="button"
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryButtonText}>Clear</Text>
        </Pressable>
      </View>
    </SheetFrame>
  );
}

/* ------------------------- Playlist management sheets --------------------- */

type PlaylistSheetState =
  | { kind: 'create' }
  | { kind: 'rename'; id: string }
  | { kind: 'addSongs'; id: string };

interface AddSongsSheetProps {
  playlist: Playlist;
  tracks: readonly LibraryTrack[];
  onSave: (trackIds: string[]) => void;
  onClose: () => void;
}

function AddSongsSheet({ playlist, tracks, onSave, onClose }: AddSongsSheetProps) {
  const { accent, onAccent } = useTheme();
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(playlist.trackIds),
  );

  const toggle = useCallback((id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<LibraryTrack>) => (
      <SelectRow
        title={item.title}
        subtitle={item.artist}
        artwork={item.artwork}
        checked={selected.has(item.id)}
        onPress={() => toggle(item.id)}
      />
    ),
    [selected, toggle],
  );

  return (
    <SheetFrame onClose={onClose} closeLabel="Close">
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>Add songs</Text>
        <Text numberOfLines={1} style={styles.rowSubtitle}>
          {`${playlist.name} • ${selected.size} selected`}
        </Text>
      </View>
      {tracks.length === 0 ? (
        <Text style={styles.sheetHint}>Import some songs first, then come back to sort them.</Text>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          extraData={selected}
          style={styles.sheetListTall}
          keyboardShouldPersistTaps="handled"
        />
      )}
      <View style={styles.sheetActions}>
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => onSave(Array.from(selected))}
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
    </SheetFrame>
  );
}

interface PlaylistSheetHostProps {
  state: PlaylistSheetState | null;
  tracks: readonly LibraryTrack[];
  playlists: readonly Playlist[];
  onClose: () => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onSetMembers: (id: string, trackIds: string[]) => void;
}

function PlaylistSheetHost({
  state,
  tracks,
  playlists,
  onClose,
  onCreate,
  onRename,
  onSetMembers,
}: PlaylistSheetHostProps) {
  if (!state) {
    return null;
  }
  if (state.kind === 'create') {
    return (
      <SheetFrame key="create" onClose={onClose} closeLabel="Close">
        <Text style={[styles.sheetTitle, styles.sheetTitleSolo]}>New playlist</Text>
        <NameForm initial="" confirmLabel="Create" onCancel={onClose} onSubmit={onCreate} />
      </SheetFrame>
    );
  }
  const playlist = playlists.find((item) => item.id === state.id);
  if (!playlist) {
    return null;
  }
  if (state.kind === 'rename') {
    return (
      <SheetFrame key={`rename-${playlist.id}`} onClose={onClose} closeLabel="Close">
        <Text style={[styles.sheetTitle, styles.sheetTitleSolo]}>Rename playlist</Text>
        <NameForm
          initial={playlist.name}
          confirmLabel="Save"
          onCancel={onClose}
          onSubmit={(name) => {
            onRename(playlist.id, name);
            onClose();
          }}
        />
      </SheetFrame>
    );
  }
  return (
    <AddSongsSheet
      key={`add-${playlist.id}`}
      playlist={playlist}
      tracks={tracks}
      onClose={onClose}
      onSave={(trackIds) => {
        onSetMembers(playlist.id, trackIds);
        onClose();
      }}
    />
  );
}

/* ---------------------------- Track options sheet ------------------------- */

type OptionsMode = 'menu' | 'edit' | 'playlists' | 'newPlaylist';

interface OptionsOverlayProps {
  visible: boolean;
  track: LibraryTrack | null;
  playlists: readonly Playlist[];
  currentPlaylistName: string | null;
  onClose: () => void;
  onToggleLike: (id: string) => void;
  onSaveDetails: (id: string, title: string, artist: string, album: string) => void;
  onPickArtwork: (id: string) => void;
  onRemove: (id: string) => void;
  onTogglePlaylist: (playlistId: string, trackId: string) => void;
  onCreatePlaylist: (name: string, trackId: string) => void;
  onRemoveFromPlaylist: (trackId: string) => void;
  onQueue: (trackId: string, playNext: boolean) => void;
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
  playlists,
  currentPlaylistName,
  onClose,
  onToggleLike,
  onSaveDetails,
  onPickArtwork,
  onRemove,
  onTogglePlaylist,
  onCreatePlaylist,
  onRemoveFromPlaylist,
  onQueue,
}: OptionsSheetProps) {
  const { accent, onAccent } = useTheme();
  const [mode, setMode] = useState<OptionsMode>('menu');
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album);

  const runAndClose = (action: () => void) => () => {
    onClose();
    action();
  };

  const renderBody = (): ReactNode => {
    switch (mode) {
      case 'menu':
        return (
          <ScrollView style={styles.menuScroll}>
            <OptionRow
              icon={track.liked ? 'heart-dislike-outline' : 'heart-outline'}
              label={track.liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
              onPress={runAndClose(() => onToggleLike(track.id))}
            />
            <OptionRow
              icon="play-forward-outline"
              label="Play next"
              onPress={runAndClose(() => onQueue(track.id, true))}
            />
            <OptionRow
              icon="list-outline"
              label="Add to queue"
              onPress={runAndClose(() => onQueue(track.id, false))}
            />
            <OptionRow
              icon="add-circle-outline"
              label="Add to playlist"
              onPress={() => setMode('playlists')}
            />
            {currentPlaylistName !== null ? (
              <OptionRow
                icon="remove-circle-outline"
                label={`Remove from ${currentPlaylistName}`}
                onPress={runAndClose(() => onRemoveFromPlaylist(track.id))}
              />
            ) : null}
            <OptionRow
              icon="create-outline"
              label="Edit details"
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
          </ScrollView>
        );
      case 'edit':
        return (
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
              returnKeyType="next"
            />
            <Text style={styles.fieldLabel}>Album</Text>
            <TextInput
              value={album}
              onChangeText={setAlbum}
              style={styles.input}
              placeholder={DEFAULT_ALBUM}
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
                  onSaveDetails(track.id, title, artist, album);
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
        );
      case 'playlists':
        return (
          <View>
            <OptionRow icon="add" label="New playlist" onPress={() => setMode('newPlaylist')} />
            {playlists.length === 0 ? (
              <Text style={styles.sheetHint}>
                No playlists yet. Create one to start sorting your songs.
              </Text>
            ) : (
              <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
                {playlists.map((playlist) => (
                  <SelectRow
                    key={playlist.id}
                    title={playlist.name}
                    subtitle={countLabel(playlist.trackIds.length)}
                    artwork={null}
                    checked={playlist.trackIds.includes(track.id)}
                    onPress={() => onTogglePlaylist(playlist.id, track.id)}
                  />
                ))}
              </ScrollView>
            )}
            <View style={styles.sheetActions}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: accent },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
              >
                <Text style={[styles.primaryButtonText, { color: onAccent }]}>Done</Text>
              </Pressable>
            </View>
          </View>
        );
      case 'newPlaylist':
        return (
          <NameForm
            initial=""
            confirmLabel="Create"
            onCancel={() => setMode('playlists')}
            onSubmit={(name) => {
              onCreatePlaylist(name, track.id);
              onClose();
            }}
          />
        );
    }
  };

  return (
    <SheetFrame onClose={onClose} closeLabel="Close options">
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
      {renderBody()}
    </SheetFrame>
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
      <Text numberOfLines={1} style={styles.optionLabel}>
        {label}
      </Text>
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
  onOpenQueue: () => void;
  overlayOpen: boolean;
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
  onOpenQueue,
  overlayOpen,
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
            {overlayOpen ? (
              <View style={styles.npSlider} />
            ) : (
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
            )}
            <View style={styles.npTimes}>
              <Text style={styles.npTime}>{formatTime(elapsed)}</Text>
              <Text style={styles.npTime}>{formatTime(duration)}</Text>
            </View>
          </View>

          <View style={styles.npControls}>
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
          <View style={[styles.npFooter, { paddingBottom: insets.bottom + 12 }]}>
            <IconButton
              name="list"
              size={24}
              color={PALETTE.textSecondary}
              label="Open queue"
              onPress={onOpenQueue}
            />
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
  const [tab, setTab] = useState<TabKey>('songs');
  const [likedOnly, setLikedOnly] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [optionsId, setOptionsId] = useState<string | null>(null);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(RepeatMode.Off);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  const [playlistSheet, setPlaylistSheet] = useState<PlaylistSheetState | null>(null);
  const [query, setQuery] = useState('');
  const [librarySort, setLibrarySort] = useState<SortKey>('added');
  const [sortSheet, setSortSheet] = useState<'library' | 'playlist' | null>(null);
  const [reordering, setReordering] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  const tracksRef = useRef<LibraryTrack[]>([]);
  const playlistsRef = useRef<Playlist[]>([]);
  const queueContextRef = useRef<string[]>([]);
  const visibleRef = useRef<LibraryTrack[]>([]);
  const importingRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

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
      await ensureDirectories();
      const loaded = await loadLibrary();
      const loadedPlaylists = await loadPlaylists(new Set(loaded.map((track) => track.id)));
      const loadedSort = await loadLibrarySort();
      if (!cancelled) {
        tracksRef.current = loaded;
        playlistsRef.current = loadedPlaylists;
        setTracks(loaded);
        setPlaylists(loadedPlaylists);
        setLibrarySort(loadedSort);
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

  const commitPlaylists = useCallback((updater: (previous: Playlist[]) => Playlist[]) => {
    const next = updater(playlistsRef.current);
    playlistsRef.current = next;
    setPlaylists(next);
    void persistJson(PLAYLISTS_URI, next);
  }, []);

  const createPlaylist = useCallback(
    (name: string, firstTrackId: string | null): string => {
      const trimmed = name.trim().slice(0, MAX_PLAYLIST_NAME);
      const playlist: Playlist = {
        id: nextPlaylistId(),
        name: trimmed || `Playlist ${playlistsRef.current.length + 1}`,
        trackIds: firstTrackId ? [firstTrackId] : [],
        cover: null,
        sort: 'custom',
      };
      commitPlaylists((previous) => [...previous, playlist]);
      return playlist.id;
    },
    [commitPlaylists],
  );

  const renamePlaylist = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim().slice(0, MAX_PLAYLIST_NAME);
      if (!trimmed) {
        return;
      }
      commitPlaylists((previous) =>
        previous.map((playlist) => (playlist.id === id ? { ...playlist, name: trimmed } : playlist)),
      );
    },
    [commitPlaylists],
  );

  const deletePlaylist = useCallback(
    (id: string) => {
      const target = playlistsRef.current.find((playlist) => playlist.id === id);
      commitPlaylists((previous) => previous.filter((playlist) => playlist.id !== id));
      setOpenPlaylistId((previous) => (previous === id ? null : previous));
      if (target?.cover) {
        void removeFile(target.cover);
      }
    },
    [commitPlaylists],
  );

  const setPlaylistCover = useCallback(
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
        const existing = playlistsRef.current.find((playlist) => playlist.id === id);
        if (!existing) {
          await removeFile(asset.uri);
          return;
        }
        await ensureDirectories();
        const extension = fileExtension(asset.name, asset.mimeType, IMAGE_MIME_EXTENSIONS, 'jpg');
        const destination = `${ART_DIR}${id}-cover-${Date.now()}.${extension}`;
        await FileSystem.copyAsync({ from: asset.uri, to: destination });
        await removeFile(asset.uri);
        await removeFile(existing.cover);
        commitPlaylists((previous) =>
          previous.map((playlist) => (playlist.id === id ? { ...playlist, cover: destination } : playlist)),
        );
      } catch (error) {
        Alert.alert('Cover failed', errorMessage(error));
      }
    },
    [commitPlaylists],
  );

  const clearPlaylistCover = useCallback(
    (id: string) => {
      const existing = playlistsRef.current.find((playlist) => playlist.id === id);
      if (!existing?.cover) {
        return;
      }
      void removeFile(existing.cover);
      commitPlaylists((previous) =>
        previous.map((playlist) => (playlist.id === id ? { ...playlist, cover: null } : playlist)),
      );
    },
    [commitPlaylists],
  );

  const setPlaylistSort = useCallback(
    (id: string, sort: SortKey) => {
      commitPlaylists((previous) =>
        previous.map((playlist) => (playlist.id === id ? { ...playlist, sort } : playlist)),
      );
    },
    [commitPlaylists],
  );

  const moveTrackToIndex = useCallback(
    (playlistId: string, trackId: string, toIndex: number) => {
      commitPlaylists((previous) =>
        previous.map((playlist) => {
          if (playlist.id !== playlistId) {
            return playlist;
          }
          const ids = [...playlist.trackIds];
          const from = ids.indexOf(trackId);
          if (from < 0 || toIndex < 0 || toIndex >= ids.length || toIndex === from) {
            return playlist;
          }
          ids.splice(from, 1);
          ids.splice(toIndex, 0, trackId);
          return { ...playlist, trackIds: ids };
        }),
      );
    },
    [commitPlaylists],
  );

  const showToast = useCallback((text: string) => {
    setToast((previous) => ({ id: (previous?.id ?? 0) + 1, text }));
  }, []);
  const clearToast = useCallback(() => setToast(null), []);

  const togglePlaylistTrack = useCallback(
    (playlistId: string, trackId: string) => {
      commitPlaylists((previous) =>
        previous.map((playlist) => {
          if (playlist.id !== playlistId) {
            return playlist;
          }
          return playlist.trackIds.includes(trackId)
            ? { ...playlist, trackIds: playlist.trackIds.filter((entry) => entry !== trackId) }
            : { ...playlist, trackIds: [...playlist.trackIds, trackId] };
        }),
      );
    },
    [commitPlaylists],
  );

  const setPlaylistMembers = useCallback(
    (id: string, selected: string[]) => {
      const wanted = new Set(selected);
      commitPlaylists((previous) =>
        previous.map((playlist) => {
          if (playlist.id !== id) {
            return playlist;
          }
          const kept = playlist.trackIds.filter((entry) => wanted.has(entry));
          const keptSet = new Set(kept);
          const added = tracksRef.current
            .map((track) => track.id)
            .filter((entry) => wanted.has(entry) && !keptSet.has(entry));
          return { ...playlist, trackIds: [...kept, ...added] };
        }),
      );
    },
    [commitPlaylists],
  );

  const openPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === openPlaylistId) ?? null,
    [playlists, openPlaylistId],
  );

  const visibleTracks = useMemo(() => {
    if (openPlaylist) {
      const byId = new Map(tracks.map((track) => [track.id, track] as const));
      const members = openPlaylist.trackIds
        .map((id) => byId.get(id))
        .filter((track): track is LibraryTrack => track !== undefined);
      return sortTracks(members, openPlaylist.sort);
    }
    let base = likedOnly ? tracks.filter((track) => track.liked) : tracks;
    const needle = query.trim().toLowerCase();
    if (needle) {
      base = base.filter((track) =>
        `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(needle),
      );
    }
    return sortTracks(base, librarySort);
  }, [tracks, likedOnly, openPlaylist, librarySort, query]);
  visibleRef.current = visibleTracks;

  const playlistArtwork = useMemo(() => {
    const artworkById = new Map(tracks.map((track) => [track.id, track.artwork] as const));
    const result = new Map<string, string | null>();
    for (const playlist of playlists) {
      let found: string | null = playlist.cover;
      if (!found) {
        for (const id of playlist.trackIds) {
          const art = artworkById.get(id);
          if (art) {
            found = art;
            break;
          }
        }
      }
      result.set(playlist.id, found);
    }
    return result;
  }, [tracks, playlists]);

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

  const processFiles = useCallback(
    async (files: IncomingFile[]): Promise<string[]> => {
      if (files.length === 0) {
        return [];
      }
      setImporting(true);
      const skipped: string[] = [];
      try {
        await ensureDirectories();
        const isImage = (file: IncomingFile) =>
          isImageName(file.name) || (file.mimeType?.startsWith('image/') ?? false);
        const images = files.filter(isImage);
        const audio = files.filter((file) => !isImage(file));
        const imageByKey = new Map<string, IncomingFile>();
        for (const image of images) {
          imageByKey.set(baseKey(image.name), image);
        }
        const usedImages = new Set<IncomingFile>();
        const artById = new Map<string, string>();
        const added: LibraryTrack[] = [];

        for (const file of audio) {
          try {
            if (!(await fileExists(file.uri))) {
              continue;
            }
            const id = nextTrackId();
            const extension = fileExtension(
              file.name,
              file.mimeType,
              AUDIO_MIME_EXTENSIONS,
              'mp3',
            );
            const destination = `${SONGS_DIR}${id}${slugSuffix(file.name)}.${extension}`;
            await transferFile(file, destination);
            const names = parseTrackNames(file.name);
            let artwork: string | null = null;
            const match =
              imageByKey.get(baseKey(file.name)) ??
              imageByKey.get(baseKey(`${names.artist} - ${names.title}`)) ??
              imageByKey.get(baseKey(names.title));
            if (match && !usedImages.has(match)) {
              usedImages.add(match);
              try {
                artwork = await importArtwork(match, id);
              } catch {
                skipped.push(match.name);
              }
            }
            added.push({
              id,
              title: names.title,
              artist: names.artist,
              uri: destination,
              artwork,
              liked: false,
              sourceName: stripExtension(file.name),
              album: names.album,
            });
          } catch {
            skipped.push(file.name);
          }
        }

        const owners = [...tracksRef.current, ...added];
        for (const image of images) {
          if (usedImages.has(image)) {
            continue;
          }
          const key = baseKey(image.name);
          const owner = owners.find((track) => trackKeys(track).includes(key));
          if (!owner) {
            if (image.mode === 'copy') {
              await removeFile(image.uri);
              skipped.push(`${image.name} (no song with this name)`);
            }
            continue;
          }
          try {
            const uri = await importArtwork(image, owner.id);
            if (uri) {
              const previous = artById.get(owner.id) ?? owner.artwork;
              artById.set(owner.id, uri);
              if (previous) {
                await removeFile(previous);
              }
            }
          } catch {
            skipped.push(image.name);
          }
        }

        const withArt = (track: LibraryTrack): LibraryTrack =>
          artById.has(track.id) ? { ...track, artwork: artById.get(track.id) ?? null } : track;
        if (added.length > 0 || artById.size > 0) {
          commitTracks((previous) => [...previous.map(withArt), ...added.map(withArt)]);
        }
        const addedIds = new Set(added.map((track) => track.id));
        for (const id of artById.keys()) {
          if (!addedIds.has(id)) {
            const updated = tracksRef.current.find((track) => track.id === id);
            if (updated) {
              await syncQueueMetadata(updated);
            }
          }
        }
        if (added.length > 0) {
          await appendToQueue(added.map(withArt));
        }
      } finally {
        setImporting(false);
      }
      return skipped;
    },
    [commitTracks],
  );

  const enqueue = useCallback((task: () => Promise<string[]>): Promise<string[]> => {
    const run = queueRef.current.then(task);
    queueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const importSongs = useCallback(async () => {
    if (importingRef.current) {
      return;
    }
    importingRef.current = true;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/*', 'image/*'],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }
      const files = result.assets.map(
        (asset): IncomingFile => ({
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType,
          mode: 'copy',
        }),
      );
      reportSkipped(await enqueue(() => processFiles(files)));
    } catch (error) {
      Alert.alert('Import failed', errorMessage(error));
    } finally {
      importingRef.current = false;
    }
  }, [enqueue, processFiles]);

  const scanForNewFiles = useCallback(async () => {
    try {
      const skipped = await enqueue(async () =>
        processFiles(await findDroppedFiles(tracksRef.current, playlistsRef.current)),
      );
      reportSkipped(skipped);
    } catch (error) {
      console.warn('Folder scan failed', error);
    }
  }, [enqueue, processFiles]);

  const importFromUrl = useCallback(
    async (url: string) => {
      try {
        if (!url.startsWith('file://')) {
          await scanForNewFiles();
          return;
        }
        const decoded = decodeURIComponent(url.split('?')[0]);
        const name = decoded.split('/').pop() ?? '';
        const container = /\/Application\/([^/]+)\//.exec(DOC_DIR)?.[1];
        const ownFile = container !== undefined && decoded.includes(container);
        if (ownFile || !(isAudioName(name) || isImageName(name))) {
          await scanForNewFiles();
          return;
        }
        reportSkipped(await enqueue(() => processFiles([{ uri: url, name, mode: 'keep' }])));
      } catch (error) {
        console.warn('Could not open the shared file', error);
      }
    },
    [enqueue, processFiles, scanForNewFiles],
  );

  useEffect(() => {
    if (!hydrated) {
      return undefined;
    }
    void scanForNewFiles();
    void Linking.getInitialURL().then((url) => {
      if (url) {
        void importFromUrl(url);
      }
    });
    const stateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void scanForNewFiles();
      }
    });
    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      void importFromUrl(url);
    });
    return () => {
      stateSubscription.remove();
      linkSubscription.remove();
    };
  }, [hydrated, scanForNewFiles, importFromUrl]);

  const orderingSource = useCallback((): LibraryTrack[] => {
    const byId = new Map(tracksRef.current.map((track) => [track.id, track] as const));
    const ordered: LibraryTrack[] = [];
    const seen = new Set<string>();
    for (const id of queueContextRef.current) {
      const track = byId.get(id);
      if (track && !seen.has(id)) {
        ordered.push(track);
        seen.add(id);
      }
    }
    for (const track of tracksRef.current) {
      if (!seen.has(track.id)) {
        ordered.push(track);
      }
    }
    return ordered;
  }, []);

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
      queueContextRef.current = context.map((track) => track.id);
      if (sameContext) {
        await TrackPlayer.skip(queue.findIndex((item) => item.id === id));
      } else {
        await TrackPlayer.reset();
        await TrackPlayer.add(context.map(toPlayerTrack));
        await TrackPlayer.skip(index);
        if (shuffleOn) {
          await reorderUpcoming(orderingSource(), true);
        }
      }
      await TrackPlayer.play();
    } catch (error) {
      Alert.alert('Playback failed', errorMessage(error));
    }
  }, [shuffleOn, orderingSource]);

  const playContext = useCallback(async (shuffle: boolean) => {
    const context = visibleRef.current;
    if (context.length === 0) {
      return;
    }
    try {
      await setupTrackPlayer();
      await TrackPlayer.reset();
      await TrackPlayer.add((shuffle ? shuffled(context) : context).map(toPlayerTrack));
      queueContextRef.current = context.map((track) => track.id);
      setShuffleOn(shuffle);
      await TrackPlayer.play();
    } catch (error) {
      Alert.alert('Playback failed', errorMessage(error));
    }
  }, []);

  const toggleLike = useCallback(
    (id: string) => {
      commitTracks((previous) =>
        previous.map((track) => (track.id === id ? { ...track, liked: !track.liked } : track)),
      );
    },
    [commitTracks],
  );

  const saveDetails = useCallback(
    (id: string, title: string, artist: string, album: string) => {
      const existing = tracksRef.current.find((track) => track.id === id);
      if (!existing) {
        return;
      }
      const updated: LibraryTrack = {
        ...existing,
        title: title.trim() || existing.title,
        artist: artist.trim() || DEFAULT_ARTIST,
        album: album.trim(),
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
        await ensureDirectories();
        const destination = `${ART_DIR}${id}-art-${Date.now()}.${extension}`;
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
      if (playlistsRef.current.some((playlist) => playlist.trackIds.includes(id))) {
        commitPlaylists((previous) =>
          previous.map((playlist) =>
            playlist.trackIds.includes(id)
              ? { ...playlist, trackIds: playlist.trackIds.filter((entry) => entry !== id) }
              : playlist,
          ),
        );
      }
      await removeFile(target.uri);
      await removeFile(target.artwork);
    },
    [commitTracks, commitPlaylists],
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
    void reorderUpcoming(orderingSource(), next);
  }, [shuffleOn, orderingSource]);

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

  const selectTab = useCallback((next: TabKey) => {
    setTab(next);
    setOpenPlaylistId(null);
    if (next === 'playlists') {
      setLikedOnly(false);
    }
  }, []);

  const openLiked = useCallback(() => {
    setFilter(null);
    setLikedOnly((previous) => !previous);
  }, []);

  const showLiked = useCallback(() => {
    setTab('songs');
    setOpenPlaylistId(null);
    setFilter(null);
    setLikedOnly(true);
  }, []);

  const showPlaylist = useCallback((id: string) => {
    setLikedOnly(false);
    setTab('playlists');
    setOpenPlaylistId(id);
  }, []);

  const closePlaylist = useCallback(() => setOpenPlaylistId(null), []);
  const closePlaylistSheet = useCallback(() => setPlaylistSheet(null), []);

  const submitNewPlaylist = useCallback(
    (name: string) => {
      const id = createPlaylist(name, null);
      showPlaylist(id);
      setPlaylistSheet(tracksRef.current.length > 0 ? { kind: 'addSongs', id } : null);
    },
    [createPlaylist, showPlaylist],
  );

  const confirmDeletePlaylist = useCallback(
    (id: string) => {
      const target = playlistsRef.current.find((playlist) => playlist.id === id);
      if (!target) {
        return;
      }
      Alert.alert('Delete playlist', `"${target.name}" will be deleted. Your songs stay in the library.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deletePlaylist(id) },
      ]);
    },
    [deletePlaylist],
  );

  const openPlaylistMenu = useCallback(
    (id: string) => {
      const target = playlistsRef.current.find((playlist) => playlist.id === id);
      if (!target) {
        return;
      }
      const buttons: AlertButton[] = [
        { text: 'Add songs', onPress: () => setPlaylistSheet({ kind: 'addSongs', id }) },
        { text: 'Rename', onPress: () => setPlaylistSheet({ kind: 'rename', id }) },
        { text: 'Change cover', onPress: () => void setPlaylistCover(id) },
      ];
      if (target.cover) {
        buttons.push({ text: 'Remove cover', onPress: () => clearPlaylistCover(id) });
      }
      buttons.push(
        { text: 'Delete playlist', style: 'destructive', onPress: () => confirmDeletePlaylist(id) },
        { text: 'Cancel', style: 'cancel' },
      );
      Alert.alert(target.name, undefined, buttons);
    },
    [confirmDeletePlaylist, setPlaylistCover, clearPlaylistCover],
  );

  const removeFromOpenPlaylist = useCallback(
    (trackId: string) => {
      if (openPlaylistId === null) {
        return;
      }
      commitPlaylists((previous) =>
        previous.map((playlist) =>
          playlist.id === openPlaylistId
            ? { ...playlist, trackIds: playlist.trackIds.filter((entry) => entry !== trackId) }
            : playlist,
        ),
      );
    },
    [openPlaylistId, commitPlaylists],
  );

  const openOptions = useCallback((id: string) => setOptionsId(id), []);
  const closeOptions = useCallback(() => setOptionsId(null), []);
  const openNowPlaying = useCallback(() => setNowPlayingOpen(true), []);
  const closeNowPlaying = useCallback(() => {
    setNowPlayingOpen(false);
    setQueueOpen(false);
  }, []);
  const openQueue = useCallback(() => setQueueOpen(true), []);
  const closeQueue = useCallback(() => setQueueOpen(false), []);
  const closeSortSheet = useCallback(() => setSortSheet(null), []);

  useEffect(() => {
    setReordering(false);
  }, [openPlaylistId]);

  const toggleReorder = useCallback(() => {
    if (openPlaylistId === null) {
      return;
    }
    if (!reordering) {
      setPlaylistSort(openPlaylistId, 'custom');
    }
    setReordering(!reordering);
  }, [openPlaylistId, reordering, setPlaylistSort]);

  const selectLibrarySort = useCallback((key: SortKey) => {
    setLibrarySort(key);
    void persistJson(LIBRARY_SETTINGS_URI, { sort: key });
  }, []);

  const queueTrack = useCallback(
    async (trackId: string, playNext: boolean) => {
      const target = tracksRef.current.find((track) => track.id === trackId);
      if (!target) {
        return;
      }
      try {
        showToast(await enqueueTrack(target, playNext));
      } catch (error) {
        Alert.alert('Queue failed', errorMessage(error));
      }
    },
    [showToast],
  );
  const toggleTray = useCallback(() => setTrayOpen((previous) => !previous), []);

  const inPlaylistsTab = tab === 'playlists' && openPlaylist === null;
  const searching = query.trim().length > 0;
  const showSearch = tab === 'songs' && openPlaylist === null && tracks.length > 0;
  const showGrid = tab === 'songs' && filter === null && !searching;
  const showDownloaded = filter === 'downloaded';

  const reorderActive = reordering && openPlaylist !== null;

  const commitDrag = useCallback(
    (from: number, to: number) => {
      const moved = visibleRef.current[from];
      if (moved && openPlaylistId !== null) {
        moveTrackToIndex(openPlaylistId, moved.id, to);
      }
    },
    [openPlaylistId, moveTrackToIndex],
  );
  const dnd = useDragReorder<LibraryTrack>(visibleTracks.length, commitDrag);
  const { drag, dragY, startDrag, moveDrag, endDrag, shiftFor } = dnd;

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<LibraryTrack>) => {
      if (reorderActive) {
        return (
          <ReorderRow
            index={index}
            title={item.title}
            artist={item.artist}
            artwork={item.artwork}
            dragging={drag?.from === index}
            shift={shiftFor(index)}
            dragY={dragY}
            onStart={startDrag}
            onMove={moveDrag}
            onEnd={endDrag}
            onRemove={() => removeFromOpenPlaylist(item.id)}
          />
        );
      }
      return (
        <TrackRow
          track={item}
          active={item.id === activeTrack?.id}
          playing={playing === true}
          accent={accent}
          showDownloaded={showDownloaded}
          onPress={playTrack}
          onMore={openOptions}
        />
      );
    },
    [
      reorderActive,
      drag,
      shiftFor,
      dragY,
      startDrag,
      moveDrag,
      endDrag,
      removeFromOpenPlaylist,
      activeTrack?.id,
      playing,
      accent,
      showDownloaded,
      playTrack,
      openOptions,
    ],
  );

  const keyExtractor = useCallback((item: LibraryTrack) => item.id, []);
  const playlistKeyExtractor = useCallback((item: Playlist) => item.id, []);

  const renderPlaylist = useCallback(
    ({ item }: ListRenderItemInfo<Playlist>) => (
      <PlaylistRow
        playlist={item}
        artwork={playlistArtwork.get(item.id) ?? null}
        onPress={showPlaylist}
        onMore={openPlaylistMenu}
      />
    ),
    [playlistArtwork, showPlaylist, openPlaylistMenu],
  );

  const playlistsHeader = (
    <View style={styles.playlistsTop}>
      <ShortcutRow
        leading={
          <View style={styles.newPlaylistArt}>
            <Ionicons name="add" size={26} color={accent} />
          </View>
        }
        title="New playlist"
        subtitle="Sort your songs into a playlist"
        onPress={() => setPlaylistSheet({ kind: 'create' })}
      />
      <ShortcutRow
        leading={
          <View style={styles.likedArt}>
            <LinearGradient
              colors={['#35108F', '#8057F0']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Ionicons name="heart" size={22} color="#FFFFFF" />
          </View>
        }
        title="Liked Songs"
        subtitle={`Playlist • ${countLabel(likedCount)}`}
        onPress={showLiked}
      />
    </View>
  );

  const playlistsEmpty = !hydrated ? (
    <View style={styles.empty}>
      <ActivityIndicator color={accent} />
    </View>
  ) : (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No playlists yet</Text>
      <Text style={styles.emptyBody}>
        Tap New playlist above, or open the menu on any song and choose Add to playlist.
      </Text>
    </View>
  );

  const listHeader = (
    <View>
      {openPlaylist ? (
        <PlaylistHeader
          playlist={openPlaylist}
          trackCount={visibleTracks.length}
          cover={playlistArtwork.get(openPlaylist.id) ?? null}
          sortLabel={SORT_LABELS[openPlaylist.sort]}
          reordering={reordering}
          onBack={closePlaylist}
          onPlay={() => void playContext(false)}
          onShuffle={() => void playContext(true)}
          onAddSongs={() => setPlaylistSheet({ kind: 'addSongs', id: openPlaylist.id })}
          onSort={() => setSortSheet('playlist')}
          onReorder={toggleReorder}
          onMore={() => openPlaylistMenu(openPlaylist.id)}
        />
      ) : null}
      {openPlaylist === null && tracks.length > 1 ? (
        <SortRow label={SORT_LABELS[librarySort]} onPress={() => setSortSheet('library')} />
      ) : null}
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
  ) : openPlaylist ? (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>This playlist is empty</Text>
      <Text style={styles.emptyBody}>Add songs from your library to start listening.</Text>
      <Pressable
        onPress={() => setPlaylistSheet({ kind: 'addSongs', id: openPlaylist.id })}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.primaryButton,
          styles.emptyButton,
          { backgroundColor: accent },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.primaryButtonText, { color: onAccent }]}>Add songs</Text>
      </Pressable>
    </View>
  ) : searching ? (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No matches</Text>
      <Text style={styles.emptyBody}>{`Nothing in your songs matches "${query.trim()}".`}</Text>
    </View>
  ) : likedOnly ? (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No liked songs yet</Text>
      <Text style={styles.emptyBody}>Tap the heart on any track to save it here.</Text>
    </View>
  ) : (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>Your songs live here</Text>
      <Text style={styles.emptyBody}>
        Import audio files from the Files app or share them to this app from Files or Safari.
        They are copied into the app and stay available offline.
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

  const renderOptions = (visible: boolean, fromLibrary: boolean) => (
    <TrackOptionsOverlay
      visible={visible}
      track={optionsTrack}
      playlists={playlists}
      currentPlaylistName={
        fromLibrary && openPlaylist && optionsTrack && openPlaylist.trackIds.includes(optionsTrack.id)
          ? openPlaylist.name
          : null
      }
      onClose={closeOptions}
      onToggleLike={toggleLike}
      onSaveDetails={saveDetails}
      onPickArtwork={(id) => void pickArtwork(id)}
      onRemove={confirmRemove}
      onTogglePlaylist={togglePlaylistTrack}
      onCreatePlaylist={createPlaylist}
      onRemoveFromPlaylist={removeFromOpenPlaylist}
      onQueue={(id, next) => void queueTrack(id, next)}
    />
  );

  const listBottomPadding = currentTrack
    ? MINI_PLAYER_HEIGHT + MINI_PLAYER_BOTTOM_OFFSET + 24
    : 24;

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <LibraryHeader
        trayOpen={trayOpen}
        importing={importing}
        filter={filter}
        tab={tab}
        onToggleTray={toggleTray}
        onImport={() => void importSongs()}
        onSelectFilter={selectFilter}
      />
      {showSearch ? <SearchBar value={query} onChange={setQuery} /> : null}
      {playerError ? (
        <Text style={styles.errorBanner}>{`Player unavailable: ${playerError}`}</Text>
      ) : null}
      {inPlaylistsTab ? (
        <FlatList
          key="playlists"
          data={playlists}
          keyExtractor={playlistKeyExtractor}
          renderItem={renderPlaylist}
          ListHeaderComponent={playlistsHeader}
          ListEmptyComponent={playlistsEmpty}
          contentContainerStyle={{ paddingBottom: listBottomPadding }}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <View ref={dnd.boxRef} collapsable={false} style={styles.flex}>
          <FlatList
            key="tracks"
            ref={dnd.listRef}
            data={visibleTracks}
            {...dnd.listProps}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={emptyState}
            contentContainerStyle={{ paddingBottom: listBottomPadding }}
            initialNumToRender={14}
            windowSize={9}
            keyboardShouldPersistTaps="handled"
          />
        </View>
      )}
      <TabBar tab={tab} onSelect={selectTab} />
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
        onOpenQueue={openQueue}
        overlayOpen={optionsId !== null || queueOpen}
        optionsOverlay={
          <>
            {renderOptions(nowPlayingOpen && optionsId !== null, false)}
            {nowPlayingOpen && queueOpen ? <QueueSheet onClose={closeQueue} /> : null}
            {nowPlayingOpen && toast ? (
              <Toast key={toast.id} text={toast.text} bottom={insets.bottom + 96} onDone={clearToast} />
            ) : null}
          </>
        }
      />
      {renderOptions(!nowPlayingOpen && optionsId !== null, true)}
      {sortSheet === 'library' ? (
        <SortSheet
          title="Sort songs by"
          options={LIBRARY_SORTS}
          value={librarySort}
          onSelect={selectLibrarySort}
          onClose={closeSortSheet}
        />
      ) : null}
      {sortSheet === 'playlist' && openPlaylist ? (
        <SortSheet
          title="Sort playlist by"
          options={PLAYLIST_SORTS}
          value={openPlaylist.sort}
          onSelect={(key) => setPlaylistSort(openPlaylist.id, key)}
          onClose={closeSortSheet}
        />
      ) : null}
      {!nowPlayingOpen && toast ? (
        <Toast
          key={toast.id}
          text={toast.text}
          bottom={
            insets.bottom +
            TAB_BAR_HEIGHT +
            (currentTrack ? MINI_PLAYER_BOTTOM_OFFSET + MINI_PLAYER_HEIGHT + 12 : 24)
          }
          onDone={clearToast}
        />
      ) : null}
      <PlaylistSheetHost
        state={playlistSheet}
        tracks={tracks}
        playlists={playlists}
        onClose={closePlaylistSheet}
        onCreate={submitNewPlaylist}
        onRename={renamePlaylist}
        onSetMembers={setPlaylistMembers}
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
  optionLabel: { color: PALETTE.text, fontSize: 16, fontWeight: '500', flexShrink: 1 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    marginHorizontal: 16,
    marginBottom: 4,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#2A2A2A',
  },
  searchInput: { flex: 1, color: PALETTE.text, fontSize: 15, paddingVertical: 0 },
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
  npFooter: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 8 },

  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  sortRowText: { color: PALETTE.text, fontSize: 14, fontWeight: '700' },
  sortOptionText: { flex: 1 },
  reorderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 16,
    paddingRight: 4,
    height: ROW_HEIGHT,
  },
  smallIcon: { width: 34, height: 34 },
  dragHandle: { width: 44, height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  dragCell: { zIndex: 10 },
  reorderRowDragging: { backgroundColor: '#2A2A2A' },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#000000',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2A2A2A',
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabLabel: { color: PALETTE.textSecondary, fontSize: 11, fontWeight: '700' },
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  toast: {
    backgroundColor: '#2A2A2A',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  toastText: { color: PALETTE.text, fontSize: 14, fontWeight: '700' },
  queueHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  queueNow: { paddingHorizontal: 16, paddingBottom: 8 },
  queueNowRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  queueLabel: {
    color: PALETTE.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  queueNextLabel: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },

  rowSubtitleTop: { marginTop: 2 },
  sheetTitle: { color: PALETTE.text, fontSize: 18, fontWeight: '800' },
  sheetTitleSolo: { paddingHorizontal: 16, paddingBottom: 4 },
  menuScroll: { maxHeight: 460 },
  sheetHeader: { paddingHorizontal: 16, paddingBottom: 12, gap: 2 },
  sheetHint: {
    color: PALETTE.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sheetList: { maxHeight: 260 },
  sheetListTall: { maxHeight: 380 },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#7A7A7A',
    alignItems: 'center',
    justifyContent: 'center',
  },

  plHeader: { paddingHorizontal: 16, paddingBottom: 12 },
  plTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: -8,
  },
  plTitle: { color: PALETTE.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginTop: 4 },
  plMeta: { color: PALETTE.textSecondary, fontSize: 14, marginTop: 4 },
  plCoverWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 12 },
  plCoverShadow: {
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  plPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  plAddButton: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  plAddText: { color: PALETTE.text, fontSize: 14, fontWeight: '700' },
  plPlayGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  plPlayButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plPlayDisabled: { opacity: 0.4 },

  playlistsTop: { paddingTop: 4 },
  newPlaylistArt: {
    width: 48,
    height: 48,
    borderRadius: 4,
    backgroundColor: PALETTE.subCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  likedArt: {
    width: 48,
    height: 48,
    borderRadius: 4,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
