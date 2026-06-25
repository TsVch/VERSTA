import { useState } from 'react';

interface AuthUser {
  id: number;
  username: string;
  displayName?: string | null;
}

interface Props {
  onLogin: (user: AuthUser) => void;
}

export default function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? 'Ошибка входа');
      } else {
        onLogin(data);
      }
    } catch {
      setError('Нет соединения с сервером');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{ minHeight: '100svh', background: '#090e1a' }}
      className="flex flex-col items-center justify-center p-4"
    >
      <div className="card-neon p-8 w-full max-w-xs flex flex-col items-center gap-6">
        <img src="/versta-logo.png" alt="VERSTA" className="h-24 w-24 object-contain" />
        <div className="text-center">
          <h1 className="text-2xl font-black text-white tracking-wide">VERSTA</h1>
          <p className="text-sm" style={{ color: 'hsl(120 60% 50%)' }}>taxometer</p>
          <p className="text-xs mt-1" style={{ color: 'hsl(180 30% 35%)' }}>Честные поездки</p>
        </div>

        <form onSubmit={submit} className="w-full flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'hsl(180 30% 45%)' }}>Логин</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="versta01"
              autoComplete="username"
              required
              style={{
                background: '#0d1526',
                border: '1px solid #1a2a4a',
                borderRadius: '8px',
                padding: '10px 14px',
                color: '#fff',
                fontSize: '0.875rem',
                outline: 'none',
                width: '100%',
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'hsl(180 30% 45%)' }}>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              style={{
                background: '#0d1526',
                border: '1px solid #1a2a4a',
                borderRadius: '8px',
                padding: '10px 14px',
                color: '#fff',
                fontSize: '0.875rem',
                outline: 'none',
                width: '100%',
              }}
            />
          </div>

          {error && (
            <p style={{ color: 'hsl(0 80% 60%)', fontSize: '0.75rem', textAlign: 'center' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-neon-cyan"
            style={{ padding: '10px', borderRadius: '8px', fontWeight: 600, fontSize: '0.875rem', marginTop: '4px' }}
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>

        <a
          href="/manual.html"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: '0.7rem', color: 'hsl(180 30% 35%)', textDecoration: 'underline' }}
        >
          📖 Инструкция пользователя
        </a>
      </div>
    </div>
  );
}
