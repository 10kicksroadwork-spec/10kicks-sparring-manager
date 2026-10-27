-- Sparring manager tables. Service role writes from the server.
-- The dashboard owner uses the Table Editor, which bypasses RLS.
-- anon and authenticated have no policies and no grants.

create table public.athletes (
  athlete_id text primary key,
  display_name text not null,
  weight_lbs numeric not null check (weight_lbs > 0 and weight_lbs <= 500),
  skill integer not null check (skill between 1 and 5),
  aggression integer not null check (aggression between 1 and 5),
  role_eligibility text not null check (role_eligibility in ('FIGHTER', 'VOLUNTEER', 'BOTH')),
  active boolean not null default true,
  coach_notes text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table public.sessions (
  session_id text primary key,
  date_local date not null,
  timezone text not null,
  status text not null check (status in ('DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  revision integer not null check (revision >= 0),
  active_generation_id text not null default '',
  current_block_index integer not null check (current_block_index >= 0),
  settings_json jsonb not null,
  created_by text not null,
  created_at timestamptz not null,
  updated_by text not null,
  updated_at timestamptz not null
);

create table public.attendance (
  attendance_id text primary key,
  session_id text not null references public.sessions (session_id),
  athlete_id text not null references public.athletes (athlete_id),
  assigned_role text not null check (assigned_role in ('FIGHTER', 'VOLUNTEER')),
  present boolean not null,
  availability_status text not null check (availability_status in ('AVAILABLE', 'DEPARTED', 'REMOVED')),
  weight_lbs_snapshot numeric not null,
  skill_snapshot integer not null,
  aggression_snapshot integer not null,
  checked_in_at timestamptz not null,
  updated_at timestamptz not null,
  unique (session_id, athlete_id)
);

create index attendance_session_id_idx on public.attendance (session_id);
create index attendance_athlete_id_idx on public.attendance (athlete_id);

create table public.assignments (
  assignment_id text not null,
  session_id text not null references public.sessions (session_id),
  generation_id text not null,
  block_index integer not null check (block_index > 0),
  location text not null check (location in ('MAIN_RING', 'FLOOR_1', 'FLOOR_2')),
  fighter_id text not null references public.athletes (athlete_id),
  volunteer_id text not null references public.athletes (athlete_id),
  status text not null check (status in ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'INTERRUPTED')),
  locked boolean not null default false,
  numeric_exception_id text not null default '',
  updated_at timestamptz not null,
  updated_by text not null,
  primary key (assignment_id, generation_id)
);

create index assignments_session_generation_idx on public.assignments (session_id, generation_id);
create index assignments_fighter_id_idx on public.assignments (fighter_id);
create index assignments_volunteer_id_idx on public.assignments (volunteer_id);

create table public.restrictions (
  restriction_id text primary key,
  athlete_a_id text not null references public.athletes (athlete_id),
  athlete_b_id text not null references public.athletes (athlete_id),
  reason text not null default '',
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index restrictions_athlete_a_idx on public.restrictions (athlete_a_id);
create index restrictions_athlete_b_idx on public.restrictions (athlete_b_id);

create table public.overrides (
  override_id text primary key,
  session_id text not null references public.sessions (session_id),
  fighter_id text not null references public.athletes (athlete_id),
  volunteer_id text not null references public.athletes (athlete_id),
  allowed_numeric_limits_json jsonb not null,
  coach_email text not null,
  reason text not null default '',
  acknowledged_at timestamptz not null,
  active boolean not null default true
);

create index overrides_session_id_idx on public.overrides (session_id);

create table public.audit_log (
  audit_id text primary key,
  session_id text not null,
  actor_email text not null,
  event_type text not null,
  request_id text not null,
  prior_revision integer not null,
  new_revision integer not null,
  timestamp timestamptz not null,
  payload_json jsonb not null
);

create index audit_log_session_request_idx on public.audit_log (session_id, request_id);

create table public.locks (
  lock_key text primary key,
  token text not null,
  expires_at timestamptz not null
);

alter table public.athletes enable row level security;
alter table public.sessions enable row level security;
alter table public.attendance enable row level security;
alter table public.assignments enable row level security;
alter table public.restrictions enable row level security;
alter table public.overrides enable row level security;
alter table public.audit_log enable row level security;
alter table public.locks enable row level security;

revoke all on table public.athletes from public, anon, authenticated;
revoke all on table public.sessions from public, anon, authenticated;
revoke all on table public.attendance from public, anon, authenticated;
revoke all on table public.assignments from public, anon, authenticated;
revoke all on table public.restrictions from public, anon, authenticated;
revoke all on table public.overrides from public, anon, authenticated;
revoke all on table public.audit_log from public, anon, authenticated;
revoke all on table public.locks from public, anon, authenticated;

grant select, insert, update, delete on table public.athletes to service_role;
grant select, insert, update, delete on table public.sessions to service_role;
grant select, insert, update, delete on table public.attendance to service_role;
grant select, insert, update, delete on table public.assignments to service_role;
grant select, insert, update, delete on table public.restrictions to service_role;
grant select, insert, update, delete on table public.overrides to service_role;
grant select, insert, update, delete on table public.audit_log to service_role;
grant select, insert, update, delete on table public.locks to service_role;

create or replace function public.acquire_sparring_lock(p_key text, p_token text, p_ttl_ms integer)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  acquired text;
begin
  insert into public.locks (lock_key, token, expires_at)
  values (p_key, p_token, now() + (p_ttl_ms * interval '1 millisecond'))
  on conflict (lock_key) do update
    set token = excluded.token,
        expires_at = excluded.expires_at
    where locks.expires_at <= now()
  returning token into acquired;
  return acquired is not null and acquired = p_token;
end;
$$;

create or replace function public.release_sparring_lock(p_key text, p_token text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.locks where lock_key = p_key and token = p_token;
end;
$$;

create or replace function public.commit_sparring_batch(batch jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  item jsonb;
begin
  if batch ? 'athletes' and jsonb_typeof(batch->'athletes') = 'array' then
    for item in select value from jsonb_array_elements(batch->'athletes')
    loop
      insert into public.athletes (
        athlete_id, display_name, weight_lbs, skill, aggression, role_eligibility,
        active, coach_notes, created_at, updated_at
      ) values (
        item->>'athleteId',
        item->>'displayName',
        (item->>'weightLbs')::numeric,
        (item->>'skill')::integer,
        (item->>'aggression')::integer,
        item->>'roleEligibility',
        coalesce((item->>'active')::boolean, true),
        coalesce(item->>'coachNotes', ''),
        (item->>'createdAt')::timestamptz,
        (item->>'updatedAt')::timestamptz
      )
      on conflict (athlete_id) do update set
        display_name = excluded.display_name,
        weight_lbs = excluded.weight_lbs,
        skill = excluded.skill,
        aggression = excluded.aggression,
        role_eligibility = excluded.role_eligibility,
        active = excluded.active,
        coach_notes = excluded.coach_notes,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at;
    end loop;
  end if;

  if batch ? 'session' and jsonb_typeof(batch->'session') = 'object' then
    item := batch->'session';
    insert into public.sessions (
      session_id, date_local, timezone, status, revision, active_generation_id,
      current_block_index, settings_json, created_by, created_at, updated_by, updated_at
    ) values (
      item->>'sessionId',
      (item->>'dateLocal')::date,
      coalesce(item->>'timezone', 'America/New_York'),
      item->>'status',
      (item->>'revision')::integer,
      coalesce(item->>'activeGenerationId', ''),
      (item->>'currentBlockIndex')::integer,
      coalesce(item->'settings', '{}'::jsonb),
      coalesce(item->>'createdBy', ''),
      (item->>'createdAt')::timestamptz,
      coalesce(item->>'updatedBy', ''),
      (item->>'updatedAt')::timestamptz
    )
    on conflict (session_id) do update set
      date_local = excluded.date_local,
      timezone = excluded.timezone,
      status = excluded.status,
      revision = excluded.revision,
      active_generation_id = excluded.active_generation_id,
      current_block_index = excluded.current_block_index,
      settings_json = excluded.settings_json,
      created_by = excluded.created_by,
      created_at = excluded.created_at,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;
  end if;

  if batch ? 'attendance' and jsonb_typeof(batch->'attendance') = 'array' then
    for item in select value from jsonb_array_elements(batch->'attendance')
    loop
      insert into public.attendance (
        attendance_id, session_id, athlete_id, assigned_role, present, availability_status,
        weight_lbs_snapshot, skill_snapshot, aggression_snapshot, checked_in_at, updated_at
      ) values (
        item->>'attendanceId',
        item->>'sessionId',
        item->>'athleteId',
        item->>'assignedRole',
        (item->>'present')::boolean,
        item->>'availabilityStatus',
        (item->>'weightLbsSnapshot')::numeric,
        (item->>'skillSnapshot')::integer,
        (item->>'aggressionSnapshot')::integer,
        (item->>'checkedInAt')::timestamptz,
        (item->>'updatedAt')::timestamptz
      )
      on conflict (attendance_id) do update set
        session_id = excluded.session_id,
        athlete_id = excluded.athlete_id,
        assigned_role = excluded.assigned_role,
        present = excluded.present,
        availability_status = excluded.availability_status,
        weight_lbs_snapshot = excluded.weight_lbs_snapshot,
        skill_snapshot = excluded.skill_snapshot,
        aggression_snapshot = excluded.aggression_snapshot,
        checked_in_at = excluded.checked_in_at,
        updated_at = excluded.updated_at;
    end loop;
  end if;

  if batch ? 'assignmentInserts' and jsonb_typeof(batch->'assignmentInserts') = 'array' then
    for item in select value from jsonb_array_elements(batch->'assignmentInserts')
    loop
      insert into public.assignments (
        assignment_id, session_id, generation_id, block_index, location, fighter_id, volunteer_id,
        status, locked, numeric_exception_id, updated_at, updated_by
      ) values (
        item->>'assignmentId',
        item->>'sessionId',
        coalesce(item->>'generationId', ''),
        (item->>'blockIndex')::integer,
        item->>'location',
        item->>'fighterId',
        item->>'volunteerId',
        item->>'status',
        coalesce((item->>'locked')::boolean, false),
        coalesce(item->>'approvedNumericExceptionId', ''),
        (item->>'updatedAt')::timestamptz,
        coalesce(item->>'updatedBy', '')
      );
    end loop;
  end if;

  if batch ? 'assignmentUpdates' and jsonb_typeof(batch->'assignmentUpdates') = 'array' then
    for item in select value from jsonb_array_elements(batch->'assignmentUpdates')
    loop
      insert into public.assignments (
        assignment_id, session_id, generation_id, block_index, location, fighter_id, volunteer_id,
        status, locked, numeric_exception_id, updated_at, updated_by
      ) values (
        item->>'assignmentId',
        item->>'sessionId',
        coalesce(item->>'generationId', ''),
        (item->>'blockIndex')::integer,
        item->>'location',
        item->>'fighterId',
        item->>'volunteerId',
        item->>'status',
        coalesce((item->>'locked')::boolean, false),
        coalesce(item->>'approvedNumericExceptionId', ''),
        (item->>'updatedAt')::timestamptz,
        coalesce(item->>'updatedBy', '')
      )
      on conflict (assignment_id, generation_id) do update set
        session_id = excluded.session_id,
        block_index = excluded.block_index,
        location = excluded.location,
        fighter_id = excluded.fighter_id,
        volunteer_id = excluded.volunteer_id,
        status = excluded.status,
        locked = excluded.locked,
        numeric_exception_id = excluded.numeric_exception_id,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
    end loop;
  end if;

  if batch ? 'restriction' and jsonb_typeof(batch->'restriction') = 'object' then
    item := batch->'restriction';
    insert into public.restrictions (
      restriction_id, athlete_a_id, athlete_b_id, reason, active, created_by, created_at, updated_at
    ) values (
      item->>'restrictionId',
      item->>'athleteAId',
      item->>'athleteBId',
      coalesce(item->>'reason', ''),
      coalesce((item->>'active')::boolean, true),
      coalesce(item->>'createdBy', ''),
      (item->>'createdAt')::timestamptz,
      (item->>'updatedAt')::timestamptz
    )
    on conflict (restriction_id) do update set
      athlete_a_id = excluded.athlete_a_id,
      athlete_b_id = excluded.athlete_b_id,
      reason = excluded.reason,
      active = excluded.active,
      created_by = excluded.created_by,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at;
  end if;

  if batch ? 'override' and jsonb_typeof(batch->'override') = 'object' then
    item := batch->'override';
    insert into public.overrides (
      override_id, session_id, fighter_id, volunteer_id, allowed_numeric_limits_json,
      coach_email, reason, acknowledged_at, active
    ) values (
      item->>'overrideId',
      item->>'sessionId',
      item->>'fighterId',
      item->>'volunteerId',
      case
        when jsonb_typeof(item->'allowedNumericLimitsJson') = 'object' then item->'allowedNumericLimitsJson'
        when coalesce(item->>'allowedNumericLimitsJson', '') = '' then '{}'::jsonb
        else (item->>'allowedNumericLimitsJson')::jsonb
      end,
      coalesce(item->>'coachEmail', ''),
      coalesce(item->>'reason', ''),
      (item->>'acknowledgedAt')::timestamptz,
      coalesce((item->>'active')::boolean, true)
    )
    on conflict (override_id) do update set
      session_id = excluded.session_id,
      fighter_id = excluded.fighter_id,
      volunteer_id = excluded.volunteer_id,
      allowed_numeric_limits_json = excluded.allowed_numeric_limits_json,
      coach_email = excluded.coach_email,
      reason = excluded.reason,
      acknowledged_at = excluded.acknowledged_at,
      active = excluded.active;
  end if;

  item := batch->'audit';
  insert into public.audit_log (
    audit_id, session_id, actor_email, event_type, request_id,
    prior_revision, new_revision, timestamp, payload_json
  ) values (
    item->>'auditId',
    coalesce(item->>'sessionId', 'roster'),
    coalesce(item->>'actorEmail', ''),
    coalesce(item->>'eventType', ''),
    coalesce(item->>'requestId', ''),
    coalesce((item->>'priorRevision')::integer, 0),
    coalesce((item->>'newRevision')::integer, 0),
    (item->>'timestamp')::timestamptz,
    coalesce(item->'payload', '{}'::jsonb)
  );
end;
$$;

revoke all on function public.acquire_sparring_lock(text, text, integer) from public, anon, authenticated;
revoke all on function public.release_sparring_lock(text, text) from public, anon, authenticated;
revoke all on function public.commit_sparring_batch(jsonb) from public, anon, authenticated;
grant execute on function public.acquire_sparring_lock(text, text, integer) to service_role;
grant execute on function public.release_sparring_lock(text, text) to service_role;
grant execute on function public.commit_sparring_batch(jsonb) to service_role;

notify pgrst, 'reload schema';
