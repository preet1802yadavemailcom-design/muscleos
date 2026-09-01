import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@services/api';
import { useAuthStore } from '@store/auth.store';

/** Google redirects here after login with tokens in the URL fragment
 *  (#accessToken=...&refreshToken=...) — never in the query string, so they
 *  never hit server access logs. We read them, fetch the user's profile,
 *  store the session, and continue into the app like a normal login. */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  useEffect(() => {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const params = new URLSearchParams(hash);
    const accessToken = params.get('accessToken');
    const refreshToken = params.get('refreshToken');

    if (!accessToken || !refreshToken) {
      navigate('/login', { replace: true, state: { error: 'Google sign-in failed — please try again.' } });
      return;
    }

    (async () => {
      try {
        const res: any = await api.get('/auth/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        setAuth(res.data, accessToken, refreshToken);
        const profileIncomplete = params.get('profileIncomplete') === '1';
        navigate(profileIncomplete ? '/complete-profile' : '/', { replace: true });
      } catch {
        navigate('/login', { replace: true, state: { error: 'Google sign-in failed — please try again.' } });
      }
    })();
  }, [navigate, setAuth]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-muted-foreground">Signing you in…</p>
    </div>
  );
}
