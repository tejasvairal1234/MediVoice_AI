// server/services/tts.js
// Universal Neural Text-to-Speech (Hindi, Marathi, English, Spanish, French, German, and 100+ languages)
// Uses Microsoft Edge Neural Voice API - 100% Free, No API Key, No Google dependency or rate limiting

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// Voice selection mapping
const VOICE_MAP = {
  'hi': 'hi-IN-SwaraNeural',
  'mr': 'mr-IN-AarohiNeural',
  'bn': 'bn-IN-TanishaaNeural',
  'ta': 'ta-IN-PallaviNeural',
  'te': 'te-IN-ShrutiNeural',
  'gu': 'gu-IN-DhwaniNeural',
  'kn': 'kn-IN-SapnaNeural',
  'ml': 'ml-IN-SobhanaNeural',
  'pa': 'pa-IN-GurpreetNeural',
  'ur': 'ur-PK-UzmaNeural',
  'es': 'es-ES-ElviraNeural',
  'fr': 'fr-FR-DeniseNeural',
  'de': 'de-DE-KatjaNeural',
  'zh': 'zh-CN-XiaoxiaoNeural',
  'ja': 'ja-JP-NanamiNeural',
  'en': 'en-US-AriaNeural',
};

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
  if (/[\u0600-\u06FF]/.test(text)) return 'ur'; // Urdu

  // Devanagari script (distinguish Marathi vs Hindi)
  if (/[\u0900-\u097F]/.test(text)) {
    if (/\b(आहे|नाही|काय|कसे|मला|तुम्हाला|झाले|होते|करा|सांगा|औषध|त्रास)\b/.test(text)) {
      return 'mr'; // Marathi
    }
    return 'hi'; // Hindi
  }

  // CJK
  if (/[\u4e00-\u9fa5]/.test(text)) return 'zh';
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';

  // European languages
  if (/[áéíóúüñ¿¡]/i.test(text)) return 'es';
  if (/[àâæçéèêëîïôœùûüÿ]/i.test(text)) return 'fr';
  if (/[äöüß]/i.test(text)) return 'de';

  return 'en';
}

/**
 * Synthesize speech audio from text using Microsoft Edge Neural TTS
 * @param {string} text - Text to synthesize
 * @param {string|null} langHint - Optional language override
 * @returns {Promise<Buffer|null>} MP3 Audio Buffer
 */
async function synthesizeSpeech(text, langHint = null) {
  if (!text || !text.trim()) return null;

  try {
    const cleanText = text.trim();
    const lang = (langHint || detectLanguage(cleanText)).toLowerCase().split('-')[0];
    const voiceName = VOICE_MAP[lang] || VOICE_MAP['en'];

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[TTS] Synthesis timeout after 5s');
        resolve(null);
      }, 5000);

      try {
        const { audioStream } = tts.toStream(cleanText);
        const chunks = [];

        audioStream.on('data', (chunk) => chunks.push(chunk));
        
        audioStream.on('close', () => {
          clearTimeout(timeout);
          const buffer = Buffer.concat(chunks);
          resolve(buffer.length > 0 ? buffer : null);
        });

        audioStream.on('error', (err) => {
          clearTimeout(timeout);
          console.error('[TTS] audioStream error:', err.message);
          resolve(null);
        });
      } catch (err) {
        clearTimeout(timeout);
        console.error('[TTS] toStream error:', err.message);
        resolve(null);
      }
    });
  } catch (err) {
    console.error('[TTS] General error:', err.message);
    return null;
  }
}

module.exports = { synthesizeSpeech, detectLanguage };
