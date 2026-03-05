import React from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import './SessionSettings.css';

function Toggle({ checked, onChange, label }) {
  const handleKeyDown = (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      onChange(!checked);
    }
  };

  return (
    <label className="toggle-row">
      <span className="toggle-label">{label}</span>
      <div
        className={`toggle ${checked ? 'toggle-on' : ''}`}
        role="switch"
        tabIndex={0}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        onKeyDown={handleKeyDown}
      >
        <div className="toggle-thumb" />
      </div>
    </label>
  );
}

export default function SessionSettings({ onStartInterview, onUndetectable, onMore, onBack }) {
  const { session, updateSession } = useInterviewStore();

  const toggle = (field) => (val) => updateSession({ [field]: val });
  const audioInputMode = session.audioInputMode || 'mic';

  return (
    <div className="session-panel">
      <div className="panel-header">
        <button className="btn-back" onClick={onBack}>← Back</button>
        <h2 className="panel-title">Session Settings</h2>
      </div>

      <div className="settings-group">
        <Toggle
          label="Auto Answer"
          checked={session.autoAnswer}
          onChange={toggle('autoAnswer')}
        />
        <Toggle
          label="Show Transcript"
          checked={session.showTranscript}
          onChange={toggle('showTranscript')}
        />
        <Toggle
          label="Show Translation"
          checked={session.showTranslation}
          onChange={toggle('showTranslation')}
        />
        <Toggle
          label="Show Custom Input"
          checked={session.showCustomInput}
          onChange={toggle('showCustomInput')}
        />

        <div className="audio-mode-row">
          <span className="audio-mode-label">Audio Source</span>
          <div className="audio-mode-actions">
            <button
              type="button"
              className={`audio-mode-btn ${audioInputMode === 'mic' ? 'audio-mode-btn-active' : ''}`}
              onClick={() => updateSession({ audioInputMode: 'mic' })}
            >
              Mic only
            </button>
            <button
              type="button"
              className={`audio-mode-btn ${audioInputMode === 'mic-system' ? 'audio-mode-btn-active' : ''}`}
              onClick={() => updateSession({ audioInputMode: 'mic-system' })}
            >
              Mic + System
            </button>
          </div>
          <p className="audio-mode-hint">
            Mic + System captures your microphone and meeting/system audio together.
          </p>
        </div>
      </div>

      <div className="action-group">
        <button className="btn-primary" onClick={onStartInterview}>
          🎙️ Start Interview (Standard)
        </button>
        <button className="btn-secondary" onClick={onUndetectable}>
          🫥 Undetectable Mode
        </button>
        <button className="btn-ghost" onClick={onMore}>
          ⚙️ More Settings
        </button>
      </div>
    </div>
  );
}
