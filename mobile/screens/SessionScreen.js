import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSocketClient } from '../hooks/useSocketClient';

/**
 * SessionScreen — receives and displays streaming answers from the desktop host.
 *
 * Answer chunks arrive as deltas via Socket.io and are appended incrementally.
 * Transcript updates from the desktop microphone are shown at the top.
 */
export default function SessionScreen({ sessionCode, serverUrl, onDisconnect }) {
  const [answer, setAnswer] = useState('');
  const [transcript, setTranscript] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Connecting…');
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const scrollViewRef = useRef(null);
  const copyTimeoutRef = useRef(null);

  const handleSessionJoined = useCallback(() => {
    setStatusMessage('Connected — waiting for interview…');
    setError(null);
  }, []);

  const handleSessionError = useCallback((message) => {
    setError(message);
    setStatusMessage('Connection failed');
  }, []);

  const handleAnswerChunk = useCallback((chunk, isDone) => {
    if (isDone) {
      setIsGenerating(false);
    } else if (chunk) {
      setIsGenerating(true);
      setAnswer((prev) => prev + chunk);
      // Auto-scroll to end as answer streams in
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }
  }, []);

  const handleTranscriptUpdate = useCallback((text) => {
    setTranscript(text);
  }, []);

  const handleHostDisconnected = useCallback(() => {
    setIsGenerating(false);
    setError('Desktop host has disconnected');
    setStatusMessage('Host disconnected');
  }, []);

  const { isConnected, sessionStatus } = useSocketClient({
    serverUrl,
    sessionCode,
    onSessionJoined: handleSessionJoined,
    onSessionError: handleSessionError,
    onAnswerChunk: handleAnswerChunk,
    onTranscriptUpdate: handleTranscriptUpdate,
    onHostDisconnected: handleHostDisconnected,
  });

  const copyAnswer = async () => {
    if (!answer) return;
    await Clipboard.setStringAsync(answer);
    setCopied(true);
    clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const clearAll = () => {
    setAnswer('');
    setTranscript('');
    setIsGenerating(false);
    clearTimeout(copyTimeoutRef.current);
    setCopied(false);
  };

  // Clear the copy-confirmation timeout when the component unmounts to avoid
  // triggering a state update on an already-unmounted component.
  useEffect(() => {
    return () => clearTimeout(copyTimeoutRef.current);
  }, []);

  const confirmDisconnect = () => {
    Alert.alert(
      'Disconnect',
      'Are you sure you want to disconnect from this session?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: onDisconnect },
      ]
    );
  };

  const statusDotStyle =
    sessionStatus === 'error'
      ? styles.dotError
      : sessionStatus === 'joined' && isConnected
      ? styles.dotConnected
      : styles.dotWaiting;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={confirmDisconnect}
          style={styles.backButton}
          testID="disconnect-button"
        >
          <Text style={styles.backText}>← End</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={[styles.dot, statusDotStyle]} />
          <Text style={styles.sessionCodeText}>{sessionCode}</Text>
        </View>
        <TouchableOpacity onPress={clearAll} style={styles.clearHeaderBtn}>
          <Text style={styles.clearHeaderText}>Clear</Text>
        </TouchableOpacity>
      </View>

      {/* Status bar */}
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          {isConnected ? statusMessage : '🔴 Reconnecting…'}
        </Text>
      </View>

      {/* Error box */}
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
        </View>
      )}

      {/* Scrollable content */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Transcript */}
        {transcript ? (
          <View style={styles.transcriptBox}>
            <Text style={styles.boxLabel}>🎤 Transcript</Text>
            <Text style={styles.transcriptText}>{transcript}</Text>
          </View>
        ) : null}

        {/* Answer */}
        {(answer || isGenerating) ? (
          <View style={styles.answerBox}>
            <View style={styles.answerLabelRow}>
              <Text style={styles.boxLabel}>💡 Answer</Text>
              {isGenerating && (
                <Text style={styles.generatingBadge}>generating…</Text>
              )}
              {answer && !isGenerating && (
                <TouchableOpacity
                  onPress={copyAnswer}
                  style={[styles.copyButton, copied && styles.copyButtonDone]}
                  testID="copy-button"
                >
                  <Text style={[styles.copyText, copied && styles.copyTextDone]}>
                    {copied ? '✓ Copied' : 'Copy'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.answerText}>
              {answer}{isGenerating ? '▌' : ''}
            </Text>
          </View>
        ) : null}

        {/* Waiting placeholder */}
        {!answer && !isGenerating && sessionStatus === 'joined' && (
          <View style={styles.waitingBox}>
            <Text style={styles.waitingIcon}>👂</Text>
            <Text style={styles.waitingText}>Waiting for a question…</Text>
            <Text style={styles.waitingSubtext}>
              Answers will stream here automatically when the interviewer speaks.
            </Text>
          </View>
        )}

        {/* Connecting placeholder */}
        {sessionStatus === 'connecting' && (
          <View style={styles.waitingBox}>
            <Text style={styles.waitingIcon}>🔗</Text>
            <Text style={styles.waitingText}>Connecting to session…</Text>
            <Text style={styles.waitingSubtext}>
              Make sure the desktop app is open and running Undetectable Mode.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1117',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#1a1d2e',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2d3e',
  },
  backButton: {
    paddingVertical: 4,
    paddingRight: 8,
    minWidth: 60,
  },
  backText: {
    color: '#7986cb',
    fontSize: 15,
    fontWeight: '500',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotConnected: {
    backgroundColor: '#66bb6a',
  },
  dotWaiting: {
    backgroundColor: '#ffa726',
  },
  dotError: {
    backgroundColor: '#ef5350',
  },
  sessionCodeText: {
    color: '#e8eaf6',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  clearHeaderBtn: {
    paddingVertical: 4,
    paddingLeft: 8,
    minWidth: 60,
    alignItems: 'flex-end',
  },
  clearHeaderText: {
    color: '#555d7a',
    fontSize: 14,
  },
  statusBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#12141f',
    borderBottomWidth: 1,
    borderBottomColor: '#1e2132',
  },
  statusText: {
    color: '#9ea3b8',
    fontSize: 13,
    textAlign: 'center',
  },
  errorBox: {
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: '#2a1a1a',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#5c2323',
  },
  errorText: {
    color: '#ef9a9a',
    fontSize: 13,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  transcriptBox: {
    backgroundColor: '#1a1d2e',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2d3e',
  },
  boxLabel: {
    fontSize: 12,
    color: '#7986cb',
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  transcriptText: {
    color: '#9ea3b8',
    fontSize: 14,
    lineHeight: 20,
  },
  answerBox: {
    backgroundColor: '#1a1d2e',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#3d4263',
  },
  answerLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  generatingBadge: {
    fontSize: 11,
    color: '#ffa726',
    fontStyle: 'italic',
  },
  copyButton: {
    marginLeft: 'auto',
    backgroundColor: '#2a2d3e',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 4,
  },
  copyButtonDone: {
    backgroundColor: '#1b3a2a',
  },
  copyText: {
    color: '#7986cb',
    fontSize: 12,
    fontWeight: '500',
  },
  copyTextDone: {
    color: '#66bb6a',
  },
  answerText: {
    color: '#e8eaf6',
    fontSize: 15,
    lineHeight: 23,
  },
  waitingBox: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  waitingIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  waitingText: {
    color: '#9ea3b8',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  waitingSubtext: {
    color: '#555d7a',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
