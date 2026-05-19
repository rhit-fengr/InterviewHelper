import React, { useEffect, useState } from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import { AI_PROVIDERS, TOPICS, LANGUAGES, MIC_PROVIDERS, SYSTEM_PROVIDERS } from '../../constants';
import './InterviewSetup.css';

export default function InterviewSetup({ onStart, onAuth }) {
  const { setup, updateSetup, auth } = useInterviewStore();
  const isAuthenticated = !!auth.token && !!auth.user;
  const isWindowsRuntime = typeof navigator !== 'undefined' && /win/i.test(String(navigator.platform || ''));
  const selectedProvider = setup.aiProvider || 'openai';
  const autoHideWindowsLiveCaptions = setup.autoHideWindowsLiveCaptions === true;
  const windowsLiveCaptionsMicrophoneAssist = setup.windowsLiveCaptionsMicrophoneAssist === true;
  const micProvider = setup.micProvider || 'webspeech';
  const systemProvider = setup.systemProvider || 'windows-live-captions';
  // Support legacy single-value migration: ensure interviewLangs is always an array
  const interviewLangs = Array.isArray(setup.interviewLangs)
    ? setup.interviewLangs
    : [setup.interviewLang || 'en-US'];

  useEffect(() => {
    if (!setup.aiProvider) {
      updateSetup({ aiProvider: 'openai' });
    }
  }, [setup.aiProvider, updateSetup]);

  useEffect(() => {
    if (!isWindowsRuntime && systemProvider === 'windows-live-captions') {
      updateSetup({ systemProvider: 'openai' });
    }
  }, [isWindowsRuntime, systemProvider, updateSetup]);

  const handleChange = (field) => (e) => updateSetup({ [field]: e.target.value });

  const showWindowsLiveCaptionsControls = (
    isWindowsRuntime
    && (
    systemProvider === 'windows-live-captions'
    || windowsLiveCaptionsMicrophoneAssist
    )
  );

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
        <label className="form-label" htmlFor="setup-mic-provider">Microphone Provider</label>
        <select
          id="setup-mic-provider"
          className="form-select"
          value={micProvider}
          onChange={handleChange('micProvider')}
        >
          {MIC_PROVIDERS.map((provider) => (
            <option key={provider.value} value={provider.value}>{provider.label}</option>
          ))}
        </select>
        <p className="setup-note">
          Browser Speech keeps the candidate microphone route separate from system captions and is the default mic path.
        </p>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="setup-system-provider">System Audio Provider</label>
        <select
          id="setup-system-provider"
          className="form-select"
          value={systemProvider}
          onChange={handleChange('systemProvider')}
        >
          {SYSTEM_PROVIDERS.map((provider) => (
            <option
              key={provider.value}
              value={provider.value}
              disabled={provider.value === 'windows-live-captions' && !isWindowsRuntime}
            >
              {provider.value === 'windows-live-captions' && !isWindowsRuntime
                ? 'Windows Live Captions (Windows only)'
                : provider.label}
            </option>
          ))}
        </select>
        <p className="setup-note">
          {isWindowsRuntime
            ? 'Windows Live Captions is best-effort on Windows 11 and depends on the OS accessibility layer, not an official transcript API.'
            : 'Windows Live Captions is unavailable on this OS. On Mac, use Browser Speech for mic and a cloud or local provider for system audio.'}
        </p>
      </div>

      {showWindowsLiveCaptionsControls && (
        <div className="form-group windows-live-captions-group">
          <div className="form-label">Windows Live Captions</div>
          <div className="advanced-caption-options">
            <label className="checkbox-row checkbox-row--stacked">
              <input
                type="checkbox"
                checked={autoHideWindowsLiveCaptions}
                onChange={(e) => updateSetup({ autoHideWindowsLiveCaptions: e.target.checked })}
              />
              <div>
                <div className="checkbox-row-title">Auto-hide after captions start</div>
                <div className="checkbox-row-copy">Decide this before Listening starts. If hiding fails, capture should continue.</div>
              </div>
            </label>
            <label className="checkbox-row checkbox-row--stacked">
              <input
                type="checkbox"
                checked={windowsLiveCaptionsMicrophoneAssist}
                onChange={(e) => updateSetup({ windowsLiveCaptionsMicrophoneAssist: e.target.checked })}
              />
              <div>
                <div className="checkbox-row-title">Use microphone assist</div>
                <div className="checkbox-row-copy">Experimental / Compatibility. Keeps the native mic route separate and only tries to help Windows captions.</div>
              </div>
            </label>
          </div>
        </div>
      )}

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
