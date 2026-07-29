# Proxy Guide

miaw-core can route a WhatsApp connection through an HTTP, HTTPS, SOCKS4, or SOCKS5 proxy — per instance, so twenty bots in one process can each have their own egress IP. Proxy support shipped in v1.3.0; proxy list files, rotation strategies, and the CLI diagnostics landed in v1.10.0.

For the short version, see [Proxy Support in USAGE.md](./USAGE.md#proxy-support). For the CLI command reference, see [CLI.md](./CLI.md#proxy-operations).

---

## Table of Contents

- [Why Use a Proxy](#why-use-a-proxy)
- [Quick Start](#quick-start)
- [Configuration Forms](#configuration-forms)
- [Protocol Support](#protocol-support)
- [Proxy List Files](#proxy-list-files)
- [Rotation Strategies](#rotation-strategies)
- [Multi-Instance Patterns](#multi-instance-patterns)
- [CLI Usage](#cli-usage)
- [Testing and Troubleshooting](#testing-and-troubleshooting)
- [Security](#security)
- [Choosing a Proxy Provider](#choosing-a-proxy-provider)
- [API Reference](#api-reference)
- [Related Files](#related-files)
- [Version History](#version-history)

---

## Why Use a Proxy

### Geographic distribution

WhatsApp notices when a number registered in Indonesia consistently connects from a datacenter in Virginia. Routing each instance through a proxy in the region its number belongs to makes the traffic look like what it claims to be.

### IP separation for multi-instance

Running twenty sessions from one IP address is a distinctive pattern. Not automatically a banned one — but it is the kind of correlation that makes a block on one account propagate to the others. One proxy per instance decorrelates them.

### Network egress control

Containers, corporate networks, and locked-down VPCs frequently have no direct outbound internet. A proxy may be the only route out, independent of any WhatsApp consideration.

### When you do *not* need one

A single bot running on a stable residential connection or a reputable VPS is fine without a proxy. Adding one buys you an extra network hop, extra latency, a new dependency that can fail at 3am, and a credential to manage. Reach for a proxy when you have a reason from the list above — not by default.

---

## Quick Start

```typescript
import { MiawClient } from "miaw-core";

const client = new MiawClient({
  instanceId: "bot-1",
  proxy: "socks5://proxy.example.com:1080",
});

await client.connect();

client.getProxyInfo();
// { url: "socks5://proxy.example.com:1080/", protocol: "socks5" }
```

No extra install: `https-proxy-agent`, `socks-proxy-agent`, and `undici` ship with miaw-core and are imported lazily, only when you actually configure a proxy.

Test the proxy before you spend a pairing attempt on it:

```bash
npx miaw-cli proxy test socks5://proxy.example.com:1080
```

---

## Configuration Forms

### URL string

```typescript
new MiawClient({ instanceId: "bot-1", proxy: "socks5://user:pass@host:1080" });
```

### ProxyConfig object

```typescript
new MiawClient({
  instanceId: "bot-1",
  proxy: {
    url: "http://proxy.example.com:8080",
    username: "myuser",
    password: "p@ss:w0rd#1",
  },
});
```

Use the object form when credentials contain URL-significant characters. This is the single most common proxy bug:

```typescript
// WRONG - the @ in the password ends the userinfo section early,
// so the host is parsed as "w0rd" and the connection goes nowhere.
proxy: "http://myuser:p@ssw0rd@proxy.example.com:8080"

// RIGHT - either percent-encode it...
proxy: "http://myuser:p%40ssw0rd@proxy.example.com:8080"

// ...or use the object form and let miaw-core encode it for you.
proxy: { url: "http://proxy.example.com:8080", username: "myuser", password: "p@ssw0rd" }
```

`@`, `:`, `/`, `?`, `#`, and `%` all need this treatment. The object form is simply safer.

### Environment variables

Recognized by the CLI:

| Variable | Equivalent flag |
|----------|-----------------|
| `MIAW_PROXY` | `--proxy` |
| `MIAW_PROXY_FILE` | `--proxy-file` |
| `MIAW_PROXY_STRATEGY` | `--proxy-strategy` |

Prefer these over CLI flags for anything containing a password — flags land in your shell history.

### Custom agents (advanced)

Bypass miaw-core's agent construction entirely:

```typescript
import { HttpsProxyAgent } from "https-proxy-agent";

new MiawClient({
  instanceId: "advanced-bot",
  agent: new HttpsProxyAgent("http://proxy:8080"),  // WebSocket transport
  fetchAgent: myUndiciDispatcher,                    // media transport
});
```

`agent` and `fetchAgent` take precedence over `proxy`. Note the trade-off: when you supply them, miaw-core skips validation and `getProxyInfo()` returns `null`, because it has no URL to report. Use `proxy` unless you specifically need a custom transport (a local CONNECT shim, a mutual-TLS agent, connection-pool tuning).

---

## Protocol Support

| Protocol | WebSocket (messages) | Media upload | Media download | DNS resolved by |
|----------|----------------------|--------------|----------------|-----------------|
| `http://` | Yes | Yes | Yes | proxy |
| `https://` | Yes | Yes | Yes | proxy |
| `socks4://` | Yes | Yes | **No — direct** | you (leaks) |
| `socks4a://` | Yes | Yes | **No — direct** | proxy |
| `socks5://` | Yes | Yes | **No — direct** | you (leaks) |
| `socks5h://` | Yes | Yes | **No — direct** | proxy |

_Verified empirically against Baileys 7.0.0-rc13 by routing real traffic through a
local proxy and inspecting which hosts it was asked to tunnel._

### DNS leaks with plain `socks5://`

`socks5://` and `socks4://` resolve the destination hostname **locally**, before the
tunnel opens. The connection is proxied but the DNS query is not, so your resolver —
and your ISP — still sees every host you contact. The `socks5h://` and `socks4a://`
variants hand the hostname to the proxy and let it resolve, which closes that gap.

You can watch the difference: point each at a proxy you control and look at what it's
asked to connect to. `socks5://` asks for an IP address; `socks5h://` asks for
`web.whatsapp.com`. **Prefer `socks5h://` unless you specifically need local
resolution** (e.g. a split-horizon DNS setup where only you can resolve the name).

### ⚠️ SOCKS media *downloads* use a direct connection

**With a SOCKS proxy, downloading media reveals your real IP.** Messages, presence, the
whole session, and media *uploads* all go through the proxy — only downloads escape it.

**What leaks.** `downloadMedia()` only. `sendImage()`, `sendVideo()`, `sendAudio()`,
`sendDocument()` and `sendSticker()` are proxied on every supported protocol.

**Why.** The two media directions use different HTTP clients inside Baileys. Uploads go
through Node's `https.request({ agent })`, which accepts the same `http.Agent` that
carries the WebSocket — and `socks-proxy-agent` provides one. Downloads go through
native `fetch(url, { dispatcher })`, which accepts *only* an undici `Dispatcher`, and
undici implements no SOCKS transport. So there is simply nothing to hand it.

**What it means in practice.** WhatsApp's CDN sees your real IP when you fetch incoming
media. For IP separation that partly undermines the point; for egress control in a
locked-down container it is worse — the direct route may not exist at all and downloads
will fail outright.

**Fixes, best first:**

1. **Use an HTTP or HTTPS proxy.** Every transport is proxied, downloads included. Most
   providers offer HTTP alongside SOCKS on the same endpoint.
2. **Front the SOCKS proxy with a local HTTP CONNECT shim** and point miaw-core at the
   shim over `http://`.

**How to verify.** Compare the exit IP against your real one:

```bash
npx miaw-cli proxy test socks5h://proxy.example.com:1080 --ip
curl -s https://api.ipify.org    # your real IP
```

`proxy list` and `proxy test` flag this per proxy, so you never have to remember which
entries are SOCKS.

---

## Proxy List Files

Instead of hardcoding proxies, load them from a file.

### TXT format

One proxy per line:

```
# US region
socks5://us1.example.com:1080            weight=3 label=us
socks5://user:pass@us2.example.com:1080

; semicolons start comments too
http://eu1.example.com:8080              weight=2 label=eu

# Scheme-less vendor forms
1.2.3.4:8080
5.6.7.8:8080:myuser:mypass
```

Rules worth knowing:

- A line is a comment only when its **first non-whitespace character** is `#` or `;`. Inline `#` is never stripped, because that would corrupt passwords. Write a literal `#` in a password as `%23`.
- Optional trailing `weight=<number>` and `label=<text>` tokens, whitespace-separated.
- Scheme-less lines accept `host:port` and `host:port:user:pass` — the two formats proxy vendors actually ship. They expand using `defaultProtocol` (`http` unless you change it). A password containing `:` must use the full URL form.
- CRLF files work; trailing `\r` is stripped.
- Duplicate entries are **not** deduplicated — listing a proxy twice is a legitimate way to weight it under round-robin.

### JSON format

```json
[
  "socks5://us1.example.com:1080",
  { "url": "socks5://us2.example.com:1080", "weight": 3 },
  {
    "url": "http://eu1.example.com:8080",
    "username": "myuser",
    "password": "p@ss:w0rd",
    "weight": 5,
    "label": "eu"
  }
]
```

A `{ "proxies": [...] }` wrapper is also accepted. There is deliberately **no `strategy` key** — strategy is a property of how your application rotates, not of the proxy list, and putting it in both places creates a which-wins ambiguity.

### Format auto-detection

Explicit `format` option → file extension (`.json`; `.txt`/`.list`/`.conf`/extensionless → TXT) → content sniff (leading `[` or `{`). A file that resolves as JSON but fails to parse **throws** rather than falling back to TXT, so a truncated write can't silently become a list of garbage proxies.

### Validation and partial failure

By default the loader is strict and throws on the first bad entry, naming the file and line. Pass `strict: false` to skip bad entries and collect them instead:

```typescript
import { loadProxyList } from "miaw-core";

const proxies = await loadProxyList("./proxies.txt", {
  strict: false,
  onInvalid: ({ line, reason }) => console.warn(`Skipped line ${line}: ${reason}`),
});
```

The CLI uses non-strict parsing everywhere, so one typo never hides the rest of your file — or stops your other bots from connecting.

### Hot reload

```typescript
const rotator = await ProxyRotator.fromFile("./proxies.txt", {
  strategy: "deterministic",
  watch: true,
  onReload: (entries) => console.log(`Proxy pool reloaded: ${entries.length}`),
  onError: (error) => console.error("Proxy reload failed:", error.message),
});
```

Implementation notes that affect you:

- It polls with `fs.watchFile` rather than `fs.watch`. `fs.watch` follows the **inode**, so the usual ways a proxy list gets updated — an atomic `mv`, an editor's write-and-rename, a Kubernetes ConfigMap symlink swap — leave an `fs.watch` watcher permanently and silently dead. Polling survives all of them.
- The watcher is **non-persistent**: it will not keep a CLI process alive.
- A reload that yields zero valid entries is treated as a failure and the **previous pool is kept**, which closes the truncate-then-write race.
- Call `rotator.close()` when you're done.

**What hot reload does not do:** it will not re-proxy an already-connected client. A `MiawClient` binds its agent at `connect()`. Reloading changes which proxy *future* connections get; to move a live session you must disconnect and reconnect it — and read [Rotation Strategies](#rotation-strategies) before you decide to.

---

## Rotation Strategies

| Strategy | Picks | Stateful | Safe for a live session? |
|----------|-------|----------|--------------------------|
| `round-robin` | Next in order, wrapping | Yes (cursor) | No |
| `random` | Uniform random | No | No |
| `weighted` | Random, biased by `weight` | No | No |
| `deterministic` | Stable hash of `instanceId` | No | **Yes** |

### `round-robin`

Cycles through the pool. The cursor survives a hot reload — it resumes after the entry it last served rather than restarting at the top, which would make every reload hammer your first proxy.

### `random`

Uniform pick. Simple, stateless, no coordination between processes.

### `weighted`

Random, biased by each entry's `weight` (default `1`). **A weight of `0` drains the proxy** — it stays in the file for documentation but is never selected. Negative, `NaN`, and infinite weights are rejected at construction rather than silently skewing traffic.

### `deterministic` — the default, and why

**This is the only strategy safe to use with a persisted WhatsApp session.**

WhatsApp treats a session's source IP as part of its trust signal. If `bot-3` connects from Frankfurt on Monday and São Paulo on Tuesday, you have manufactured an account-takeover signature against your own account. The observable results are re-pairing prompts, 401/440 disconnect loops, and eventually a ban.

`deterministic` hashes the `instanceId` to a stable entry, so a given session keeps a stable egress IP for its lifetime while N instances still spread across N proxies.

> **Rotation is for distributing instances across proxies. It is never for rotating a live session's IP.**

It uses **rendezvous (highest-random-weight) hashing**, not `hash % length`. The difference matters the first time you edit your proxy file. Under modulo, removing one proxy from a list of five remaps roughly *every* instance — so a routine edit changes the egress IP of every live session at once, which is exactly the churn described above. Rendezvous hashing remaps only the instances that were on the removed proxy; everyone else stays put. It is also independent of line order, so reordering the file remaps nothing, and the hash key excludes credentials, so rotating a password remaps nothing either.

```typescript
const rotator = await ProxyRotator.fromFile("./proxies.txt");

// Same instanceId -> same proxy, across restarts and across file edits.
const client = new MiawClient({
  instanceId: "bot-3",
  proxy: rotator.forInstance("bot-3"),
});
```

### Choosing a strategy

| Situation | Strategy |
|-----------|----------|
| Long-lived WhatsApp sessions (almost always) | `deterministic` |
| Proxies differ in capacity or cost | `weighted` |
| Short-lived one-shot work, no persisted session | `round-robin` or `random` |
| Independent processes with no shared state | `deterministic` or `random` |

---

## Multi-Instance Patterns

### One proxy per instance, from a file

```typescript
import { MiawClient, ProxyRotator } from "miaw-core";

const rotator = await ProxyRotator.fromFile("./proxies.txt", {
  strategy: "deterministic",
});

const ids = ["bot-1", "bot-2", "bot-3"];
const clients = ids.map(
  (instanceId) =>
    new MiawClient({
      instanceId,
      sessionPath: "./sessions",
      proxy: rotator.forInstance(instanceId),
    })
);

await Promise.all(clients.map((c) => c.connect()));
```

Each bot lands on a stable proxy, and it stays stable across restarts and across edits to `proxies.txt`.

### Explicit per-instance mapping

When you want the assignment written down rather than derived:

```typescript
const assignments = {
  "bot-us": "socks5://us.example.com:1080",
  "bot-eu": "http://eu.example.com:8080",
  "bot-asia": "http://asia.example.com:8080",
};

for (const [instanceId, proxy] of Object.entries(assignments)) {
  await new MiawClient({ instanceId, sessionPath: "./sessions", proxy }).connect();
}
```

### Handling a dead proxy

A proxy that stops responding looks like a network failure, and miaw-core's auto-reconnect will keep retrying through it. To fail over, drop it from the pool and reconnect:

```typescript
const rotator = await ProxyRotator.fromFile("./proxies.txt");
let pool = (await loadProxyList("./proxies.txt")).map((p) => p.url);

client.on("connection", async (state) => {
  if (state !== "disconnected") return;

  const current = client.getProxyInfo();
  if (!current) return;

  // Drop the failing proxy and re-select from what's left.
  pool = pool.filter((url) => !url.includes(new URL(current.url).host));
  if (pool.length === 0) {
    console.error("No proxies left in the pool");
    return;
  }

  rotator.setProxies(pool);
  console.warn(`Proxy ${current.url} failed; re-selecting`);
  // Rebuild the client with the new proxy - an existing client keeps the
  // agent it was constructed with.
});
```

Because `deterministic` uses rendezvous hashing, removing the dead proxy moves only the instances that were on it. Your other bots do not budge.

---

## CLI Usage

Full reference in [CLI.md](./CLI.md#proxy-operations). The essentials:

### Test before you connect

None of the `proxy` commands need a WhatsApp connection — that is the point. You can validate a proxy without spending a pairing attempt on it.

```bash
npx miaw-cli proxy test socks5://proxy.example.com:1080
npx miaw-cli proxy test http://user:pass@proxy.example.com:8080 --ip
npx miaw-cli proxy list --proxy-file ./proxies.txt
npx miaw-cli proxy test-all --proxy-file ./proxies.txt
```

`proxy test-all` exits non-zero if any proxy fails, so it gates a deploy:

```bash
npx miaw-cli proxy test-all --proxy-file ./proxies.txt || exit 1
```

### Connecting through a proxy

```bash
# Explicit
npx miaw-cli --proxy socks5://proxy.example.com:1080 get groups

# From a list, deterministic by instance
npx miaw-cli --instance-id bot-3 --proxy-file ./proxies.txt get groups
```

`bot-3` resolves to the same proxy on every invocation.

### Precedence

1. `--proxy <url>` — always wins.
2. `--proxy-file <path>` — selects one proxy for this process using `--proxy-strategy` (default `deterministic`).
3. Neither — direct connection.

Supplying both warns and honors `--proxy`.

---

## Testing and Troubleshooting

### How `proxy test` works

It opens an HTTPS `HEAD` request to `https://web.whatsapp.com/` through the proxy's WebSocket agent — the *same* agent Baileys will use — and measures time to first response header. That covers DNS, the proxy handshake (HTTP `CONNECT` or SOCKS), TLS, and one round trip.

Any HTTP status counts as success, including 403. The question being answered is "does the tunnel establish", not "does WhatsApp approve". Only transport-level failures mark a proxy as down.

**What it cannot tell you:** whether WhatsApp will accept a session from that IP. A flagged datacenter IP passes this probe and still gets you disconnected. The probe proves reachability; reputation is a separate problem that only a real connection reveals.

### Interpreting latency

| Latency | Reading |
|---------|---------|
| under 200ms | Excellent |
| 200–500ms | Fine; typical for a cross-region proxy |
| 500ms–1s | Usable, noticeably slower to send |
| over 2s | Expect connection instability and reconnect churn |

Baileys has connection timeouts of its own. A proxy that consistently exceeds ~2s will produce reconnect loops that look like WhatsApp problems but aren't.

### Symptom table

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `ECONNREFUSED` | Nothing listening on that host/port | Check the port; confirm the proxy is running |
| `ETIMEDOUT` | Firewall drop, or the host is wrong | Check egress rules; verify the hostname |
| `ENOTFOUND` | DNS failure on the proxy hostname | Check spelling; try the literal IP |
| `407 Proxy Authentication Required` | Missing or wrong credentials | Add username/password; use the object form if they contain special characters |
| `SOCKS: Authentication failed` | Wrong SOCKS5 credentials | Verify; some providers want the region baked into the username |
| Probe passes, WhatsApp 401s or loops | The IP is flagged, or you rotated a live session's IP | Use a residential proxy; switch to `deterministic` |
| Text sends fine, media fails | SOCKS proxy, no route for direct traffic | See [the SOCKS caveat](#️-socks-media-traffic-uses-a-direct-connection) |
| `Unsupported proxy protocol` | Scheme isn't http/https/socks4/socks5 | Fix the scheme; `socks://` is treated as SOCKS5 |
| `Invalid proxy configuration` | Unparseable URL | Percent-encode special characters, or use the object form |

### Debugging

```bash
npx miaw-cli --debug --proxy socks5://proxy.example.com:1080 get groups
```

Debug output never contains a raw proxy URL — passwords are masked everywhere, including in error strings.

---

## Security

### Credential handling

Proxy credentials are as sensitive as any other password.

- **Prefer `.env` or a proxy file over CLI flags.** Flags land in shell history and in the process list, where any other user on the box can read them.
- Add `proxies.txt` and `proxies.json` to `.gitignore` (miaw-core's own `.gitignore` already lists them).
- `chmod 600 proxies.txt`.
- In containers, mount the proxy list as a secret rather than baking it into the image.

### What gets masked, and what does not

`maskProxyUrl()` replaces the **password** and preserves the **username**. That is deliberate: providers routinely encode the region or sticky-session id in the username, which makes it genuinely useful in diagnostics, and it is not the secret.

Masking is applied to CLI output, `getProxyInfo()`, `ProxyRotator.getStats()`, loader errors, and error strings from the proxy-agent libraries (which sometimes embed the full URL).

```typescript
import { maskProxyUrl } from "miaw-core";
maskProxyUrl("http://user:hunter2@proxy:8080");  // "http://user:****@proxy:8080/"
```

The one thing *not* masked is the value you pass in: `client.options.proxy` holds the real URL, because it has to.

### Trusting the proxy operator

Your proxy operator sees every connection you make: destination hosts, TLS SNI, timing, volume. With an HTTP proxy they can attempt to MITM the TLS session, which fails against certificate validation but is worth knowing they can try.

Your WhatsApp *messages* are end-to-end encrypted by the Signal protocol and remain unreadable to the proxy. Your connection *metadata* is not. Free and public proxy lists are run by people whose business model you cannot see; assume the traffic is logged.

---

## Choosing a Proxy Provider

Vendor-agnostic — this is what to evaluate, not who to buy from.

### What actually matters

**Residential vs datacenter.** Datacenter IP ranges are published and widely flagged; residential IPs come from real ISP allocations and attract far less suspicion. For WhatsApp, residential is meaningfully better and meaningfully more expensive. Mobile IPs are better still and pricier again.

**Sticky sessions.** This one is decisive. Many providers rotate your exit IP every request or every few minutes by default. That is the opposite of what a persisted WhatsApp session needs. **The sticky-session lifetime must be at least as long as your session lifetime — which is indefinite.** If a provider caps stickiness at 30 minutes, it is unsuitable, whatever else it offers.

**Protocol availability.** Given [the SOCKS media caveat](#️-socks-media-traffic-uses-a-direct-connection), confirm HTTP/HTTPS is on offer, not just SOCKS5.

**Per-IP concurrency limits.** Some plans allow one connection per IP. Every WhatsApp instance holds a long-lived WebSocket plus intermittent media transfers, so a limit of one will bite immediately.

**Geographic match.** The proxy's country should match the phone number's country code. A `+62` number connecting from Germany is exactly the mismatch you bought the proxy to avoid.

### Red flags

- Free or public proxy lists — logged, shared, unstable, frequently already flagged.
- No authentication (an open proxy is open to everyone, and its reputation reflects that).
- No sticky-session option, or an undocumented one.
- Shared exit IPs with no isolation — you inherit every other tenant's reputation.
- No trial period. Which brings us to:

### Before you buy

```bash
npx miaw-cli proxy test <trial-url> --ip
```

Confirm: it connects; latency is acceptable from where you actually run; the exit IP is in the right country; and — running it repeatedly over several minutes — **the exit IP does not change**. That last check catches unsuitable stickiness before you have twenty sessions depending on it.

---

## API Reference

| Export | Signature | Purpose |
|--------|-----------|---------|
| `createProxyAgents` | `(config) => Promise<{ wsAgent, fetchAgent }>` | Builds both transports. `fetchAgent` is `undefined` for SOCKS. |
| `validateProxyConfig` | `(config) => boolean` | URL parseable and protocol supported. |
| `maskProxyUrl` | `(config) => string` | Password-masked URL, safe to print. Never throws. |
| `parseProxyList` | `(content, options?) => ProxyPoolEntry[]` | Parses in-memory content. |
| `loadProxyList` | `(path, options?) => Promise<ProxyPoolEntry[]>` | Reads and parses a file. |
| `loadProxyListSync` | `(path, options?) => ProxyPoolEntry[]` | Synchronous variant. |
| `validateProxyList` | `(entries) => { valid, invalid }` | Partitions a list; invalid URLs are masked. |
| `watchProxyList` | `(path, onChange, options?) => ProxyListWatcher` | Hot-reload watcher. Call `close()`. |
| `ProxyRotator` | class | Rotation. See below. |
| `MiawClient#getProxyInfo` | `() => { url, protocol } \| null` | Current proxy, masked. `null` if none. |

`ProxyRotator`: `new ProxyRotator(urls | options)`, `ProxyRotator.fromFile(path, options?)`, `.next(instanceId?)`, `.forInstance(instanceId)`, `.setProxies(list)`, `.getStats()`, `.close()`, `.size`, `.strategy`.

Types: `ProxyConfig`, `ProxyAgents`, `ProxyPoolEntry`, `ProxyFileFormat`, `ProxyDefaultProtocol`, `ProxyParseOptions`, `ProxyListWatchOptions`, `ProxyListWatcher`, `ProxyRotationStrategy`, `ProxyRotatorOptions`, `ProxyRotatorStats`, `ProxyRotatorFromFileOptions`.

Utilities **throw** on bad input rather than returning `{ success, error }` — that result-object convention applies to `MiawClient` methods only.

---

## Related Files

| File | Contents |
|------|----------|
| [src/utils/proxy-agent.ts](../src/utils/proxy-agent.ts) | Agent construction, validation, masking |
| [src/utils/proxy-loader.ts](../src/utils/proxy-loader.ts) | File parsing, validation, watcher |
| [src/utils/proxy-rotator.ts](../src/utils/proxy-rotator.ts) | Rotation strategies, rendezvous hashing |
| [src/cli/commands/proxy.ts](../src/cli/commands/proxy.ts) | `proxy list` / `test` / `test-all` |
| [src/cli/utils/proxy-config.ts](../src/cli/utils/proxy-config.ts) | CLI flag resolution and selection |
| [src/client/MiawClient.ts](../src/client/MiawClient.ts) | `resolveProxyAgents()`, `getProxyInfo()` |
| [examples/10-proxy-rotation.ts](../examples/10-proxy-rotation.ts) | Runnable multi-instance example |

---

## Version History

| Version | Change |
|---------|--------|
| v1.3.0 | `proxy` option, `createProxyAgents()`, `validateProxyConfig()`, `getProxyInfo()`, CLI `--proxy` |
| v1.10.0 | Proxy list files, `ProxyRotator`, `maskProxyUrl()`, CLI `proxy` commands, `--proxy-file` / `--proxy-strategy`, this guide |
