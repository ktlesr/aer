import { prisma } from "@/lib/prisma";

export interface UserScope {
  organizationId: string;
  projectId: string;
}

/**
 * Every user owns exactly one personal organization (teams are deferred). This provisions it
 * idempotently: an org with this owner + a default project. Safe to call on every sign-in.
 */
export async function ensureWorkspace(
  userId: string,
  displayName?: string | null,
): Promise<UserScope> {
  const existing = await prisma.organization.findUnique({
    where: { ownerUserId: userId },
    include: { projects: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (existing && existing.projects.length > 0) {
    return { organizationId: existing.id, projectId: existing.projects[0].id };
  }

  // No org yet (or an org without a project): create both in one transaction.
  const org = await prisma.organization.create({
    data: {
      name: displayName?.trim() || "My Workspace",
      ownerUserId: userId,
      projects: { create: { name: "Default Project" } },
    },
    include: { projects: true },
  });
  return { organizationId: org.id, projectId: org.projects[0].id };
}

/** The tenant scope a logged-in user can read — null if they have no workspace yet. */
export async function getUserScope(userId: string): Promise<UserScope | null> {
  const org = await prisma.organization.findUnique({
    where: { ownerUserId: userId },
    include: { projects: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!org || org.projects.length === 0) return null;
  return { organizationId: org.id, projectId: org.projects[0].id };
}
