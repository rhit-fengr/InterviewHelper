import React from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import './MoreSettings.css';

const STRUCTURES = ['STAR', 'CAR', 'PAR', 'SOAR'];
const STYLES = [
  { value: 'conversational', label: 'Conversational' },
  { value: 'structured', label: 'Structured' },
  { value: 'concise', label: 'Concise' },
  { value: 'detailed', label: 'Detailed' },
];
const LENGTHS = [
  { value: 'short', label: 'Short (~30s)' },
  { value: 'medium', label: 'Medium (~1min)' },
  { value: 'long', label: 'Long (~2min)' },
];
const SENSITIVITIES = [
  { value: 'low', label: 'Low — explicit questions only' },
  { value: 'medium', label: 'Medium — clear + implied questions' },
  { value: 'high', label: 'High — any prompt/statement' },
];

export default function MoreSettings({ onBack }) {
  const {
    personalInfo, updatePersonalInfo,
    answerSettings, updateAnswerSettings,
    displaySettings, updateDisplaySettings,
    advancedSettings, updateAdvancedSettings,
  } = useInterviewStore();

  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

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

  return (
    <div className="more-panel">
      <div className="panel-header">
        <button className="btn-back" onClick={onBack}>← Back</button>
        <h2 className="panel-title">More Settings</h2>
      </div>

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

      {/* Answer Settings */}
      <section className="settings-section">
        <h3 className="section-title">Answer Settings</h3>

        <div className="form-group">
          <label className="form-label">Behavioral Structure</label>
          <div className="chip-group">
            {STRUCTURES.map((s) => (
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
            {STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Answer Length</label>
          <select
            className="form-select"
            value={answerSettings.answerLength}
            onChange={(e) => updateAnswerSettings({ answerLength: e.target.value })}
          >
            {LENGTHS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Question Detection Sensitivity</label>
          <select
            className="form-select"
            value={answerSettings.detectionSensitivity}
            onChange={(e) => updateAnswerSettings({ detectionSensitivity: e.target.value })}
          >
            {SENSITIVITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
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
          />
        </div>
      </section>

      {/* Advanced Settings */}
      <section className="settings-section">
        <h3 className="section-title">Advanced Settings</h3>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={advancedSettings.hideFromScreenSharing}
            onChange={handleHideFromScreenSharing}
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
