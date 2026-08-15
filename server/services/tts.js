// server/services/tts.js
// Universal Free Neural Text-to-Speech (Hindi, English, Spanish, French, German, and 100+ languages)

const googleTTS = require('google-tts-api');

/**
 * Accurately detect language code from text content/script
 * @param {string} text
 * @returns {string} ISO language code
 */
function detectLanguage(text) {
  if (!text) return 'en';

  // Distinct Indian Scripts
  if (/[\u0980-\u09FF]/.test(text)) return 'bn'; // Bengali
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta'; // Tamil
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te'; // Telugu
  if (/[\u0A80-\u0AFF]/.test(text)) return 'gu'; // Gujarati
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn'; // Kannada
  if (/[\u0D00-\u0D7F]/.test(text)) return 'ml'; // Malayalam
  if (/[\u0A00-\u0A7F]/.test(text)) return 'pa'; // Punjabi
  if (/[\u0600-\u06FF]/.test(text)) return 'ur'; // Urdu / Arabic

  // Devanagari script (distinguish Marathi vs Hindi)
  if (/[\u0900-\u097F]/.test(text)) {
    if (/\b(आहे|नाही|मला|काय|कसे|दुखत|झाले|झाला|आहोत|होते|करा|येत|सांगा|घ्या)\b/.test(text)) {
      return 'mr'; // Marathi
    }
    return 'hi'; // Hindi
  }

  // CJK and Cyrillic
  if (/[\u4e00-\u9fa5]/.test(text)) return 'zh-CN'; // Chinese
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';    // Japanese
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';    // Russian

  // European languages with distinct characters
  if (/[áéíóúñ¿¡]/i.test(text)) return 'es'; // Spanish
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(text)) return 'fr'; // French
  if (/[äöüß]/i.test(text)) return 'de'; // German
  if (/[ãõâêîôû]/i.test(text)) return 'pt'; // Portuguese

  return 'en';
}

/**
 * Synthesize speech audio from text using high quality neural voice stream
 * @param {string} text - Text to synthesize
 * @param {string|null} langHint - Optional language override
 * @returns {Promise<Buffer>} MP3 Audio Buffer
 */
async function synthesizeSpeech(text, langHint = null) {
  if (!text || !text.trim()) return null;

  try {
    const lang = langHint || detectLanguage(text);

    // Get all audio chunks (handles any text length gracefully)
    const results = await googleTTS.getAllAudioBase64(text.trim(), {
      lang,
      slow: false,
      host: 'https://translate.google.com',
      timeout: 3000,
    });

    if (!results || results.length === 0) return null;

    const buffers = results.map(r => Buffer.from(r.base64, 'base64'));
    return Buffer.concat(buffers);
  } catch (err) {
    console.error('[TTS] Error generating speech:', err.message);
    return null;
  }
}

module.exports = { synthesizeSpeech, detectLanguage };
