import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * `registerType: 'prompt'` (vite.config.ts) means a new build never
 * silently swaps itself in — that matters here specifically because a
 * silent reload mid check-in-scan or mid-payment would be a genuinely bad
 * time to lose in-flight state. This renders a small toast the member/staff
 * can act on when it's convenient instead.
 */
export function PwaUpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('Service worker registration failed', error);
    },
  });

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  if (!offlineReady && !needRefresh) return null;

  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:left-auto sm:w-80 z-50 rounded-lg border border-border bg-background shadow-lg p-4">
      <p className="text-sm text-foreground">
        {needRefresh
          ? 'A new version of MuscleOS is available.'
          : 'MuscleOS is ready to work offline.'}
      </p>
      <div className="mt-3 flex gap-2 justify-end">
        {needRefresh && (
          <button
            type="button"
            onClick={() => updateServiceWorker(true)}
            className="text-sm font-medium rounded-md px-3 py-1.5 bg-primary text-primary-foreground"
          >
            Reload
          </button>
        )}
        <button
          type="button"
          onClick={close}
          className="text-sm font-medium rounded-md px-3 py-1.5 border border-border"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
