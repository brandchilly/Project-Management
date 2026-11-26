import { Settings2 } from 'lucide-react';
import { BrandLogo } from '@/components/brand/BrandLogo';

// Shown when the build has no Supabase URL/anon key, instead of a blank crash.
export function SetupRequired() {
  return (
    <div className="min-h-screen bg-ink flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-graphite-800 bg-ink-100 p-6 shadow-card">
        <BrandLogo size="sm" />
        <div className="mt-6 flex items-center gap-2 text-gold-400">
          <Settings2 className="h-5 w-5" />
          <h1 className="font-sans text-base font-semibold">Setup required</h1>
        </div>
        <p className="mt-2 text-sm text-graphite-300">
          This build has no Supabase connection. Add <code className="text-white">VITE_SUPABASE_URL</code> and{' '}
          <code className="text-white">VITE_SUPABASE_ANON_KEY</code> to <code className="text-white">.env</code>{' '}
          (or to the GitHub repository secrets for deploys), then rebuild. See the README.
        </p>
      </div>
    </div>
  );
}
