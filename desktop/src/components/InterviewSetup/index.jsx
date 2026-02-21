import React from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import { TOPICS, LANGUAGES } from '../../constants';
import './InterviewSetup.css';

export default function InterviewSetup({ onStart }) {
  const { setup, updateSetup } = useInterviewStore();

  const handleChange = (field) => (e) => updateSetup({ [field]: e.target.value });

  return (
    <div className="setup-panel">
      <h2 className="setup-title">Interview Setup</h2>
      <p className="setup-subtitle">Configure your interview preferences below.</p>

      <div className="form-group">
        <label className="form-label">Topic</label>
        <select className="form-select" value={setup.topic} onChange={handleChange('topic')}>
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Interview Language</label>
        <select className="form-select" value={setup.interviewLang} onChange={handleChange('interviewLang')}>
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
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
