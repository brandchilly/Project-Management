import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (online) return null;
  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-[60] flex items-center justify-center gap-2 bg-warning-500/15 border-b border-warning-500/30 px-4 py-2 text-xs font-medium text-warning-300 backdrop-blur-md safe-top"
    >
      <WifiOff className="h-3.5 w-3.5" />
      You are offline. Changes will not save until you reconnect.
    </div>
  );
}
