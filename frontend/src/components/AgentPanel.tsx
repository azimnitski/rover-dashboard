import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, Cpu, RotateCcw } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Role = 'user' | 'assistant';

interface Message {
  id: number;
  role: Role;
  thinking: string;   // content inside <think>…</think>
  answer: string;     // content after </think>
  streaming: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let msgIdCounter = 0;

function parseThinkAnswer(raw: string): { thinking: string; answer: string } {
  const open = raw.indexOf('<think>');
  const close = raw.indexOf('</think>');
  if (open !== -1 && close !== -1 && close > open) {
    return {
      thinking: raw.slice(open + 7, close).trimStart(),
      answer: raw.slice(close + 8).trimStart(),
    };
  }
  if (open !== -1) {
    // Still inside <think> block — everything is thinking so far
    return { thinking: raw.slice(open + 7), answer: '' };
  }
  return { thinking: '', answer: raw };
}

const BACKEND = import.meta.env.VITE_API_URL ?? `http://${window.location.hostname}:8765`;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(true);
  if (!text) return null;
  return (
    <div className="mt-1 mb-2 rounded border border-yellow-800/40 bg-yellow-950/20 text-xs font-mono">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-yellow-500/80 hover:text-yellow-400 transition-colors"
      >
        <Cpu size={11} />
        <span className="uppercase tracking-widest text-[10px]">Reasoning</span>
        <span className="ml-auto text-[10px] text-yellow-700">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="px-2 pb-2 text-yellow-300/60 whitespace-pre-wrap leading-relaxed border-t border-yellow-800/30 pt-1">
          {text}
          {!text.includes('</think>') && (
            <span className="animate-pulse text-yellow-500">▍</span>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} gap-0.5`}>
      {isUser ? (
        <div className="max-w-[85%] rounded-lg px-3 py-2 bg-panel-accent/30 text-gray-200 text-sm font-mono">
          {msg.answer}
        </div>
      ) : (
        <div className="w-full">
          <ThinkingBlock text={msg.thinking} />
          <div className="text-sm font-mono text-gray-200 whitespace-pre-wrap leading-relaxed">
            {msg.answer}
            {msg.streaming && !msg.thinking && (
              <span className="animate-pulse text-panel-accent">▍</span>
            )}
            {msg.streaming && msg.thinking && msg.answer && (
              <span className="animate-pulse text-panel-accent">▍</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------
export function AgentPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState('llama3.2:3b-rover');
  const [stats, setStats] = useState<{ tokens: number; ms: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || busy) return;

    setInput('');
    setStats(null);
    setBusy(true);

    // Add user message
    const userId = ++msgIdCounter;
    setMessages(prev => [...prev, { id: userId, role: 'user', thinking: '', answer: prompt, streaming: false }]);

    // Add empty assistant message that we'll fill in
    const assistantId = ++msgIdCounter;
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', thinking: '', answer: '', streaming: true }]);

    abortRef.current = new AbortController();
    let rawAccum = '';
    let totalTokens = 0;
    const t0 = Date.now();

    try {
      const res = await fetch(`${BACKEND}/api/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model }),
        signal: abortRef.current.signal,
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.info) {
              // Backend status message (e.g. CUDA OOM retry)
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, thinking: obj.info, answer: '', streaming: true } : m
              ));
              rawAccum = '';
            }
            if (obj.response) {
              rawAccum += obj.response;
              totalTokens++;
              const { thinking, answer } = parseThinkAnswer(rawAccum);
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, thinking, answer, streaming: true } : m
              ));
            }
            if (obj.done) {
              const { thinking, answer } = parseThinkAnswer(rawAccum);
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, thinking, answer, streaming: false } : m
              ));
              setStats({ tokens: obj.eval_count ?? totalTokens, ms: Date.now() - t0 });
            }
            if (obj.error) {
              setMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? { ...m, answer: `Error: ${obj.error}`, streaming: false }
                  : m
              ));
            }
          } catch { /* incomplete JSON line, skip */ }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, answer: `Connection error: ${(e as Error).message}`, streaming: false }
            : m
        ));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [input, busy, model]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
    setBusy(false);
  };

  const clear = () => {
    setMessages([]);
    setStats(null);
  };

  return (
    <div className="panel-card flex flex-col h-[520px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-panel-accent" />
          <span className="text-xs font-mono text-panel-muted uppercase tracking-wider">LLM Agent</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            disabled={busy}
            className="text-[10px] font-mono bg-panel-surface border border-panel-border rounded px-1.5 py-0.5 text-panel-muted focus:outline-none focus:border-panel-accent"
          >
            <option value="llama3.2:3b-rover">llama3.2:3b (rover)</option>
            <option value="llama3.2:3b">llama3.2:3b (full ctx)</option>
            <option value="moondream">moondream</option>
          </select>
          <button
            onClick={clear}
            disabled={busy}
            className="text-panel-muted hover:text-gray-300 transition-colors disabled:opacity-30"
            title="Clear chat"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <p className="text-xs text-panel-muted font-mono text-center">
              Ask a question or give the rover a command.<br />
              <span className="text-[10px] text-panel-border">Shift+Enter for newline</span>
            </p>
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="flex-shrink-0 text-[10px] font-mono text-panel-border pt-1 border-t border-panel-border mt-1">
          {stats.tokens} tokens · {(stats.ms / 1000).toFixed(1)}s · {(stats.tokens / (stats.ms / 1000)).toFixed(1)} tok/s
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 flex gap-2 mt-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={busy}
          rows={2}
          placeholder="Ask something… (Enter to send)"
          className="flex-1 resize-none text-sm font-mono bg-panel-surface border border-panel-border rounded px-2 py-1.5 text-gray-200 placeholder-panel-border focus:outline-none focus:border-panel-accent disabled:opacity-50"
        />
        {busy ? (
          <button
            onClick={stop}
            className="px-3 rounded bg-red-900/40 border border-red-800/50 text-red-400 hover:bg-red-900/60 transition-colors text-xs font-mono"
            title="Stop generation"
          >
            ■ Stop
          </button>
        ) : (
          <button
            onClick={sendMessage}
            disabled={!input.trim()}
            className="px-3 rounded bg-panel-accent/20 border border-panel-accent/40 text-panel-accent hover:bg-panel-accent/30 transition-colors disabled:opacity-30"
            title="Send (Enter)"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
