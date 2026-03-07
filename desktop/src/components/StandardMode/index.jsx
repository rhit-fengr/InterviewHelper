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

export default function StandardMode({ onBack }) {
  const { setup, session, personalInfo, answerSettings, displaySettings } = useInterviewStore();
  const [isRunning, setIsRunning] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [conversationHistory, setConversationHistory] = useState([]);
  const [lastQuestion, setLastQuestion] = useState('');
  const [transcriptEntries, setTranscriptEntries] = useState([]);
  const [historyView, setHistoryView] = useState('expanded');
  const detectionTimeoutRef = useRef(null);
  const transcriptScrollRef = useRef(null);
  const lastDetectedAtRef = useRef(0);
  const lastAutoAnswerRef = useRef(null);
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

  const { answer, isLoading, error: aiError, generateAnswer, cancelGeneration, clearAnswer } = useAIAnswer();
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
    }, 900);
  }, [runQuestionDetection]);

  // Support array of interview languages (use first for recognition)
  const interviewLangs = Array.isArray(setup.interviewLangs)
    ? setup.interviewLangs
    : [setup.interviewLang || 'en-US'];
  const audioInputMode = session.audioInputMode || 'mic';

  const handleFinalSegment = useCallback(({
    text,
    language: segmentLanguage,
    timestamp,
    sourceMode,
    speaker: providedSpeaker,
  }) => {
    const cleanedText = sanitizeTranscriptSegment(text);
    if (!cleanedText) return;
    const sourceSpeaker = speakerFromSourceMode(sourceMode);
    const speaker = providedSpeaker || (
      sourceSpeaker !== 'Unknown' ? sourceSpeaker : guessSpeakerLabel(cleanedText)
    );
    setTranscriptEntries((prev) => ([
      ...prev,
      {
        text: cleanedText,
        language: segmentLanguage,
        speaker,
        timestamp,
        sourceMode: sourceMode || 'unknown',
      },
    ].slice(-500)));
  }, []);

  const webSpeechTranscript = useTranscript({
    enabled: isRunning && audioInputMode === 'mic',
    language: interviewLangs,
    onTranscriptChange: handleTranscriptUpdate,
    onFinalSegment: handleFinalSegment,
    rotationIntervalMs: 8000,
  });

  const dualAudioTranscript = useDualAudioTranscript({
    enabled: isRunning && audioInputMode === 'mic-system',
    language: interviewLangs,
    provider: setup.aiProvider,
    transcribeProvider: setup.sttProvider,
    onTranscriptChange: handleTranscriptUpdate,
    onFinalSegment: handleFinalSegment,
  });

  const transcript = audioInputMode === 'mic-system'
    ? dualAudioTranscript.transcript
    : webSpeechTranscript.transcript;
  const isListening = audioInputMode === 'mic-system'
    ? dualAudioTranscript.isListening
    : webSpeechTranscript.isListening;
  const transcriptError = audioInputMode === 'mic-system'
    ? dualAudioTranscript.error
    : webSpeechTranscript.error;
  const activeLanguage = audioInputMode === 'mic-system'
    ? dualAudioTranscript.activeLanguage
    : webSpeechTranscript.activeLanguage;

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

  const handleToggle = () => {
    if (isRunning) {
      clearTimeout(detectionTimeoutRef.current);
      setIsRunning(false);
      cancelGeneration();
      pendingQuestionRef.current = null;
    } else {
      setIsRunning(true);
      clearAnswer();
      webSpeechTranscript.clearTranscript();
      dualAudioTranscript.clearTranscript();
      setTranscriptEntries([]);
      lastAutoAnswerRef.current = null;
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

      {(transcriptError || aiError) && (
        <div className="error-box">⚠️ {transcriptError || aiError}</div>
      )}

      {session.showTranscript && (isRunning || transcript) && (
        <div className="transcript-box">
          <div className="box-label-row">
            <span className="box-label">🎤 Transcript</span>
            <span className="transcript-lang-badge">
              Source: {audioInputMode === 'mic-system' ? 'Mic + System' : 'Mic only'} |{' '}
              STT: {setup.sttProvider || 'auto'} |{' '}
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
