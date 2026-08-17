import { describe, expect, it } from "vitest";
import { isPublicAddress } from "./ip";

/**
 * The guard that decides whether Sailo will open a socket to an address.
 *
 * Tested exhaustively rather than representatively, because every entry in
 * this file is a hole if it is missing and there is no way to notice a missing
 * one in production — an SSRF that works looks exactly like a webhook that
 * worked.
 */

describe("isPublicAddress", () => {
  it("accepts ordinary public IPv4", () => {
    for (const address of [
      "1.1.1.1",
      "8.8.8.8",
      "34.117.59.81", // a Google Cloud front end, where a real hook lives
      "104.18.0.1",
      "199.232.1.1",
      "223.255.255.255", // the last address before multicast
    ]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("refuses every private, reserved and special IPv4 range", () => {
    for (const address of [
      "0.0.0.0", // "this network" — reaches localhost on Linux
      "0.1.2.3",
      "10.0.0.1",
      "10.255.255.255",
      "127.0.0.1",
      "127.1.1.1",
      "100.64.0.1", // carrier-grade NAT
      "100.127.255.255",
      "169.254.169.254", // cloud metadata — the one that steals credentials
      "169.254.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.1", // IETF protocol assignments
      "192.0.2.1", // TEST-NET-1
      "192.168.1.1",
      "198.18.0.1", // benchmarking
      "198.19.255.255",
      "198.51.100.1", // TEST-NET-2
      "203.0.113.1", // TEST-NET-3
      "224.0.0.1", // multicast
      "239.255.255.255",
      "240.0.0.1", // reserved
      "255.255.255.255",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("accepts the addresses either side of a private block", () => {
    // The classic off-by-one: 172.16/12 is 172.16–172.31, not 172.16–172.32.
    expect(isPublicAddress("172.15.255.255")).toBe(true);
    expect(isPublicAddress("172.32.0.1")).toBe(true);
    expect(isPublicAddress("100.63.255.255")).toBe(true);
    expect(isPublicAddress("100.128.0.1")).toBe(true);
    expect(isPublicAddress("11.0.0.1")).toBe(true);
    expect(isPublicAddress("9.255.255.255")).toBe(true);
  });

  it("refuses alternative notations rather than resolving them", () => {
    /*
     * The classic filter bypass: write a private address in a notation the
     * checker reads one way and the resolver reads another. `010.0.0.1` is
     * octal to some stacks, `0x7f.1` hexadecimal to others. Neither is a form
     * we need to accept, so both are simply not addresses.
     */
    for (const address of [
      "010.0.0.1",
      "0177.0.0.1",
      "0x7f.0.0.1",
      "2130706433", // 127.0.0.1 as a single integer
      "127.1",
      "1.1.1.1.1",
      "1.1.1",
      "1.1.1.256",
      "",
      "   ",
      "not-an-address",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("accepts public IPv6", () => {
    for (const address of [
      "2606:4700:4700::1111",
      "2001:4860:4860::8888",
      "2a00:1450:4009:81f::200e",
    ]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("refuses loopback, unspecified, link-local, ULA and multicast IPv6", () => {
    for (const address of [
      "::",
      "::1",
      "[::1]",
      "fe80::1",
      "fe80::1%eth0", // a zone index is a local scope by definition
      "febf::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("unwraps IPv4 smuggled inside IPv6", () => {
    /*
     * A checker that knows only the fc00::/7 and fe80::/10 prefixes waves
     * every one of these straight through to the metadata endpoint.
     */
    expect(isPublicAddress("::ffff:169.254.169.254")).toBe(false);
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:a9fe:a9fe")).toBe(false); // the same, in hex
    expect(isPublicAddress("64:ff9b::169.254.169.254")).toBe(false); // NAT64
    expect(isPublicAddress("2002:a9fe:a9fe::1")).toBe(false); // 6to4

    // And still lets the public ones through by the same route.
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicAddress("64:ff9b::1.1.1.1")).toBe(true);
  });

  it("refuses malformed IPv6 rather than guessing", () => {
    for (const address of [
      "1:2:3:4:5:6:7", // too few groups, no ::
      "1:2:3:4:5:6:7:8:9",
      "1::2::3", // two run-length markers
      "gggg::1",
      "::ffff:999.1.1.1",
      "1:2:3:4:5:6:1.2.3.4:7", // dotted quad not in the tail
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });
});
