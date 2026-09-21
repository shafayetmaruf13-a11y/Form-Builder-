import { customAlphabet } from "nanoid";

/**
 * Public link slugs.
 *
 * Architecture rule 6: a fill page is an untrusted surface reachable by anyone
 * holding the URL, so the URL *is* the access control. Two properties follow.
 *
 * **Unguessable.** 22 characters of a 32-symbol alphabet is 110 bits. Somebody
 * enumerating at a million guesses a second is not getting a hit before the
 * heat death of anything. This is deliberately far more than a nanoid default —
 * the cost is a longer URL, which nobody types anyway.
 *
 * **Unmistakable.** The alphabet drops `0/O`, `1/l/I` and `u/v`, so a slug read
 * off a printed page or over the phone cannot land on a *different* valid form.
 * Lower case only, for the same reason: a URL is not reliably case-preserved by
 * every chat client and mail scanner that touches it.
 */

/** Crockford-ish: no vowels that make words, no visually confusable pairs. */
export const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstwxyz";

export const SLUG_LENGTH = 22;

const generate = customAlphabet(SLUG_ALPHABET, SLUG_LENGTH);

export function newSlug(): string {
  return generate();
}

/**
 * An optional second secret, for a link the owner wants to restrict further.
 *
 * Kept separate from the slug so it can be rotated without invalidating a URL
 * that is already printed on something.
 */
export function newLinkToken(): string {
  return customAlphabet(SLUG_ALPHABET, 32)();
}

/**
 * Whether a string could be one of our slugs.
 *
 * Cheap rejection before the database is touched, so a scan of `/f/<junk>` costs
 * a regex rather than a query. Not a security boundary — the lookup is.
 */
export function isSlugShaped(value: string): boolean {
  return (
    value.length === SLUG_LENGTH &&
    [...value].every((character) => SLUG_ALPHABET.includes(character))
  );
}

/**
 * Constant-time string comparison, for the link token.
 *
 * `===` on secrets leaks their prefix through timing. The comparison is short
 * and the leak is small, but it is free to not have it.
 */
export function secretEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return difference === 0;
}
