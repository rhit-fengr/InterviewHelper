import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import { useTranscript } from '../../hooks/useTranscript';
import { useAIAnswer } from '../../hooks/useAIAnswer';
import './StandardMode.css';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:4000';

export default function StandardMode({ onBack }) {
  const { setup, session, personalInfo, answerSettings, displaySettings } = useInterviewStore();
  const [isRunning, setIsRunning] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [conversationHistory, setConversationHistory] = useState([]);
  const [lastQuestion, setLastQuestion] = useState('');
  const detectionTimeoutRef = useRef(null);
  const lastDetectedAtRef = useRef(0);

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

  const triggerAnswerGeneration = useCallback((question) => {
    const currentHistory = conversationHistoryRef.current;
    const currentSettings = answerSettingsRef.current;
    generateAnswer({
      question,
      personalInfo: personalInfoRef.current,
      answerSettings: currentSettings,
      setup: setupRef.current,
      conversationHistory: currentHistory,
    }).then(() => {
      setConversationHistory((prev) => [
        ...prev.slice(-currentSettings.memoryLimit),
        { role: 'user', content: question },
      ]);
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
        body: JSON.stringify({ transcript: text, sensitivity: answerSettingsRef.current.detectionSensitivity }),
      });
      const data = await res.json();
      if (data.isQuestion && data.question) {
        lastDetectedAtRef.current = Date.now();
        setLastQuestion(data.question);
        triggerAnswerGeneration(data.question);
      }
    } catch {
      // Network error — skip detection
    }
  }, [triggerAnswerGeneration]);

  const handleTranscriptUpdate = useCallback((text) => {
    if (!sessionRef.current.autoAnswer) return;
    clearTimeout(detectionTimeoutRef.current);
    // Debounce question detection — wait 1.5s of silence before checking
    detectionTimeoutRef.current = setTimeout(() => {
      runQuestionDetection(text);
    }, 1500);
  }, [runQuestionDetection]);

  const { transcript, isListening, error: transcriptError, clearTranscript } = useTranscript({
    enabled: isRunning && session.showTranscript,
    language: setup.interviewLang,
    onTranscriptChange: handleTranscriptUpdate,
  });

  const handleCustomSubmit = (e) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    triggerAnswerGeneration(customInput.trim());
    setCustomInput('');
  };

  const handleToggle = () => {
    if (isRunning) {
      setIsRunning(false);
      cancelGeneration();
    } else {
      setIsRunning(true);
      clearAnswer();
      clearTranscript();
    }
  };


  useEffect(() => {
    return () => clearTimeout(detectionTimeoutRef.current);
  }, []);

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
          <button className="btn-clear" onClick={() => { clearAnswer(); clearTranscript(); }}>
            Clear
          </button>
        )}
      </div>

      {(transcriptError || aiError) && (
        <div className="error-box">⚠️ {transcriptError || aiError}</div>
      )}

      {session.showTranscript && transcript && (
        <div className="transcript-box">
          <div className="box-label">🎤 Transcript</div>
          <p className="transcript-text">{transcript}</p>
        </div>
      )}

      {lastQuestion && (
        <div className="question-box">
          <div className="box-label">❓ Detected Question</div>
          <p className="question-text">{lastQuestion}</p>
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
