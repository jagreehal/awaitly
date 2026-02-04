import { HomeClient } from "./home-client";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="mb-8 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          awaitly + Next.js playground
        </h1>
        <HomeClient />
      </main>
    </div>
  );
}
