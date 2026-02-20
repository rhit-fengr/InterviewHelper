import React, { useState, useEffect, useCallback } from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import { useSocketSync } from '../../hooks/useSocketSync';
import { useAIAnswer } from '../../hooks/useAIAnswer';
import { useTranscript } from '../../hooks/useTranscript';
import './UndetectableMode.css';

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

  const {
    isConnected,
    clientConnected,
    createSession,
    streamAnswerChunk,
    streamTranscript,
  } = useSocketSync({ role: 'host' });

  const { answer, isLoading, generateAnswer } = useAIAnswer();

  const { transcript } = useTranscript({
    enabled: isRunning,
    language: setup.interviewLang,
    onTranscriptChange: useCallback((text) => {
      if (clientConnected) streamTranscript(sessionCode, text);
    }, [clientConnected, sessionCode, streamTranscript]),
  });

  // Register the session with the server once socket connects
  useEffect(() => {
    if (isConnected) {
      createSession(sessionCode);
    }
  }, [isConnected, createSession, sessionCode]);

  // Stream answer chunks to connected mobile client
  useEffect(() => {
    if (!clientConnected || !answer) return;
    streamAnswerChunk(sessionCode, answer, !isLoading);
  }, [answer, isLoading, clientConnected, sessionCode, streamAnswerChunk]);

  const handleStartStop = () => {
    setIsRunning((prev) => !prev);
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

  const handleAskQuestion = async (question) => {
    if (!question.trim()) return;
    await generateAnswer({ question, personalInfo, answerSettings, setup, conversationHistory });
    setConversationHistory((prev) => [
      ...prev.slice(-answerSettings.memoryLimit),
      { role: 'user', content: question },
    ]);
  };

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
            <li>Open Interview Hammer on your mobile device</li>
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
          {isRunning ? '⏹ Stop' : '🎙️ Start Listening'}
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
      {isRunning && transcript && (
        <div className="transcript-preview">
          <span className="box-label">🎤 Live</span>
          <p className="transcript-text">{transcript}</p>
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
