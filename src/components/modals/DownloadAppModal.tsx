/**
 * DownloadAppModal — Shown on web when user tries to start navigation.
 * Prompts them to download the native app.
 * Tracks download progress and prompts user to install once complete.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

const APK_URL = 'https://github.com/Jrtowers-prog/PlymHack2026New/releases/download/latest/SafeNightHome.apk';

type DownloadState = 'idle' | 'downloading' | 'done' | 'error';

/** Download APK as blob, save it, and prompt install */
const downloadAndPromptInstall = async (
  setStatus: (s: DownloadState) => void,
  setProgress: (p: number) => void,
) => {
  if (Platform.OS !== 'web') return;

  setStatus('downloading');
  setProgress(0);

  try {
    const response = await fetch(APK_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    const reader = response.body?.getReader();
    const chunks: BlobPart[] = [];
    let received = 0;

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total > 0) setProgress(Math.round((received / total) * 100));
      }
    }

    const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
    const blobUrl = URL.createObjectURL(blob);

    // Trigger browser download with correct MIME type
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'SafeNightHome.apk';
    a.type = 'application/vnd.android.package-archive';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Cleanup after a delay
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

    setStatus('done');
  } catch {
    setStatus('error');
  }
};

interface DownloadAppModalProps {
  visible: boolean;
  onClose: () => void;
}

export function DownloadAppModal({ visible, onClose }: DownloadAppModalProps) {
  const [status, setStatus] = useState<DownloadState>('idle');
  const [progress, setProgress] = useState(0);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Ionicons name="phone-portrait-outline" size={48} color="#1570EF" />
        <Text style={styles.title}>Navigation is app-only</Text>
        <Text style={styles.body}>
          Turn-by-turn navigation with 3D maps is available exclusively in our mobile app.
          Download it to navigate safely.
        </Text>

        {/* Apple — iOS build not yet available */}
        <View style={styles.storeButtonDisabled}>
          <Ionicons name="logo-apple" size={24} color="#98A2B3" />
          <View style={styles.storeTextCol}>
            <Text style={styles.storeLabelDisabled}>iOS — Coming Soon</Text>
            <Text style={styles.storeSubtextDisabled}>Not yet available</Text>
          </View>
        </View>

        {/* Android — download + install flow */}
        {status === 'idle' && (
          <Pressable
            style={styles.storeButtonActive}
            onPress={() => downloadAndPromptInstall(setStatus, setProgress)}
            accessibilityRole="link"
          >
            <Ionicons name="logo-google-playstore" size={24} color="#fff" />
            <View style={styles.storeTextCol}>
              <Text style={styles.storeLabel}>Download for Android</Text>
              <Text style={styles.storeSubtext}>APK · Always latest version</Text>
            </View>
            <Ionicons name="download-outline" size={20} color="#fff" />
          </Pressable>
        )}

        {status === 'downloading' && (
          <View style={styles.storeButtonDownloading}>
            <ActivityIndicator color="#fff" size="small" />
            <View style={styles.storeTextCol}>
              <Text style={styles.storeLabel}>Downloading{progress > 0 ? ` ${progress}%` : '...'}</Text>
              <Text style={styles.storeSubtext}>Please wait</Text>
            </View>
          </View>
        )}

        {status === 'done' && (
          <View style={styles.storeButtonDone}>
            <Ionicons name="checkmark-circle" size={24} color="#fff" />
            <View style={styles.storeTextCol}>
              <Text style={styles.storeLabel}>Download Complete!</Text>
              <Text style={styles.storeSubtext}>Tap the notification or open your Downloads to install</Text>
            </View>
          </View>
        )}

        {status === 'error' && (
          <Pressable
            style={styles.storeButtonError}
            onPress={() => downloadAndPromptInstall(setStatus, setProgress)}
          >
            <Ionicons name="alert-circle" size={24} color="#fff" />
            <View style={styles.storeTextCol}>
              <Text style={styles.storeLabel}>Download failed</Text>
              <Text style={styles.storeSubtext}>Tap to retry</Text>
            </View>
          </Pressable>
        )}

        <Pressable style={styles.closeButton} onPress={onClose} accessibilityRole="button">
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    elevation: 100,
  },
  card: {
    width: 320,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#101828',
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    color: '#475467',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 4,
  },
  storeButtonActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    backgroundColor: '#1570EF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  storeButtonDownloading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    backgroundColor: '#2E90FA',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  storeButtonDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    backgroundColor: '#12B76A',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  storeButtonError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    backgroundColor: '#F04438',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  storeTextCol: {
    flex: 1,
  },
  storeLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  storeSubtext: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    marginTop: 1,
  },
  storeButtonDisabled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    backgroundColor: '#F2F4F7',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  storeLabelDisabled: {
    fontSize: 15,
    fontWeight: '700',
    color: '#98A2B3',
  },
  storeSubtextDisabled: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D0D5DD',
    marginTop: 1,
  },
  closeButton: {
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 10,
    backgroundColor: '#f2f4f7',
  },
  closeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475467',
  },
});
