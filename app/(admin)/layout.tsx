import AdminNav from "@/components/AdminNav";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-gray-950">
      <AdminNav />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
