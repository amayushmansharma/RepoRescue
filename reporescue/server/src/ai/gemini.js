/**
 * Minimal Gemini REST client — server-side only.
 *
 * Uses Node 24's built-in fetch. No SDK dependency.
 * API key is read exclusively from the environment and never leaves the server.
 *
 * Security notes:
 *  - GEMINI_API_KEY is never serialised into API responses or logs.
 *  - All scanned repository content is treated as untrusted data and wrapped in
 *    explicit user-turn delimiters so it cannot override system instructions.
 *  - The client validates model outputs before returning them.
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = "gemini-2.0-flash";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 1024;

/**
 * Returns true if a Gemini API key is configured in the environment.
 * Does not validate the key itself.
 */
export function geminiAvailable() {
  const key = process.env.GEMINI_API_KEY?.trim() ?? "";
  return key.length > 10;
}

/**
 * Sends a single-turn prompt to Gemini and returns the text response.
 *
 * @param {object} options
 * @param {string} options.systemInstruction  - The trusted system prompt.
 * @param {string} options.userContent        - The (potentially untrusted) user turn.
 * @returns {Promise<string>}
 */
export async function geminiGenerate({ systemInstruction, userContent }) {
  const key = process.env.GEMINI_API_KEY?.trim() ?? "";
  if (!key || key.length <= 10) {
    throw new GeminiUnavailableError("GEMINI_API_KEY is not configured.");
  }

  const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${key}`;

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: userContent }] }],
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.3,
      candidateCount: 1,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new GeminiUnavailableError("Gemini request timed out.");
    }
    throw new GeminiUnavailableError(`Gemini request failed: ${error?.message ?? "network error"}`);
  }

  if (response.status === 429) throw new GeminiRateLimitError("Gemini rate limit reached. Try again shortly.");
  if (response.status === 401 || response.status === 403) throw new GeminiUnavailableError("Gemini API key is invalid or lacks permission.");
  if (!response.ok) {
    const rawText = await response.text().catch(() => "");
    const safeText = rawText.replace(/key=[^&\s"']+/gi, "key=[REDACTED]").replaceAll(key, "[REDACTED]");
    throw new GeminiUnavailableError(`Gemini returned HTTP ${response.status}: ${safeText.slice(0, 200)}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new GeminiUnavailableError("Gemini response was not valid JSON.");
  }

  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    // Blocked or empty response — fall through to caller to use deterministic text.
    throw new GeminiUnavailableError("Gemini returned an empty or blocked response.");
  }

  return text.trim();
}

export class GeminiUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "GeminiUnavailableError";
    this.code = "AI_UNAVAILABLE";
  }
}

export class GeminiRateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "GeminiRateLimitError";
    this.code = "AI_RATE_LIMITED";
  }
}
