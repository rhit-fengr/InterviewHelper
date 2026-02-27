import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY_SERVER_URL = '@interview_hammer_server_url';
const DEFAULT_SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:4000';

/**
 * ConnectScreen — entry point of the mobile companion app.
 *
 * The user enters the backend server URL and the session code shown on the
 * desktop app's Undetectable Mode screen, then taps Connect.
 */
export default function ConnectScreen({ onConnect }) {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [sessionCode, setSessionCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Restore the last-used server URL from persistent storage
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY_SERVER_URL)
      .then((saved) => { if (saved) setServerUrl(saved); })
      .catch(() => {/* ignore */});
  }, []);

  const handleConnect = () => {
    const trimmedCode = sessionCode.trim().toUpperCase();
    const trimmedUrl = serverUrl.trim().replace(/\/$/, '');

    if (!trimmedUrl) {
      setError('Please enter the server URL.');
      return;
    }
    if (!trimmedCode) {
      setError('Please enter the session code.');
      return;
    }

    setError(null);
    setIsLoading(true);

    // Persist server URL for next time
    AsyncStorage.setItem(STORAGE_KEY_SERVER_URL, trimmedUrl).catch(() => {});

    onConnect(trimmedCode, trimmedUrl);
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>⚡</Text>
          <Text style={styles.title}>Interview Hammer</Text>
          <Text style={styles.subtitle}>Mobile Companion</Text>
        </View>

        {/* Form */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connect to Session</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://192.168.1.x:4000"
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              testID="server-url-input"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Session Code</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={sessionCode}
              onChangeText={(t) => setSessionCode(t.toUpperCase())}
              placeholder="IRON-7842"
              placeholderTextColor="#555"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
              testID="session-code-input"
            />
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.connectBtn, isLoading && styles.connectBtnDisabled]}
            onPress={handleConnect}
            disabled={isLoading}
            testID="connect-button"
          >
            <Text style={styles.connectBtnText}>
              {isLoading ? 'Connecting…' : 'Connect →'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Instructions */}
        <View style={styles.instructionsBox}>
          <Text style={styles.instructionsTitle}>How to connect</Text>
          <Text style={styles.instructionStep}>1. Open Interview Hammer on your desktop</Text>
          <Text style={styles.instructionStep}>2. Navigate to Undetectable Mode</Text>
          <Text style={styles.instructionStep}>3. Note the session code shown on screen</Text>
          <Text style={styles.instructionStep}>4. Enter the code above and tap Connect</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#0f1117',
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#e8eaf6',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#7986cb',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#1a1d2e',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#2a2d3e',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#e8eaf6',
    marginBottom: 18,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    color: '#9ea3b8',
    marginBottom: 6,
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#0f1117',
    borderWidth: 1,
    borderColor: '#2a2d3e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e8eaf6',
    fontSize: 15,
  },
  codeInput: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
    color: '#7986cb',
  },
  errorBox: {
    backgroundColor: '#2a1a1a',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#5c2323',
  },
  errorText: {
    color: '#ef9a9a',
    fontSize: 13,
  },
  connectBtn: {
    backgroundColor: '#5c6bc0',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  connectBtnDisabled: {
    opacity: 0.6,
  },
  connectBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  instructionsBox: {
    backgroundColor: '#1a1d2e',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2d3e',
  },
  instructionsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ea3b8',
    marginBottom: 10,
  },
  instructionStep: {
    fontSize: 13,
    color: '#6d7280',
    marginBottom: 6,
    lineHeight: 18,
  },
});
