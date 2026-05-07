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

export default function AdminBooksPage() {
  const { data, isPending } = useQuery({
    queryKey: ["admin-books"],
    queryFn: async () => {
      const res = await fetch("/api/admin/books");
      return res.json();
    },
  });

  const books = data?.books || [];

  return (
    <div>
      <h1 className="text-[20px] font-semibold text-slate-900">
        Universal Library
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        All books in the system
      </p>

      <div className="mt-4 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Uploaded By</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6} className="h-12">
                      <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    </TableCell>
                  </TableRow>
                ))
              : books.map((book: any) => (
                  <TableRow key={book.id} className="hover:bg-slate-50">
                    <TableCell className="font-medium">{book.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {book.author || "Unknown"}
                    </TableCell>
                    <TableCell>
                      {book.language !== "und" ? book.language.toUpperCase() : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {book.uploadedBy?.name || "Unknown"}
                    </TableCell>
                    <TableCell>{book._count.userAccesses}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(book.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
