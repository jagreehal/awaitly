"use client";

import { useState } from "react";
import { signup } from "./actions/signup";
import { useUser, type UserError } from "../hooks/useUser";
import { ResultError } from "../lib/result-error";

export function HomeClient() {
  const [actionStatus, setActionStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [apiStatus, setApiStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiSuccess, setApiSuccess] = useState<string | null>(null);

  const [userIdInput, setUserIdInput] = useState("");
  const [queryUserId, setQueryUserId] = useState<string | null>(null);
  const userQuery = useUser(queryUserId);

  async function handleSignupAction(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement)
      .value;
    setActionStatus("loading");
    setActionError(null);
    setActionSuccess(null);
    const result = await signup(email, password);
    setActionStatus(result.success ? "success" : "error");
    if (result.success) {
      setActionSuccess(`User created with id ${result.userId}`);
    } else {
      setActionError(result.error);
    }
  }

  async function handleSignupApi(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = (form.elements.namedItem("api-email") as HTMLInputElement)
      .value;
    const password = (form.elements.namedItem(
      "api-password"
    ) as HTMLInputElement).value;
    setApiStatus("loading");
    setApiError(null);
    setApiSuccess(null);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { userId?: number; error?: string };
      if (res.ok) {
        setApiSuccess(`User created with id ${data.userId}`);
      } else {
        setApiError(data.error ?? "Request failed");
      }
    } catch {
      setApiError("Network error");
    }
    setApiStatus("idle");
  }

  return (
    <div className="space-y-10">
      {/* Server Action signup */}
      <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-medium text-zinc-900 dark:text-zinc-50">
          Signup (Server Action + workflow)
        </h2>
        <form onSubmit={handleSignupAction} className="space-y-3">
          <div>
            <label
              htmlFor="email"
              className="block text-sm text-zinc-600 dark:text-zinc-400"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm text-zinc-600 dark:text-zinc-400"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
            />
          </div>
          <button
            type="submit"
            disabled={actionStatus === "loading"}
            className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {actionStatus === "loading" ? "Submitting…" : "Sign up (action)"}
          </button>
        </form>
        {actionStatus === "error" && actionError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            {actionError}
          </p>
        )}
        {actionStatus === "success" && actionSuccess && (
          <p className="mt-3 text-sm text-green-600 dark:text-green-400">
            {actionSuccess}
          </p>
        )}
      </section>

      {/* API Route signup */}
      <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-medium text-zinc-900 dark:text-zinc-50">
          Signup (API Route + workflow)
        </h2>
        <form onSubmit={handleSignupApi} className="space-y-3">
          <div>
            <label
              htmlFor="api-email"
              className="block text-sm text-zinc-600 dark:text-zinc-400"
            >
              Email
            </label>
            <input
              id="api-email"
              name="api-email"
              type="email"
              required
              className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
            />
          </div>
          <div>
            <label
              htmlFor="api-password"
              className="block text-sm text-zinc-600 dark:text-zinc-400"
            >
              Password
            </label>
            <input
              id="api-password"
              name="api-password"
              type="password"
              required
              className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
            />
          </div>
          <button
            type="submit"
            disabled={apiStatus === "loading"}
            className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {apiStatus === "loading" ? "Submitting…" : "Sign up (API)"}
          </button>
        </form>
        {apiStatus === "error" && apiError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            {apiError}
          </p>
        )}
        {apiSuccess && (
          <p className="mt-3 text-sm text-green-600 dark:text-green-400">
            {apiSuccess}
          </p>
        )}
      </section>

      {/* React Query: get user */}
      <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-medium text-zinc-900 dark:text-zinc-50">
          Get user (React Query + Result)
        </h2>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="User ID (e.g. 1)"
              value={userIdInput}
              onChange={(e) => setUserIdInput(e.target.value)}
              className="w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
            />
            <button
              type="button"
              onClick={() => setQueryUserId(userIdInput.trim() || null)}
              className="rounded bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Fetch
            </button>
          </div>
          {userQuery.isLoading && (
            <p className="text-sm text-zinc-500">Loading…</p>
          )}
          {userQuery.isError && userQuery.error instanceof ResultError && (
            <div className="text-sm">
              <p className="font-medium text-red-600 dark:text-red-400">
                Error:
              </p>
              <p className="text-zinc-600 dark:text-zinc-400">
                {((): string => {
                  const e = userQuery.error.error as UserError;
                  switch (e) {
                    case "NOT_FOUND":
                      return "User not found";
                    case "UNAUTHORIZED":
                      return "Unauthorized";
                    default:
                      return String(e);
                  }
                })()}
              </p>
            </div>
          )}
          {userQuery.isSuccess && userQuery.data && (
            <div className="rounded border border-zinc-200 p-3 dark:border-zinc-700">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {userQuery.data.email}
              </p>
              <p className="text-xs text-zinc-500">id: {userQuery.data.id}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
