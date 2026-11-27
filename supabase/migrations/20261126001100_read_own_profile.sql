-- Every signed-in user can read their own profile row, even while inactive, so the app can
-- tell "account not active yet" apart from "no profile" at login. Additive: one extra SELECT
-- policy; inactive users still see nothing else (every other policy requires an active role).
create policy profiles_select_self on public.profiles for select to authenticated
  using (id = auth.uid());
