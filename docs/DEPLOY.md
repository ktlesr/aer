# DEPLOY.md — Deploying AER on Dokploy (Level B)

This is the **remote/real** step of GO_LIVE: run the recorder on your own Dokploy host with a
managed Postgres service, so a real agent can record runs against a public URL.

> Scope guard: this does NOT add RBAC/SSO/billing. It only makes the existing pipeline run remotely.

The repo ships a root **`Dockerfile`** (multi-stage, monorepo-aware) and a `.dockerignore`.
Prisma 7 uses driver adapters (pg), so there is **no native query-engine binary** to worry about.
The container, on start, runs `prisma migrate deploy` and then `next start` on port **3000**.

---

## 1. Create the Postgres service

In Dokploy: **Create → Database → PostgreSQL**.

- Note the **internal connection string** Dokploy gives you (host is the service name on the
  internal network, e.g. `aer-postgres-xxxx:5432`). Use the *internal* host so app↔DB traffic
  stays on the Dokploy network.
- It looks like: `postgresql://<user>:<password>@<internal-host>:5432/<db>`

---

## 2. Create the application (from GitHub)

In Dokploy: **Create → Application → GitHub**, pick `ktlesr/aer`, branch `main`.

- **Build Type:** `Dockerfile`
- **Dockerfile Path:** `Dockerfile`
- **Build Context / Root:** repository root (`.`) — the Dockerfile needs the workspace lockfile
  and `packages/`, so do NOT set the context to `apps/web`.
- **Exposed Port:** `3000`

---

## 3. Environment variables (on the application)

Only one variable is required at runtime — the app reads `DATABASE_URL` and nothing else:

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | the **internal** Postgres URL from step 1, with `?schema=public` appended | required |
| `NODE_ENV` | `production` | set by the image already; harmless to re-set |

`AER_API_BASE_URL` is **not** a server variable — it is for the SDK / demo agent / clients that
*call* this deployment (see step 6).

Append `?schema=public` if it is not already there, e.g.
`postgresql://aer:pass@aer-postgres-xxxx:5432/aer?schema=public`.

---

## 4. Deploy

Trigger the deploy. The build will:
1. `pnpm install --frozen-lockfile`
2. `prisma generate` + `next build` (via the web `build` script)
3. start the container → `prisma migrate deploy` applies all migrations → `next start`

Assign a domain in Dokploy (e.g. `https://aer.yourdomain.com`). Open `/runs` — it loads, but is
empty until you create data (no seed runs in production by default).

---

## 5. Create a production API key (and optional demo data)

Open a shell into the running container (Dokploy **Terminal** on the app), then:

```bash
cd /app/apps/web

# Mint a real API key (prints the plaintext aer_... ONCE; DB stores only the hash):
pnpm exec tsx scripts/create-key.ts --org "Acme" --project "Prod Agents"

# OR, to load the demo run + demo key for a quick visual check:
pnpm exec prisma db seed
```

Copy the printed `aer_...` key — it cannot be recovered later.

---

## 6. Point the SDK / agent at the deployment

Anything that records evidence sets the base URL to your domain and uses the key from step 5:

```bash
AER_API_BASE_URL="https://aer.yourdomain.com" \
AER_API_KEY="aer_..." \
pnpm e2e:demo
```

or in code:

```ts
const recorder = new AgentEvidenceRecorder({
  baseUrl: "https://aer.yourdomain.com",
  apiKey: process.env.AER_API_KEY!,
});
```

✅ Done when: a run recorded via the deployed URL shows up at `https://aer.yourdomain.com/runs`,
and the downloaded audit packet contains a `content_hash` and no raw PII.

---

## Troubleshooting

- **Build fails at `prisma generate`** — ensure the build context is the repo root, not `apps/web`
  (the generator reads `apps/web/prisma/schema.prisma` and the workspace must be intact).
- **App boots but 500s on `/runs`** — `DATABASE_URL` is wrong/unreachable. Verify the *internal*
  host and that the Postgres service is healthy.
- **`migrate deploy` errors on start** — the DB user lacks DDL permission, or the URL is missing
  `?schema=public`. Check Dokploy logs for the container's startup command output.
- **Connecting from outside the Dokploy network** (e.g. local SDK → remote DB) needs the *external*
  Postgres URL; app↔DB inside Dokploy should always use the internal one.
