import React, { useEffect } from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import { AI_PROVIDERS, TOPICS, LANGUAGES } from '../../constants';
import './InterviewSetup.css';

export default function InterviewSetup({ onStart }) {
  const { setup, updateSetup } = useInterviewStore();
  const selectedProvider = setup.aiProvider || 'openai';
  // Support legacy single-value migration: ensure interviewLangs is always an array
  const interviewLangs = Array.isArray(setup.interviewLangs)
    ? setup.interviewLangs
    : [setup.interviewLang || 'en-US'];

  useEffect(() => {
    if (!setup.aiProvider) {
      updateSetup({ aiProvider: 'openai' });
    }
  }, [setup.aiProvider, updateSetup]);

  const handleChange = (field) => (e) => updateSetup({ [field]: e.target.value });

  const handleInterviewLangToggle = (langValue) => {
    const current = interviewLangs;
    if (current.includes(langValue)) {
      // Prevent deselecting the last language
      if (current.length === 1) return;
      updateSetup({ interviewLangs: current.filter((l) => l !== langValue) });
    } else {
      updateSetup({ interviewLangs: [...current, langValue] });
    }
  };

  return (
    <div className="setup-panel">
      <h2 className="setup-title">Interview Setup</h2>
      <p className="setup-subtitle">Configure your interview preferences below.</p>

      <div className="form-group">
        <label className="form-label">AI Provider</label>
        <select className="form-select" value={selectedProvider} onChange={handleChange('aiProvider')}>
          {AI_PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Transcription Provider</label>
        <select
          className="form-select"
          value={setup.sttProvider || 'auto'}
          onChange={handleChange('sttProvider')}
        >
          <option value="auto">Auto (OpenAI -> Local -> Gemini)</option>
          <option value="local">Local Whisper Service (no cloud)</option>
          <option value="openai">OpenAI (Whisper)</option>
          <option value="gemini">Gemini (best effort)</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Topic</label>
        <select className="form-select" value={setup.topic} onChange={handleChange('topic')}>
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">
          Interview Language <span className="form-label-hint">(select one or more)</span>
        </label>
        <div className="lang-checkbox-grid">
          {LANGUAGES.map((l) => {
            const isOnlySelected = interviewLangs.includes(l.value) && interviewLangs.length === 1;
            return (
              <label
                key={l.value}
                className={`lang-checkbox-item${isOnlySelected ? ' lang-checkbox-item--locked' : ''}`}
                title={isOnlySelected ? 'At least one language must be selected' : ''}
              >
                <input
                  type="checkbox"
                  checked={interviewLangs.includes(l.value)}
                  onChange={() => handleInterviewLangToggle(l.value)}
                />
                <span>{l.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Answer Language</label>
        <select className="form-select" value={setup.answerLang} onChange={handleChange('answerLang')}>
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Additional Instructions</label>
        <textarea
          className="form-textarea"
          placeholder="Tell us about yourself or add special instructions (e.g. 'I am a senior engineer at Google with 8 years of experience...')"
          value={setup.customInstructions}
          onChange={handleChange('customInstructions')}
          rows={4}
        />
      </div>

      <button className="btn-primary" onClick={onStart}>
        Continue to Session Settings →
      </button>
    </div>
  );
}
