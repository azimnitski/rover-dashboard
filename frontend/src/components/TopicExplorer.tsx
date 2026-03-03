import { useState } from 'react';
import { useAllTopics } from '../hooks/useRosTopic';
import { Radio, ChevronDown, ChevronRight } from 'lucide-react';

export function TopicExplorer() {
  const topics = useAllTopics();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (topic: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  };

  const sortedTopics = Array.from(topics.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  const timeSince = (ts: number) => {
    const diff = Date.now() / 1000 - ts;
    if (diff < 1) return 'just now';
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    return `${Math.floor(diff / 60)}m ago`;
  };

  return (
    <div className="panel-card">
      <div className="flex items-center gap-2 mb-3">
        <Radio size={16} className="text-panel-muted" />
        <span className="stat-label">Active Topics</span>
        <span className="ml-auto text-[10px] font-mono text-panel-muted">
          {topics.size} topics
        </span>
      </div>

      <div className="space-y-1 max-h-64 overflow-y-auto">
        {sortedTopics.length === 0 ? (
          <div className="text-xs text-panel-muted text-center py-4 font-mono">
            Waiting for data...
          </div>
        ) : (
          sortedTopics.map(([topic, info]) => (
            <div key={topic}>
              <button
                onClick={() => toggle(topic)}
                className="w-full flex items-center gap-1.5 py-1 px-1.5 rounded hover:bg-panel-bg text-left transition-colors group"
              >
                {expanded.has(topic) ? (
                  <ChevronDown size={12} className="text-panel-muted flex-shrink-0" />
                ) : (
                  <ChevronRight size={12} className="text-panel-muted flex-shrink-0" />
                )}
                <span className="font-mono text-xs text-gray-300 truncate flex-1">
                  {topic}
                </span>
                <span className="text-[10px] text-panel-muted font-mono flex-shrink-0">
                  {timeSince(info.timestamp)}
                </span>
              </button>

              {expanded.has(topic) && (
                <pre className="ml-5 p-2 bg-panel-bg rounded text-[10px] font-mono text-gray-400 overflow-x-auto max-h-32 overflow-y-auto">
                  {JSON.stringify(info.data, null, 2)}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
