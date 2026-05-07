'use client';
/* eslint-disable react-hooks/set-state-in-effect */

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckIcon, CopyIcon, LinkIcon, MailIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectRole } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ApiError, apiGet, apiPost } from '@/lib/api/client';

interface ProjectDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconEmoji: string | null;
  ownerId: string;
}

interface Member {
  id: string;
  role: ProjectRole;
  addedAt: string;
  user: { id: string; name: string; email: string };
}

interface Invitation {
  id: string;
  email: string | null;
  role: ProjectRole;
  token: string;
  expiresAt: string;
  createdAt: string;
}

const ROLES: ProjectRole[] = ['ADMIN', 'EDITOR', 'VIEWER'];

export default function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations('project');
  const router = useRouter();
  const { id } = use(params);

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ project: p }, { members: ms }, { invitations: invs }] = await Promise.all([
        apiGet<{ project: ProjectDetail }>(`/api/projects/${id}`),
        apiGet<{ members: Member[] }>(`/api/projects/${id}/members`),
        apiGet<{ invitations: Invitation[] }>(`/api/projects/${id}/invitations`),
      ]);
      setProject(p);
      setMembers(ms);
      setInvitations(invs);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.body.error.message : 'Ошибка');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!project) return null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        {project.iconEmoji ?? '📒'} {project.name} — {t('settings')}
      </h1>

      <MetadataCard project={project} onSaved={load} />
      <MembersCard project={project} members={members} onChanged={load} />
      <InvitationsCard
        projectId={project.id}
        invitations={invitations}
        onChanged={load}
        createdLink={createdLink}
        onLinkCreated={setCreatedLink}
      />

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive text-base">{t('deleteProject')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2Icon className="mr-2 size-4" />
            {t('deleteProject')}
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('deleteDialog.title', { name: project.name })}
        description={t('deleteDialog.description')}
        confirmLabel={t('deleteDialog.confirm')}
        destructive
        onConfirm={async () => {
          await fetch(`/api/projects/${project.id}`, {
            method: 'DELETE',
            credentials: 'include',
          });
          router.push('/dashboard');
          router.refresh();
        }}
      />
    </div>
  );
}

function MetadataCard({
  project,
  onSaved,
}: {
  project: ProjectDetail;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations('project');
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [iconEmoji, setIconEmoji] = useState(project.iconEmoji ?? '');
  const [pending, setPending] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || null,
          iconEmoji: iconEmoji || null,
        }),
      });
      toast.success(t('savedToast'));
      await onSaved();
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('metadataTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-name">{t('name')}</Label>
            <Input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-desc">{t('description')}</Label>
            <Input
              id="m-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-emoji">{t('iconEmoji')}</Label>
            <Input
              id="m-emoji"
              value={iconEmoji}
              onChange={(e) => setIconEmoji(e.target.value)}
              maxLength={8}
              placeholder="📒"
            />
          </div>
          <Button type="submit" disabled={pending} className="self-start">
            {t('save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MembersCard({
  project,
  members,
  onChanged,
}: {
  project: ProjectDetail;
  members: Member[];
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations('project');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('VIEWER');
  const [pending, setPending] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await apiPost(`/api/projects/${project.id}/members`, { email, role });
      setEmail('');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.body.error.message : 'Ошибка');
    } finally {
      setPending(false);
    }
  }

  async function handleRoleChange(memberId: string, newRole: ProjectRole) {
    await fetch(`/api/projects/${project.id}/members/${memberId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    await onChanged();
  }

  async function handleRemove(memberId: string) {
    await fetch(`/api/projects/${project.id}/members/${memberId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    toast.success(t('removedToast'));
    await onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('membersTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Имя</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Роль</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const isOwner = m.user.id === project.ownerId;
              return (
                <TableRow key={m.id}>
                  <TableCell>{m.user.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{m.user.email}</TableCell>
                  <TableCell>
                    {isOwner ? (
                      <span className="text-muted-foreground text-xs">{t('owner')}</span>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm">
                            {m.role}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {ROLES.map((r) => (
                            <DropdownMenuItem
                              key={r}
                              onClick={() => void handleRoleChange(m.id, r)}
                            >
                              {r}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                  <TableCell>
                    {!isOwner && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('removeMember')}
                        onClick={() => void handleRemove(m.id)}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <form onSubmit={handleAdd} className="flex items-end gap-2 border-t pt-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="add-email">{t('addMemberEmail')}</Label>
            <Input
              id="add-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-role">{t('addMemberRole')}</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button id="add-role" variant="outline" type="button">
                  {role}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {ROLES.map((r) => (
                  <DropdownMenuItem key={r} onClick={() => setRole(r)}>
                    {r}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button type="submit" disabled={pending || !email}>
            {t('addMember')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function InvitationsCard({
  projectId,
  invitations,
  onChanged,
  createdLink,
  onLinkCreated,
}: {
  projectId: string;
  invitations: Invitation[];
  onChanged: () => void | Promise<void>;
  createdLink: string | null;
  onLinkCreated: (url: string | null) => void;
}) {
  const t = useTranslations('project');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('VIEWER');
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function inviteByEmail(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await apiPost(`/api/projects/${projectId}/invitations`, { email, role });
      setEmail('');
      toast.success(t('invitedToast'));
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.body.error.message : 'Ошибка');
    } finally {
      setPending(false);
    }
  }

  async function inviteByLink() {
    setPending(true);
    try {
      const { url } = await apiPost<{ url: string }>(`/api/projects/${projectId}/invitations`, {
        role,
        shareLink: true,
      });
      onLinkCreated(url);
      toast.success(t('linkCreatedToast'));
      await onChanged();
    } finally {
      setPending(false);
    }
  }

  async function revoke(token: string) {
    await fetch(`/api/projects/${projectId}/invitations/${token}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    await onChanged();
  }

  async function handleCopy() {
    if (createdLink) {
      await navigator.clipboard.writeText(createdLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('invitationsTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {createdLink && (
          <div className="bg-muted/30 flex items-center gap-2 rounded-md border p-2">
            <code className="flex-1 font-mono text-xs break-all">{createdLink}</code>
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
              <span className="ml-1">{copied ? t('copied') : t('copyLink')}</span>
            </Button>
          </div>
        )}

        {invitations.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('emptyInvitations')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email / тип</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    {inv.email ? (
                      <span className="flex items-center gap-2">
                        <MailIcon className="text-muted-foreground size-4" />
                        {inv.email}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <LinkIcon className="text-muted-foreground size-4" />
                        share-link
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{inv.role}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('revokeInvite')}
                      onClick={() => void revoke(inv.token)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <form onSubmit={inviteByEmail} className="flex items-end gap-2 border-t pt-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="inv-email">{t('inviteByEmail')}</Label>
            <Input
              id="inv-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Роль</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" type="button">
                  {role}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {ROLES.map((r) => (
                  <DropdownMenuItem key={r} onClick={() => setRole(r)}>
                    {r}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button type="submit" disabled={pending || !email}>
            {t('inviteByEmail')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void inviteByLink()}
          >
            <LinkIcon className="mr-2 size-4" />
            {t('inviteByLink')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
