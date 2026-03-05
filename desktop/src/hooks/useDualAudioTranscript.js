import { useCallback, useEffect, useRef, useState } from 'react';
import { getTranscriptTail, normalizeRecognitionLanguages } from '../utils/interviewTranscript';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:4000';
const CHUNK_MS = 2500;
const MAX_TRANSCRIPT_LINES = 120;
const MAX_TRANSCRIPT_CHARS = 6000;
const TRANSCRIBE_ERROR_PREFIX = 'Transcription error:';

function pickRecorderMimeType(provider = 'openai') {
  if (typeof MediaRecorder === 'undefined') return '';
  const normalizedProvider = String(provider || '').toLowerCase();
  const candidates = normalizedProvider === 'gemini'
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

export function useDualAudioTranscript({
  enabled = false,
  language = 'en-US',
  provider = 'openai',
  transcribeProvider = 'auto',
  onTranscriptChange,
  onFinalSegment,
} = {}) {
  const languages = normalizeRecognitionLanguages(language);
  const primaryLanguage = languages[0];

  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState(null);
  const [activeLanguage, setActiveLanguage] = useState(primaryLanguage);

  const recorderRef = useRef(null);
  const contextRef = useRef(null);
  const micStreamRef = useRef(null);
  const systemStreamRef = useRef(null);
  const transcriptRef = useRef('');
  const lastSegmentRef = useRef('');
  const onChangeRef = useRef(onTranscriptChange);
  const onFinalSegmentRef = useRef(onFinalSegment);
  const enabledRef = useRef(enabled);
  const uploadQueueRef = useRef(Promise.resolve());
  const localWhisperLeaseRef = useRef(false);

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

  const stopCapture = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore stop errors
      }
    }
    recorderRef.current = null;

    if (contextRef.current) {
      contextRef.current.close().catch(() => {});
      contextRef.current = null;
    }

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

    setIsListening(false);
  }, []);

  const transcribeChunk = useCallback(async (chunkBlob) => {
    const mimeType = chunkBlob?.type || 'audio/webm';
    const form = new FormData();
    form.append('audio', chunkBlob, `chunk-${Date.now()}.${inferExtensionFromMimeType(mimeType)}`);
    form.append('provider', provider);
    form.append('transcribeProvider', transcribeProvider || 'auto');
    form.append('language', primaryLanguage);
    form.append('sourceMode', 'mic-system');

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

      const segment = String(body?.text || '').trim();
      if (!segment) return;
      if (segment === lastSegmentRef.current) return;
      lastSegmentRef.current = segment;

      const nextTranscript = appendTranscriptSegment(transcriptRef.current, segment);
      transcriptRef.current = nextTranscript;
      setTranscript(nextTranscript);
      onChangeRef.current?.(nextTranscript);
      onFinalSegmentRef.current?.({
        text: segment,
        language: primaryLanguage,
        timestamp: Date.now(),
      });
      setError(null);
    } catch (err) {
      const message = err?.message || 'Transcription request failed.';
      if (/rate limit/i.test(String(message))) {
        setError('Rate limit reached while transcribing audio. Wait a moment and try again.');
      } else if (/failed to fetch/i.test(String(message))) {
        setError(`Cannot reach transcription service at ${SERVER_URL}. Ensure server is running.`);
      } else {
        setError(`${TRANSCRIBE_ERROR_PREFIX} ${message}`);
      }
    }
  }, [primaryLanguage, provider, transcribeProvider]);

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
        const shouldEnsureLocalService = (
          normalizedTranscribeProvider === 'local' ||
          normalizedTranscribeProvider === 'auto'
        );

        if (shouldEnsureLocalService && window?.electronAPI?.ensureLocalWhisper) {
          const localResult = await window.electronAPI.ensureLocalWhisper();
          if (localResult?.ok) {
            localWhisperLeaseRef.current = true;
          } else if (normalizedTranscribeProvider === 'local') {
            throw new Error(localResult?.message || 'Failed to start local Whisper service.');
          }
        }

        if (!navigator?.mediaDevices?.getUserMedia || !navigator?.mediaDevices?.getDisplayMedia) {
          throw new Error('Browser does not support required media capture APIs.');
        }
        if (typeof MediaRecorder === 'undefined') {
          throw new Error('MediaRecorder is not supported in this environment.');
        }

        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        startupMicStream = micStream;

        const systemStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        });
        startupSystemStream = systemStream;

        const systemAudioTracks = systemStream.getAudioTracks();
        if (systemAudioTracks.length === 0) {
          throw new Error('No system audio track was selected. Re-share with "Share audio" enabled.');
        }

        if (cancelled || !enabledRef.current) {
          micStream.getTracks().forEach((track) => track.stop());
          systemStream.getTracks().forEach((track) => track.stop());
          return;
        }

        micStreamRef.current = micStream;
        systemStreamRef.current = systemStream;
        startupMicStream = null;
        startupSystemStream = null;
        uploadQueueRef.current = Promise.resolve();

        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) {
          throw new Error('AudioContext is not supported in this environment.');
        }
        const context = new AudioContextCtor();
        contextRef.current = context;

        const destination = context.createMediaStreamDestination();
        const micSource = context.createMediaStreamSource(micStream);
        const systemSource = context.createMediaStreamSource(
          new MediaStream(systemAudioTracks)
        );
        micSource.connect(destination);
        systemSource.connect(destination);

        const mixedStream = destination.stream;
        const effectiveTranscribeProvider = String(transcribeProvider || provider || 'auto').toLowerCase();
        const mimeType = pickRecorderMimeType(
          effectiveTranscribeProvider === 'auto' ? provider : effectiveTranscribeProvider
        );
        const recorder = mimeType
          ? new MediaRecorder(mixedStream, { mimeType })
          : new MediaRecorder(mixedStream);

        recorder.ondataavailable = (event) => {
          if (!enabledRef.current) return;
          if (!event?.data || event.data.size <= 0) return;
          uploadQueueRef.current = uploadQueueRef.current
            .then(() => transcribeChunk(event.data))
            .catch(() => {
              // Queue errors are already surfaced in transcribeChunk.
            });
        };

        recorder.onerror = () => {
          setError('Audio recorder failed. Stop and start listening again.');
        };

        recorder.onstart = () => setIsListening(true);
        recorder.onstop = () => setIsListening(false);
        const chunkMs = effectiveTranscribeProvider === 'gemini' ? 6000 : CHUNK_MS;
        recorder.start(chunkMs);
        recorderRef.current = recorder;

        for (const track of systemStream.getVideoTracks()) {
          track.onended = () => {
            if (enabledRef.current) {
              setError('System audio share ended. Click Start Listening and share audio again.');
              stopCapture();
            }
          };
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
  }, [enabled, primaryLanguage, provider, transcribeProvider, stopCapture, transcribeChunk]);

  const clearTranscript = () => {
    transcriptRef.current = '';
    lastSegmentRef.current = '';
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
