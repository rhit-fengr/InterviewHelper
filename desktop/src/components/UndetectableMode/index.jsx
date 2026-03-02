import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import { useDualAudioTranscript } from '../../hooks/useDualAudioTranscript';
import { useSocketSync } from '../../hooks/useSocketSync';
import { useAIAnswer } from '../../hooks/useAIAnswer';
import { useTranscript } from '../../hooks/useTranscript';
import { getTranscriptTail, guessSpeakerLabel } from '../../utils/interviewTranscript';
import { normalizeQuestionKey, shouldSkipAutoAnswer } from '../../utils/autoAnswer';
import './UndetectableMode.css';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:4000';
const LIVE_TRANSCRIPT_LINES = 3;
const LIVE_TRANSCRIPT_MAX_CHARS = 600;

function getRecentTranscriptLines(text, maxLines = LIVE_TRANSCRIPT_LINES, maxChars = LIVE_TRANSCRIPT_MAX_CHARS) {
  const value = String(text || '').trim();
  if (!value) return '';
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-Math.max(1, Number(maxLines) || LIVE_TRANSCRIPT_LINES));
  return getTranscriptTail(lines.join('\n'), maxChars);
}

function generateSessionCode() {
  const words = ['IRON', 'APEX', 'BOLT', 'NOVA', 'JADE', 'ECHO', 'FLUX', 'GRID'];
  const word = words[Math.floor(Math.random() * words.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${word}-${num}`;
}

export default function UndetectableMode({ onBack }) {
  const { setup, session, personalInfo, answerSettings } = useInterviewStore();
  const [sessionCode] = useState(() => generateSessionCode());
  const [isRunning, setIsRunning] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [conversationHistory, setConversationHistory] = useState([]);

  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

  // Keep latest values in refs so callbacks stay stable
  const sessionRef = useRef(session);
  const answerSettingsRef = useRef(answerSettings);
  const personalInfoRef = useRef(personalInfo);
  const setupRef = useRef(setup);
  const conversationHistoryRef = useRef(conversationHistory);
  const activeLanguageRef = useRef('en-US');
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { answerSettingsRef.current = answerSettings; }, [answerSettings]);
  useEffect(() => { personalInfoRef.current = personalInfo; }, [personalInfo]);
  useEffect(() => { setupRef.current = setup; }, [setup]);
  useEffect(() => { conversationHistoryRef.current = conversationHistory; }, [conversationHistory]);

  const {
    isConnected,
    clientConnected,
    createSession,
    streamAnswerChunk,
    streamTranscript,
  } = useSocketSync({ role: 'host' });

  const { answer, isLoading, generateAnswer } = useAIAnswer();

  // Debounce ref for question detection
  const detectionTimeoutRef = useRef(null);
  const lastDetectedAtRef = useRef(0);
  const lastAutoAnswerRef = useRef(null);
  // Track the in-flight question so we can save user+assistant pair when generation completes
  const pendingQuestionRef = useRef(null);
  const prevIsLoadingRef = useRef(false);
  const isLoadingRef = useRef(false);
  // Track how many characters of the current answer have already been streamed
  const lastStreamedLengthRef = useRef(0);

  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  const triggerAnswerGeneration = useCallback(async (question) => {
    pendingQuestionRef.current = question;
    await generateAnswer({
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
      triggerAnswerGeneration(detectedQuestion);
    } catch {
      // Network error — skip detection
    }
  }, [triggerAnswerGeneration]);

  const handleTranscriptUpdate = useCallback((text) => {
    const transcriptPreview = getRecentTranscriptLines(text);
    // Forward transcript to mobile
    if (clientConnected && transcriptPreview) {
      streamTranscript(sessionCode, transcriptPreview, {
        language: activeLanguageRef.current,
        speaker: guessSpeakerLabel(transcriptPreview),
      });
    }
    // Auto-detect question and generate answer if enabled
    if (sessionRef.current.autoAnswer) {
      clearTimeout(detectionTimeoutRef.current);
      detectionTimeoutRef.current = setTimeout(() => {
        runQuestionDetection(getTranscriptTail(text, 1200));
      }, 1500);
    }
  }, [clientConnected, sessionCode, streamTranscript, runQuestionDetection]);

  const audioInputMode = session.audioInputMode || 'mic';
  const interviewLangs = Array.isArray(setup.interviewLangs)
    ? setup.interviewLangs
    : [setup.interviewLang || 'en-US'];

  const speechTranscript = useTranscript({
    enabled: isRunning && audioInputMode === 'mic',
    language: interviewLangs,
    onTranscriptChange: handleTranscriptUpdate,
  });

  const dualAudioTranscript = useDualAudioTranscript({
    enabled: isRunning && audioInputMode === 'mic-system',
    language: interviewLangs,
    provider: setup.aiProvider,
    onTranscriptChange: handleTranscriptUpdate,
  });

  const transcript = audioInputMode === 'mic-system'
    ? dualAudioTranscript.transcript
    : speechTranscript.transcript;
  const transcriptPreview = getRecentTranscriptLines(transcript);
  const activeLanguage = audioInputMode === 'mic-system'
    ? dualAudioTranscript.activeLanguage
    : speechTranscript.activeLanguage;
  const transcriptError = audioInputMode === 'mic-system'
    ? dualAudioTranscript.error
    : speechTranscript.error;
  const isListening = audioInputMode === 'mic-system'
    ? dualAudioTranscript.isListening
    : speechTranscript.isListening;

  useEffect(() => {
    activeLanguageRef.current = activeLanguage || activeLanguageRef.current;
  }, [activeLanguage]);

  // Register the session with the server once socket connects
  useEffect(() => {
    if (isConnected) {
      createSession(sessionCode);
    }
  }, [isConnected, createSession, sessionCode]);

  // Stream only NEW (delta) answer characters to connected mobile client
  useEffect(() => {
    if (!clientConnected) return;
    if (answer === '') {
      // New generation starting — reset stream position
      lastStreamedLengthRef.current = 0;
      return;
    }
    const delta = answer.slice(lastStreamedLengthRef.current);
    if (delta) {
      streamAnswerChunk(sessionCode, delta, false);
      lastStreamedLengthRef.current = answer.length;
    }
    if (!isLoading && lastStreamedLengthRef.current > 0) {
      // Signal completion after last delta has been sent
      streamAnswerChunk(sessionCode, '', true);
    }
  }, [answer, isLoading, clientConnected, sessionCode, streamAnswerChunk]);

  const handleStartStop = () => {
    setIsRunning((prev) => {
      const next = !prev;
      if (!next) {
        pendingQuestionRef.current = null;
        speechTranscript.clearTranscript();
        dualAudioTranscript.clearTranscript();
      } else {
        lastAutoAnswerRef.current = null;
      }
      return next;
    });
    clearTimeout(detectionTimeoutRef.current);
  };

  const handleHideToggle = () => {
    if (isElectron) {
      if (isHidden) {
        window.electronAPI.showWindow();
      } else {
        window.electronAPI.hideWindow();
      }
    }
    setIsHidden((prev) => !prev);
  };

  const handleAskQuestion = useCallback(async (question) => {
    if (!question.trim()) return;
    await triggerAnswerGeneration(question);
  }, [triggerAnswerGeneration]);

  useEffect(() => {
    return () => clearTimeout(detectionTimeoutRef.current);
  }, []);

  // Save completed conversation turn (user question + assistant answer) to history
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading && pendingQuestionRef.current && answer) {
      const question = pendingQuestionRef.current;
      const limit = Math.max(2, Number(answerSettingsRef.current.memoryLimit) || 10);
      setConversationHistory((prev) => {
        const next = [
          ...prev,
          { role: 'user', content: question },
          { role: 'assistant', content: answer },
        ];
        // Keep at most `limit` conversation turns (user+assistant pairs) => `limit * 2` messages
        return next.slice(-(limit * 2));
      });
      pendingQuestionRef.current = null;
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, answer]);

  return (
    <div className="undetectable-panel">
      <div className="panel-header">
        <button className="btn-back" onClick={onBack}>← Back</button>
        <h2 className="panel-title">Undetectable Mode</h2>
      </div>

      {/* Session info bar */}
      <div className="session-bar">
        <div className="session-info">
          <span className="session-label">Session Code</span>
          <span className="session-code">{sessionCode}</span>
        </div>
        <div className="session-status">
          <span className={`status-indicator ${clientConnected ? 'connected' : isConnected ? 'waiting' : 'offline'}`}>
            {clientConnected ? '✅ Phone Connected' : isConnected ? '⏳ Waiting…' : '🔴 Offline'}
          </span>
        </div>
      </div>

      {/* Setup instructions */}
      {!clientConnected && (
        <div className="instructions-box">
          <h4 className="instructions-title">Connect Your Phone</h4>
          <ol className="instructions-list">
            <li>Open Interview AI Hamburger on your mobile device</li>
            <li>Tap <strong>"Connect to Session"</strong></li>
            <li>Enter code: <strong className="code-highlight">{sessionCode}</strong></li>
            <li>Tap Connect — answers stream to your phone</li>
          </ol>
        </div>
      )}

      {/* Controls */}
      <div className="control-row">
        <button
          className={`btn-toggle ${isRunning ? 'btn-stop' : 'btn-start'}`}
          onClick={handleStartStop}
          disabled={!clientConnected}
        >
          {isRunning ? '⏹ Stop' : `🎙️ Start Listening (${audioInputMode === 'mic-system' ? 'Mic + System' : 'Mic'})`}
        </button>

        {clientConnected && (
          <button
            className={`btn-hide ${isHidden ? 'btn-show' : ''}`}
            onClick={handleHideToggle}
          >
            {isHidden ? '👁 Show App' : '🫥 Hide App'}
          </button>
        )}
      </div>

      {/* Live transcript preview (desktop side only) */}
      {session.showTranscript && isRunning && transcriptPreview && (
        <div className="transcript-preview">
          <span className="box-label">🎤 Live ({isListening ? 'listening' : 'idle'})</span>
          <p className="transcript-text">{transcriptPreview}</p>
        </div>
      )}

      {transcriptError && (
        <div className="instructions-box">
          <h4 className="instructions-title">Audio Capture Error</h4>
          <p className="transcript-text">{transcriptError}</p>
        </div>
      )}

      {/* Answer preview on desktop */}
      {(answer || isLoading) && (
        <div className="answer-preview">
          <span className="box-label">💡 {isLoading ? 'Generating…' : 'Answer (streamed to phone)'}</span>
          <p className="answer-text">{answer}</p>
        </div>
      )}

      {/* Manual question override */}
      {session.showCustomInput && (
        <ManualInput onSubmit={handleAskQuestion} disabled={!clientConnected} />
      )}
    </div>
  );
}

function ManualInput({ onSubmit, disabled }) {
  const [value, setValue] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    onSubmit(value.trim());
    setValue('');
  };

  return (
    <form className="manual-input-form" onSubmit={handleSubmit}>
      <input
        className="manual-input"
        placeholder={disabled ? 'Connect phone first…' : 'Type a question manually…'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
      />
      <button type="submit" className="btn-send" disabled={disabled}>→</button>
    </form>
  );
}
