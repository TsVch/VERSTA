import { LogEntry } from '../types';

interface Props {
  logs: LogEntry[];
  onClear: () => void;
}

function typeColor(t: LogEntry['type']): string {
  switch (t) {
    case 'gps': return 'hsl(180 100% 55%)';
    case 'warn': return 'hsl(55 100% 55%)';
    case 'error': return 'hsl(0 100% 60%)';
    case 'system': return 'hsl(270 100% 72%)';
    default: return 'hsl(180 30% 60%)';
  }
}

function typeLabel(t: LogEntry['type']): string {
  switch (t) {
    case 'gps': return 'GPS';
    case 'warn': return 'WARN';
    case 'error': return 'ERR';
    case 'system': return 'SYS';
    default: return 'INF';
  }
}

export default function EventLog({ logs, onClear }: Props) {
  return (
    <div className="card-neon p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="section-title">Лог событий</span>
        <button
          onClick={onClear}
          className="text-xs px-2 py-0.5 rounded"
          style={{ background: 'hsl(0 80% 15%)', border: '1px solid hsl(0 100% 35%)', color: 'hsl(0 100% 55%)' }}
        >
          Очистить
        </button>
      </div>
      <div className="log-container font-mono text-xs space-y-0.5">
        {logs.length === 0 && (
          <div style={{ color: 'hsl(180 30% 35%)' }}>Лог пуст — начните поездку</div>
        )}
        {[...logs].reverse().map((entry, i) => {
          const d = new Date(entry.ts);
          const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
          return (
            <div key={i} className="flex gap-2" style={{ lineHeight: '1.5' }}>
              <span style={{ color: 'hsl(180 30% 35%)', flexShrink: 0 }}>{time}</span>
              <span style={{ color: typeColor(entry.type), flexShrink: 0, minWidth: '28px' }}>[{typeLabel(entry.type)}]</span>
              <span style={{ color: typeColor(entry.type), wordBreak: 'break-all' }}>{entry.msg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
