'use strict';

const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'placeholder' });

const TOKEN_LIMITS = {
  short: 200,
  medium: 500,
  long: 1000,
};

/**
 * Build a system prompt personalised for the candidate.
 */
function buildSystemPrompt(personalInfo = {}, answerSettings = {}, setup = {}) {
  return `You are an expert interview coach helping ${personalInfo.fullName || 'the candidate'} in a ${setup.topic || 'general'} interview.

Candidate Profile:
- Role: ${personalInfo.currentRole || 'Not specified'}
- Company: ${personalInfo.company || 'Not specified'}
- Experience: ${personalInfo.yearsOfExperience || 'Not specified'} years
- Skills: ${personalInfo.skills || 'Not specified'}
- Work History: ${personalInfo.workHistory || 'Not specified'}
- Education: ${personalInfo.education || 'Not specified'}

Answer Settings:
- Structure: ${answerSettings.behavioralStructure || 'STAR'} (use for behavioral questions)
- Style: ${answerSettings.responseStyle || 'conversational'}
- Length: ${answerSettings.answerLength || 'medium'}
- Answer Language: ${setup.answerLang || 'en-US'}

Additional Context: ${setup.customInstructions || 'None'}

Respond naturally as if the candidate is speaking. Do not mention you are an AI. Keep answers focused and well-structured.`.trim();
}

/**
 * Generate a streaming AI answer for the given question.
 * Returns an OpenAI stream object.
 */
async function generateAnswer({ question, personalInfo, answerSettings, setup, conversationHistory = [] }) {
  const systemPrompt = buildSystemPrompt(personalInfo, answerSettings, setup);
  const maxTokens = TOKEN_LIMITS[answerSettings?.answerLength] || TOKEN_LIMITS.medium;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-(answerSettings?.memoryLimit || 10)),
    { role: 'user', content: question },
  ];

  const stream = await client.chat.completions.create({
    model: 'gpt-4o',
    messages,
    stream: true,
    max_tokens: maxTokens,
  });

  return stream;
}

/**
 * Detect whether a transcript contains an interview question.
 * Returns { isQuestion: boolean, question: string|null }
 */
async function detectQuestion(transcript, sensitivity = 'medium') {
  const sensitivityPrompts = {
    low: 'Only return true if there is a very clear, explicit question with a question mark.',
    medium: 'Return true for clear questions and reasonably implied questions.',
    high: 'Return true for explicit questions, implicit questions, and subtle prompts like "tell me about..." or "walk me through..."',
  };

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: `Transcript: "${transcript}"\n\n${sensitivityPrompts[sensitivity] || sensitivityPrompts.medium}\n\nIs this an interview question? Respond with JSON only: {"isQuestion": boolean, "question": "extracted question or null"}`,
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 150,
  });

  return JSON.parse(response.choices[0].message.content);
}

module.exports = { generateAnswer, detectQuestion, buildSystemPrompt };
