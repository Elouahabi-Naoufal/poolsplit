import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { generateGroupPublicToken } from "@/lib/utils";
import { logEvent } from "@/server/audit";
import { activityResponsibility, computeMemberBalances } from "./stats";
import fs from "fs";
import path from "path";

export type ServiceError = { ok: false; error: string; params?: Record<string, string | number> };

export interface PermissionsJson {
  canManageOutings: boolean;
  canRecordPayments: boolean;
  canUseTemplates: boolean;
}

// ── Group list / detail ─────────────────────────────────────────

export interface GroupListEntry {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  status: string;
  memberCount: number;
  myRole: string;
  myPerms: PermissionsJson;
}

export type GroupListResult = { ok: true; groups: GroupListEntry[] } | ServiceError;

export async function listGroupsService(userId: string): Promise<GroupListResult> {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    include: { group: true },
    orderBy: { joinedAt: "desc" },
  });

  const groupIds = memberships.map(m => m.groupId);
  const counts = groupIds.length > 0
    ? await prisma.groupMember.groupBy({ by: ["groupId"], where: { groupId: { in: groupIds } }, _count: true })
    : [];
  const countMap = new Map(counts.map(c => [c.groupId, c._count]));

  const groups = memberships.map(m => ({
    id: m.group.id,
    name: m.group.name,
    description: m.group.description,
    image: m.group.image,
    status: m.group.status,
    memberCount: countMap.get(m.group.id) ?? 0,
    myRole: m.role,
    myPerms: effectivePerms(m.role === "OWNER", m.canManageOutings, m.canRecordPayments, m.canUseTemplates),
  }));

  return { ok: true, groups };
}

export interface GroupDetail {
  group: { id: string; name: string; description: string | null; image: string | null; status: string; publicToken: string | null; createdAt: Date };
  isOwner: boolean;
  myRole: string;
  myPerms: PermissionsJson;
  members: {
    id: string;
    role: string;
    isOwner: boolean;
    permissions: PermissionsJson;
    user: { id: string; username: string; displayName: string; publicId: string };
  }[];
  outings: { id: string; name: string; status: string; participantCount: number; createdAt: Date; totalCentimes: number; myNetCentimes: number }[];
}

export type GroupDetailResult = { ok: true; data: GroupDetail } | ServiceError;

export async function getGroupService(userId: string, groupId: string): Promise<GroupDetailResult> {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return { ok: false, error: "groupMissing" };

  const member = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
  if (!member) return { ok: false, error: "notGroupMember" };

  const [members, outings] = await Promise.all([
    prisma.groupMember.findMany({
      where: { groupId },
      include: { user: { select: { id: true, username: true, displayName: true, publicId: true } } },
    }),
    prisma.outing.findMany({
      where: { groupId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { participants: true } } },
    }),
  ]);

  const outingIds = outings.map(o => o.id);
  const [outingActivities, outingParticipants] = await Promise.all([
    outingIds.length > 0
      ? prisma.activity.findMany({
          where: { outingId: { in: outingIds } },
          include: {
            payments: { select: { userId: true, amountCentimes: true } },
            usageRecords: { select: { status: true, totalCentimes: true, participants: { select: { userId: true } } } },
            lineItems: { select: { userId: true, priceCentimes: true } },
          },
        })
      : [],
    outingIds.length > 0
      ? prisma.outingParticipant.findMany({
          where: { outingId: { in: outingIds } },
          include: { user: { select: { displayName: true } } },
        })
      : [],
  ]);
  const activityByOuting = new Map<string, typeof outingActivities>();
  for (const a of outingActivities) {
    const list = activityByOuting.get(a.outingId!) ?? [];
    list.push(a);
    activityByOuting.set(a.outingId!, list);
  }
  const participantByOuting = new Map<string, typeof outingParticipants>();
  for (const p of outingParticipants) {
    const list = participantByOuting.get(p.outingId) ?? [];
    list.push(p);
    participantByOuting.set(p.outingId, list);
  }

  const isOwner = group.ownerId === userId;

  return {
    ok: true,
    data: {
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        image: group.image,
        status: group.status,
        publicToken: group.publicToken,
        createdAt: group.createdAt,
      },
      isOwner,
      myRole: member.role,
      myPerms: effectivePerms(isOwner, member.canManageOutings, member.canRecordPayments, member.canUseTemplates),
      members: members.map(m => {
        const owner = m.userId === group.ownerId;
        return {
          id: m.id,
          role: m.role,
          isOwner: owner,
          permissions: { canManageOutings: m.canManageOutings, canRecordPayments: m.canRecordPayments, canUseTemplates: m.canUseTemplates },
          user: { id: m.userId, username: m.user.username, displayName: m.user.displayName, publicId: m.user.publicId },
        };
      }),
      outings: outings.map(o => {
        const acts = activityByOuting.get(o.id) ?? [];
        const total = acts.reduce((s, a) => s + activityResponsibility(a as any), 0);
        const balances = computeMemberBalances(
          (participantByOuting.get(o.id) ?? []).map(p => ({ userId: p.userId, user: p.user })),
          acts as any[]
        );
        const mine = balances.find(b => b.userId === userId);
        return { id: o.id, name: o.name, status: o.status, participantCount: o._count.participants, createdAt: o.createdAt, totalCentimes: total, myNetCentimes: mine?.netBalance ?? 0 };
      }),
    },
  };
}

function effectivePerms(isOwner: boolean, canManageOutings: boolean, canRecordPayments: boolean, canUseTemplates: boolean): PermissionsJson {
  return {
    canManageOutings: isOwner || canManageOutings,
    canRecordPayments: isOwner || canRecordPayments,
    canUseTemplates: isOwner || canUseTemplates,
  };
}

// ── Create group ─────────────────────────────────────────────────

const createGroupSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
});

export interface CreatedGroup {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  status: string;
  publicToken: string | null;
}

export type CreateGroupResult = { ok: true; group: CreatedGroup } | ServiceError;

export async function createGroupService(userId: string, input: { name: string; description?: string }): Promise<CreateGroupResult> {
  const parsed = createGroupSchema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path?.[0] ?? "");
    if (field === "name") return { ok: false, error: "groupNameLen" };
    if (field === "description") return { ok: false, error: "groupDescLen" };
    return { ok: false, error: "invalidInput" };
  }

  const group = await prisma.group.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      ownerId: userId,
      status: "PLANNING",
      publicToken: generateGroupPublicToken(),
    },
  });

  await prisma.groupMember.create({ data: { groupId: group.id, userId, role: "OWNER" } });

  await logEvent({ groupId: group.id, actorId: userId, eventType: "GROUP_CREATED", entityType: "Group", entityId: group.id, metadata: { name: group.name } });

  return {
    ok: true,
    group: {
      id: group.id,
      name: group.name,
      description: group.description,
      image: group.image,
      status: group.status,
      publicToken: group.publicToken,
    },
  };
}

// ── Invitations ──────────────────────────────────────────────────

export type SuccessResult = { ok: true } | ServiceError;

export async function inviteMemberService(userId: string, groupId: string, publicId: string): Promise<SuccessResult> {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return { ok: false, error: "groupMissing" };
  if (group.ownerId !== userId) return { ok: false, error: "onlyOwner" };

  const invitedUser = await prisma.user.findUnique({ where: { publicId } });
  if (!invitedUser) return { ok: false, error: "userMissing" };

  const existingMember = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: invitedUser.id } },
  });
  if (existingMember) return { ok: false, error: "alreadyMember" };

  const existingInvite = await prisma.groupInvitation.findFirst({
    where: { groupId, inviteeUserId: invitedUser.id, status: "PENDING" },
  });
  if (existingInvite) return { ok: false, error: "alreadyInvited" };

  const inv = await prisma.groupInvitation.create({
    data: { groupId, inviterId: userId, inviteePublicId: publicId, inviteeUserId: invitedUser.id, status: "PENDING" },
  });

  await logEvent({ groupId, actorId: userId, eventType: "MEMBER_INVITED", entityType: "GroupInvitation", entityId: inv.id, metadata: { invitee: publicId } });
  return { ok: true };
}

export type AcceptInvitationResult = { ok: true; groupId: string } | ServiceError;

export async function acceptInvitationService(userId: string, invitationId: string): Promise<AcceptInvitationResult> {
  const inv = await prisma.groupInvitation.findUnique({ where: { id: invitationId } });
  if (!inv) return { ok: false, error: "inviteNotFound" };
  if (inv.inviteeUserId !== userId) return { ok: false, error: "notYourInvite" };
  if (inv.status !== "PENDING") return { ok: false, error: "alreadyResponded" };

  const group = await prisma.group.findUnique({ where: { id: inv.groupId } });
  if (!group) return { ok: false, error: "groupMissing" };

  let conflict: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.groupInvitation.findUnique({ where: { id: inv.id } });
      if (!fresh || fresh.status !== "PENDING") {
        conflict = "alreadyResponded";
        throw new Error("Already answered.");
      }
      const alreadyMember = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId: inv.groupId, userId } },
      });
      if (alreadyMember) {
        conflict = "alreadyMember";
        throw new Error("Already a member of this group.");
      }
      await tx.groupInvitation.update({ where: { id: inv.id }, data: { status: "ACCEPTED" } });
      await tx.groupMember.create({ data: { groupId: inv.groupId, userId, role: "MEMBER" } });
      await tx.activityEvent.create({ data: { groupId: inv.groupId, actorId: userId, eventType: "MEMBER_JOINED", entityType: "User", entityId: userId } });
    });
  } catch {
    if (conflict) return { ok: false, error: conflict };
    return { ok: false, error: "acceptInviteFailed" };
  }

  return { ok: true, groupId: inv.groupId };
}

export async function declineInvitationService(userId: string, invitationId: string): Promise<SuccessResult> {
  const inv = await prisma.groupInvitation.findUnique({ where: { id: invitationId } });
  if (!inv) return { ok: false, error: "inviteNotFound" };
  if (inv.inviteeUserId !== userId) return { ok: false, error: "notYourInvite" };
  await prisma.groupInvitation.update({ where: { id: inv.id }, data: { status: "DECLINED" } });
  return { ok: true };
}

// ── Member management ────────────────────────────────────────────

export async function removeMemberService(callerUserId: string, groupId: string, targetUserId: string): Promise<SuccessResult> {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return { ok: false, error: "groupMissing" };
  if (group.ownerId !== callerUserId) return { ok: false, error: "onlyOwner" };
  if (targetUserId === group.ownerId) return { ok: false, error: "cantRemoveOwner" };

  const member = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: targetUserId } } });
  if (!member) return { ok: false, error: "notGroupMember" };

  await prisma.$transaction(async (tx) => {
    await tx.groupMember.delete({ where: { id: member.id } });
    await tx.activityEvent.create({ data: { groupId, actorId: callerUserId, eventType: "MEMBER_REMOVED", entityType: "User", entityId: targetUserId } });
  });
  return { ok: true };
}

export const groupPermissionKeys = ["canManageOutings", "canRecordPayments", "canUseTemplates"] as const;
export type GroupPermissionKey = (typeof groupPermissionKeys)[number];

export async function updateGroupPermissionsService(
  callerUserId: string,
  groupId: string,
  targetUserId: string,
  permissions: Partial<Record<GroupPermissionKey, boolean>>
): Promise<SuccessResult> {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return { ok: false, error: "groupMissing" };
  if (group.ownerId !== callerUserId) return { ok: false, error: "onlyOwner" };
  if (targetUserId === group.ownerId) return { ok: false, error: "cantRemoveOwner" };

  const member = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: targetUserId } } });
  if (!member) return { ok: false, error: "notGroupMember" };

  const data: Partial<Record<GroupPermissionKey, boolean>> = {};
  for (const key of groupPermissionKeys) {
    if (permissions[key] !== undefined) data[key] = permissions[key];
  }
  if (Object.keys(data).length === 0) return { ok: false, error: "invalidInput" };

  await prisma.groupMember.update({ where: { id: member.id }, data });
  await logEvent({
    groupId,
    actorId: callerUserId,
    eventType: "PERMISSIONS_UPDATED",
    entityType: "GroupMember",
    entityId: member.id,
    metadata: { userId: targetUserId, permissions: data },
  });
  return { ok: true };
}

// ── Group image ──────────────────────────────────────────────────

const MAX_GROUP_IMAGE_MB = 5;
const GROUP_IMAGE_EXTS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

function groupImageDir() {
  return path.join(process.cwd(), "data", "group-images");
}

function groupImageFile(groupId: string, ext: string) {
  return path.join(groupImageDir(), `${groupId}.${ext}`);
}

async function ensureGroupImageDir() {
  await fs.promises.mkdir(groupImageDir(), { recursive: true });
}

async function removeGroupImageFiles(groupId: string) {
  for (const ext of Object.values(GROUP_IMAGE_EXTS)) {
    try {
      await fs.promises.unlink(groupImageFile(groupId, ext));
    } catch {}
  }
}

export function isGroupImageUploadFile(value: unknown): value is File & { arrayBuffer: () => Promise<ArrayBuffer> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "size" in value &&
    typeof (value as { size: unknown }).size === "number" &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string" &&
    "arrayBuffer" in value &&
    typeof (value as { arrayBuffer: unknown }).arrayBuffer === "function"
  );
}

export async function updateGroupImageService(
  userId: string,
  groupId: string,
  options: { file: File & { arrayBuffer: () => Promise<ArrayBuffer> } | null; removeImage: boolean }
): Promise<SuccessResult> {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return { ok: false, error: "groupMissing" };
  if (group.ownerId !== userId) return { ok: false, error: "onlyOwner" };

  const { file, removeImage } = options;
  if (file && file.size > 0) {
    const extKey = file.type as keyof typeof GROUP_IMAGE_EXTS;
    if (!(extKey in GROUP_IMAGE_EXTS)) return { ok: false, error: "groupImageOnly" };
    const mb = file.size / 1024 / 1024;
    if (mb > MAX_GROUP_IMAGE_MB) {
      return { ok: false, error: "groupImageTooBig", params: { maxMB: MAX_GROUP_IMAGE_MB } };
    }
    await ensureGroupImageDir();
    await removeGroupImageFiles(group.id);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.promises.writeFile(groupImageFile(group.id, GROUP_IMAGE_EXTS[extKey]), buffer);
    await prisma.group.update({
      where: { id: group.id },
      data: { image: `/api/group-image/${group.id}?v=${Date.now()}` },
    });
  } else if (removeImage) {
    await removeGroupImageFiles(group.id);
    await prisma.group.update({ where: { id: group.id }, data: { image: null } });
  }

  return { ok: true };
}