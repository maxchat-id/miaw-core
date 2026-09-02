# Deploying per-instance proxy pins (v1.11.0)

**Audience:** whoever operates miaw-core deployments.

**Scope:** only what v1.11.0 changes operationally. General proxy deployment —
egress firewall rules, sticky-session requirements, provider selection — is in
[DEPLOYMENT_PROXY.md](./DEPLOYMENT_PROXY.md) and still applies unchanged. Read
that first if you are setting up proxies at all.

v1.11.0 introduces **one new piece of persistent state** and **one changed
default**. If you deploy miaw-core, those two things are what you need to know.

---

## 1. New state on disk: `<session-path>/instances.json`

`miaw-cli instance set-proxy <id> ...` writes a per-instance proxy assignment
here. It sits **next to** the instance directories, not inside them:

```
<MIAW_SESSION_PATH>/
├── instances.json        ← new in v1.11.0
├── bot-eu/
│   ├── creds.json
│   └── keys/
└── bot-us/
    └── ...
```

### It must be on the persistent volume

Same volume as the session directories. If it is lost, every pinned instance
falls back to `MIAW_PROXY_FILE` selection or to a direct connection on its next
connect — i.e. a **silent egress-IP change on a live session**, which WhatsApp
reads as account takeover. This is the same failure mode as losing
`MIAW_SESSION_PATH` itself (DEPLOYMENT_PROXY.md §1).

It deliberately lives outside the instance directories because
`AuthHandler.clearSession()` does `rm -rf` on `<session-path>/<id>/` during
logout — a pin stored inside would be destroyed by a routine logout. It also
has to be writable before an instance exists, since you normally pin *first* so
the pairing itself comes from the final egress IP.

### It is a secret

A `url` pin embeds proxy credentials. The file is written `0600` via atomic
tmp+rename, and miaw-core warns on stderr (once per path) if it finds the file
group- or world-readable. Treat the whole session volume as secret-grade
storage, as you already do for `creds.json`.

**Prefer label pins, which store no credentials at all:**

```bash
miaw-cli instance set-proxy bot-eu --label eu --proxy-file /etc/miaw/proxies.txt
```

That records only `{"label":"eu"}`. Credentials stay in the proxy file, so
rotating a proxy password touches one mounted Secret and nothing else. With URL
pins, a password rotation means rewriting `instances.json` for every affected
instance.

To keep a URL out of shell history and process listings:

```bash
miaw-cli instance set-proxy bot-eu --from-env EU_PROXY_URL
```

### Concurrency

Writes are atomic, but two concurrent `set-proxy` calls against the same session
volume are last-writer-wins. Pins are rare, human-driven operations — do not
generate them from a hot loop or a reconciliation controller running per-pod.

---

## 2. Precedence, and the one line that matters

Highest first:

1. `--proxy` / `MIAW_PROXY`
2. the pin in `instances.json`
3. `--proxy-file` + `--proxy-strategy`
4. direct

**A `MIAW_PROXY` set globally in your pod spec silently outranks every pin.**
This is the most likely misconfiguration: an operator pins per-instance proxies,
a cluster-wide `MIAW_PROXY` is already in the environment, and every instance
quietly egresses through the wrong IP. miaw-core prints
`⚠️ --proxy overrides the pinned proxy for "<id>"` when this happens — make sure
that line is not being swallowed by your log pipeline.

If you use pins, do **not** also set `MIAW_PROXY`.

---

## 3. Behavior on a broken pin: refuses, does not fall back

If a pin cannot be resolved (a label with no `--proxy-file`, a label matching
nothing, an unreadable proxy file), miaw-core **refuses to build a client**:

```
❌ Refusing to connect "bot-eu" without its configured proxy: ...
```

It does not fall back to a direct connection. That is deliberate — falling back
would leak the real egress IP the operator was deliberately hiding. Expect a
crash-looping pod rather than a quietly-misrouted one.

Offline commands still work, so the failure is recoverable in place:

```bash
miaw-cli --session-path /data/sessions instance ls
miaw-cli --session-path /data/sessions instance unset-proxy bot-eu
```

A corrupt `instances.json` behaves the same way: it is reported and refused, not
treated as empty.

---

## 4. Changed default: `ProxyRotator` now defaults to `deterministic`

**Library consumers only.** Ignore this if you use the CLI or set
`MIAW_PROXY_STRATEGY` — the CLI already defaulted to `deterministic`.

`new ProxyRotator(urls)` previously defaulted to `round-robin`, contradicting the
documentation. Round-robin hands a long-lived session a different egress IP on
every call, which is exactly the ban scenario. The default is now
`deterministic`, matching the docs.

**Breaking:** `rotator.next()` with no `instanceId` now throws (deterministic
selection needs an id). The error names the fix. To keep the old behaviour, pass
the strategy explicitly:

```ts
new ProxyRotator({ proxies, strategy: "round-robin" });
```

Checked against the sibling `miaw-api`: it constructs with an explicit strategy
and always calls `next(instanceId)`, so it is unaffected.

---

## 5. Upgrade checklist

- [ ] `instances.json` path is on the **persistent** session volume, and in
      whatever you back up `creds.json` with.
- [ ] Session volume permissions allow `0600` files (no `fsGroup` remount that
      forces `0644`, no FUSE mount that ignores modes). Watch startup stderr for
      the permissions warning.
- [ ] No cluster-wide `MIAW_PROXY` if you intend to use pins.
- [ ] Prefer `--label` pins so credentials stay in the mounted proxy Secret.
- [ ] Library consumers: audit `new ProxyRotator(...)` for a missing `strategy`
      plus a bare `next()`.
- [ ] Alerting treats "Refusing to connect ... without its configured proxy" as
      a hard failure, not a transient.

## 6. Rollback

Downgrading to 1.10.x leaves `instances.json` in place; 1.10.x does not read it,
so pinned instances revert to `MIAW_PROXY_FILE` selection or direct. **Confirm
that is the egress you want before rolling back on live sessions** — for an
instance whose pin differed from what the file would select, that is an IP
change. Setting `MIAW_PROXY` to the pinned value for the affected instances is
the safe way to hold the egress steady across a downgrade.

The file is forward-compatible: it carries a `version` field and is otherwise
inert to older releases.
