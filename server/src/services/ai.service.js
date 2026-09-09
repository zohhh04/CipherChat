const OpenAI = require('openai');
const config = require('../config');

let client = null;

function getClient() {
  if (!config.ai.apiKey) return null;
  if (!client) {
    client = new OpenAI({ apiKey: config.ai.apiKey, baseURL: config.ai.baseURL });
  }
  return client;
}

function requireClient() {
  const c = getClient();
  if (!c) throw new Error('AI service not configured. Set GEMINI_API_KEY.');
  return c;
}

async function summarize(messages, style = 'brief') {
  const openai = requireClient();

  const messageText = messages
    .map((m) => `[${m.sender || 'User'}]: ${m.text}`)
    .join('\n');

  const stylePrompts = {
    brief: 'Provide a brief 2-3 sentence summary of the conversation.',
    detailed: 'Provide a detailed summary with key points, decisions, and action items.',
    bullets: 'Summarize as a bulleted list of key points.',
  };

  const response = await openai.chat.completions.create({
    model: config.ai.model,
    max_tokens: config.ai.maxTokens,
    messages: [
      {
        role: 'system',
        content: `You are a helpful chat summarizer. ${stylePrompts[style] || stylePrompts.brief} Be concise and factual.`,
      },
      {
        role: 'user',
        content: `Summarize this conversation:\n\n${messageText}`,
      },
    ],
  });

  return response.choices[0]?.message?.content || 'No summary generated.';
}

async function smartReplies(messages, context = '') {
  const openai = requireClient();

  const recentMessages = messages.slice(-10);
  const messageText = recentMessages
    .map((m) => `[${m.sender || 'User'}]: ${m.text}`)
    .join('\n');

  const response = await openai.chat.completions.create({
    model: config.ai.model,
    max_tokens: 200,
    messages: [
      {
        role: 'system',
        content: `You are a smart reply assistant. Given the recent messages in a chat, suggest 3-5 short, contextual reply options the user might want to send. Return ONLY a JSON array of strings, no explanation, no markdown. Replies should be natural, varied in tone (casual, friendly, professional), and relevant to the conversation context.${context ? `\nAdditional context: ${context}` : ''}`,
      },
      {
        role: 'user',
        content: `Recent messages:\n${messageText}\n\nReturn ONLY a JSON array like ["reply1", "reply2", "reply3"]. No other text.`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content || '[]';
  try {
    const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.slice(0, 5);
    if (parsed.replies && Array.isArray(parsed.replies)) return parsed.replies.slice(0, 5);
    return [];
  } catch {
    return [];
  }
}

async function translate(text, targetLang = 'en') {
  const openai = requireClient();

  const langNames = {
    en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', ru: 'Russian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
    ar: 'Arabic', hi: 'Hindi', nl: 'Dutch', sv: 'Swedish', pl: 'Polish',
    tr: 'Turkish', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian', uk: 'Ukrainian',
  };

  const response = await openai.chat.completions.create({
    model: config.ai.model,
    max_tokens: config.ai.maxTokens,
    messages: [
      {
        role: 'system',
        content: `You are a professional translator. Translate the user's text to ${langNames[targetLang] || targetLang}. Return ONLY the translated text, no explanations or notes. Preserve the original tone and meaning.`,
      },
      {
        role: 'user',
        content: text,
      },
    ],
  });

  return response.choices[0]?.message?.content || text;
}

async function transcribeAudio(audioBuffer, filename = 'audio.webm', language = null) {
  const openai = requireClient();

  const base64 = Buffer.from(audioBuffer).toString('base64');
  const mimeType = filename.endsWith('.mp3') ? 'audio/mp3' : filename.endsWith('.wav') ? 'audio/wav' : 'audio/webm';

  const response = await openai.chat.completions.create({
    model: config.ai.model,
    max_tokens: config.ai.maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Transcribe this audio${language ? ` (language: ${language})` : ''}. Return ONLY the transcribed text, no explanations.`,
          },
          {
            type: 'input_audio',
            input_audio: { data: base64, format: filename.split('.').pop() || 'webm' },
          },
        ],
      },
    ],
  });

  return response.choices[0]?.message?.content || '';
}

async function detectUrgency(messages) {
  const openai = getClient();
  if (!openai) return { urgency: 'normal', confidence: 0.5 };

  const messageText = messages
    .map((m) => `[${m.sender || 'User'}]: ${m.text}`)
    .join('\n');

  const response = await openai.chat.completions.create({
    model: config.ai.model,
    max_tokens: 100,
    messages: [
      {
        role: 'system',
        content: `You are a notification urgency classifier. Analyze the messages and determine urgency level. Return ONLY a JSON object with:
- "urgency": one of "critical", "high", "normal", "low"
- "confidence": a number 0-1
- "reason": brief explanation

Classify as:
- critical: emergencies, urgent deadlines, system outages, security issues
- high: important work requests, time-sensitive matters, direct questions needing immediate response
- normal: regular conversation, casual messages, general questions
- low: FYI messages, casual chat, non-urgent updates

Return ONLY the JSON object, no other text.`,
      },
      {
        role: 'user',
        content: `Analyze these messages for notification urgency:\n\n${messageText}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content || '{}';
  try {
    const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      urgency: parsed.urgency || 'normal',
      confidence: parsed.confidence || 0.5,
      reason: parsed.reason || '',
    };
  } catch {
    return { urgency: 'normal', confidence: 0.5, reason: '' };
  }
}

module.exports = { summarize, smartReplies, translate, transcribeAudio, detectUrgency };
