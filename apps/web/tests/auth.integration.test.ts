import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { signUpWithPassword } from "@/lib/auth/signup";
import { ensureWorkspace, getUserScope } from "@/lib/auth/workspace";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/auth/api-keys";

const EMAILS = ["alice.test@example.com", "bob.test@example.com"];

async function purge() {
  await prisma.organization.deleteMany({ where: { owner: { email: { in: EMAILS } } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

beforeAll(purge);
afterAll(purge);

describe("auth — signup + personal workspace", () => {
  it("creates a user with a hashed password and a personal org+project", async () => {
    const res = await signUpWithPassword({
      email: "alice.test@example.com",
      password: "password123",
      name: "Alice",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "alice.test@example.com" } });
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt
    expect(user.passwordHash).not.toContain("password123");

    const scope = await getUserScope(res.userId);
    expect(scope).not.toBeNull();
    expect(scope?.organizationId).toBeTruthy();
    expect(scope?.projectId).toBeTruthy();
  });

  it("rejects a duplicate email and a weak password", async () => {
    const dup = await signUpWithPassword({ email: "alice.test@example.com", password: "password123" });
    expect(dup.ok).toBe(false);
    const weak = await signUpWithPassword({ email: "bob.test@example.com", password: "short" });
    expect(weak.ok).toBe(false);
  });

  it("ensureWorkspace is idempotent (same org on repeat)", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "alice.test@example.com" } });
    const a = await ensureWorkspace(user.id);
    const b = await ensureWorkspace(user.id);
    expect(a.organizationId).toBe(b.organizationId);
    expect(a.projectId).toBe(b.projectId);
  });
});

describe("auth — API keys are workspace-scoped", () => {
  it("creates a key (hash only), lists it, and revokes only within the owning workspace", async () => {
    const alice = await prisma.user.findUniqueOrThrow({ where: { email: "alice.test@example.com" } });
    const aliceScope = (await getUserScope(alice.id))!;

    const bob = await signUpWithPassword({ email: "bob.test@example.com", password: "password123" });
    expect(bob.ok).toBe(true);
    if (!bob.ok) return;
    const bobScope = (await getUserScope(bob.userId))!;

    const created = await createApiKey(aliceScope, "alice key");
    expect(created.apiKey).toMatch(/^aer_[0-9a-f]{32}$/);

    // Stored as hash only — the plaintext never lands in the DB.
    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.keyHash).toHaveLength(64);
    expect(stored.keyHash).not.toContain(created.apiKey);

    const aliceKeys = await listApiKeys(aliceScope);
    expect(aliceKeys.map((k) => k.id)).toContain(created.id);
    // Bob cannot see Alice's key.
    expect((await listApiKeys(bobScope)).map((k) => k.id)).not.toContain(created.id);

    // Bob cannot revoke Alice's key (cross-tenant) ...
    expect(await revokeApiKey(bobScope, created.id)).toBe(false);
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } })).revokedAt).toBeNull();

    // ... but Alice can.
    expect(await revokeApiKey(aliceScope, created.id)).toBe(true);
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } })).revokedAt).not.toBeNull();
  });
});
