import { z } from "zod";

/**
 * A phone number as people actually type one.
 *
 * The character set is the point, not the formatting. This value is matched
 * against `applications.phone` in duplicate detection, and it used to be
 * interpolated into a PostgREST `or=(...)` filter where a comma separates
 * conditions — so a "phone number" of `1234567,status.eq.new` added a
 * condition of the caller's choosing and widened the match to a stranger's
 * application, which the handler then overwrote and issued a resume token for.
 *
 * The query no longer splices anything into a filter expression, so this is
 * the second of two locks rather than the only one. It stays because the first
 * lock is one refactor away from being reopened.
 */
export const applicantPhone = z
  .string()
  .trim()
  .min(7)
  .max(30)
  .regex(/^[0-9+()\-.\s]+$/, "Enter a valid phone number");
