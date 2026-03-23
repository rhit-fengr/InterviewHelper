import React, { useState, useCallback } from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import {
  BEHAVIORAL_STRUCTURES,
  RESPONSE_STYLES,
  ANSWER_LENGTHS,
  DETECTION_SENSITIVITIES,
  MIC_PROVIDERS,
  SYSTEM_PROVIDERS,
} from '../../constants';
import { getProfile, updateProfile } from '../../utils/api';
import './MoreSettings.css';

export default function MoreSettings({ onBack }) {
  const {
    setup, updateSetup,
    personalInfo, updatePersonalInfo,
    answerSettings, updateAnswerSettings,
    displaySettings, updateDisplaySettings,
    advancedSettings, updateAdvancedSettings,
    auth,
  } = useInterviewStore();

  const isAuthenticated = !!auth.token && !!auth.user;
  const autoHideWindowsLiveCaptions = setup.autoHideWindowsLiveCaptions === true;
  const windowsLiveCaptionsMicrophoneAssist = setup.windowsLiveCaptionsMicrophoneAssist === true;
  const micProvider = setup.micProvider || 'webspeech';
  const systemProvider = setup.systemProvider || 'windows-live-captions';
  const showWindowsLiveCaptionsControls = (
    systemProvider === 'windows-live-captions'
    || windowsLiveCaptionsMicrophoneAssist
  );
  const [syncStatus, setSyncStatus] = useState(''); // '', 'pushing', 'pulling', 'push-ok', 'pull-ok', 'error'
  const [syncError, setSyncError] = useState('');

  const handleSyncUp = useCallback(async () => {
    setSyncStatus('pushing');
    setSyncError('');
    try {
      await updateProfile(auth.token, {
        name: personalInfo.fullName,
        personalInfo,
      });
      setSyncStatus('push-ok');
    } catch (err) {
      setSyncStatus('error');
      setSyncError(err.message || 'Failed to sync profile');
    }
  }, [auth.token, personalInfo]);

  const handlePullDown = useCallback(async () => {
    setSyncStatus('pulling');
    setSyncError('');
    try {
      const remote = await getProfile(auth.token);
      const merged = { ...(remote.personalInfo || {}) };
      if (remote.name) {
        merged.fullName = remote.name;
      }
      updatePersonalInfo(merged);
      setSyncStatus('pull-ok');
    } catch (err) {
      setSyncStatus('error');
      setSyncError(err.message || 'Failed to pull profile');
    }
  }, [auth.token, updatePersonalInfo]);

  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;
  const desktopOnlyDisabled = !isElectron;

  const handleOpacityChange = (e) => {
    const val = parseFloat(e.target.value);
    updateDisplaySettings({ windowOpacity: val });
    if (isElectron) window.electronAPI.setOpacity(val);
  };

  const handleHideFromScreenSharing = (e) => {
    const val = e.target.checked;
    updateAdvancedSettings({ hideFromScreenSharing: val });
    if (isElectron) window.electronAPI.setContentProtection(val);
  };

  const handleHideAppIcon = (e) => {
    const val = e.target.checked;
    updateAdvancedSettings({ hideAppIcon: val });
    if (isElectron) window.electronAPI.setSkipTaskbar(val);
  };

  const handleAlwaysOnTop = (e) => {
    const val = e.target.checked;
    updateDisplaySettings({ alwaysOnTop: val });
    if (isElectron) window.electronAPI.setAlwaysOnTop(val);
  };

  return (
    <div className="more-panel">
      <div className="panel-header">
        <button className="btn-back" onClick={onBack}>← Back</button>
        <h2 className="panel-title">More Settings</h2>
      </div>

      {desktopOnlyDisabled && (
        <div className="env-warning">
          Running in web preview (`localhost:3000`). Desktop-only settings are shown but currently disabled.
        </div>
      )}

      <section className="settings-section">
        <h3 className="section-title">Caption Capture</h3>

        <div className="form-group">
          <label className="form-label">Microphone Provider</label>
          <select
            className="form-select"
            value={micProvider}
            onChange={(e) => updateSetup({ micProvider: e.target.value })}
          >
            {MIC_PROVIDERS.map((provider) => (
              <option key={provider.value} value={provider.value}>{provider.label}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">System Audio Provider</label>
          <select
            className="form-select"
            value={systemProvider}
            onChange={(e) => updateSetup({ systemProvider: e.target.value })}
          >
            {SYSTEM_PROVIDERS.map((provider) => (
              <option key={provider.value} value={provider.value}>{provider.label}</option>
            ))}
          </select>
        </div>

        {showWindowsLiveCaptionsControls && (
          <>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={autoHideWindowsLiveCaptions}
                onChange={(e) => updateSetup({ autoHideWindowsLiveCaptions: e.target.checked })}
              />
              <div>
                <div className="checkbox-label">Auto-hide Windows Live Captions after text starts</div>
                <div className="checkbox-desc">Non-blocking preference. If hiding fails, listening should continue.</div>
              </div>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={windowsLiveCaptionsMicrophoneAssist}
                onChange={(e) => updateSetup({ windowsLiveCaptionsMicrophoneAssist: e.target.checked })}
              />
              <div>
                <div className="checkbox-label">Use Windows Live Captions microphone assist</div>
                <div className="checkbox-desc">Experimental / Compatibility only. Do not rely on it as the main mic path.</div>
              </div>
            </label>
          </>
        )}
      </section>

      {/* Personal Info */}
      <section className="settings-section">
        <h3 className="section-title">Personal Information</h3>
        {[
          { key: 'fullName', label: 'Full Name', placeholder: 'Jane Doe' },
          { key: 'currentRole', label: 'Current Role', placeholder: 'Senior Software Engineer' },
          { key: 'company', label: 'Company', placeholder: 'Google' },
          { key: 'yearsOfExperience', label: 'Years of Experience', placeholder: '5' },
          { key: 'skills', label: 'Key Skills', placeholder: 'React, Node.js, Python, AWS...' },
        ].map(({ key, label, placeholder }) => (
          <div className="form-group" key={key}>
            <label className="form-label">{label}</label>
            <input
              className="form-input"
              placeholder={placeholder}
              value={personalInfo[key]}
              onChange={(e) => updatePersonalInfo({ [key]: e.target.value })}
            />
          </div>
        ))}
        <div className="form-group">
          <label className="form-label">Work History</label>
          <textarea
            className="form-textarea"
            placeholder="Brief summary of your work history..."
            value={personalInfo.workHistory}
            onChange={(e) => updatePersonalInfo({ workHistory: e.target.value })}
            rows={3}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Education</label>
          <input
            className="form-input"
            placeholder="B.S. Computer Science, MIT"
            value={personalInfo.education}
            onChange={(e) => updatePersonalInfo({ education: e.target.value })}
          />
        </div>
      </section>

      {/* Profile Sync (authenticated only) */}
      {isAuthenticated && (
        <section className="settings-section sync-section">
          <h3 className="section-title">Profile Sync</h3>
          <p className="sync-hint">
            Sync your local profile with your server account ({auth.user.email}).
          </p>
          <div className="sync-actions">
            <button
              className="btn-secondary sync-btn"
              onClick={handleSyncUp}
              disabled={syncStatus === 'pushing' || syncStatus === 'pulling'}
            >
              {syncStatus === 'pushing' ? 'Syncing…' : 'Sync Profile to Server'}
            </button>
            <button
              className="btn-secondary sync-btn"
              onClick={handlePullDown}
              disabled={syncStatus === 'pushing' || syncStatus === 'pulling'}
            >
              {syncStatus === 'pulling' ? 'Pulling…' : 'Pull from Server'}
            </button>
          </div>
          {syncStatus === 'push-ok' && (
            <div className="sync-feedback sync-feedback--success">Profile synced to server.</div>
          )}
          {syncStatus === 'pull-ok' && (
            <div className="sync-feedback sync-feedback--success">Profile updated from server.</div>
          )}
          {syncStatus === 'error' && (
            <div className="sync-feedback sync-feedback--error">{syncError}</div>
          )}
        </section>
      )}

      {/* Answer Settings */}
      <section className="settings-section">
        <h3 className="section-title">Answer Settings</h3>

        <div className="form-group">
          <label className="form-label">Behavioral Structure</label>
          <div className="chip-group">
            {BEHAVIORAL_STRUCTURES.map((s) => (
              <button
                key={s}
                className={`chip ${answerSettings.behavioralStructure === s ? 'chip-active' : ''}`}
                onClick={() => updateAnswerSettings({ behavioralStructure: s })}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Response Style</label>
          <select
            className="form-select"
            value={answerSettings.responseStyle}
            onChange={(e) => updateAnswerSettings({ responseStyle: e.target.value })}
          >
            {RESPONSE_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Answer Length</label>
          <select
            className="form-select"
            value={answerSettings.answerLength}
            onChange={(e) => updateAnswerSettings({ answerLength: e.target.value })}
          >
            {ANSWER_LENGTHS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Question Detection Sensitivity</label>
          <select
            className="form-select"
            value={answerSettings.detectionSensitivity}
            onChange={(e) => updateAnswerSettings({ detectionSensitivity: e.target.value })}
          >
            {DETECTION_SENSITIVITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Conversation Memory ({answerSettings.memoryLimit} messages)</label>
          <input
            type="range"
            min={2}
            max={20}
            value={answerSettings.memoryLimit}
            onChange={(e) => updateAnswerSettings({ memoryLimit: parseInt(e.target.value) })}
            className="range-input"
          />
        </div>
      </section>

      {/* Display Settings */}
      <section className="settings-section">
        <h3 className="section-title">Display Settings</h3>

        <div className="form-group">
          <label className="form-label">Font Size ({displaySettings.fontSize}px)</label>
          <input
            type="range"
            min={10}
            max={20}
            value={displaySettings.fontSize}
            onChange={(e) => updateDisplaySettings({ fontSize: parseInt(e.target.value) })}
            className="range-input"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Window Opacity ({Math.round(displaySettings.windowOpacity * 100)}%)</label>
          <input
            type="range"
            min={0.3}
            max={1}
            step={0.05}
            value={displaySettings.windowOpacity}
            onChange={handleOpacityChange}
            className="range-input"
            disabled={desktopOnlyDisabled}
          />
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={displaySettings.alwaysOnTop}
            onChange={handleAlwaysOnTop}
            disabled={desktopOnlyDisabled}
          />
          <div>
            <div className="checkbox-label">Always On Top</div>
            <div className="checkbox-desc">Keep Interview AI Hamburger above other windows</div>
          </div>
        </label>
      </section>

      {/* Advanced Settings */}
      <section className="settings-section">
        <h3 className="section-title">Advanced Settings</h3>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={advancedSettings.hideFromScreenSharing}
            onChange={handleHideFromScreenSharing}
            disabled={desktopOnlyDisabled}
          />
          <div>
            <div className="checkbox-label">Hide from Screen Sharing</div>
            <div className="checkbox-desc">Prevents app from appearing in Zoom, Teams, OBS recordings</div>
          </div>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={advancedSettings.hideAppIcon}
            onChange={handleHideAppIcon}
            disabled={desktopOnlyDisabled}
          />
          <div>
            <div className="checkbox-label">Hide App Icon</div>
            <div className="checkbox-desc">Remove from taskbar/dock (Undetectable Mode)</div>
          </div>
        </label>
      </section>
    </div>
  );
}
