import { describe, expect, it } from "bun:test";
import { personInitials } from "../src/lib/display-normalize";

describe("account avatar initials", () => {
  it("uses Dolmar Cross's first and last initials", () => {
    expect(personInitials("Dolmar Cross")).toBe("DC");
  });

  it("uses the last name rather than a middle name", () => {
    expect(personInitials("Jane Marie Smith")).toBe("JS");
  });

  it("handles whitespace and lowercase names", () => {
    expect(personInitials("  dolmar   cross  ")).toBe("DC");
  });

  it("does not invent a last initial for a single name", () => {
    expect(personInitials("Dolmar")).toBe("D");
  });

  it("supports the existing dotted email-name fallback", () => {
    expect(personInitials("dolmar.cross")).toBe("DC");
  });

  it("provides an initial when no name is available", () => {
    expect(personInitials("  ")).toBe("A");
  });
});