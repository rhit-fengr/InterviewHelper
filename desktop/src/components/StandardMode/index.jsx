import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import { useDualAudioTranscript } from '../../hooks/useDualAudioTranscript';
import { useTranscript } from '../../hooks/useTranscript';
import { useAIAnswer } from '../../hooks/useAIAnswer';
import { LANGUAGES } from '../../constants';
import {
  buildManualQuestionFromEntries,
  buildSessionExportText,
  extractManualQuestionFromTranscript,
  getTranscriptTail,
  guessSpeakerLabel,
  sanitizeTranscriptSegment,
  speakerFromSourceMode,
} from '../../utils/interviewTranscript';
import { normalizeQuestionKey, shouldSkipAutoAnswer } from '../../utils/autoAnswer';
import './StandardMode.css';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:4000';
const MERGE_WINDOW_MS = 4_500;
const SHORT_FRAGMENT_MAX_CHARS = 10;
const DETECT_QUESTION_DEBOUNCE_MS = 650;
const MIC_ROTATION_INTERVAL_MS = 2_200;

function joinTranscriptText(previousText = '', currentText = '') {
  const left = String(previousText || '').trim();
  const right = String(currentText || '').trim();
  if (!left) return right;
  if (!right) return left;
  if (/[，。！？!?.,:]$/.test(left)) return `${left} ${right}`.trim();
  return `${left} ${right}`.trim();
}

function shouldMergeTranscriptEntries(previousEntry, nextEntry) {
  if (!previousEntry || !nextEntry) return false;
  if ((previousEntry.sourceMode || 'unknown') !== (nextEntry.sourceMode || 'unknown')) return false;
  if ((previousEntry.language || '') !== (nextEntry.language || '')) return false;
  if ((previousEntry.speaker || '') !== (nextEntry.speaker || '')) return false;

  const previousTs = Number(previousEntry.timestamp) || 0;
  const nextTs = Number(nextEntry.timestamp) || 0;
  if (!previousTs || !nextTs) return false;
  if (nextTs - previousTs > MERGE_WINDOW_MS) return false;

  const prevText = String(previousEntry.text || '').trim();
  const nextText = String(nextEntry.text || '').trim();
  if (!prevText || !nextText) return false;

  if (prevText.length <= SHORT_FRAGMENT_MAX_CHARS || nextText.length <= SHORT_FRAGMENT_MAX_CHARS) {
    return true;
  }

  return prevText.length + nextText.length <= 56;
}

export default function StandardMode({ onBack }) {
  const {
    setup,
    session,
    personalInfo,
    answerSettings,
    displaySettings,
    runtime,
    updateRuntime,
    resetRuntime,
  } = useInterviewStore();
  const [isRunning, setIsRunning] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [conversationHistory, setConversationHistory] = useState([]);
  const [lastQuestion, setLastQuestion] = useState('');
  const [transcriptEntries, setTranscriptEntries] = useState([]);
  const [historyView, setHistoryView] = useState('expanded');
  const [localError, setLocalError] = useState('');
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [windowsCaptionsWindowHidden, setWindowsCaptionsWindowHidden] = useState(
    setup.autoHideWindowsLiveCaptions === true
  );
  const [windowsCaptionsWindowBusy, setWindowsCaptionsWindowBusy] = useState(false);
  const [windowsCaptionsWindowError, setWindowsCaptionsWindowError] = useState('');
  const detectionTimeoutRef = useRef(null);
  const transcriptScrollRef = useRef(null);
  const lastDetectedAtRef = useRef(0);
  const lastAutoAnswerRef = useRef(null);
  const micLiveTranscriptRef = useRef('');
  const systemLiveTranscriptRef = useRef('');
  // Track the in-flight question so we can save user+assistant pair when generation completes
  const pendingQuestionRef = useRef(null);
  const prevIsLoadingRef = useRef(false);
  const isLoadingRef = useRef(false);

  // Keep latest values in refs so callbacks are stable and don't go stale
  const sessionRef = useRef(session);
  const answerSettingsRef = useRef(answerSettings);
  const personalInfoRef = useRef(personalInfo);
  const setupRef = useRef(setup);
  const conversationHistoryRef = useRef(conversationHistory);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { answerSettingsRef.current = answerSettings; }, [answerSettings]);
  useEffect(() => { personalInfoRef.current = personalInfo; }, [personalInfo]);
  useEffect(() => { setupRef.current = setup; }, [setup]);
  useEffect(() => { conversationHistoryRef.current = conversationHistory; }, [conversationHistory]);

  const {
    answer,
    isLoading,
    error: aiError,
    generateAnswer,
    generateAnswerFromScreenshot,
    cancelGeneration,
    clearAnswer,
  } = useAIAnswer();
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  const languageLabelByValue = useRef(
    Object.fromEntries(LANGUAGES.map((l) => [l.value, l.label]))
  );

  const triggerAnswerGeneration = useCallback((question) => {
    pendingQuestionRef.current = question;
    generateAnswer({
      question,
      personalInfo: personalInfoRef.current,
      answerSettings: answerSettingsRef.current,
      setup: setupRef.current,
      conversationHistory: conversationHistoryRef.current,
    });
  }, [generateAnswer]);

  const runQuestionDetection = useCallback(async (text) => {
    if (!text.trim()) return;
    const now = Date.now();
    if (now - lastDetectedAtRef.current < 3000) return;

    try {
      const res = await fetch(`${SERVER_URL}/api/ai/detect-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: text,
          sensitivity: answerSettingsRef.current.detectionSensitivity,
          provider: setupRef.current.aiProvider,
        }),
      });
      const data = await res.json();
      const detectedQuestion = typeof data.question === 'string' ? data.question.trim() : '';
      if (!data.isQuestion || !detectedQuestion) return;
      if (shouldSkipAutoAnswer({
        question: detectedQuestion,
        lastAuto: lastAutoAnswerRef.current,
        pendingQuestion: pendingQuestionRef.current,
        isLoading: isLoadingRef.current,
      })) {
        return;
      }

      lastDetectedAtRef.current = Date.now();
      lastAutoAnswerRef.current = {
        key: normalizeQuestionKey(detectedQuestion),
        at: Date.now(),
      };
      setLastQuestion(detectedQuestion);
      triggerAnswerGeneration(detectedQuestion);
    } catch {
      // Network error — skip detection
    }
  }, [triggerAnswerGeneration]);

  const handleTranscriptUpdate = useCallback((text) => {
    if (!sessionRef.current.autoAnswer) return;
    clearTimeout(detectionTimeoutRef.current);
    // Debounce question detection — wait a short silence window before checking
    detectionTimeoutRef.current = setTimeout(() => {
      runQuestionDetection(getTranscriptTail(text, 1200));
    }, DETECT_QUESTION_DEBOUNCE_MS);
  }, [runQuestionDetection]);

  // Support array of interview languages (use first for recognition)
  const interviewLangs = Array.isArray(setup.interviewLangs)
    ? setup.interviewLangs
    : [setup.interviewLang || 'en-US'];
  const isElectronRuntime = typeof window !== 'undefined' && window.electronAPI?.isElectron;
  const audioInputMode = session.audioInputMode || 'mic';
  const normalizedSttProvider = String(setup.sttProvider || 'auto').trim().toLowerCase();
  const windowsLiveCaptionsMicAssist = setup.windowsLiveCaptionsIncludeMicrophoneAudio !== false;
  const useProviderDrivenMicOnly = audioInputMode === 'mic' && isElectronRuntime;
  const useMicOnlyWindowsCaptions = useProviderDrivenMicOnly && normalizedSttProvider === 'windows-live-captions';
  const useCombinedWindowsCaptions = (
    audioInputMode === 'mic-system'
    && normalizedSttProvider === 'windows-live-captions'
    && windowsLiveCaptionsMicAssist
  );
  const useDualAudioForCurrentMode = audioInputMode === 'mic-system' || useProviderDrivenMicOnly;
  const canToggleWindowsLiveCaptionsWindow = isElectronRuntime && normalizedSttProvider === 'windows-live-captions';

  const handleWindowsLiveCaptionsStatusChange = useCallback((status = {}) => {
    if (typeof status.hidden === 'boolean') {
      setWindowsCaptionsWindowHidden(status.hidden);
    }
    if (status.error) {
      setWindowsCaptionsWindowError(String(status.error));
    }
    updateRuntime({
      diagnostics: {
        windowsLiveCaptionsRunning: status.running === true,
        windowsLiveCaptionsHidden: status.hidden === true,
        windowsLiveCaptionsAutoHidePending: status.autoHidePending === true,
        windowsLiveCaptionsMicrophoneAudioEnabled: status.microphoneAudioEnabled === true,
      },
    });
  }, [updateRuntime]);

  const handleRuntimeStateChange = useCallback((nextState = {}) => {
    updateRuntime(nextState);
  }, [updateRuntime]);

  const syncWindowsLiveCaptionsWindowState = useCallback(async () => {
    if (!canToggleWindowsLiveCaptionsWindow || !window?.electronAPI?.getWindowsLiveCaptionsStatus) return;
    try {
      const status = await window.electronAPI.getWindowsLiveCaptionsStatus();
      if (typeof status?.hidden === 'boolean') {
        setWindowsCaptionsWindowHidden(status.hidden);
      }
    } catch {
      // Ignore sync failures; manual toggle still reports errors explicitly.
    }
  }, [canToggleWindowsLiveCaptionsWindow]);

  const pushCombinedTranscriptForDetection = useCallback(() => {
    const combined = [micLiveTranscriptRef.current, systemLiveTranscriptRef.current]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join('\n');
    handleTranscriptUpdate(combined);
  }, [handleTranscriptUpdate]);

  const handleMicTranscriptUpdate = useCallback((text) => {
    micLiveTranscriptRef.current = String(text || '');
    if (audioInputMode === 'mic-system') {
      pushCombinedTranscriptForDetection();
      return;
    }
    handleTranscriptUpdate(text);
  }, [audioInputMode, handleTranscriptUpdate, pushCombinedTranscriptForDetection]);

  const handleSystemTranscriptUpdate = useCallback((text) => {
    systemLiveTranscriptRef.current = String(text || '');
    if (audioInputMode === 'mic-system') {
      pushCombinedTranscriptForDetection();
    }
  }, [audioInputMode, pushCombinedTranscriptForDetection]);

  const handleFinalSegment = useCallback(({
    text,
    language: segmentLanguage,
    timestamp,
    sourceMode,
    speaker: providedSpeaker,
  }) => {
    const cleanedText = sanitizeTranscriptSegment(text);
    if (!cleanedText) return;
    const effectiveSourceMode = (
      audioInputMode === 'mic' && sourceMode === 'system'
        ? 'mic'
        : sourceMode
    );
    const sourceSpeaker = speakerFromSourceMode(effectiveSourceMode);
    const speaker = useCombinedWindowsCaptions
      ? guessSpeakerLabel(cleanedText)
      : providedSpeaker || (
        sourceSpeaker !== 'Unknown' ? sourceSpeaker : guessSpeakerLabel(cleanedText)
      );
    setTranscriptEntries((prev) => {
      const nextEntry = {
        text: cleanedText,
        language: segmentLanguage,
        speaker,
        timestamp: timestamp || Date.now(),
        sourceMode: effectiveSourceMode || 'unknown',
      };
      if (prev.length > 0) {
        const previousEntry = prev[prev.length - 1];
        if (shouldMergeTranscriptEntries(previousEntry, nextEntry)) {
          const mergedEntry = {
            ...previousEntry,
            text: joinTranscriptText(previousEntry.text, nextEntry.text),
            timestamp: nextEntry.timestamp,
          };
          return [...prev.slice(0, -1), mergedEntry].slice(-500);
        }
      }
      return [...prev, nextEntry].slice(-500);
    });
  }, [audioInputMode, useCombinedWindowsCaptions]);

  const webSpeechTranscript = useTranscript({
    enabled: isRunning && audioInputMode === 'mic' && !useProviderDrivenMicOnly,
    language: interviewLangs,
    onTranscriptChange: handleMicTranscriptUpdate,
    onFinalSegment: handleFinalSegment,
    rotationIntervalMs: MIC_ROTATION_INTERVAL_MS,
  });

  const dualAudioTranscript = useDualAudioTranscript({
    enabled: isRunning && useDualAudioForCurrentMode,
    language: interviewLangs,
    provider: setup.aiProvider,
    transcribeProvider: setup.sttProvider,
    autoHideWindowsLiveCaptions: setup.autoHideWindowsLiveCaptions === true,
    includeWindowsLiveCaptionsMicrophoneAudio:
      normalizedSttProvider === 'windows-live-captions' && windowsLiveCaptionsMicAssist,
    captureMic: audioInputMode === 'mic-system'
      ? !useCombinedWindowsCaptions
      : !useMicOnlyWindowsCaptions,
    captureSystem: audioInputMode === 'mic-system' || useMicOnlyWindowsCaptions,
    onTranscriptChange: audioInputMode === 'mic-system'
      ? handleTranscriptUpdate
      : handleMicTranscriptUpdate,
    onFinalSegment: handleFinalSegment,
    onWindowsLiveCaptionsStatusChange: handleWindowsLiveCaptionsStatusChange,
    onRuntimeStateChange: handleRuntimeStateChange,
  });

  const transcript = useDualAudioForCurrentMode
    ? dualAudioTranscript.transcript
    : webSpeechTranscript.transcript;
  const isListening = useDualAudioForCurrentMode
    ? dualAudioTranscript.isListening
    : webSpeechTranscript.isListening;
  const transcriptError = useDualAudioForCurrentMode
    ? dualAudioTranscript.error
    : webSpeechTranscript.error;
  const activeLanguage = useDualAudioForCurrentMode
    ? dualAudioTranscript.activeLanguage
    : webSpeechTranscript.activeLanguage;
  const systemSttLabel = normalizedSttProvider === 'auto'
    ? 'openai -> local -> gemini -> windows-live-captions'
    : normalizedSttProvider === 'windows-live-captions' && windowsLiveCaptionsMicAssist
      ? 'windows-live-captions + mic-assist'
      : normalizedSttProvider;
  const micSttLabel = normalizedSttProvider === 'auto'
    ? 'openai -> local -> gemini'
    : normalizedSttProvider === 'windows-live-captions'
      ? 'openai -> local -> gemini'
      : normalizedSttProvider;
  const sttDisplayLabel = useCombinedWindowsCaptions
    ? 'Captions=windows-live-captions + mic-assist'
    : audioInputMode === 'mic-system'
    ? `Mic=${micSttLabel} | System=${systemSttLabel}`
    : useProviderDrivenMicOnly
      ? `Mic=${useMicOnlyWindowsCaptions ? 'windows-live-captions + mic-assist' : micSttLabel}`
      : 'Mic=webspeech';
  const runtimeStatusLabel = runtime.status || (isRunning ? 'starting' : 'idle');
  const runtimeSourceLabel = audioInputMode === 'mic-system' ? 'Mic + System' : 'Mic';
  const runtimeProviderLabel = runtime.diagnostics.providerUsed || (
    normalizedSttProvider === 'auto'
      ? 'auto'
      : normalizedSttProvider
  );

  useEffect(() => {
    setWindowsCaptionsWindowHidden(setup.autoHideWindowsLiveCaptions === true);
  }, [setup.autoHideWindowsLiveCaptions]);

  useEffect(() => {
    if (!isRunning || !canToggleWindowsLiveCaptionsWindow) return undefined;
    let cancelled = false;

    const sync = async () => {
      if (cancelled) return;
      await syncWindowsLiveCaptionsWindowState();
    };

    sync();
    const timer = setInterval(sync, 1800);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isRunning, canToggleWindowsLiveCaptionsWindow, syncWindowsLiveCaptionsWindowState]);

  useEffect(() => {
    updateRuntime({
      activeProvider: runtimeProviderLabel,
      providerDetail: sttDisplayLabel,
      sourceMode: runtimeSourceLabel,
      status: isRunning ? (isListening ? 'running' : 'starting') : 'idle',
      isListening,
      startedAt: isRunning
        ? (runtime.startedAt || Date.now())
        : null,
      lastError: transcriptError || aiError || windowsCaptionsWindowError || localError || '',
      diagnostics: {
        sourceLabel: sttDisplayLabel,
        activeLanguage: activeLanguage || '',
      },
    });
  }, [
    activeLanguage,
    aiError,
    isListening,
    isRunning,
    localError,
    runtime.startedAt,
    runtimeProviderLabel,
    runtimeSourceLabel,
    sttDisplayLabel,
    transcriptError,
    updateRuntime,
    windowsCaptionsWindowError,
  ]);

  useEffect(() => {
    return () => {
      resetRuntime();
    };
  }, [resetRuntime]);

  const handleToggleWindowsLiveCaptionsWindow = useCallback(async () => {
    if (!canToggleWindowsLiveCaptionsWindow || windowsCaptionsWindowBusy || !window?.electronAPI) return;
    setWindowsCaptionsWindowBusy(true);
    setWindowsCaptionsWindowError('');
    try {
      const result = windowsCaptionsWindowHidden
        ? await window.electronAPI.showWindowsLiveCaptions()
        : await window.electronAPI.hideWindowsLiveCaptions();
      if (!result?.ok) {
        setWindowsCaptionsWindowError(
          windowsCaptionsWindowHidden
            ? 'Unable to show Windows Live Captions right now.'
            : 'Unable to hide Windows Live Captions right now.'
        );
        return;
      }
      await syncWindowsLiveCaptionsWindowState();
    } catch {
      setWindowsCaptionsWindowError(
        windowsCaptionsWindowHidden
          ? 'Unable to show Windows Live Captions right now.'
          : 'Unable to hide Windows Live Captions right now.'
      );
    } finally {
      setWindowsCaptionsWindowBusy(false);
    }
  }, [
    canToggleWindowsLiveCaptionsWindow,
    syncWindowsLiveCaptionsWindowState,
    windowsCaptionsWindowBusy,
    windowsCaptionsWindowHidden,
  ]);

  const handleCustomSubmit = (e) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    const question = customInput.trim();
    setLastQuestion(question);
    triggerAnswerGeneration(question);
    setCustomInput('');
  };

  const handleManualAnswer = () => {
    const manualQuestion =
      buildManualQuestionFromEntries(transcriptEntries, { maxEntries: 3, maxChars: 500 }) ||
      extractManualQuestionFromTranscript(getTranscriptTail(transcript, 500));
    if (!manualQuestion) return;
    setLastQuestion(manualQuestion);
    triggerAnswerGeneration(manualQuestion);
  };

  const handleScreenshotAnswer = useCallback(async () => {
    if (
      !isElectronRuntime
      || !window?.electronAPI?.capturePrimaryScreen
      || isCapturingScreenshot
      || isLoading
    ) {
      return;
    }

    setLocalError('');
    setIsCapturingScreenshot(true);
    try {
      const captureResult = await window.electronAPI.capturePrimaryScreen({ excludeAppWindow: true });
      if (!captureResult?.ok || !captureResult?.dataUrl) {
        throw new Error(captureResult?.error || 'Unable to capture the primary screen right now.');
      }

      const transcriptContext = (
        buildManualQuestionFromEntries(transcriptEntries, { maxEntries: 6, maxChars: 900 })
        || getTranscriptTail(transcript, 900)
      );

      const result = await generateAnswerFromScreenshot({
        screenshotDataUrl: captureResult.dataUrl,
        transcript: transcriptContext,
        personalInfo: personalInfoRef.current,
        answerSettings: answerSettingsRef.current,
        setup: setupRef.current,
        conversationHistory: conversationHistoryRef.current,
      });
      if (!result?.answer) return;

      const detectedQuestion = String(result.question || '').trim();
      if (detectedQuestion) {
        setLastQuestion(detectedQuestion);
        const limit = Math.max(2, Number(answerSettingsRef.current.memoryLimit) || 10);
        const messageLimit = limit * 2;
        setConversationHistory((prev) => {
          const next = [
            ...prev,
            { role: 'user', content: detectedQuestion },
            { role: 'assistant', content: result.answer },
          ];
          return next.slice(-messageLimit);
        });
      }
    } catch (error) {
      setLocalError(error?.message || 'Unable to answer from screenshot right now.');
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [
    generateAnswerFromScreenshot,
    isCapturingScreenshot,
    isElectronRuntime,
    isLoading,
    transcript,
    transcriptEntries,
  ]);

  const handleToggle = () => {
    if (isRunning) {
      clearTimeout(detectionTimeoutRef.current);
      setIsRunning(false);
      cancelGeneration();
      if (canToggleWindowsLiveCaptionsWindow && window?.electronAPI?.stopWindowsLiveCaptions) {
        window.electronAPI.stopWindowsLiveCaptions().catch(() => {
          // Ignore stop failures; app quit path also cleans up managed captions.
        });
      }
      resetRuntime();
      pendingQuestionRef.current = null;
      micLiveTranscriptRef.current = '';
      systemLiveTranscriptRef.current = '';
    } else {
      setIsRunning(true);
      setLocalError('');
      setWindowsCaptionsWindowError('');
      updateRuntime({
        activeProvider: runtimeProviderLabel,
        providerDetail: sttDisplayLabel,
        sourceMode: runtimeSourceLabel,
        status: 'starting',
        isListening: false,
        startedAt: Date.now(),
        lastError: '',
        diagnostics: {
          sourceLabel: sttDisplayLabel,
          activeLanguage: activeLanguage || '',
        },
      });
      clearAnswer();
      webSpeechTranscript.clearTranscript();
      dualAudioTranscript.clearTranscript();
      setTranscriptEntries([]);
      lastAutoAnswerRef.current = null;
      micLiveTranscriptRef.current = '';
      systemLiveTranscriptRef.current = '';
    }
  };

  useEffect(() => {
    return () => clearTimeout(detectionTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!transcriptScrollRef.current) return;
    transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
  }, [transcriptEntries.length]);

  // Save completed conversation turn (user question + assistant answer) to history
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading && pendingQuestionRef.current && answer) {
      const question = pendingQuestionRef.current;
      const limit = Math.max(2, Number(answerSettingsRef.current.memoryLimit) || 10);
      const messageLimit = limit * 2; // each turn has 2 messages: user + assistant
      setConversationHistory((prev) => {
        const next = [
          ...prev,
          { role: 'user', content: question },
          { role: 'assistant', content: answer },
        ];
        return next.slice(-messageLimit);
      });
      pendingQuestionRef.current = null;
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, answer]);

  // Build list of completed turns to show in the history section
  const completedTurns = [];
  for (let i = 0; i < conversationHistory.length - 1; i += 2) {
    completedTurns.push({
      question: conversationHistory[i]?.content || '',
      answer: conversationHistory[i + 1]?.content || '',
    });
  }

  const handleExport = () => {
    if (!transcript.trim() && completedTurns.length === 0) return;

    const content = buildSessionExportText({
      transcript,
      transcriptEntries,
      completedTurns,
      metadata: {
        topic: setup.topic,
        answerLang: setup.answerLang,
        interviewLangs,
      },
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `interview-session-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  };

  return (
    <div className="standard-panel">
      <div className="panel-header">
        <button className="btn-back" onClick={onBack}>← End</button>
        <h2 className="panel-title">Standard Mode</h2>
        <span className={`status-dot ${isListening ? 'listening' : ''}`} />
      </div>

      <div className="control-bar">
        <button
          className={`btn-toggle ${isRunning ? 'btn-stop' : 'btn-start'}`}
          onClick={handleToggle}
        >
          {isRunning ? '⏹ Stop Listening' : '🎙️ Start Listening'}
        </button>
        {isRunning && (
          <button
            className="btn-clear"
            onClick={() => {
              cancelGeneration();
              pendingQuestionRef.current = null;
              lastAutoAnswerRef.current = null;
              clearTimeout(detectionTimeoutRef.current);
              detectionTimeoutRef.current = null;
              clearAnswer();
              webSpeechTranscript.clearTranscript();
              dualAudioTranscript.clearTranscript();
              micLiveTranscriptRef.current = '';
              systemLiveTranscriptRef.current = '';
              setLastQuestion('');
              setTranscriptEntries([]);
            }}
          >
            Clear
          </button>
        )}
        {(completedTurns.length > 0 || transcript.trim()) && (
          <button className="btn-export" onClick={handleExport}>
            Export
          </button>
        )}
      </div>

      <div className="feedback-slot" aria-live="polite" hidden={!(transcriptError || aiError || windowsCaptionsWindowError || localError)}>
        {(transcriptError || aiError || windowsCaptionsWindowError || localError) && (
          <div className="error-box">⚠️ {transcriptError || aiError || windowsCaptionsWindowError || localError}</div>
        )}
      </div>

      <div className="runtime-status-bar">
        <span className="runtime-badge">Provider: {runtimeProviderLabel}</span>
        <span className="runtime-badge">Source: {runtimeSourceLabel}</span>
        <span className="runtime-badge">Status: {runtimeStatusLabel}</span>
        {runtime.diagnostics.windowsLiveCaptionsRunning && (
          <span className="runtime-badge">
            LiveCaptions {runtime.diagnostics.windowsLiveCaptionsHidden ? 'Hidden' : 'Visible'}
          </span>
        )}
        {runtime.diagnostics.localWhisperHealthy && (
          <span className="runtime-badge">LocalWhisper Ready</span>
        )}
        {runtime.diagnostics.localWhisperLeaseCount > 0 && (
          <span className="runtime-badge">Local Lease: {runtime.diagnostics.localWhisperLeaseCount}</span>
        )}
      </div>

      {(runtime.lastError || runtime.diagnostics.localWhisperHealthUrl) && (
        <div className="runtime-detail-box">
          {runtime.lastError && (
            <div className="runtime-detail-line">Last error: {runtime.lastError}</div>
          )}
          {runtime.diagnostics.localWhisperHealthUrl && (
            <div className="runtime-detail-line">
              Local health: {runtime.diagnostics.localWhisperHealthUrl}
            </div>
          )}
        </div>
      )}

      {isRunning && canToggleWindowsLiveCaptionsWindow && (
        <div className="caption-control-bar">
          <button
            type="button"
            className="btn-caption-toggle"
            onClick={handleToggleWindowsLiveCaptionsWindow}
            disabled={windowsCaptionsWindowBusy}
          >
            {windowsCaptionsWindowBusy
              ? 'Updating Live Captions...'
              : windowsCaptionsWindowHidden
                ? 'Show Live Captions'
                : 'Hide Live Captions'}
          </button>
          <span className="caption-control-note">
            Windows Live Captions uses Windows accessibility capture, so keeping it visible until text starts flowing is more reliable.
          </span>
        </div>
      )}

      {session.showTranscript && (isRunning || transcript) && (
        <div className="transcript-box">
          <div className="box-label-row">
            <span className="box-label">🎤 Transcript</span>
            <span className="transcript-lang-badge">
              Source: {audioInputMode === 'mic-system' ? 'Mic + System' : 'Mic only'} |{' '}
              STT: {sttDisplayLabel} |{' '}
              Listening: {languageLabelByValue.current[activeLanguage] || activeLanguage}
              {audioInputMode === 'mic' && interviewLangs.length > 1 ? ' (auto-cycle)' : ''}
            </span>
          </div>

          <div className="transcript-scroll" ref={transcriptScrollRef}>
            {transcriptEntries.length > 0 ? (
              <div className="transcript-entry-list">
                {transcriptEntries.slice(-150).map((entry, idx) => (
                  <div key={`${entry.timestamp}-${idx}`} className="transcript-entry">
                    <span className={`speaker-tag speaker-${entry.speaker.toLowerCase()}`}>
                      {entry.speaker}
                    </span>
                    <span className="entry-language-tag">{entry.language}</span>
                    {entry.sourceMode && (
                      <span className="entry-source-tag">
                        {entry.sourceMode === 'system' ? 'System' : entry.sourceMode === 'mic' ? 'Mic' : entry.sourceMode}
                      </span>
                    )}
                    <span className="entry-text">{entry.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="transcript-empty">{isRunning ? 'Listening...' : 'No transcript yet.'}</p>
            )}
          </div>
        </div>
      )}

      {lastQuestion && (
        <div className="question-box">
          <div className="box-label-row">
            <span className="box-label">❓ Detected Question</span>
            {!session.autoAnswer && isRunning && !isLoading && (
              <button className="btn-answer" onClick={() => triggerAnswerGeneration(lastQuestion)}>
                Answer
              </button>
            )}
          </div>
          <p className="question-text">{lastQuestion}</p>
        </div>
      )}

      {isRunning && (transcriptEntries.length > 0 || transcript.trim()) && (
        <div className="control-bar">
          <button className="btn-answer-wide" onClick={handleManualAnswer} disabled={isLoading}>
            💡 Answer Current Transcript
            {session.autoAnswer ? ' (Manual Retry)' : ''}
          </button>
        </div>
      )}

      {isElectronRuntime && (
        <div className="control-bar">
          <button
            className="btn-screenshot"
            onClick={handleScreenshotAnswer}
            disabled={isCapturingScreenshot || isLoading}
          >
            {isCapturingScreenshot ? 'Capturing Screenshot...' : '🖼 Answer Screenshot'}
          </button>
        </div>
      )}

      {(answer || isLoading) && (
        <div className="answer-box">
          <div className="box-label-row">
            <span className="box-label">💡 Answer</span>
            {isLoading && <span className="loading-badge">generating…</span>}
            {answer && !isLoading && (
              <button
                className="btn-copy"
                onClick={() => navigator.clipboard.writeText(answer)}
              >
                Copy
              </button>
            )}
          </div>
          <p className="answer-text" style={{ fontSize: `${displaySettings.fontSize}px` }}>
            {answer}
          </p>
          {isLoading && <span className="cursor-blink">▌</span>}
        </div>
      )}

      {completedTurns.length > 0 && (
        <div className="history-section">
          <div className="history-header">
            <span className="box-label">📋 Conversation History</span>
            <div className="history-actions">
              {historyView !== 'hidden' && (
                <button
                  className="btn-history-action"
                  onClick={() => setHistoryView((prev) => (prev === 'expanded' ? 'collapsed' : 'expanded'))}
                >
                  {historyView === 'expanded' ? 'Collapse' : 'Expand'}
                </button>
              )}
              <button
                className="btn-history-action"
                onClick={() => setHistoryView((prev) => (prev === 'hidden' ? 'expanded' : 'hidden'))}
              >
                {historyView === 'hidden' ? 'Show' : 'Hide'}
              </button>
            </div>
          </div>
          {historyView === 'expanded' && (
            <div className="history-list">
              {completedTurns.map((turn, idx) => (
                <div key={idx} className="history-turn">
                  <div className="history-question">Q: {turn.question}</div>
                  <div className="history-answer" style={{ fontSize: `${displaySettings.fontSize}px` }}>
                    A: {turn.answer}
                  </div>
                </div>
              ))}
            </div>
          )}
          {historyView === 'collapsed' && (
            <div className="history-collapsed-note">
              {completedTurns.length} turn(s) kept in memory and will still be included in export.
            </div>
          )}
          {historyView === 'hidden' && (
            <div className="history-collapsed-note">
              History panel hidden. {completedTurns.length} turn(s) are still retained for context and export.
            </div>
          )}
        </div>
      )}

      {session.showCustomInput && (
        <form className="custom-input-form" onSubmit={handleCustomSubmit}>
          <input
            className="custom-input"
            aria-label="Manual question input"
            placeholder="Type a question manually and press Enter…"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
          />
          <button type="submit" className="btn-send">→</button>
        </form>
      )}
    </div>
  );
}
