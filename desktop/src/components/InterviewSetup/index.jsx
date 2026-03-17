import React, { useEffect, useState } from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import { AI_PROVIDERS, TOPICS, LANGUAGES } from '../../constants';
import './InterviewSetup.css';

export default function InterviewSetup({ onStart, onAuth }) {
  const { setup, updateSetup, auth } = useInterviewStore();
  const isAuthenticated = !!auth.token && !!auth.user;
  const [showAdvancedCaptions, setShowAdvancedCaptions] = useState(false);
  const selectedProvider = setup.aiProvider || 'openai';
  const autoHideWindowsLiveCaptions = setup.autoHideWindowsLiveCaptions === true;
  const windowsLiveCaptionsIncludeMicrophoneAudio =
    setup.windowsLiveCaptionsIncludeMicrophoneAudio !== false;
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
      <h2 className="setup-title">Caption Mode Setup</h2>
      <p className="setup-subtitle">Choose the caption and answer settings you need right now.</p>

      <div className="form-group">
        <label className="form-label" htmlFor="setup-ai-provider">AI Provider</label>
        <select
          id="setup-ai-provider"
          className="form-select"
          value={selectedProvider}
          onChange={handleChange('aiProvider')}
        >
          {AI_PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="setup-stt-provider">Transcription Provider</label>
        <select
          id="setup-stt-provider"
          className="form-select"
          value={setup.sttProvider || 'auto'}
          onChange={handleChange('sttProvider')}
        >
          <option value="auto">Auto (OpenAI -> Local -> Gemini, then Windows Live Captions for system fallback)</option>
          <option value="windows-live-captions">Windows Live Captions (Windows 11 accessibility capture)</option>
          <option value="local">Local Whisper Service (no cloud)</option>
          <option value="openai">OpenAI (Whisper)</option>
          <option value="gemini">Gemini (best effort)</option>
        </select>
        <p className="setup-note">
          Windows Live Captions is best-effort on Windows 11 and depends on the OS accessibility layer, not an official transcript API.
        </p>
        <button
          type="button"
          className="btn-link"
          onClick={() => setShowAdvancedCaptions((prev) => !prev)}
        >
          {showAdvancedCaptions ? 'Hide Live Captions options' : 'Show Live Captions options'}
        </button>
        {showAdvancedCaptions && (
          <div className="advanced-caption-options">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={autoHideWindowsLiveCaptions}
                onChange={(e) => updateSetup({ autoHideWindowsLiveCaptions: e.target.checked })}
              />
              <span>Auto-hide Live Captions after text starts flowing (experimental)</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={windowsLiveCaptionsIncludeMicrophoneAudio}
                onChange={(e) => updateSetup({ windowsLiveCaptionsIncludeMicrophoneAudio: e.target.checked })}
              />
              <span>Try to enable “Include microphone audio” automatically</span>
            </label>
          </div>
        )}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="setup-topic">Topic</label>
        <select id="setup-topic" className="form-select" value={setup.topic} onChange={handleChange('topic')}>
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <div className="form-label" id="setup-interview-language-label">
          Interview Language <span className="form-label-hint">(select one or more)</span>
        </div>
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
        <label className="form-label" htmlFor="setup-answer-language">Answer Language</label>
        <select
          id="setup-answer-language"
          className="form-select"
          value={setup.answerLang}
          onChange={handleChange('answerLang')}
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="setup-custom-instructions">Additional Instructions</label>
        <textarea
          id="setup-custom-instructions"
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

      <button className="btn-auth-entry" onClick={onAuth}>
        {isAuthenticated
          ? `${auth.user.name || auth.user.email} · Account & Billing`
          : 'Sign In / Create Account'}
      </button>
    </div>
  );
}
