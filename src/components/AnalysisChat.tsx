import { useEffect, useRef, useState } from 'react';
import { streamAnalysis, type ChatMessage } from '../services/analysisService.ts';
import type { RunSnapshot } from '../services/runSnapshot.ts';

export function AnalysisChat({ run }: { run: RunSnapshot }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const history = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight; }, [draft, messages]);

  async function send(question: string) {
    if (controller.current || !question.trim()) return;
    const abort = new AbortController(); controller.current = abort;
    setLoading(true); setError(null); setDraft('');
    const next: ChatMessage[] = [...messages, { role: 'user', content: question.trim() }];
    let answer = '';
    try {
      await streamAnalysis(run, next, chunk => { answer += chunk; setDraft(answer); }, abort.signal);
      if (!abort.signal.aborted) { setMessages([...next, { role: 'assistant', content: answer }]); setInput(''); }
    } catch (err) {
      if (!abort.signal.aborted) setError((err as Error).message);
    } finally {
      if (controller.current === abort) { controller.current = null; setLoading(false); setDraft(''); }
    }
  }
  return <div className="flex flex-col h-[440px] bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-700">
    <div ref={history} className="flex-1 overflow-y-auto p-4 space-y-3" aria-label="Analysis conversation">
      {!messages.length && !loading && <div className="text-center text-slate-600 dark:text-slate-300">
        <p>Review this run with OpenAI. Suggestions are hypotheses to test, not verified improvements.</p>
        <button onClick={() => send('Summarize this backtest, identify the strongest limitations and risks, and propose two or three specific hypotheses to validate on unseen data.')} className="mt-4 px-4 py-2 rounded bg-blue-600 text-white">Generate AI Analysis</button>
      </div>}
      {messages.map((m, i) => <div key={i} className={`p-3 rounded whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 dark:text-slate-100'}`}><strong>{m.role === 'user' ? 'You' : 'Analysis'}</strong><p>{m.content}</p></div>)}
      {loading && <div className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200" role="status">{draft || 'Analyzing…'}</div>}
      {error && <p role="alert" className="text-red-600">{error} Your completed conversation is preserved.</p>}
    </div>
    <form className="p-3 border-t flex gap-2" onSubmit={e => { e.preventDefault(); void send(input); }}>
      <input aria-label="Chat input" maxLength={2000} value={input} onChange={e => setInput(e.target.value)} disabled={loading || !messages.length} placeholder="Ask a follow-up question…" className="min-w-0 flex-1 p-2 border rounded dark:bg-slate-800 dark:text-white" />
      {loading ? <button type="button" onClick={() => controller.current?.abort()} className="p-2 border rounded">Stop</button> : <button aria-label="Send question" disabled={!input.trim() || !messages.length} className="p-2 rounded bg-blue-600 text-white disabled:opacity-50">Send</button>}
    </form>
  </div>;
}
