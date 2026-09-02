/**
 * Unit Tests for Proxy Agent Utilities
 *
 * Tests validateProxyConfig() and createProxyAgents() from src/utils/proxy-agent.ts
 */

import { describe, it, expect } from "@jest/globals";
import {
  validateProxyConfig,
  createProxyAgents,
  maskProxyUrl,
} from "../../src/utils/proxy-agent.js";
import type { ProxyConfig } from "../../src/types/index.js";

describe("Proxy Agent Utilities", () => {
  describe("validateProxyConfig", () => {
    describe("valid configurations", () => {
      it("should accept HTTP proxy URL", () => {
        expect(validateProxyConfig("http://proxy.example.com:8080")).toBe(true);
      });

      it("should accept HTTPS proxy URL", () => {
        expect(validateProxyConfig("https://proxy.example.com:8080")).toBe(
          true
        );
      });

      it("should accept SOCKS4 proxy URL", () => {
        expect(validateProxyConfig("socks4://proxy.example.com:1080")).toBe(
          true
        );
      });

      it("should accept SOCKS5 proxy URL", () => {
        expect(validateProxyConfig("socks5://proxy.example.com:1080")).toBe(
          true
        );
      });

      it("should accept SOCKS5h proxy URL (DNS resolved at the proxy)", () => {
        expect(validateProxyConfig("socks5h://proxy.example.com:1080")).toBe(
          true
        );
      });

      it("should accept SOCKS4a proxy URL (DNS resolved at the proxy)", () => {
        expect(validateProxyConfig("socks4a://proxy.example.com:1080")).toBe(
          true
        );
      });

      it("should accept SOCKS proxy URL (generic)", () => {
        expect(validateProxyConfig("socks://proxy.example.com:1080")).toBe(
          true
        );
      });

      it("should accept proxy URL with authentication", () => {
        expect(
          validateProxyConfig("socks5://user:pass@proxy.example.com:1080")
        ).toBe(true);
      });

      it("should accept ProxyConfig object", () => {
        const config: ProxyConfig = { url: "http://proxy.example.com:8080" };
        expect(validateProxyConfig(config)).toBe(true);
      });

      it("should accept ProxyConfig object with auth fields", () => {
        const config: ProxyConfig = {
          url: "http://proxy.example.com:8080",
          username: "user",
          password: "pass",
        };
        expect(validateProxyConfig(config)).toBe(true);
      });
    });

    describe("invalid configurations", () => {
      it("should reject non-URL string", () => {
        expect(validateProxyConfig("not-a-url")).toBe(false);
      });

      it("should reject empty string", () => {
        expect(validateProxyConfig("")).toBe(false);
      });

      it("should reject FTP protocol", () => {
        expect(validateProxyConfig("ftp://proxy.example.com:21")).toBe(false);
      });

      it("should reject invalid ProxyConfig object", () => {
        const config: ProxyConfig = { url: "not-a-url" };
        expect(validateProxyConfig(config)).toBe(false);
      });

      it("should reject unsupported protocol", () => {
        expect(validateProxyConfig("ws://proxy.example.com:8080")).toBe(false);
      });
    });
  });

  describe("createProxyAgents", () => {
    describe("HTTP/HTTPS proxies", () => {
      it("should create both wsAgent and fetchAgent for HTTP proxy", async () => {
        const agents = await createProxyAgents("http://proxy.example.com:8080");

        expect(agents.wsAgent).toBeDefined();
        expect(agents.fetchAgent).toBeDefined();
        // wsAgent should be an HttpsProxyAgent (extends http.Agent)
        expect(agents.wsAgent.constructor.name).toBe("HttpsProxyAgent");
      });

      it("should create both wsAgent and fetchAgent for HTTPS proxy", async () => {
        const agents = await createProxyAgents(
          "https://proxy.example.com:8080"
        );

        expect(agents.wsAgent).toBeDefined();
        expect(agents.fetchAgent).toBe(agents.wsAgent);
        expect(agents.downloadDispatcher).toBeDefined();
        expect(agents.wsAgent.constructor.name).toBe("HttpsProxyAgent");
      });
    });

    describe("SOCKS proxies", () => {
      // fetchAgent carries media UPLOADS via https.request({ agent }), so it
      // must be the same http.Agent as wsAgent - including for SOCKS. Only
      // downloadDispatcher (undici, which has no SOCKS transport) is absent.
      it.each(["socks5", "socks4", "socks", "socks5h", "socks4a"])(
        "should reuse wsAgent as fetchAgent and omit downloadDispatcher for %s",
        async (scheme) => {
          const agents = await createProxyAgents(
            `${scheme}://proxy.example.com:1080`
          );

          expect(agents.wsAgent).toBeDefined();
          expect(agents.wsAgent.constructor.name).toBe("SocksProxyAgent");
          expect(agents.fetchAgent).toBe(agents.wsAgent);
          expect(agents.downloadDispatcher).toBeUndefined();
        }
      );
    });

    describe("ProxyConfig object", () => {
      it("should handle ProxyConfig with URL only", async () => {
        const agents = await createProxyAgents({
          url: "http://proxy.example.com:8080",
        });

        expect(agents.wsAgent).toBeDefined();
        expect(agents.fetchAgent).toBe(agents.wsAgent);
        expect(agents.downloadDispatcher).toBeDefined();
      });

      it("should merge separate auth credentials into URL", async () => {
        const agents = await createProxyAgents({
          url: "http://proxy.example.com:8080",
          username: "testuser",
          password: "testpass",
        });

        expect(agents.wsAgent).toBeDefined();
        expect(agents.fetchAgent).toBe(agents.wsAgent);
        expect(agents.downloadDispatcher).toBeDefined();
      });

      it("should handle SOCKS5 ProxyConfig with auth", async () => {
        const agents = await createProxyAgents({
          url: "socks5://proxy.example.com:1080",
          username: "testuser",
          password: "testpass",
        });

        expect(agents.wsAgent).toBeDefined();
        expect(agents.fetchAgent).toBe(agents.wsAgent);
        expect(agents.downloadDispatcher).toBeUndefined();
      });
    });

    describe("error handling", () => {
      it("should throw for unsupported protocol", async () => {
        await expect(
          createProxyAgents("ftp://proxy.example.com:21")
        ).rejects.toThrow("Unsupported proxy protocol");
      });

      it("should throw for invalid URL", async () => {
        await expect(createProxyAgents("not-a-url")).rejects.toThrow();
      });

      it("should throw for empty string", async () => {
        await expect(createProxyAgents("")).rejects.toThrow();
      });
    });
  });

  describe("maskProxyUrl", () => {
    it("should mask the password", () => {
      const masked = maskProxyUrl("http://user:s3cret@proxy.example.com:8080");
      expect(masked).not.toContain("s3cret");
      expect(masked).toContain("****");
    });

    it("should preserve the username", () => {
      expect(maskProxyUrl("http://sticky-us-1:pw@proxy.example.com:8080")).toContain(
        "sticky-us-1"
      );
    });

    it("should leave a URL without credentials unchanged", () => {
      expect(maskProxyUrl("socks5://proxy.example.com:1080")).toBe(
        "socks5://proxy.example.com:1080"
      );
    });

    it("should mask credentials supplied via ProxyConfig fields", () => {
      const config: ProxyConfig = {
        url: "http://proxy.example.com:8080",
        username: "user",
        password: "s3cret",
      };
      const masked = maskProxyUrl(config);
      expect(masked).not.toContain("s3cret");
      expect(masked).toContain("user");
      expect(masked).toContain("****");
    });

    it("should return an unparseable string unchanged instead of throwing", () => {
      expect(maskProxyUrl("not-a-url")).toBe("not-a-url");
      expect(maskProxyUrl("")).toBe("");
    });

    it("should still redact credentials when the url will not parse", () => {
      // Regression: the fallback returned the input verbatim, so anything
      // new URL() rejected was printed with its password intact - in the one
      // function whose whole job is to prevent that. A missing scheme is
      // enough to get here, and it is an easy mistake to make given that the
      // TXT list format is itself scheme-less.
      const masked = maskProxyUrl("user:s3cretpassword@proxy.example.com:8080");
      expect(masked).not.toContain("s3cretpassword");
      expect(masked).toContain("****");
      // The part an operator needs in order to fix it survives.
      expect(masked).toContain("proxy.example.com:8080");
    });

    it("should redact credentials in a url with a broken scheme", () => {
      const masked = maskProxyUrl("htp:/user:s3cretpassword@proxy.example.com:8080");
      expect(masked).not.toContain("s3cretpassword");
      expect(masked).toContain("****");
    });

    it("should leave an unparseable string with no userinfo alone", () => {
      // No "@" means no userinfo by URL syntax, so there is no password to
      // hide - and mangling it would remove exactly the detail that explains
      // why it failed to parse.
      expect(maskProxyUrl("http://host:not-a-port")).toBe("http://host:not-a-port");
    });
  });
});
