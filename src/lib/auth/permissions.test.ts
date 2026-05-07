import { describe, expect, it } from 'vitest';
import {
  canDeleteProject,
  canEditFiles,
  canEditProjectMetadata,
  canManageMembers,
  canViewProject,
  isSuperAdmin,
} from './permissions';
import type { ProjectRole } from '@prisma/client';

const owner = { id: 'owner', role: 'USER' as const };
const admin = { id: 'admin-user', role: 'USER' as const };
const editor = { id: 'editor-user', role: 'USER' as const };
const viewer = { id: 'viewer-user', role: 'USER' as const };
const stranger = { id: 'stranger', role: 'USER' as const };
const superadmin = { id: 'su', role: 'SUPERADMIN' as const };

const project = { id: 'p1', ownerId: owner.id };

function access(role: ProjectRole | null) {
  return {
    project,
    membership: role === null ? null : { role },
  };
}

describe('isSuperAdmin', () => {
  it('detects SUPERADMIN', () => {
    expect(isSuperAdmin(superadmin)).toBe(true);
    expect(isSuperAdmin(owner)).toBe(false);
  });
});

describe('canViewProject', () => {
  it('owner & superadmin always can view', () => {
    expect(canViewProject(owner, access(null))).toBe(true);
    expect(canViewProject(superadmin, access(null))).toBe(true);
  });
  it('any member can view', () => {
    expect(canViewProject(viewer, access('VIEWER'))).toBe(true);
    expect(canViewProject(editor, access('EDITOR'))).toBe(true);
    expect(canViewProject(admin, access('ADMIN'))).toBe(true);
  });
  it('non-members cannot', () => {
    expect(canViewProject(stranger, access(null))).toBe(false);
  });
});

describe('canEditFiles', () => {
  it('owner, admin, editor can; viewer and stranger cannot', () => {
    expect(canEditFiles(owner, access(null))).toBe(true);
    expect(canEditFiles(admin, access('ADMIN'))).toBe(true);
    expect(canEditFiles(editor, access('EDITOR'))).toBe(true);
    expect(canEditFiles(viewer, access('VIEWER'))).toBe(false);
    expect(canEditFiles(stranger, access(null))).toBe(false);
    expect(canEditFiles(superadmin, access(null))).toBe(true);
  });
});

describe('canManageMembers / canEditProjectMetadata', () => {
  it('only ADMIN, owner, superadmin', () => {
    expect(canManageMembers(owner, access(null))).toBe(true);
    expect(canManageMembers(admin, access('ADMIN'))).toBe(true);
    expect(canManageMembers(editor, access('EDITOR'))).toBe(false);
    expect(canManageMembers(viewer, access('VIEWER'))).toBe(false);
    expect(canManageMembers(stranger, access(null))).toBe(false);
    expect(canManageMembers(superadmin, access(null))).toBe(true);

    // metadata uses the same rule
    expect(canEditProjectMetadata(editor, access('EDITOR'))).toBe(false);
    expect(canEditProjectMetadata(admin, access('ADMIN'))).toBe(true);
  });
});

describe('canDeleteProject', () => {
  it('only owner and superadmin (admins cannot)', () => {
    expect(canDeleteProject(owner, access(null))).toBe(true);
    expect(canDeleteProject(superadmin, access(null))).toBe(true);
    expect(canDeleteProject(admin, access('ADMIN'))).toBe(false);
    expect(canDeleteProject(editor, access('EDITOR'))).toBe(false);
    expect(canDeleteProject(viewer, access('VIEWER'))).toBe(false);
    expect(canDeleteProject(stranger, access(null))).toBe(false);
  });
});
