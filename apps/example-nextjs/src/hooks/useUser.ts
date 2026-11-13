"use client";

import { useQuery } from "@tanstack/react-query";
import { ResultError } from "../lib/result-error";

export type UserError = { type: "NOT_FOUND" } | { type: "UNAUTHORIZED" };

async function fetchUser(id: string) {
  const res = await fetch(`/api/users/${id}`);
  const data = (await res.json()) as
    | { ok: true; value: { id: number; email: string; createdAt: string } }
    | { ok: false; error: { type: string } };

  if (data.ok) {
    return data.value;
  }
  throw new ResultError<UserError>(data.error as UserError);
}

export function useUser(id: string | null) {
  return useQuery({
    queryKey: ["user", id],
    queryFn: () => fetchUser(id!),
    enabled: !!id,
    retry: (failureCount, error) => {
      if (error instanceof ResultError) {
        const e = error.error as UserError;
        if (e.type === "NOT_FOUND" || e.type === "UNAUTHORIZED") return false;
      }
      return failureCount < 3;
    },
  });
}
