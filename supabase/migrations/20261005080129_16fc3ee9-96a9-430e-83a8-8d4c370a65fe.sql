
create or replace function public.email_state_rank(_s text) returns int
language sql immutable set search_path = public as $$
  select case _s when 'sending' then 0 when 'accepted' then 1 when 'delivered' then 2
    when 'failed' then 3 when 'bounced' then 3 when 'complained' then 4 else 0 end
$$;

-- Webhook side: record one provider event by Resend email id. Creates an
-- 'unmatched' placeholder if the app has not attached the id yet.
create or replace function public.email_delivery_event(_resend_id text, _state text, _reason text, _recipient text)
returns text language plpgsql security definer set search_path = public as $$
declare r public.email_deliveries;
begin
  if _state not in ('accepted','delivered','bounced','complained','failed') then
    raise exception 'invalid state';
  end if;
  perform pg_advisory_xact_lock(hashtext('email_delivery:' || _resend_id));
  select * into r from public.email_deliveries where resend_message_id = _resend_id for update;
  if not found then
    insert into public.email_deliveries(resend_message_id, workflow, recipient, state,
      accepted_at, delivered_at, bounced_at, complained_at, failed_at, provider_reason)
    values (_resend_id, 'unmatched', coalesce(nullif(_recipient,''), 'unknown'), _state,
      case when _state='accepted' then now() end,
      case when _state='delivered' then now() end,
      case when _state='bounced' then now() end,
      case when _state='complained' then now() end,
      case when _state='failed' then now() end,
      left(_reason, 500));
    return 'unmatched';
  end if;
  update public.email_deliveries set
    state = case when public.email_state_rank(_state) > public.email_state_rank(state) then _state else state end,
    accepted_at   = case when _state='accepted'   then coalesce(accepted_at, now())   else accepted_at end,
    delivered_at  = case when _state='delivered'  then coalesce(delivered_at, now())  else delivered_at end,
    bounced_at    = case when _state='bounced'    then coalesce(bounced_at, now())    else bounced_at end,
    complained_at = case when _state='complained' then coalesce(complained_at, now()) else complained_at end,
    failed_at     = case when _state='failed'     then coalesce(failed_at, now())     else failed_at end,
    provider_reason = coalesce(left(_reason, 500), provider_reason),
    updated_at = now()
  where id = r.id;
  return case when r.workflow = 'unmatched' then 'unmatched' else 'matched' end;
end $$;

-- Send side: attach the Resend id to the row created before sending, folding
-- in any placeholder an early webhook already created.
create or replace function public.email_delivery_attach(_id uuid, _resend_id text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.email_deliveries; found_p boolean;
begin
  perform pg_advisory_xact_lock(hashtext('email_delivery:' || _resend_id));
  select * into p from public.email_deliveries where resend_message_id = _resend_id and id <> _id for update;
  found_p := found;
  if found_p then delete from public.email_deliveries where id = p.id; end if;
  update public.email_deliveries d set
    resend_message_id = _resend_id,
    state = case when found_p and public.email_state_rank(p.state) > 1 then p.state else 'accepted' end,
    accepted_at = coalesce(d.accepted_at, p.accepted_at, now()),
    delivered_at = coalesce(d.delivered_at, p.delivered_at),
    bounced_at = coalesce(d.bounced_at, p.bounced_at),
    complained_at = coalesce(d.complained_at, p.complained_at),
    failed_at = coalesce(d.failed_at, p.failed_at),
    provider_reason = coalesce(p.provider_reason, d.provider_reason),
    updated_at = now()
  where d.id = _id;
end $$;

revoke all on function public.email_state_rank(text) from public, anon, authenticated;
revoke all on function public.email_delivery_event(text,text,text,text) from public, anon, authenticated;
revoke all on function public.email_delivery_attach(uuid,text) from public, anon, authenticated;
grant execute on function public.email_state_rank(text) to service_role;
grant execute on function public.email_delivery_event(text,text,text,text) to service_role;
grant execute on function public.email_delivery_attach(uuid,text) to service_role;

revoke insert, update, delete, truncate, references, trigger on public.email_deliveries from anon, authenticated;
revoke select on public.email_deliveries from anon;
