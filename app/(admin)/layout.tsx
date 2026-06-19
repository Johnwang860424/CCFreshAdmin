import { auth } from "@/auth";
import { AdminShell } from "@/app/components/admin-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <AdminShell
      userName={session?.user?.name}
      userEmail={session?.user?.email}
    >
      {children}
    </AdminShell>
  );
}
