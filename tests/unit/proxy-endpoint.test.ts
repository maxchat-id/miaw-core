/**
 * formatProxyEndpoint - the identity shown for each `proxy test-all` row.
 *
 * Pure string formatting, so this is a unit test rather than another entry in
 * tests/integration/cli/11-proxy-commands.test.ts: asserting the
 * tail-preserving rule through the CLI would need hostnames long enough to
 * require DNS, and that file is deliberately offline.
 */

import { describe, it, expect } from "@jest/globals";
import { formatProxyEndpoint } from "../../src/cli/commands/proxy.js";

describe("formatProxyEndpoint", () => {
  it("should reduce a masked url to host:port", () => {
    expect(formatProxyEndpoint("http://user:****@192.0.2.10:5354/")).toBe(
      "192.0.2.10:5354"
    );
  });

  it("should carry no credentials, masked or otherwise", () => {
    const out = formatProxyEndpoint("http://vendoruser:****@1.2.3.4:8080/");
    expect(out).not.toContain("vendoruser");
    expect(out).not.toContain("****");
  });

  it("should distinguish pool members that share one long username", () => {
    // The regression: at width 40 the masked urls truncated to the same
    // string, so every row of `proxy test-all` read identically.
    const user = "vendorpool-static-residential-rotating";
    const a = formatProxyEndpoint(`http://${user}:****@127.0.0.1:1/`);
    const b = formatProxyEndpoint(`http://${user}:****@127.0.0.1:2/`);
    expect(a).not.toBe(b);
  });

  it("should keep the tail of an over-long endpoint so the port survives", () => {
    // Vendors commonly issue one gateway hostname with a per-session port, so
    // the port is the only distinguishing part. Right-truncation would
    // collapse those rows into each other exactly as the masked url did.
    const host = `${"gateway-region-pool".repeat(3)}.example.com`;
    const a = formatProxyEndpoint(`http://${host}:19001/`);
    const b = formatProxyEndpoint(`http://${host}:19002/`);

    expect(a).toContain(":19001");
    expect(b).toContain(":19002");
    expect(a).not.toBe(b);
  });

  it("should fit the column it is paired with", () => {
    const host = "x".repeat(200);
    // Two cells of padding, which is what cli-table3 reserves.
    expect(formatProxyEndpoint(`http://${host}:19001/`).length).toBe(34 - 2);
  });

  it("should mark a truncated endpoint with an ellipsis", () => {
    const host = `${"gateway-region-pool".repeat(3)}.example.com`;
    expect(formatProxyEndpoint(`http://${host}:19001/`).startsWith("…")).toBe(true);
  });

  it("should leave a short endpoint untouched", () => {
    expect(formatProxyEndpoint("socks5://127.0.0.1:1080/")).toBe("127.0.0.1:1080");
  });

  it("should fall back to the input when it is not a url", () => {
    expect(formatProxyEndpoint("not a url")).toBe("not a url");
  });
});
