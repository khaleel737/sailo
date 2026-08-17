import { afterEach, describe, expect, it } from "vitest";
import { publicShopUrl } from "./card-checkout";

const original = process.env.NEXT_PUBLIC_APP_URL;
afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = original;
});

const at = (base: string) => {
  process.env.NEXT_PUBLIC_APP_URL = base;
  return publicShopUrl("khaleel-musleh");
};

describe("publicShopUrl", () => {
  it("passes a real public address through", () => {
    expect(at("https://sailo.store")).toBe("https://sailo.store/khaleel-musleh");
    expect(at("https://www.sailo.store")).toBe(
      "https://www.sailo.store/khaleel-musleh",
    );
  });

  it("allows a preview deployment, which Stripe can reach", () => {
    expect(at("https://sailo-git-main.vercel.app")).toBe(
      "https://sailo-git-main.vercel.app/khaleel-musleh",
    );
  });

  /*
   * The reason this function exists. Stripe answers a local URL with a bare
   * "Not a valid URL" naming no field, so pressing Connect on a dev machine
   * produced a runtime error page and no clue which parameter was wrong.
   */
  it("refuses anything Stripe cannot reach", () => {
    expect(at("http://localhost:3000")).toBeNull();
    expect(at("http://localhost")).toBeNull();
    expect(at("http://127.0.0.1:3000")).toBeNull();
    expect(at("http://192.168.0.198:3000")).toBeNull();
    expect(at("http://my-mac.local:3000")).toBeNull();
    expect(at("http://shop.localhost:3000")).toBeNull();
    // A bare hostname resolves on a LAN and nowhere else.
    expect(at("http://intranet:3000")).toBeNull();
  });

  it("refuses a malformed or non-web base", () => {
    expect(at("not a url")).toBeNull();
    expect(at("ftp://files.example.com")).toBeNull();
  });
});
