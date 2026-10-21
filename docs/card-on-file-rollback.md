# Card-on-file rollback

Required, before or with any revert of the card-link behavior. On the source branch that is `7332975f`, `ec783a04`, or `19d4ff5f`. On `integration/rc17-card-on-file` those changes are `d0799090` (from `7332975f`), `cd2417f2` (from `ec783a04`), and `322d7d0e` (from `19d4ff5f`), followed by `a56486f9` and `fac2f96b`. Reverting this RC to `4ba33ac9` is the same rollback.

The resume code on `7e3e6eb` and on `4ba33ac9` accepts a card row in both exchange and resolve. After a revert, or while an old instance is still serving during a mixed deploy, a live card link opens and edits the application.

The step below is a production data change. It needs owner approval at rollback time. Do not run it as part of this pull request, and do not run it while this RC is only a draft.

```sql
UPDATE public.application_resume_tokens
SET revoked_at = now()
WHERE revoked_at IS NULL
  AND expires_at - created_at = interval '72 hours';
```

Deploy the reverted build at 100%, not gradually. A partial rollout leaves the old code serving next to live card rows.

There is no migration to undo. `revokeResumeTokens(appId)` is a different tool: it revokes every live link for one application, including thank-you links. Customers already saved on `stripe_customer_id` stay. Reverting the auth change restores bare-id customer creation.
