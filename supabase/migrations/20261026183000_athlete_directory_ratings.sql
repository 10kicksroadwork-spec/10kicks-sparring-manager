-- Directory import: weight, skill, and aggression may be unknown.
-- Skill keeps sheet values 1–7. Aggression stays 1–5 when it is filled in.
-- The aggression column is restored if a dashboard edit removed it.

alter table public.athletes add column if not exists aggression integer;
alter table public.athletes alter column aggression drop not null;
alter table public.athletes drop constraint if exists athletes_aggression_check;
alter table public.athletes add constraint athletes_aggression_check
  check (aggression is null or (aggression >= 1 and aggression <= 5));

alter table public.athletes drop constraint if exists athletes_skill_check;
alter table public.athletes alter column skill drop not null;
alter table public.athletes add constraint athletes_skill_check
  check (skill is null or (skill >= 1 and skill <= 7));

alter table public.athletes drop constraint if exists athletes_weight_lbs_check;
alter table public.athletes alter column weight_lbs drop not null;
alter table public.athletes add constraint athletes_weight_lbs_check
  check (weight_lbs is null or (weight_lbs > 0 and weight_lbs <= 500));
