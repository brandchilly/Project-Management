-- Default data that production needs: the 8 departments from the task sheet's "Default role"
-- column, the Digital Sales Engine template (8 launch stages + Post-Launch, 24 tasks),
-- Personal Branding (a copy), settings, holidays.
-- No people, job roles or memberships are seeded: the admin adds those in the app.

insert into public.departments (name, position) values
  ('Account Manager', 1),
  ('Strategist', 2),
  ('Copywriter', 3),
  ('Designer', 4),
  ('Tech', 5),
  ('Video Team', 6),
  ('Editor', 7),
  ('Ads Manager', 8)
on conflict (name) do nothing;

do $$
declare
  v_tpl uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_s5 uuid; v_s6 uuid; v_s7 uuid; v_s8 uuid; v_s9 uuid;
begin
  if exists (select 1 from public.templates where name = 'Digital Sales Engine') then
    return;
  end if;

  insert into public.templates (name, description)
  values ('Digital Sales Engine', '14-working-day launch: onboarding to ads live.')
  returning id into v_tpl;

  insert into public.template_stages (template_id, position, name, duration_days, is_post_launch) values
    (v_tpl, 1, 'Onboarding', 0, false) returning id into v_s1;
  insert into public.template_stages (template_id, position, name, duration_days, is_post_launch) values
    (v_tpl, 2, 'Niche & Problem Statement Understanding', 2, false) returning id into v_s2;
  insert into public.template_stages (template_id, position, name, duration_days, is_post_launch) values
    (v_tpl, 3, 'Offer Creation', 2, false) returning id into v_s3;
  insert into public.template_stages (template_id, position, name, duration_days, is_post_launch) values
    (v_tpl, 4, 'Landing Page, VSL Content, Ads Script', 2, false) returning id into v_s4;
  insert into public.template_stages (template_id, position, name, duration_days, is_post_launch) values
    (v_tpl, 5, 'Tech – LP, CRM, Forms', 2, false) returning id into v_s5;
  insert into public.template_stages (template_id, position, name, duration_days, is_post_launch) values
    (v_tpl, 6, 'VSL Shoot & Ads Edit', 3, false) returning id into v_s6;
  insert into public.template_stages (template_id, position, name, duration_days, is_post_launch) values
    (v_tpl, 7, 'Campaign Setup', 2, false) returning id into v_s7;
  insert into public.template_stages (template_id, position, name, duration_days, is_post_launch) values
    (v_tpl, 8, 'Ads Launch', 1, false) returning id into v_s8;
  insert into public.template_stages (template_id, position, name, duration_days, is_post_launch) values
    (v_tpl, 9, 'Post-Launch', 0, true) returning id into v_s9;

  -- (stage, position, task_no, milestone, title, department, due day, review, client, blocks,
  --  recurring, recurrence, checklist). Departments are matched by name.
  insert into public.template_tasks
    (template_stage_id, position, task_no, milestone, title, department_id, due_day_offset,
     needs_review, client_dependent, blocks_stage, is_recurring, recurrence, checklist)
  select v.stage, v.pos, v.no, v.milestone, v.title, d.id, v.due,
         v.review, v.client, v.blocks, v.recurring, v.recurrence::public.recurrence_kind, v.checklist::text[]
  from (values
    -- 1. Onboarding (Day 0). Access requests run in parallel and do not block the stage.
    (v_s1, 1, 1,  'Foundation',  'Client Onboarding Sheet Creation', 'Account Manager', 0, false, false, true,  false, null, '{}'),
    (v_s1, 2, 2,  'Foundation',  'Client Onboarding Call',           'Account Manager', 0, false, true,  true,  false, null, '{}'),
    (v_s1, 3, 12, 'Tech Setup',  'Access Request – Domain',          'Tech',            2, false, true,  false, false, null, '{}'),
    (v_s1, 4, 18, 'Advertising', 'Access Request – IG',              'Ads Manager',     2, false, true,  false, false, null, '{}'),
    (v_s1, 5, 19, 'Advertising', 'Access Request – Meta Ads Manager','Ads Manager',     2, false, true,  false, false, null, '{}'),
    (v_s1, 6, 20, 'Advertising', 'Access Request – FB Page',         'Ads Manager',     2, false, true,  false, false, null, '{}'),
    -- 2. Niche & Problem Statement Understanding (Day 1–2)
    (v_s2, 1, 3,  'Foundation',  'Client Brainstorming / Niche Discussion, Problem-to-Solution Roadmap', 'Strategist', 2, true, true, true, false, null, '{}'),
    -- 3. Offer Creation (Day 3–4)
    (v_s3, 1, 5,  'Content',     'Offer Creation',                   'Strategist',      4, true,  false, true,  false, null, '{}'),
    -- 4. Landing Page, VSL Content, Ads Script (Day 5–6)
    (v_s4, 1, 6,  'Content',     'Landing Page (copy)',              'Copywriter',      6, true,  false, true,  false, null, '{}'),
    (v_s4, 2, 7,  'Content',     'VSL Long Script',                  'Copywriter',      6, true,  false, true,  false, null, '{}'),
    (v_s4, 3, 8,  'Content',     'Ads Short Scripts',                'Copywriter',      6, true,  false, true,  false, null, '{}'),
    (v_s4, 4, 9,  'Content',     'Brand Color Theme',                'Designer',        6, true,  false, true,  false, null, '{}'),
    (v_s4, 5, 13, 'Media',       'Client Photos',                    'Account Manager', 6, false, true,  true,  false, null, '{}'),
    -- 5. Tech – LP, CRM, Forms (Day 7–8)
    (v_s5, 1, 10, 'Tech Setup',  'Landing Page (LP) / Forms',        'Tech',            8, true,  false, true,  false, null,
       '{"Hero section","Testimonials section","Form","Thank-you page"}'),
    (v_s5, 2, 11, 'Tech Setup',  'CRM',                              'Tech',            8, false, false, true,  false, null, '{}'),
    -- 6. VSL Shoot & Ads Edit (Day 9–11)
    (v_s6, 1, 14, 'Media',       'Video Shoot',                      'Video Team',      9, false, true,  true,  false, null, '{}'),
    (v_s6, 2, 15, 'Media',       'VSL Edited Video',                 'Editor',         11, true,  false, true,  false, null, '{}'),
    (v_s6, 3, 16, 'Media',       'Ads Editing',                      'Editor',         11, true,  false, true,  false, null, '{}'),
    (v_s6, 4, 17, 'Media',       'Still Graphics',                   'Designer',       11, true,  false, true,  false, null, '{}'),
    -- 7. Campaign Setup (Day 12–13)
    (v_s7, 1, 21, 'Advertising', 'Campaign Setup',                   'Ads Manager',    13, true,  false, true,  false, null, '{}'),
    -- 8. Ads Launch (Day 14)
    (v_s8, 1, 22, 'Advertising', 'Ads Launch',                       'Ads Manager',    14, false, false, true,  false, null, '{}'),
    -- Post-Launch. Recurring reviews never block the stage; testimonials do.
    (v_s9, 1, 23, 'Advertising', 'Ads Performance Review',           'Ads Manager',    21, false, false, false, true, 'weekly',  '{}'),
    (v_s9, 2, 24, 'Operations',  'Monthly Performance Review',       'Account Manager',30, false, false, false, true, 'monthly', '{}'),
    (v_s9, 3, 4,  'Foundation',  'Client Testimonials',              'Account Manager',30, false, true,  true,  false, null, '{}')
  ) as v(stage, pos, no, milestone, title, dept, due, review, client, blocks, recurring, recurrence, checklist)
  left join public.departments d on d.name = v.dept;

  -- Seeding bumped the version once per row; the shipped template is version 1.
  update public.templates set version = 1 where id = v_tpl;

  perform private.copy_template(v_tpl, 'Personal Branding',
    'Personal Branding workflow. Starts as a copy of Digital Sales Engine; edit it in Templates.');
end $$;

insert into public.app_settings (key, value) values
  ('client_reminders', '{"enabled": true, "interval_days": 2}'),
  ('whatsapp', '{"enabled": false, "provider": null}'),
  ('email', '{"enabled": false, "from": "BrandChilly <pm@brandchilly.com>"}')
on conflict (key) do nothing;

-- Fixed-date national holidays. Festival holidays (Holi, Diwali, Eid, ...) change every
-- year: add them in Admin > Settings > Holidays.
insert into public.holidays (date, name) values
  ('2026-01-26', 'Republic Day'),
  ('2026-08-15', 'Independence Day'),
  ('2026-10-02', 'Gandhi Jayanti'),
  ('2026-12-25', 'Christmas'),
  ('2027-01-26', 'Republic Day'),
  ('2027-08-15', 'Independence Day'),
  ('2027-10-02', 'Gandhi Jayanti'),
  ('2027-12-25', 'Christmas')
on conflict (date) do nothing;
