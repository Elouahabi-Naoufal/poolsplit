import { prisma } from "@/lib/prisma";

export type GroupPerms = {
  isOwner: boolean;
  canManageOutings: boolean;
  canRecordPayments: boolean;
  canUseTemplates: boolean;
};

/**
 * Resolve effective group permissions for a user.
 * The group owner implicitly holds every permission.
 * Returns null if the user is not a member of the group.
 */
export async function getGroupMemberPerms(groupId: string, userId: string): Promise<GroupPerms | null> {
  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!member) return null;
  return {
    isOwner: member.role === "OWNER",
    canManageOutings: member.role === "OWNER" || member.canManageOutings,
    canRecordPayments: member.role === "OWNER" || member.canRecordPayments,
    canUseTemplates: member.role === "OWNER" || member.canUseTemplates,
  };
}