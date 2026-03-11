import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getTranscriptTail,
  normalizeRecognitionLanguages,
  sanitizeTranscriptSegment,
  speakerFromSourceMode,
} from '../utils/interviewTranscript';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:4000';
const DEFAULT_CHUNK_MS = 1500;
const DEFAULT_SYSTEM_CHUNK_MS = 1800;
const LOCAL_CHUNK_MS = 2000;
const LOCAL_SYSTEM_CHUNK_MS = 2600;
const GEMINI_CHUNK_MS = 2400;
const WINDOWS_CAPTIONS_POLL_MS = 1200;
const MIN_CHUNK_BYTES = 1024;
const MAX_TRANSCRIPT_LINES = 120;
const MAX_TRANSCRIPT_CHARS = 6000;
const TRANSCRIBE_ERROR_PREFIX = 'Transcription error:';
const SOURCE_MODES = ['mic', 'system'];
const CROSS_SOURCE_DEDUPE_WINDOW_MS = 12_000;
const MIN_CROSS_SOURCE_DEDUPE_CHARS = 8;
const MAX_RECENT_SEGMENTS_PER_SOURCE = 24;

function pickRecorderMimeType(provider = 'openai') {
  if (typeof MediaRecorder === 'undefined') return '';
  const normalizedProvider = String(provider || '').toLowerCase();
  const preferOgg = normalizedProvider === 'gemini' || normalizedProvider === 'local';
  const candidates = preferOgg
    ? [
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
    ]
    : [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/ogg',
    ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function inferExtensionFromMimeType(mimeType = '') {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4')) return 'mp4';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('wav')) return 'wav';
  return 'webm';
}

function appendTranscriptSegment(previous, segment) {
  const incoming = String(segment || '').trim();
  if (!incoming) return String(previous || '');

  const lines = String(previous || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  lines.push(incoming);
  const merged = lines.slice(-MAX_TRANSCRIPT_LINES).join('\n');
  return getTranscriptTail(merged, MAX_TRANSCRIPT_CHARS);
}

function normalizeEffectiveProvider(provider = 'auto', fallbackProvider = 'openai') {
  const value = String(provider || '').trim().toLowerCase();
  if (value === 'auto') return String(fallbackProvider || 'openai').trim().toLowerCase();
  return value || 'openai';
}

function getChunkDurationMs(provider = 'openai', sourceMode = 'mic') {
  const normalized = normalizeEffectiveProvider(provider);
  const source = String(sourceMode || '').trim().toLowerCase();
  const isSystem = source === 'system';
  if (normalized === 'gemini') return isSystem ? Math.max(GEMINI_CHUNK_MS, 3000) : GEMINI_CHUNK_MS;
  if (normalized === 'local') return isSystem ? LOCAL_SYSTEM_CHUNK_MS : LOCAL_CHUNK_MS;
  return isSystem ? DEFAULT_SYSTEM_CHUNK_MS : DEFAULT_CHUNK_MS;
}

function normalizeCompareText(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, '');
}

function isSemanticallySimilarSegment(left = '', right = '') {
  const a = normalizeCompareText(left);
  const b = normalizeCompareText(right);
  if (!a || !b) return false;
  if (a === b) return true;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < MIN_CROSS_SOURCE_DEDUPE_CHARS) return false;
  if (!longer.includes(shorter)) return false;
  return shorter.length / longer.length >= 0.72;
}

function pickLanguageHint(sourceMode, languages = [], fallbackLanguage = '') {
  if (!fallbackLanguage) return '';
  // For mixed language mode, keep system on auto-detect.
  if (Array.isArray(languages) && languages.length > 1 && String(sourceMode || '').toLowerCase() === 'system') return '';
  return fallbackLanguage;
}

export function useDualAudioTranscript({
  enabled = false,
  language = 'en-US',
  provider = 'openai',
  transcribeProvider = 'auto',
  captureMic = true,
  captureSystem = true,
  onTranscriptChange,
  onFinalSegment,
} = {}) {
  const languageKey = Array.isArray(language)
    ? language.map((item) => String(item || '').trim()).join('|')
    : String(language || '').trim();
  const languages = useMemo(() => normalizeRecognitionLanguages(language), [languageKey]);
  const primaryLanguage = languages[0];

  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState(null);
  const [activeLanguage, setActiveLanguage] = useState(primaryLanguage);

  const recordersRef = useRef({ mic: null, system: null });
  const micStreamRef = useRef(null);
  const systemStreamRef = useRef(null);
  const transcriptRef = useRef('');
  const lastSegmentsBySourceRef = useRef({ mic: '', system: '' });
  const onChangeRef = useRef(onTranscriptChange);
  const onFinalSegmentRef = useRef(onFinalSegment);
  const enabledRef = useRef(enabled);
  const transcribeInFlightRef = useRef(false);
  const pendingChunkBySourceRef = useRef({ mic: null, system: null });
  const pendingUpdatedAtBySourceRef = useRef({ mic: 0, system: 0 });
  const localWhisperLeaseRef = useRef(false);
  const recorderMimeTypeRef = useRef('audio/webm');
  const serviceFailureCountRef = useRef(0);
  const recentSegmentsBySourceRef = useRef({ mic: [], system: [] });
  const windowsCaptionsPollTimerRef = useRef(null);
  const requestDataTimersRef = useRef({ mic: null, system: null });

  useEffect(() => {
    onChangeRef.current = onTranscriptChange;
  }, [onTranscriptChange]);

  useEffect(() => {
    onFinalSegmentRef.current = onFinalSegment;
  }, [onFinalSegment]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    setActiveLanguage(primaryLanguage);
  }, [primaryLanguage]);

  const updateListeningState = useCallback(() => {
    const hasActiveRecorder = SOURCE_MODES.some((sourceMode) => {
      const recorder = recordersRef.current[sourceMode];
      return Boolean(recorder && recorder.state === 'recording');
    });
    setIsListening(hasActiveRecorder);
  }, []);

  const stopCapture = useCallback(() => {
    if (windowsCaptionsPollTimerRef.current) {
      clearInterval(windowsCaptionsPollTimerRef.current);
      windowsCaptionsPollTimerRef.current = null;
    }

    SOURCE_MODES.forEach((sourceMode) => {
      const requestDataTimer = requestDataTimersRef.current[sourceMode];
      if (requestDataTimer) {
        clearInterval(requestDataTimer);
        requestDataTimersRef.current[sourceMode] = null;
      }

      const recorder = recordersRef.current[sourceMode];
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // ignore stop errors
        }
      }
      recordersRef.current[sourceMode] = null;
    });

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach((track) => track.stop());
      systemStreamRef.current = null;
    }

    if (localWhisperLeaseRef.current && window?.electronAPI?.releaseLocalWhisper) {
      localWhisperLeaseRef.current = false;
      window.electronAPI.releaseLocalWhisper().catch(() => {
        // Ignore release errors; service will still be cleaned up on app quit.
      });
    }

    transcribeInFlightRef.current = false;
    pendingChunkBySourceRef.current = { mic: null, system: null };
    pendingUpdatedAtBySourceRef.current = { mic: 0, system: 0 };
    recentSegmentsBySourceRef.current = { mic: [], system: [] };

    setIsListening(false);
  }, []);

  const transcribeChunk = useCallback(async (chunkBlob, sourceMode) => {
    const normalizedSourceMode = String(sourceMode || '').trim().toLowerCase() || 'unknown';
    const mimeType = chunkBlob?.type || recorderMimeTypeRef.current || 'audio/webm';
    const languageHint = pickLanguageHint(normalizedSourceMode, languages, primaryLanguage);
    const form = new FormData();
    form.append('audio', chunkBlob, `chunk-${Date.now()}.${inferExtensionFromMimeType(mimeType)}`);
    form.append('provider', provider);
    form.append('transcribeProvider', transcribeProvider || 'auto');
    if (languageHint) {
      form.append('language', languageHint);
    }
    form.append('sourceMode', normalizedSourceMode);

    try {
      const response = await fetch(`${SERVER_URL}/api/ai/transcribe-chunk`, {
        method: 'POST',
        body: form,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(body?.error || 'Transcription rate limit reached.');
        }
        throw new Error(body?.error || `${response.status}`);
      }
      if (!enabledRef.current) return;

      const sourceFromServer = String(body?.sourceMode || normalizedSourceMode || 'unknown')
        .trim()
        .toLowerCase();
      const cleanedSegment = sanitizeTranscriptSegment(String(body?.text || ''));
      if (!cleanedSegment) return;
      if (cleanedSegment === lastSegmentsBySourceRef.current[sourceFromServer]) return;

      if (sourceFromServer === 'mic') {
        const now = Date.now();
        const recentSystem = recentSegmentsBySourceRef.current.system || [];
        const hasSystemDuplicate = recentSystem.some((entry) => (
          now - entry.at <= CROSS_SOURCE_DEDUPE_WINDOW_MS
          && isSemanticallySimilarSegment(cleanedSegment, entry.text)
        ));
        if (hasSystemDuplicate) {
          return;
        }
      }

      lastSegmentsBySourceRef.current[sourceFromServer] = cleanedSegment;
      if (SOURCE_MODES.includes(sourceFromServer)) {
        const sourceRecent = recentSegmentsBySourceRef.current[sourceFromServer] || [];
        sourceRecent.push({ text: cleanedSegment, at: Date.now() });
        recentSegmentsBySourceRef.current[sourceFromServer] = sourceRecent.slice(-MAX_RECENT_SEGMENTS_PER_SOURCE);
      }
      serviceFailureCountRef.current = 0;

      const nextTranscript = appendTranscriptSegment(transcriptRef.current, cleanedSegment);
      transcriptRef.current = nextTranscript;
      setTranscript(nextTranscript);
      onChangeRef.current?.(nextTranscript);
      onFinalSegmentRef.current?.({
        text: cleanedSegment,
        language: primaryLanguage,
        timestamp: Date.now(),
        sourceMode: sourceFromServer,
        speaker: speakerFromSourceMode(sourceFromServer),
      });
      setError(null);
    } catch (err) {
      const message = err?.message || 'Transcription request failed.';
      const lower = String(message).toLowerCase();
      const selectedProvider = String(transcribeProvider || '').toLowerCase();
      const isLocalOnlyMode = selectedProvider === 'local';
      if (isLocalOnlyMode && lower.includes('cannot reach local transcription service')) {
        serviceFailureCountRef.current += 1;
        if (serviceFailureCountRef.current >= 3) {
          setError('Local transcription service is unavailable. In browser mode, run local-whisper-service/start_local_whisper.bat manually.');
          stopCapture();
          return;
        }
      }
      if (/rate limit/i.test(String(message))) {
        setError('Rate limit reached while transcribing audio. Wait a moment and try again.');
      } else if (/failed to fetch/i.test(String(message))) {
        setError(`Cannot reach transcription service at ${SERVER_URL}. Ensure server is running.`);
      } else {
        setError(`${TRANSCRIBE_ERROR_PREFIX} ${message}`);
      }
    }
  }, [languages, primaryLanguage, provider, transcribeProvider, stopCapture]);

  const pickNextSourceToTranscribe = useCallback(() => {
    const pending = pendingChunkBySourceRef.current;
    const hasMic = Boolean(pending.mic);
    const hasSystem = Boolean(pending.system);
    if (!hasMic && !hasSystem) return null;
    if (hasMic && !hasSystem) return 'mic';
    if (!hasMic && hasSystem) return 'system';

    const micUpdatedAt = pendingUpdatedAtBySourceRef.current.mic || 0;
    const systemUpdatedAt = pendingUpdatedAtBySourceRef.current.system || 0;
    return micUpdatedAt <= systemUpdatedAt ? 'mic' : 'system';
  }, []);

  const drainPendingChunks = useCallback(() => {
    if (!enabledRef.current || transcribeInFlightRef.current) return;

    const source = pickNextSourceToTranscribe();
    if (!source) return;

    const nextChunk = pendingChunkBySourceRef.current[source];
    pendingChunkBySourceRef.current[source] = null;
    pendingUpdatedAtBySourceRef.current[source] = 0;
    if (!nextChunk) return;

    transcribeInFlightRef.current = true;
    transcribeChunk(nextChunk, source)
      .catch(() => {
        // Errors are surfaced in transcribeChunk.
      })
      .finally(() => {
        transcribeInFlightRef.current = false;
        if (enabledRef.current) {
          drainPendingChunks();
        }
      });
  }, [pickNextSourceToTranscribe, transcribeChunk]);

  const enqueueChunk = useCallback((chunkBlob, sourceMode) => {
    if (!enabledRef.current) return;
    const source = String(sourceMode || '').trim().toLowerCase();
    if (!SOURCE_MODES.includes(source)) return;

    // Keep only the latest chunk per source to cap latency/memory.
    pendingChunkBySourceRef.current[source] = chunkBlob;
    pendingUpdatedAtBySourceRef.current[source] = Date.now();
    drainPendingChunks();
  }, [drainPendingChunks]);

  useEffect(() => {
    if (!enabled) {
      stopCapture();
      return undefined;
    }

    let cancelled = false;
    const start = async () => {
      let startupMicStream = null;
      let startupSystemStream = null;
      try {
        setError(null);

        const normalizedTranscribeProvider = String(transcribeProvider || 'auto').trim().toLowerCase();
        const useWindowsLiveCaptionsPoller = (
          normalizedTranscribeProvider === 'windows-live-captions'
          && captureSystem
        );
        const shouldEnsureLocalService = normalizedTranscribeProvider === 'local';

        if (shouldEnsureLocalService && window?.electronAPI?.ensureLocalWhisper) {
          const localResult = await window.electronAPI.ensureLocalWhisper();
          if (localResult?.ok) {
            localWhisperLeaseRef.current = true;
          } else if (normalizedTranscribeProvider === 'local') {
            throw new Error(localResult?.message || 'Failed to start local Whisper service.');
          }
        }

        if (captureMic && !navigator?.mediaDevices?.getUserMedia) {
          throw new Error('Browser does not support microphone capture API.');
        }
        if (captureSystem && !useWindowsLiveCaptionsPoller && !navigator?.mediaDevices?.getDisplayMedia) {
          throw new Error('Browser does not support screen audio capture API.');
        }
        if (typeof MediaRecorder === 'undefined') {
          throw new Error('MediaRecorder is not supported in this environment.');
        }

        let micStream = null;
        let systemStream = null;
        let systemAudioTracks = [];

        if (captureMic) {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // Suppress desktop playback leakage into the mic channel in dual-source mode.
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          startupMicStream = micStream;
        }

        if (captureSystem && !useWindowsLiveCaptionsPoller) {
          systemStream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: true,
          });
          startupSystemStream = systemStream;

          systemAudioTracks = systemStream.getAudioTracks();
          if (systemAudioTracks.length === 0) {
            throw new Error('No system audio track was selected. Re-share with "Share audio" enabled.');
          }
          systemAudioTracks.forEach((track) => { track.enabled = true; });
        }

        if (!micStream && !systemStream && !useWindowsLiveCaptionsPoller) {
          throw new Error('No capture source enabled.');
        }

        if (cancelled || !enabledRef.current) {
          micStream?.getTracks().forEach((track) => track.stop());
          systemStream?.getTracks().forEach((track) => track.stop());
          return;
        }

        micStreamRef.current = micStream;
        systemStreamRef.current = systemStream;
        startupMicStream = null;
        startupSystemStream = null;
        transcribeInFlightRef.current = false;
        pendingChunkBySourceRef.current = { mic: null, system: null };
        pendingUpdatedAtBySourceRef.current = { mic: 0, system: 0 };
        lastSegmentsBySourceRef.current = { mic: '', system: '' };
        recentSegmentsBySourceRef.current = { mic: [], system: [] };

        const recorderProvider = normalizeEffectiveProvider(transcribeProvider, provider);
        const mimeType = pickRecorderMimeType(recorderProvider);

        const createRecorder = (sourceMode, sourceStream) => {
          if (!sourceStream?.getAudioTracks || sourceStream.getAudioTracks().length === 0) {
            return null;
          }

          const audioOnlyStream = new MediaStream(sourceStream.getAudioTracks());
          const recorder = mimeType
            ? new MediaRecorder(audioOnlyStream, { mimeType })
            : new MediaRecorder(audioOnlyStream);
          recorderMimeTypeRef.current = recorder.mimeType || mimeType || recorderMimeTypeRef.current;
          const chunkMs = getChunkDurationMs(recorderProvider, sourceMode);
          const normalizedSelectedTranscribeProvider = String(transcribeProvider || 'auto').trim().toLowerCase();
          const useRequestDataMode = (
            normalizedSelectedTranscribeProvider === 'local'
            || (normalizedSelectedTranscribeProvider === 'auto' && sourceMode === 'system')
          );

          recorder.ondataavailable = (event) => {
            if (!enabledRef.current) return;
            if (!event?.data || event.data.size <= 0) return;
            if (event.data.size < MIN_CHUNK_BYTES) return;
            enqueueChunk(event.data, sourceMode);
          };

          recorder.onerror = () => {
            setError(`Audio recorder (${sourceMode}) failed. Stop and start listening again.`);
          };

          recorder.onstart = () => {
            updateListeningState();
          };

          recorder.onstop = () => {
            const timer = requestDataTimersRef.current[sourceMode];
            if (timer) {
              clearInterval(timer);
              requestDataTimersRef.current[sourceMode] = null;
            }
            if (recordersRef.current[sourceMode] === recorder) {
              recordersRef.current[sourceMode] = null;
            }
            updateListeningState();
          };

          if (!enabledRef.current || cancelled) return null;
          if (recorder.state !== 'inactive') return recorder;

          try {
            if (useRequestDataMode) {
              recorder.start();
              requestDataTimersRef.current[sourceMode] = setInterval(() => {
                if (!enabledRef.current || recorder.state !== 'recording') return;
                try {
                  recorder.requestData();
                } catch {
                  // Ignore requestData race conditions during shutdown.
                }
              }, Math.max(900, chunkMs));
            } else {
              // Use timeslice mode to avoid stop/start gaps that can drop trailing words.
              recorder.start(Math.max(900, chunkMs));
            }
          } catch {
            setError(`Audio recorder failed to start for ${sourceMode}. Stop and start listening again.`);
            return null;
          }
          return recorder;
        };

        const micRecorder = captureMic ? createRecorder('mic', micStream) : null;
        let systemRecorder = null;
        if (captureSystem && useWindowsLiveCaptionsPoller) {
          const virtualRecorder = {
            state: 'recording',
            stop() {
              this.state = 'inactive';
            },
          };
          recordersRef.current.system = virtualRecorder;
          systemRecorder = virtualRecorder;

          const enqueuePoll = () => {
            if (!enabledRef.current || cancelled) return;
            enqueueChunk(new Blob(['windows-live-captions-poll'], { type: 'text/plain' }), 'system');
          };
          enqueuePoll();
          windowsCaptionsPollTimerRef.current = setInterval(enqueuePoll, WINDOWS_CAPTIONS_POLL_MS);
          updateListeningState();
        } else if (captureSystem) {
          systemRecorder = createRecorder('system', new MediaStream(systemAudioTracks));
        }
        if (!micRecorder && !systemRecorder) {
          throw new Error('No audio tracks available for recording.');
        }

        recordersRef.current.mic = micRecorder;
        if (!useWindowsLiveCaptionsPoller) {
          recordersRef.current.system = systemRecorder;
        }

        if (captureSystem && systemStream) {
          for (const track of systemStream.getVideoTracks()) {
            track.onended = () => {
              if (enabledRef.current) {
                setError('System audio share ended. Re-share screen audio to continue interviewer transcription.');
                const recorder = recordersRef.current.system;
                if (recorder && recorder.state !== 'inactive') {
                  try {
                    recorder.stop();
                  } catch {
                    // ignore stop errors
                  }
                }
                recordersRef.current.system = null;
                updateListeningState();
              }
            };
          }
        }
      } catch (err) {
        if (startupMicStream) {
          startupMicStream.getTracks().forEach((track) => track.stop());
        }
        if (startupSystemStream) {
          startupSystemStream.getTracks().forEach((track) => track.stop());
        }
        const message = err?.message || 'Failed to start dual audio capture.';
        setError(message);
        stopCapture();
      }
    };

    start();

    return () => {
      cancelled = true;
      stopCapture();
    };
  }, [enabled, primaryLanguage, provider, transcribeProvider, captureMic, captureSystem, stopCapture, transcribeChunk, enqueueChunk, updateListeningState]);

  const clearTranscript = () => {
    transcriptRef.current = '';
    lastSegmentsBySourceRef.current = { mic: '', system: '' };
    setTranscript('');
  };

  return {
    transcript,
    isListening,
    error,
    activeLanguage,
    clearTranscript,
  };
}
