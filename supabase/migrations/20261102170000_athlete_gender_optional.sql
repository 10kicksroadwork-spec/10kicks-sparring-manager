-- Optional roster gender for a soft same-gender matching preference only.
-- Missing gender means no preference. Never inferred from names.

alter table public.athletes
  add column if not exists gender text;

alter table public.athletes drop constraint if exists athletes_gender_check;
alter table public.athletes
  add constraint athletes_gender_check
  check (gender is null or gender in ('FEMALE', 'MALE', 'OTHER'));

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
        athlete_id, display_name, weight_lbs, skill, aggression, gender, role_eligibility,
        active, coach_notes, created_at, updated_at
      ) values (
        item->>'athleteId',
        item->>'displayName',
        (item->>'weightLbs')::numeric,
        (item->>'skill')::integer,
        (item->>'aggression')::integer,
        nullif(upper(coalesce(item->>'gender', '')), ''),
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
        gender = excluded.gender,
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

revoke all on function public.commit_sparring_batch(jsonb) from public, anon, authenticated;
grant execute on function public.commit_sparring_batch(jsonb) to service_role;

notify pgrst, 'reload schema';
