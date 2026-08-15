// server/services/llm.js
// LLM service using Groq API (FREE tier) — OpenAI-compatible
// Models: llama-3.3-70b-versatile (smart), llama-3.1-8b-instant (faster)

const { OpenAI } = require('openai');

// Groq uses OpenAI SDK with a custom base URL
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const MODEL = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = `You are MediVoice, a compassionate and professional AI health screening assistant.
Your role is to conduct a structured but adaptive health screening call with a patient.

LANGUAGE FIDELITY RULES (CRITICAL - STRICT ADHERENCE REQUIRED):
1. DEFAULT LANGUAGE: Always start the call in English.
2. STRICT LANGUAGE MATCHING: Always respond in the EXACT SAME LANGUAGE the patient used in their latest message.
3. NEVER DEFAULT TO HINDI: Do NOT switch to Hindi unless the patient explicitly speaks Hindi (e.g. "मुझे बुखार है" or "mujhe bukhar hai").
4. If the patient speaks in English -> ALWAYS respond in English.
5. If the patient speaks in Marathi (e.g. "मला पोटात दुखत आहे" / "mala tras hoto") -> ALWAYS respond in Marathi (Devanagari script).
6. If the patient speaks in Bengali -> ALWAYS respond in Bengali (Bengali script).
7. If the patient speaks in Tamil -> ALWAYS respond in Tamil (Tamil script).
8. If the patient speaks in Telugu -> ALWAYS respond in Telugu (Telugu script).
9. If the patient speaks in Gujarati -> ALWAYS respond in Gujarati (Gujarati script).
10. If the patient speaks in Kannada, Malayalam, Punjabi, or Urdu -> ALWAYS respond in that respective language in its native script.
11. If the patient speaks in Spanish, French, German, Arabic, Russian, Chinese, Japanese, or Portuguese -> ALWAYS respond in that exact language.
12. If the patient message is short or ambiguous (e.g. "yes", "no", "ok", "hello") -> Maintain the current ongoing conversation language (default English).

BEHAVIOR GUIDELINES:
- Ask health screening questions ONE AT A TIME. Never ask multiple questions in a single turn.
- Be adaptive: if a user's answer is vague, ask a helpful clarifying follow-up before moving on.
- Track what has already been asked and answered – never repeat questions.
- Keep responses concise and conversational (2–3 sentences max per turn).
- Show empathy when the patient mentions pain, discomfort, or worry.
- NEVER provide formal medical diagnoses. Remind the user you are collecting intake information for their doctor.
- Speak naturally as if on a phone call. No bullet points, markdown symbols, or headers.

SCREENING TOPICS TO COVER (in this order, adapting as needed):
1. Patient's name (if not volunteered)
2. Main health concern or symptom
3. How long the symptom has been present (onset/duration)
4. Severity on a scale of 1–10
5. Whether the symptom is getting better, worse, or staying the same
6. Any associated symptoms (nausea, fever, dizziness, etc.)
7. Any relevant medical history or current medications (brief)
8. Ask if there's anything else they want to mention

CLOSING THE CALL:
When you have collected the necessary screening information (or when the patient indicates they are finished, have answered all questions, or says goodbye/thank you), provide a warm, reassuring closing message (e.g. "Thank you for providing these details. Your screening is now complete, and I will prepare your clinical health report. Take care!") AND append the exact tag [CALL_COMPLETED] at the very end of your response.`;

const REPORT_SYSTEM_PROMPT = `You are a medical documentation assistant.
Given a conversation history from a health screening call, generate a structured health report in JSON format.

The JSON must have this exact structure:
{
  "chiefComplaint": "string – the main symptom or concern in 1-2 sentences",
  "patientName": "string – patient name, or 'Not provided'",
  "symptomHistory": {
    "onset": "string – when symptoms started",
    "progression": "string – how symptoms changed over time",
    "associatedSymptoms": "string – other symptoms mentioned"
  },
  "severity": {
    "painLevel": number (0-10, or null if not mentioned),
    "trend": "improving" or "worsening" or "stable" or "unknown"
  },
  "duration": "string – how long the patient has had symptoms",
  "medicalHistory": "string – relevant history or medications, or 'None reported'",
  "aiFlags": ["array of strings – things worth following up on or urgent concerns"],
  "recommendedAction": "string – a non-diagnostic, general recommendation",
  "callQuality": "complete" or "partial" or "minimal",
  "language": "en" or "hi"
}

If the call was very short or incomplete, set callQuality to "partial" or "minimal" and use "Not collected" for missing fields.
Always return valid JSON only. No extra text outside the JSON.`;

/**
 * Get the opening greeting from the AI (Default in English)
 */
async function getGreeting() {
  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: '[SYSTEM: The call has just started. Give a warm, brief greeting in English (2 sentences max) introducing yourself as MediVoice AI and asking how you can help them today.]',
      },
    ],
    max_tokens: 150,
    temperature: 0.7,
  });
  return response.choices[0].message.content.trim();
}

/**
 * Get the next AI response in the screening conversation
 * @param {Array} history - Conversation history [{role, content}]
 * @param {string} userMessage - Latest user message
 */
async function getAIResponse(history, userMessage) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages,
    max_tokens: 120,
    temperature: 0.5,
  });

  const rawText = response.choices[0].message.content.trim();
  const isCallCompleted = rawText.includes('[CALL_COMPLETED]') ||
    /screening is (now )?complete|prepare your (clinical )?report|report has been generated|take care and goodbye/i.test(rawText);
  const cleanText = rawText.replace(/\[CALL_COMPLETED\]/g, '').trim();

  return {
    text: cleanText,
    isCompleted: isCallCompleted,
  };
}

/**
 * Generate a structured health report from the conversation history
 * @param {Array} history - Full conversation history [{role, content}]
 */
async function generateHealthReport(history) {
  if (!history || history.length === 0) {
    return {
      chiefComplaint: 'Call ended before any information was collected.',
      patientName: 'Not provided',
      symptomHistory: { onset: 'Not collected', progression: 'Not collected', associatedSymptoms: 'Not collected' },
      severity: { painLevel: null, trend: 'unknown' },
      duration: 'Not collected',
      medicalHistory: 'Not collected',
      aiFlags: [],
      recommendedAction: 'Please contact a healthcare provider for a proper evaluation.',
      callQuality: 'minimal',
      language: 'en',
    };
  }

  const conversationText = history
    .map((m) => `${m.role === 'assistant' ? 'AI' : 'Patient'}: ${m.content}`)
    .join('\n');

  try {
    const response = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Generate a health report from this conversation:\n\n${conversationText}\n\nReturn only valid JSON.`,
        },
      ],
      max_tokens: 800,
      temperature: 0.2,
      // Note: Groq doesn't support response_format: json_object on all models
      // We parse manually with fallback
    });

    const raw = response.choices[0].message.content.trim();
    // Extract JSON from the response (handle markdown code fences)
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ||
                      raw.match(/```\s*([\s\S]*?)```/) ||
                      [null, raw];
    const jsonStr = jsonMatch[1] || raw;
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error('Error generating report:', err.message);
    return {
      chiefComplaint: 'Report generation encountered an error. Please review the transcript.',
      patientName: 'Not provided',
      symptomHistory: { onset: 'See transcript', progression: 'See transcript', associatedSymptoms: 'See transcript' },
      severity: { painLevel: null, trend: 'unknown' },
      duration: 'See transcript',
      medicalHistory: 'See transcript',
      aiFlags: ['Manual review recommended'],
      recommendedAction: 'Please consult a healthcare provider.',
      callQuality: 'partial',
      language: 'en',
    };
  }
}

/**
 * Get a continuation greeting when a call is restarted/resumed
 * @param {Array} history - Previous conversation history [{role, content}]
 */
async function getContinuationGreeting(history) {
  if (!history || history.length === 0) {
    return getGreeting();
  }
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    {
      role: 'user',
      content: '[SYSTEM: The user has restarted/reconnected the call to continue this screening session. In 1 or 2 concise, supportive sentences, warmly acknowledge continuing where we left off and ask how to proceed or follow up on the last point discussed. Speak in the same language as the previous conversation. No markdown.]',
    },
  ];

  try {
    const response = await groq.chat.completions.create({
      model: MODEL,
      messages,
      max_tokens: 150,
      temperature: 0.7,
    });
    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('[LLM] Continuation greeting error:', err);
    return "Welcome back. Let's continue where we left off. What other details would you like to share?";
  }
}

module.exports = { getAIResponse, getGreeting, getContinuationGreeting, generateHealthReport };
