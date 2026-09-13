/* Gemini API adapter.
 *
 * Uses the Gemini REST API directly with an API key, keeping the same text-in / text-out
 * interface as the other adapters. No tools, no persistent sessions, no SDK dependency —
 * just a single generateContent call that returns the model's text response. */

const OUTPUT_CAP = 4 * 1024 * 1024;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM_PROMPT = [
  'You are the openGym Coach.',
  'Answer only the supplied task and return exactly the requested JSON.',
  'You have no tools, filesystem access, external services, or persistent memory.'
].join(' ');

export default {
  id: 'gemini',
  runtime: 'Google Gemini API',

  async check(cfg, env) {
    if (!env.GEMINI_API_KEY) return { ok: false, error: 'no Gemini API key configured' };
    return { ok: true, version: 'Gemini API' };
  },

  async invoke({ prompt, jobDir, env, model, timeoutMs }) {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return { code: -1, text: '', stderr: 'no Gemini API key', timedOut: false, spawnError: true };
    }

    const modelId = model || DEFAULT_MODEL;
    const url = `${API_BASE}/${modelId}:generateContent?key=${apiKey}`;

    const body = JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.2
      }
    });

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: abortController.signal
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const errMsg = errBody.slice(0, 500) || `HTTP ${res.status}`;
        return { code: 1, text: '', stderr: errMsg, timedOut: false, spawnError: false };
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts
        ?.map(p => p.text || '')
        .join('')
        .trim()
        .slice(0, OUTPUT_CAP) || '';

      if (!text) {
        const reason = data?.candidates?.[0]?.finishReason;
        return {
          code: 1, text: '',
          stderr: reason ? `Gemini returned no text (finishReason: ${reason})` : 'Gemini returned no text',
          timedOut: false, spawnError: false
        };
      }

      return { code: 0, text, stderr: '', timedOut: false, spawnError: false };
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        return { code: -1, text: '', stderr: 'Gemini API request timed out', timedOut: true, spawnError: false };
      }
      return {
        code: -1, text: '',
        stderr: e instanceof Error ? e.message : String(e),
        timedOut: false, spawnError: true
      };
    }
  }
};
