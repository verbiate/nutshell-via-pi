"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function AuditLogPage() {
  const { data, isPending } = useQuery({
    queryKey: ["admin-audit"],
    queryFn: async () => {
      const res = await fetch("/api/admin/audit");
      return res.json();
    },
  });

  const logs = data?.logs || [];

  return (
    <div>
      <h1 className="text-[20px] font-semibold text-foreground">Audit Log</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Record of all admin actions
      </p>

      <div className="mt-4 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Old Value</TableHead>
              <TableHead>New Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6} className="h-12">
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              : logs.map((log: any) => (
                  <TableRow key={log.id} className="hover:bg-background">
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{log.actor?.name || log.actorId}</TableCell>
                    <TableCell>
                        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                        {log.action}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {log.entityType} / {log.entityId.substring(0, 8)}...
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">
                      {log.oldValue || "—"}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {log.newValue || "—"}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
