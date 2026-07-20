import { run } from "awaitly";

async function execute() {
  return await run(async (step) => {
    const x = await step(() => Promise.resolve(1));
    return x;
  });
}
