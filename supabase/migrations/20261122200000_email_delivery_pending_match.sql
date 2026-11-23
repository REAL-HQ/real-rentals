-- Lead alert reliability (Dolmar, Nov 22 2026).
--
-- A send whose request was cut off after Resend accepted it left its row at
-- "sending" with no Resend id, and Resend's webhook then landed in a separate
-- "unmatched" row. This migration:
--   1. stores the subject (and a small meta object) on each delivery row so a
--      webhook can find the row it belongs to;
--   2. makes email_delivery_attach never move a row backwards (a webhook can
--      now attach first, and the sender's own attach must not undo it);
--   3. adds email_delivery_claim_pending: for an unmatched webhook, fold it
--      into the ONE pending "sending" row with the same recipient (and the same
--      subject when both are known) created just before the send. Two or more
--      candidates = ambiguous = left unmatched.
-- Idempotent. No data is changed by applying it.

alter table public.email_deliveries add column if not exists subject text;
alter table public.email_deliveries add column if not exists meta jsonb;

create index if not exists email_deliveries_pending_idx
  on public.email_deliveries (lower(recipient), created_at)
  where state = 'sending' and resend_message_id is null;

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
    -- Highest of: what the row already has, what the placeholder had, accepted.
    state = (select s from unnest(array[d.state, case when found_p then p.state end, 'accepted']) s
             where s is not null order by public.email_state_rank(s) desc, s limit 1),
    accepted_at = coalesce(d.accepted_at, p.accepted_at, now()),
    delivered_at = coalesce(d.delivered_at, p.delivered_at),
    bounced_at = coalesce(d.bounced_at, p.bounced_at),
    complained_at = coalesce(d.complained_at, p.complained_at),
    failed_at = coalesce(d.failed_at, p.failed_at),
    provider_reason = coalesce(p.provider_reason, d.provider_reason),
    updated_at = now()
  where d.id = _id;
end $$;

create or replace function public.email_delivery_claim_pending(
  _resend_id text, _recipient text, _subject text, _sent_at timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare cand uuid; n int; at timestamptz := coalesce(_sent_at, now());
begin
  if coalesce(_resend_id, '') = '' or coalesce(_recipient, '') = '' then return 'skipped'; end if;
  perform pg_advisory_xact_lock(hashtext('email_delivery:' || _resend_id));
  -- Only a still-unmatched placeholder is claimed.
  if not exists (select 1 from public.email_deliveries
                 where resend_message_id = _resend_id and workflow = 'unmatched') then
    return 'not_unmatched';
  end if;
  select count(*), (array_agg(id order by created_at))[1] into n, cand
    from public.email_deliveries
   where state = 'sending' and resend_message_id is null and workflow <> 'unmatched'
     and lower(recipient) = lower(_recipient)
     and created_at between at - interval '2 minutes' and at + interval '10 seconds'
     and (_subject is null or subject is null or subject = left(_subject, 300));
  if n <> 1 then return case when n = 0 then 'no_candidate' else 'ambiguous' end; end if;
  perform public.email_delivery_attach(cand, _resend_id);
  return 'attached';
end $$;

revoke all on function public.email_delivery_attach(uuid,text) from public, anon, authenticated;
revoke all on function public.email_delivery_claim_pending(text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.email_delivery_attach(uuid,text) to service_role;
grant execute on function public.email_delivery_claim_pending(text,text,text,timestamptz) to service_role;
