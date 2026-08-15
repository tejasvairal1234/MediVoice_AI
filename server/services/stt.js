// server/services/stt.js
// Speech-to-Text using Groq Whisper API (in-memory, fast transcription)

const { OpenAI, toFile } = require('openai');

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

/**
 * Transcribe audio buffer using Groq Whisper (free + fast)
 * @param {Buffer} audioBuffer - Raw audio data
 * @param {string} language - Optional language hint ('en', 'hi', etc.)
 * @returns {{ text: string, language: string }}
 */
async function transcribeAudio(audioBuffer, language = null) {
  try {
    const file = await toFile(audioBuffer, 'speech.webm', { type: 'audio/webm' });

    const params = {
      file,
      model: 'whisper-large-v3-turbo',
      response_format: 'verbose_json',
    };

    if (language && language !== 'auto' && language !== 'en') {
      const code = language.split('-')[0];
      params.language = code;
    }

    const transcription = await groq.audio.transcriptions.create(params);

    return {
      text: transcription.text?.trim() || '',
      language: transcription.language || language || 'en',
    };
  } catch (err) {
    console.error('[STT] Transcribe error:', err.message);
    return { text: '', language: 'en' };
  }
}

module.exports = { transcribeAudio };
