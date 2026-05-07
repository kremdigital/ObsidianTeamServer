import type { Project, ProjectMember, ProjectRole, User, UserRole } from '@prisma/client';
import { prisma } from '@/lib/db/client';

export type ProjectActor = Pick<User, 'id' | 'role'>;

export interface ProjectAccess {
  project: Pick<Project, 'id' | 'ownerId'>;
  membership: Pick<ProjectMember, 'role'> | null;
}

export async function loadProjectAccess(
  user: ProjectActor,
  projectId: string,
): Promise<ProjectAccess | null> {
  const [project, membership] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, ownerId: true },
    }),
    prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.id } },
      select: { role: true },
    }),
  ]);
  if (!project) return null;
  return { project, membership };
}

export function isSuperAdmin(user: { role: UserRole }): boolean {
  return user.role === 'SUPERADMIN';
}

export function canViewProject(user: ProjectActor, access: ProjectAccess): boolean {
  if (isSuperAdmin(user)) return true;
  if (access.project.ownerId === user.id) return true;
  return access.membership !== null;
}

export function canEditFiles(user: ProjectActor, access: ProjectAccess): boolean {
  if (isSuperAdmin(user)) return true;
  if (access.project.ownerId === user.id) return true;
  return access.membership?.role === 'ADMIN' || access.membership?.role === 'EDITOR';
}

export function canManageMembers(user: ProjectActor, access: ProjectAccess): boolean {
  if (isSuperAdmin(user)) return true;
  if (access.project.ownerId === user.id) return true;
  return access.membership?.role === 'ADMIN';
}

export function canEditProjectMetadata(user: ProjectActor, access: ProjectAccess): boolean {
  return canManageMembers(user, access);
}

export function canDeleteProject(user: ProjectActor, access: ProjectAccess): boolean {
  if (isSuperAdmin(user)) return true;
  return access.project.ownerId === user.id;
}

export type AssignableMemberRole = ProjectRole;
