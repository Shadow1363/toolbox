/**
 * Ask Claude from the browser with the user's own Anthropic API key (no backend). Shared by tools that offer
 * an optional AI step (Scrolling Playlist's "Auto-build"; the Auto Editor can use it for its AI plan).
 *
 *   if (!aiKey()) showKeyField();
 *   setAiKey(key, { remember });                   // memory only, unless the user opts in to localStorage
 *   const data = await askJson({ system, prompt, schema });   // schema: JSON Schema of the answer
 *
 * The official SDK (`LIBS.anthropic`) loads on first use, with `dangerouslyAllowBrowser` because the key is the
 * user's own and is sent only to api.anthropic.com. Answers come back as structured outputs (`output_config.format`
 * with a JSON schema), so they parse without guessing. Server-side refusal fallbacks are on (`fallbacks: 'default'`).
 */
import { loadLib } from './cdn.js';
import { store } from './dom.js';

export const AI_MODEL = 'claude-opus-5-5';
const KEY = 'ai:anthropic-key';
let key = store.get(KEY, '') || '';

export const aiKey = () => key;
export const aiKeyRemembered = () => !!store.get(KEY, '');

/** Set (or clear, with '') the key. remember: also keep it in this browser's localStorage. */
export function setAiKey(value, { remember = false } = {}) {
  key = (value || '').trim();
  try {
    if (remember && key) store.set(KEY, key);
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked: memory only */ }
}

let client = null, clientKey = '';
async function getClient() {
  if (!key) throw new Error('Add your Anthropic API key first.');
  if (!client || clientKey !== key) {
    const { default: Anthropic } = await loadLib('anthropic');
    client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
    clientKey = key;
  }
  return client;
}

/** A readable message for an SDK error. */
async function explain(err) {
  let A = null;
  try { A = (await loadLib('anthropic')).default; } catch { /* the SDK itself failed to load */ }
  if (!A) return 'Could not load the Anthropic SDK. Check your connection or content blockers.';
  if (err instanceof A.AuthenticationError) return 'The API key was rejected. Check it in your Anthropic Console.';
  if (err instanceof A.PermissionDeniedError) return 'This API key is not allowed to use this model.';
  if (err instanceof A.RateLimitError) return 'Rate limited by the API. Wait a moment and try again.';
  if (err instanceof A.APIConnectionError) return 'Could not reach api.anthropic.com. Check your connection.';
  if (err instanceof A.APIError) return `API error ${err.status ?? ''}: ${err.message}`.trim();
  return err?.message || String(err);
}

/**
 * One request; resolves the parsed JSON answer. effort: 'low' | 'medium' | 'high' (low is plenty for lists).
 * Throws an Error with a readable message on a bad key, network trouble, a refusal or an unparseable answer.
 */
export async function askJson({ system, prompt, schema, maxTokens = 16000, effort = 'low', signal } = {}) {
  let res;
  try {
    const c = await getClient();
    res = await c.beta.messages.create({
      model: AI_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort, format: { type: 'json_schema', schema } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }, { signal });
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) throw err;
    throw new Error(await explain(err));
  }
  if (res.stop_reason === 'refusal') throw new Error('The model declined this request. Try describing it differently.');
  if (res.stop_reason === 'max_tokens') throw new Error('The answer was cut off. Ask for fewer items.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch { throw new Error('The answer was not valid JSON. Try again.'); }
}
