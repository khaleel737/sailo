import { describe, expect, it } from "vitest";
import {
  HANDLE_MESSAGES,
  normalizeHandle,
  RESERVED_HANDLES,
  suggestHandles,
  validateHandleFormat,
} from "@/lib/handle";

describe("normalizeHandle", () => {
  it.each([
    ["  My Shop!  ", "myshop"],
    ["Clay & Co.", "clayco"],
    ["ALREADY-fine_1", "already-fine_1"],
    ["émoji✨shop", "mojishop"],
  ])("normalises %s", (given, expected) => {
    expect(normalizeHandle(given)).toBe(expected);
  });

  it("is idempotent", () => {
    const once = normalizeHandle("My Shop!");
    expect(normalizeHandle(once)).toBe(once);
  });
});

describe("validateHandleFormat", () => {
  it("accepts a well-formed handle", () => {
    expect(validateHandleFormat("clay-co_1")).toBeNull();
  });

  it.each([
    ["", "empty"],
    ["ab", "too_short"],
    ["a".repeat(33), "too_long"],
    ["admin", "reserved"],
    ["!!!", "invalid_chars"],
  ])("rejects %s as %s", (given, problem) => {
    expect(validateHandleFormat(given)).toBe(problem);
  });

  it("has a message for every problem it can report", () => {
    for (const key of Object.keys(HANDLE_MESSAGES)) {
      expect(HANDLE_MESSAGES[key as keyof typeof HANDLE_MESSAGES]).toBeTruthy();
    }
  });

  it("reserves the routes the app itself owns", () => {
    // A shop at /admin or /login would shadow the app's own pages.
    for (const reserved of ["admin", "login", "signup", "api"]) {
      expect(RESERVED_HANDLES.has(reserved)).toBe(true);
      expect(validateHandleFormat(reserved)).toBe("reserved");
    }
  });
});

describe("suggestHandles", () => {
  it("offers alternatives", () => {
    const suggestions = suggestHandles("clay");
    expect(suggestions.length).toBeGreaterThan(0);
    expect(new Set(suggestions).size).toBe(suggestions.length);
  });

  it("only ever suggests handles that would themselves be valid", () => {
    for (const s of suggestHandles("clay")) {
      expect(validateHandleFormat(s)).toBeNull();
    }
  });

  it("suggests something usable even for a reserved word", () => {
    const suggestions = suggestHandles("admin");
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) expect(validateHandleFormat(s)).toBeNull();
  });
});
