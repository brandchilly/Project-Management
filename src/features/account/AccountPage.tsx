import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { BellOff, KeyRound, LogOut, Shield, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/brand';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';
import { Badge } from '@/components/ui/Badge';
import { FormField } from '@/components/form/FormField';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase, errorMessage } from '@/lib/supabase';
import { EMAIL_NOTIFICATION_TYPES, ROLE_LABELS } from '@/lib/constants';

export function AccountPage() {
  const { profile, refreshProfile, signOut } = useAuth();
  const { toast } = useToast();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Load once per signed-in user; saving email preferences must not overwrite unsaved typing.
  const latestProfile = useRef(profile);
  latestProfile.current = profile;
  useEffect(() => {
    setFullName(latestProfile.current?.full_name ?? '');
    setPhone(latestProfile.current?.phone ?? '');
  }, [profile?.id]);

  const saveProfile = useMutation({
    mutationFn: async (args: { p_full_name?: string; p_phone?: string; p_email_mutes?: string[] }) => {
      const { error } = await supabase.rpc('update_my_profile', args);
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => refreshProfile(),
    onError: (e: Error) => toast({ type: 'error', title: 'Could not save', description: e.message }),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(errorMessage(error));
    },
    onSuccess: () => {
      setPassword('');
      setConfirmPassword('');
      toast({ type: 'success', title: 'Password changed' });
    },
    onError: (e: Error) => toast({ type: 'error', title: 'Could not change password', description: e.message }),
  });

  const submitProfile = (e: FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    saveProfile.mutate(
      { p_full_name: fullName.trim(), p_phone: phone.trim() },
      { onSuccess: () => toast({ type: 'success', title: 'Profile saved' }) }
    );
  };

  const passwordError =
    password && password.length < 8
      ? 'At least 8 characters'
      : confirmPassword && confirmPassword !== password
        ? 'Passwords do not match'
        : undefined;

  const mutes = new Set(profile?.email_mutes ?? []);
  const toggleMute = (type: string, emailOn: boolean) => {
    const next = new Set(mutes);
    if (emailOn) next.delete(type);
    else next.add(type);
    saveProfile.mutate({ p_email_mutes: [...next] });
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Account" subtitle={profile?.email} />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-gold-400" />
                Profile
              </CardTitle>
              <CardDescription>
                {profile && <Badge>{ROLE_LABELS[profile.role]}</Badge>} Your role and departments are set by the admin.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitProfile} className="space-y-4">
                <FormField label="Name" htmlFor="me-name" required>
                  <Input id="me-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </FormField>
                <FormField label="Phone" htmlFor="me-phone">
                  <Input id="me-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </FormField>
                <Button type="submit" disabled={!fullName.trim() || saveProfile.isPending}>
                  Save profile
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-gold-400" />
                Change password
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!passwordError && password && password === confirmPassword) changePassword.mutate();
                }}
                className="space-y-4"
              >
                <FormField label="New password" htmlFor="me-pass">
                  <Input
                    id="me-pass"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </FormField>
                <FormField label="Repeat new password" htmlFor="me-pass2" error={passwordError}>
                  <Input
                    id="me-pass2"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </FormField>
                <Button
                  type="submit"
                  disabled={!!passwordError || !password || password !== confirmPassword || changePassword.isPending}
                >
                  Change password
                </Button>
              </form>
            </CardContent>
          </Card>

          {profile?.role === 'admin' && (
            <Card className="lg:hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-crimson-500" />
                  Admin
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                {[
                  { to: '/admin/users', label: 'Users' },
                  { to: '/admin/departments', label: 'Departments' },
                  { to: '/admin/templates', label: 'Templates' },
                  { to: '/admin/settings', label: 'Settings' },
                ].map((l) => (
                  <Button key={l.to} variant="secondary" asChild>
                    <Link to={l.to}>{l.label}</Link>
                  </Button>
                ))}
              </CardContent>
            </Card>
          )}

          {(profile?.role === 'admin' || profile?.role === 'manager') && (
            <Button variant="secondary" fullWidth asChild className="lg:hidden">
              <Link to="/team">My Team</Link>
            </Button>
          )}

          <Button variant="outline" fullWidth onClick={signOut}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellOff className="h-4 w-4 text-gold-400" />
              Email notifications
            </CardTitle>
            <CardDescription>
              Everything always shows in the app. Choose which ones you also want by email once email is switched on.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-graphite-800">
              {EMAIL_NOTIFICATION_TYPES.map((n) => (
                <li key={n.type}>
                  <label className="flex min-h-[48px] items-center justify-between gap-4">
                    <span className="text-sm text-graphite-200">{n.label}</span>
                    <Switch
                      checked={!mutes.has(n.type)}
                      disabled={saveProfile.isPending}
                      onCheckedChange={(on) => toggleMute(n.type, on)}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
