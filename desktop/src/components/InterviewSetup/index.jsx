import React from 'react';
import { useInterviewStore } from '../../store/interviewStore';
import './InterviewSetup.css';

const TOPICS = [
  { value: 'software-engineering', label: 'Software Engineering' },
  { value: 'behavioral', label: 'Behavioral' },
  { value: 'system-design', label: 'System Design' },
  { value: 'data-structures', label: 'Data Structures & Algorithms' },
  { value: 'product-management', label: 'Product Management' },
  { value: 'data-science', label: 'Data Science' },
  { value: 'finance', label: 'Finance' },
  { value: 'general', label: 'General' },
];

const LANGUAGES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'zh-CN', label: 'Chinese (Mandarin)' },
  { value: 'zh-TW', label: 'Chinese (Traditional)' },
  { value: 'es-ES', label: 'Spanish' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'ko-KR', label: 'Korean' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'ar-SA', label: 'Arabic' },
];

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
