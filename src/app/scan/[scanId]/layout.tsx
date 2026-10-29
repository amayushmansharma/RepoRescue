import type { ReactNode } from "react";
import { ScanWorkspaceProvider, WorkspaceShell } from "@/features/workspace/ScanWorkspaceProvider";

export default function ScanLayout({ children }: { children: ReactNode }) {
  return (
    <ScanWorkspaceProvider>
      <WorkspaceShell>{children}</WorkspaceShell>
    </ScanWorkspaceProvider>
  );
}
