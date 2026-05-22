import { NavBar } from "@/components/layout/NavBar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f7f8fb]">
      <NavBar />
      <div>{children}</div>
    </div>
  );
}
