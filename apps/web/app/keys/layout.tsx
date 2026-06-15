import { AppHeader } from "@/components/app-header";

export default function KeysLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-10 flex min-h-full flex-col">
      <AppHeader active="keys" />
      <div className="flex-1">{children}</div>
    </div>
  );
}
