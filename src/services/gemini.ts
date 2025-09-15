import axios from 'axios';
import { env } from '@utils/env';
import { logger } from '@logger';

export interface GeminiStructuredCommand {
  type: string;
  [key: string]: any;
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Simple wrapper - adjust according to the official Gemini SDK if added later
export async function geminiInfer(prompt: string): Promise<GeminiStructuredCommand | null> {
  const model = env.GEMINI_MODEL;
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const systemInstruction = `You are a strict JSON command generator. Given a user instruction about treasury or bot actions, output ONLY a compact JSON object with the extracted intent.
Rules:
- No extra text.
- Keys must be camelCase.
- Monetary amounts: convert to integer cents in field valueInCents.
- Example input: "Enviar 100 reais para tesouraria" -> {"type":"send","valueInCents":10000}.
- If you cannot map, return {"type":"unknown"}.`;

  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [
      { role: 'user', parts: [{ text: prompt }] }
    ],
    generationConfig: { temperature: 0.2, maxOutputTokens: 256 }
  };

  try {
    const { data } = await axios.post(url, body, { headers: { 'Content-Type': 'application/json' } });
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return null;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      logger.warn({ raw: text }, 'Gemini JSON parse failed');
      return null;
    }
  } catch (err: any) {
    if (err.response) {
      logger.error({ status: err.response.status, data: err.response.data }, 'Gemini API error response');
    } else {
      logger.error({ err }, 'Gemini API request error');
    }
    return null;
  }
}
