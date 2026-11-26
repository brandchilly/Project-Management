import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Lock, ArrowRight, AlertCircle, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});
type FormValues = z.infer<typeof schema>;

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Wrong email or password.';
  if (m.includes('banned')) return 'This account has been deactivated. Contact your admin.';
  if (m.includes('fetch')) return 'Cannot reach the server. Check your internet connection.';
  return message;
}

export function LoginPage() {
  const { accessError } = useAuth();
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  // On success the auth listener loads the profile and the router redirects by role.
  const onSubmit = async (values: FormValues) => {
    setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword(values);
    if (signInError) setError(friendlyAuthError(signInError.message));
  };

  const shownError = error || accessError;

  return (
    <div className="min-h-screen bg-ink flex flex-col items-center justify-center px-6 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-crimson-radial" />
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-80 w-80 rounded-full bg-crimson-600/10 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-10">
          <div className="relative mb-5">
            <div className="absolute inset-0 bg-crimson-600/10 blur-2xl" />
            <BrandLogo size="lg" className="relative" />
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-crimson-600/40 bg-crimson-600/10 shadow-glow">
            <ShieldCheck className="h-6 w-6 text-crimson-500" />
          </div>
          <h1 className="font-serif text-3xl font-semibold text-white mt-4">Project Management</h1>
          <p className="text-sm text-graphite-400 mt-2">Sign in to your workspace</p>
        </div>

        <div className="rounded-2xl border border-graphite-800 bg-ink-100/80 backdrop-blur-sm p-6 shadow-card">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-graphite-500" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@brandchilly.com"
                  className="pl-10"
                  autoComplete="email"
                  aria-invalid={!!errors.email}
                  {...register('email')}
                />
              </div>
              {errors.email && <p className="mt-1.5 text-xs text-error-300">{errors.email.message}</p>}
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-graphite-500" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                  {...register('password')}
                />
              </div>
              {errors.password && <p className="mt-1.5 text-xs text-error-300">{errors.password.message}</p>}
            </div>

            {shownError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-error-500/30 bg-error-500/10 px-3 py-2.5 text-sm text-error-300"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{shownError}</span>
              </div>
            )}

            <Button type="submit" fullWidth size="lg" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign In'}
              {!isSubmitting && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-graphite-500 mt-6">
          Accounts are created by your admin. Forgot your password? Ask your admin to reset it.
        </p>
      </div>
    </div>
  );
}
