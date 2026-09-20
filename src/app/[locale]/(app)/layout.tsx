import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { avatarSrc } from "@/lib/avatar";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, displayName: true, publicId: true, avatar: true, isAdmin: true },
  });
  if (!user) redirect("/login");

  const memberships = await prisma.groupMember.findMany({
    where: { userId: session.userId },
    include: { group: true },
    orderBy: { joinedAt: "desc" },
    take: 8,
  });

  return (
    <AppShell
      user={{
        displayName: user.displayName,
        publicId: user.publicId,
        avatarUrl: avatarSrc(user),
        isAdmin: user.isAdmin,
      }}
      groups={memberships.map(m => ({ id: m.group.id, name: m.group.name, image: m.group.image }))}
    >
      {children}
    </AppShell>
  );
}
