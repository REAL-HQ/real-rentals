"""Offline evidence gate. Does not query providers, mutate state, or print payloads.

Inputs are operator-collected evidence, not independent verification. Missing or
unknown legacy sends must never be converted into zero. No bearer URLs allowed.
"""
import json, sys

def blockers(e):
    failures=[]
    required=['target_verified','fence_verified','cron_paused','all_origins_inventoried',
              'old_instances_quiesced','provider_inventory_complete',
              'pre_pause_sends_reconciled','tokens_preserved','audit_preserved',
              'published_candidate_verified','restart_approved']
    for key in required:
        if e.get(key) is not True: failures.append(key)
    for key in ['inflight_requests','pending_http_jobs','unaccounted_deliveries',
                'retrying_deliveries','unknown_delivery_outcomes']:
        if type(e.get(key)) is not int or e[key] != 0: failures.append(key)
    # A hold must be persistent, observable and separately released. This package
    # intentionally supports only completed/terminal deliveries, not guessed holds.
    for key in ['provider_evidence_ref','origin_inventory_ref','fence_evidence_ref']:
        if not isinstance(e.get(key),str) or not e[key].strip(): failures.append(key)
    return failures

if __name__=='__main__':
    try:
        bad=blockers(json.load(open(sys.argv[1])))
        print(json.dumps({'status':'BLOCKED' if bad else 'EVIDENCE_COMPLETE_REQUIRES_OPERATOR_VERIFICATION',
                          'missing_or_unsafe':bad}))
        sys.exit(1 if bad else 0)
    except (ValueError,OSError,IndexError,TypeError):
        print('{"status":"BLOCKED","reason":"INVALID_EVIDENCE"}')
        sys.exit(1)
