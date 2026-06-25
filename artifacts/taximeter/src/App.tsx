import { useState, useEffect } from 'react';
import Taximeter from './pages/Taximeter';
import LoginPage from './pages/LoginPage';

interface AuthUser {
  id: number;
  username: string;
  displayName?: string | null;
}

export default function App() {
  const [user,    setUser]    = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { setUser(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100svh', background: '#090e1a' }}
           className="flex items-center justify-center">
        <div style={{ color: 'hsl(180 100% 55%)', fontSize: '0.875rem' }}
             className="animate-pulse">
          Загрузка...
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
  };

  return <Taximeter user={user} onLogout={handleLogout} />;
}
