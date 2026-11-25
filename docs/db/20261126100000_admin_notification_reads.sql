-- APPLIED to tbcmgdwzarfdgzzmmele on 2026-11-26 by the lead (recorded in schema_migrations as 20261126100000).
--
-- GAP-095 (admin part): per-admin read state for the Super Admin notification inbox.
-- Until now `admin_notifications.read` is one flag shared by every admin, so one admin's
-- "mark all read" cleared everyone's badge.
--
-- The portal code (server/platform-api/pg/admin/platform.ts) detects this table with
-- to_regclass() and switches to per-admin receipts automatically (re-checked every minute);
-- without it, it keeps using the shared `read` column. Idempotent; safe to re-run.

create table if not exists public.admin_notification_reads (
  notification_id text not null references public.admin_notifications (id) on delete cascade,
  admin_id        text not null references public.admin_users (id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, admin_id)
);

create index if not exists admin_notification_reads_admin_idx on public.admin_notification_reads (admin_id);

-- Same posture as the other admin tables: RLS on, no policies, no client grants (panel only).
alter table public.admin_notification_reads enable row level security;
revoke all on public.admin_notification_reads from anon, authenticated;

-- Keep what was already read: a notification read under the shared flag counts as read by every
-- admin that existed when it was read (approximation: all current admins).
insert into public.admin_notification_reads (notification_id, admin_id, read_at)
select an.id, a.id, an.created_at
from public.admin_notifications an
cross join public.admin_users a
where an.read
on conflict do nothing;
