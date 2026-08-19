import { describe, expect, it } from "vitest";
import { newMemberPassCode, normalizeMemberPassCode } from "./passes";
import { foldScanCode, newTicketCode, normalizeTicketCode } from "../ticketing/tickets";
import { DEFAULT_CODE_PATTERN, mintCode, newLicenseKey } from "@sailo/core/codes";

/**
 * The pass code, and the one property the door depends on.
 *
 * `checkInMemberByCode` itself needs a database and belongs to the scenario
 * suite — the interesting parts of it are a conditional claim and a live
 * entitlement read, neither of which a mock proves anything about. What is
 * worth pinning here is the code format, because `admitAnyCode` resolves a
 * ticket first and falls through to a membership only on `not_found`: if the
 * two code spaces could ever overlap, a member's pass could be swallowed by a
 * ticket lookup, or worse, admit against somebody else's ticket.
 */

describe("member pass codes", () => {
  it("is twelve characters in three groups", () => {
    const code = newMemberPassCode();
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it("never uses the four lookalike letters", () => {
    // 200 codes is 2,400 characters — if I, L, O or U were in the alphabet
    // this would fail essentially every run.
    for (let i = 0; i < 200; i += 1) {
      expect(newMemberPassCode()).not.toMatch(/[ILOU]/);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(newMemberPassCode());
    expect(seen.size).toBe(500);
  });
});

describe("normalizing what the door typed", () => {
  it("accepts lowercase, spaces and missing dashes", () => {
    const code = newMemberPassCode();
    const bare = code.replace(/-/g, "");
    expect(normalizeMemberPassCode(bare.toLowerCase())).toBe(code);
    expect(normalizeMemberPassCode(` ${bare} `)).toBe(code);
    expect(normalizeMemberPassCode(bare.replace(/(.{6})/, "$1 "))).toBe(code);
  });

  it("folds the four lookalikes back to what was printed", () => {
    // A member reading their own pass off a phone photo, getting all four
    // wrong at once. Every one has to land on the character we issued.
    expect(normalizeMemberPassCode("I234-5678-9ABC")).toBe("1234-5678-9ABC");
    expect(normalizeMemberPassCode("L234-5678-9ABC")).toBe("1234-5678-9ABC");
    expect(normalizeMemberPassCode("O234-5678-9ABC")).toBe("0234-5678-9ABC");
    expect(normalizeMemberPassCode("U234-5678-9ABC")).toBe("V234-5678-9ABC");
  });

  it("leaves a wrong-length string alone rather than inventing groups", () => {
    // A half-typed code must not be re-grouped into something that looks
    // valid — the door should show it back as the nonsense it is.
    expect(normalizeMemberPassCode("ABC")).toBe("ABC");
    expect(normalizeMemberPassCode("")).toBe("");
  });
});

describe("member passes and tickets cannot be confused", () => {
  /*
   * The load-bearing one. `admitAnyCode` tries a ticket, then a member pass,
   * and that ordering is only safe because a folded string cannot be a
   * candidate for both. Ten characters against twelve is what guarantees it —
   * not the odds, the arithmetic. If somebody ever shortens the pass to ten
   * to match the ticket, this fails and says why.
   */
  it("are different lengths once folded", () => {
    for (let i = 0; i < 100; i += 1) {
      const ticket = normalizeTicketCode(newTicketCode()).replace(/-/g, "");
      const pass = normalizeMemberPassCode(newMemberPassCode()).replace(/-/g, "");
      expect(ticket).toHaveLength(10);
      expect(pass).toHaveLength(12);
      expect(ticket).not.toBe(pass);
    }
  });

  it("a ticket code normalized as a pass keeps its own grouping", () => {
    // Ten characters through the pass normalizer is not twelve, so it is
    // returned ungrouped and will match no `pass_code` row.
    const ticket = newTicketCode();
    expect(normalizeMemberPassCode(ticket)).toBe(ticket.replace(/-/g, ""));
  });

  /*
   * Spec 48 added two more minted strings — a pool code and a licence key —
   * and this is where the property they had to satisfy is checked from the
   * side that cares. Neither is ever presented at a door today, and that is
   * exactly why the guarantee has to be arithmetic rather than a convention:
   * the day somebody adds a third branch to `admitAnyCode`, the lengths are
   * what will still be true.
   *
   * `codes.test.ts` asserts the same thing from the minting side, including
   * that a *pattern* folding to ten or twelve is refused before it can ever
   * produce one.
   */
  it("neither a pool code nor a licence key can be either length", () => {
    for (let i = 0; i < 100; i += 1) {
      expect(foldScanCode(mintCode(DEFAULT_CODE_PATTERN))).not.toHaveLength(10);
      expect(foldScanCode(mintCode(DEFAULT_CODE_PATTERN))).not.toHaveLength(12);
      expect(foldScanCode(newLicenseKey())).not.toHaveLength(10);
      expect(foldScanCode(newLicenseKey())).not.toHaveLength(12);
    }
  });
});
