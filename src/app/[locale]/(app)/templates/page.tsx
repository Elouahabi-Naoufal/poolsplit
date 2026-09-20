import { prisma } from "@/lib/prisma";
import { getSession } from "@/server/auth/session";
import { redirect } from "next/navigation";
import ClientTemplatesPage from "@/components/ClientTemplatesPage";

export default async function TemplatesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const templates = await prisma.activityTemplate.findMany({
    where: { userId: session.userId },
    include: { products: true },
    orderBy: { updatedAt: "desc" },
  });

  return <ClientTemplatesPage templates={templates} />;
}