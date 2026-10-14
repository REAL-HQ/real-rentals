-- REVIEW ONLY. Install atomically AFTER the PR39 reservation package. No journal entry.
-- Does not change PR39's SQL or mutation contract; explicit bounded read projections only.
DO $$ BEGIN IF to_regclass('public.reservations') IS NULL OR to_regprocedure('private.reservation_eligible(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'reservation_interface_prerequisites_missing'; END IF; END $$;
CREATE FUNCTION public.reservation_interface_list(_view text,_after timestamptz DEFAULT '-infinity',_after_id uuid DEFAULT '00000000-0000-0000-0000-000000000000') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role IN ('admin','team','coordinator')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF _view NOT IN ('drafts','upcoming','history') THEN RAISE EXCEPTION 'invalid_view'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY pickup_at,id) FROM (
 SELECT r.id,r.application_id,r.vehicle_id,r.state,r.pickup_at,r.timezone,r.agreed_end_at,r.hold_expires_at,r.version,a.full_name AS applicant_name,
 CASE WHEN v.id IS NULL THEN NULL ELSE concat_ws(' ',v.unit_number,v.year,v.make,v.model) END AS vehicle_label,
 CASE WHEN v.id IS NULL THEN ARRAY['Vehicle unassigned — no allocation'] ELSE private.vehicle_release_reasons(v.id)
 || CASE WHEN v.status NOT IN ('available','reserved') THEN ARRAY['Vehicle currently unavailable; verify before allocation'] ELSE '{}'::text[] END
 || CASE WHEN EXISTS(SELECT 1 FROM public.rentals WHERE vehicle_id=v.id AND status='active') THEN ARRAY['Active rental — no assumed return date'] ELSE '{}'::text[] END END AS warnings
 FROM public.reservations r JOIN public.applications a ON a.id=r.application_id LEFT JOIN public.vehicles v ON v.id=r.vehicle_id
 WHERE (r.pickup_at,r.id)>(_after,_after_id) AND CASE _view WHEN 'drafts' THEN r.state='draft' WHEN 'upcoming' THEN r.state IN ('reserved','confirmed') ELSE r.state IN ('cancelled','expired','converted') END
 ORDER BY r.pickup_at,r.id LIMIT 50) p),'[]'::jsonb);
END $$;
CREATE FUNCTION public.reservation_interface_history(_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role IN ('admin','team','coordinator')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY occurred_at DESC) FROM (
 SELECT action,occurred_at,before_record->>'state' AS from_state,after_record->>'state' AS to_state FROM public.reservation_history WHERE reservation_id=_id ORDER BY id DESC LIMIT 50) p),'[]'::jsonb);
END $$;
CREATE FUNCTION public.reservation_interface_options(_q text DEFAULT '',_pickup timestamptz DEFAULT NULL,_end timestamptz DEFAULT NULL,_exclude uuid DEFAULT NULL,_vehicle_q text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE apps jsonb; vehs jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role IN ('admin','team')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) INTO apps FROM (
 SELECT a.id,a.full_name AS name,m.timezone FROM public.applications a LEFT JOIN public.reservation_market_rules m ON m.market_id=a.market_id
 WHERE a.status='approved' AND a.full_name ILIKE '%'||left(coalesce(_q,''),100)||'%' ORDER BY a.full_name,a.id LIMIT 25) p;
 SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) INTO vehs FROM (
 SELECT v.id,concat_ws(' ',v.unit_number,v.year,v.make,v.model) AS label,m.timezone,
 private.vehicle_release_reasons(v.id)
 || CASE WHEN v.status NOT IN ('available','reserved') OR v.status IS NULL THEN ARRAY['Vehicle unavailable or on maintenance/safety hold'] ELSE '{}'::text[] END
 || CASE WHEN EXISTS(SELECT 1 FROM public.rentals WHERE vehicle_id=v.id AND status='active') THEN ARRAY['Active rental blocks allocation; no assumed return date'] ELSE '{}'::text[] END
 || CASE WHEN m.market_id IS NULL THEN ARRAY['Market timezone/turnaround unconfigured'] ELSE '{}'::text[] END
 || CASE WHEN NOT EXISTS(SELECT 1 FROM public.inspections i WHERE i.vehicle_id=v.id AND i.inspection_type='pre_delivery' AND i.status='passed' AND i.completed_at<=clock_timestamp()
 AND EXISTS(SELECT 1 FROM public.inspection_items x WHERE x.inspection_id=i.id)
 AND NOT EXISTS(SELECT 1 FROM public.inspection_items x WHERE x.inspection_id=i.id AND (x.result IS NULL OR x.result NOT IN ('pass','fail','na') OR (x.is_critical AND x.result='fail')))) THEN ARRAY['Completed pre-delivery evidence missing'] ELSE '{}'::text[] END AS reasons,
 CASE WHEN _pickup IS NULL OR m.market_id IS NULL OR (_end IS NOT NULL AND _end<=_pickup) THEN NULL ELSE EXISTS(SELECT 1 FROM public.reservations r WHERE r.vehicle_id=v.id AND r.state IN ('reserved','confirmed') AND (_exclude IS NULL OR r.id<>_exclude)
 AND tstzrange(r.pickup_at,r.occupied_until,'[)') && tstzrange(_pickup,_end+make_interval(mins=>m.turnaround_minutes),'[)')) END AS conflict
 FROM public.vehicles v LEFT JOIN public.reservation_market_rules m ON m.market_id=v.market_id WHERE v.archived_at IS NULL AND concat_ws(' ',v.unit_number,v.year,v.make,v.model) ILIKE '%'||left(coalesce(_vehicle_q,''),100)||'%' ORDER BY v.id LIMIT 50) p;
 RETURN jsonb_build_object('applicants',apps,'vehicles',vehs);
END $$;
REVOKE ALL ON FUNCTION public.reservation_interface_list(text,timestamptz,uuid),public.reservation_interface_history(uuid),public.reservation_interface_options(text,timestamptz,timestamptz,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reservation_interface_list(text,timestamptz,uuid),public.reservation_interface_history(uuid),public.reservation_interface_options(text,timestamptz,timestamptz,uuid,text) TO authenticated;
