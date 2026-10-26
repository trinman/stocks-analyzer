import { analysisContext, type RunSnapshot } from './runSnapshot.ts';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export async function readAnalysisStream(body: ReadableStream<Uint8Array>, onText: (text: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  let hasText = false;
  function event(frame: string) {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const value = JSON.parse(data);
    if (value.type === 'response.output_text.delta' && typeof value.delta === 'string') { hasText ||= !!value.delta; onText(value.delta); }
    if (value.type === 'response.completed') completed = true;
    if (['error', 'response.failed', 'response.incomplete'].includes(value.type)) throw new Error('AI analysis did not complete. Please retry.');
    if (value.type === 'response.refusal.delta') throw new Error('The model could not analyze this request. Try a different question.');
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) { event(buffer.slice(0, end)); buffer = buffer.slice(end + 2); }
      if (buffer.length > 1000000) throw new Error('Invalid AI response. Please retry.');
      if (done) { if (buffer.trim()) event(buffer); break; }
    }
    if (!completed || !hasText) throw new Error('AI response was interrupted or empty. Please retry.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function streamAnalysis(run: RunSnapshot, messages: ChatMessage[], onText: (text: string) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch('/.netlify/functions/analysis', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ context: analysisContext(run), messages: messages.slice(-12) }, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || (response.status === 429 ? 'Too many analysis requests. Please wait a minute.' : 'AI analysis is unavailable. Please try again.'));
  }
  if (!response.body) throw new Error('AI response is empty.');
  await readAnalysisStream(response.body, onText);
}
