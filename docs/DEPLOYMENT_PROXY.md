# Deployment Notes — Proxy Support (v1.10.0)

**Audience: whoever deploys or operates miaw-core.** This covers only what
changed operationally in v1.10.0; it is not a general deployment guide. If you
deploy miaw-core without proxies configured, nothing here applies — the feature
is entirely opt-in and the defaults are unchanged.

Related: [PROXY.md](./PROXY.md) for the feature itself, [CLI.md](./CLI.md) for
command reference.

---

## TL;DR for the deploy pipeline

```bash
# 1. Gate the deploy on every proxy being reachable (exits non-zero if any fail)
npx miaw-cli proxy test-all --proxy-file /etc/miaw/proxies.txt || exit 1

# 2. Confirm what was parsed — credentials are masked, safe for CI logs
npx miaw-cli proxy list --proxy-file /etc/miaw/proxies.txt
```

Both commands need **no WhatsApp connection**, so they run in CI on a runner
that has never paired a device.

---

## 1. `instanceId` must be stable across deploys — this one bans accounts

The default proxy-selection strategy is `deterministic`: a proxy is chosen by
hashing `instanceId`. That is what keeps a session on a stable egress IP.

**It only works if `instanceId` is stable.** If you derive it from something
that changes per deploy — a Kubernetes pod name, a container ID, a random
suffix, `$HOSTNAME` on a StatefulSet replacement — then every rollout hands
that session a different proxy, and therefore a different egress IP.

WhatsApp treats a session's source IP as part of its trust signal. A session
whose IP jumps between regions looks like an account takeover. Expect
re-pairing prompts, 401/440 disconnect loops, and eventually a ban.

```bash
# WRONG — pod name changes on every rollout
MIAW_INSTANCE_ID=$HOSTNAME

# RIGHT — tied to the account, not the container
MIAW_INSTANCE_ID=bot-sales-id
```

The same rule applies to `MIAW_SESSION_PATH`: it must be a **persistent
volume**. A session that is lost on redeploy has to re-pair by QR, which is
manual and defeats unattended deployment.

## 2. Proxy list files are secrets

`proxies.txt` / `proxies.json` contain credentials in the URL.

- Mount as a secret (Kubernetes `Secret`, Docker secret, or similar) — do not
  bake into an image.
- `chmod 600`.
- Both filenames are in `.gitignore`; keep it that way.
- Prefer `MIAW_PROXY` / `MIAW_PROXY_FILE` env vars over CLI flags. Flags appear
  in shell history and in `ps` output, readable by any other user on the host.

miaw-core masks passwords in all its own output — CLI tables, `--json`,
`getProxyInfo()`, and error strings — so logs and crash reports are safe to
ship to an aggregator. Usernames are intentionally **not** masked (providers
encode region/sticky-session ids there, and it is not the secret).

## 3. Hot reload works with atomic file replacement

`ProxyRotator.fromFile(path, { watch: true })` polls with `fs.watchFile` rather
than `fs.watch`, specifically so that the usual ways a config file gets updated
keep working:

- `mv new.txt proxies.txt` (atomic replace)
- editor write-and-rename
- **Kubernetes ConfigMap/Secret symlink swap**

`fs.watch` follows the inode and would go permanently and silently dead after
any of these. Polling survives all of them.

Two caveats:

- A reload that parses to **zero valid entries keeps the previous pool** and
  reports via `onError`. A truncated write cannot empty your proxy pool.
- Hot reload affects **future connections only**. It does not re-proxy an
  already-connected client; a `MiawClient` binds its agent at `connect()`.
  Moving a live session to a new proxy requires a reconnect — and read §1 first.

## 4. Egress firewall rules

If outbound traffic is restricted, the proxy is not the only destination that
needs to be allowed.

| Traffic | Destination | Goes through the proxy? |
|---------|-------------|-------------------------|
| Session / messages | `web.whatsapp.com` | Yes, all protocols |
| Media upload | `*.cdn.whatsapp.net` | Yes, all protocols |
| Media download | `mmg.whatsapp.net`, `*.cdn.whatsapp.net` | **HTTP/HTTPS only** |

**With a SOCKS proxy, media downloads bypass it and connect directly.** Native
`fetch()` requires an undici Dispatcher and undici has no SOCKS transport. In a
locked-down environment with no direct egress, `downloadMedia()` will simply
fail. Use an HTTP/HTTPS proxy if downloads must work, or allow direct egress to
the media CDNs.

`proxy list` and `proxy test` flag this per proxy (`DL direct`), so you can
audit a proxy file without reading this table.

## 5. Provider requirement: sticky sessions

Most rotating-proxy plans change your exit IP every request or every few
minutes. That is incompatible with a persisted WhatsApp session — see §1.

**Require a sticky-session lifetime at least as long as your session lifetime,
which is indefinite.** A provider that caps stickiness at 30 minutes is
unsuitable regardless of price or pool size.

Verify before committing to a plan — run this repeatedly over several minutes
and confirm the IP does not change:

```bash
npx miaw-cli proxy test "$MIAW_PROXY" --ip
```

## 6. Node version

Unrelated to proxies but relevant if you are bumping from ≤1.9.1: v1.9.2 added
a `default` export condition so CommonJS `require()` resolves the package.
That path needs **Node >= 22.12**. The declared engine floor is still
`>=18.0.0`, which is correct for ESM `import` — only `require()` interop needs
the newer runtime.

## 7. Rollback

The proxy feature is additive and opt-in. To disable it, unset `MIAW_PROXY`,
`MIAW_PROXY_FILE` and `MIAW_PROXY_STRATEGY` and redeploy — connections revert
to direct. No session, credential, or on-disk format changed in v1.10.0, so
rolling the package back to 1.9.x needs no data migration.

One behavioural change to be aware of if you have custom tooling: `proxy test`
now treats **HTTP 407** as a failure (exit 1) rather than success. If a
pipeline previously passed against a proxy with wrong credentials, it was a
false green and will now correctly fail.
