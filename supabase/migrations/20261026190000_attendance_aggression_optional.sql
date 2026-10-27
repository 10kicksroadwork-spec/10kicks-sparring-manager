-- Check-in no longer requires aggression. A blank snapshot is a directory fact, not a corrupt row.

alter table public.attendance alter column aggression_snapshot drop not null;
