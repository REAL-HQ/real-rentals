import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CARD_LINK_MAX_AGE_MS,
  CARD_LINK_MS,
  cardEmailHref,
  cardLinkFresh,
  cardTextHref,
  forgetCachedCardLink,
  readCachedCardLink,
  rememberCachedCardLink,
  type CachedCardLink,
} from "../src/lib/card-link-cache";

const NOW = Date.parse("2026-10-21T15:00:00.000Z");

describe("card link cache", () => {
  it("keeps a link until it is about 71 hours old", () => {
    assert.equal(CARD_LINK_MS - CARD_LINK_MAX_AGE_MS, 60 * 60 * 1000);
    const cache = new Map<string, CachedCardLink>();
    const fresh = { link: "https://drivereal.com/card/a?t=card.abc", expiresAt: NOW + CARD_LINK_MS };
    rememberCachedCardLink(cache, "a", fresh);
    assert.equal(readCachedCardLink(cache, "a", NOW)?.link, fresh.link);
    assert.equal(cardLinkFresh(NOW + 2 * 60 * 60 * 1000, NOW), true);
    const aging = { link: fresh.link, expiresAt: NOW + 30 * 60 * 1000 };
    rememberCachedCardLink(cache, "a", aging);
    assert.equal(readCachedCardLink(cache, "a", NOW), null);
    assert.equal(cache.has("a"), false);
  });

  it("clears a remembered link", () => {
    const cache = new Map<string, CachedCardLink>();
    rememberCachedCardLink(cache, "a", { link: "https://example.test/card", expiresAt: NOW + CARD_LINK_MS });
    forgetCachedCardLink(cache, "a");
    assert.equal(readCachedCardLink(cache, "a", NOW), null);
  });

  it("builds sms and mailto anchors from the prepared link", () => {
    const link = "https://drivereal.com/card/a?t=card.abc";
    const sms = cardTextHref("555", link);
    const mailto = cardEmailHref("ada@example.com", link);
    assert.equal(sms.startsWith("sms:555?"), true);
    assert.equal(decodeURIComponent(sms).includes(link), true);
    assert.equal(mailto.startsWith("mailto:ada@example.com?"), true);
    assert.equal(decodeURIComponent(mailto).includes(link), true);
  });
});
