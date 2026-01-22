/**
 * Debug script to test tree-sitter analyzer
 */

import { analyzeWorkflowSource, resetIdCounter } from "./index";

async function main() {
  resetIdCounter();

  // Test case that's failing
  const source = `
const workflow = createWorkflow({});

async function run() {
  return await workflow(async (step, deps) => {
    const user = await step(() => deps.fetchUser(id), {
      key: 'user',
      name: 'Fetch User',
    });
    return user;
  });
}
  `;

  console.log("=== Testing workflow analysis ===\n");
  console.log("Source:", source);
  console.log("\n=== Results ===\n");

  const results = await analyzeWorkflowSource(source);
  console.log("Number of results:", results.length);

  if (results[0]) {
    console.log("Root:", JSON.stringify(results[0].root, null, 2));
    console.log("Stats:", results[0].metadata.stats);
    console.log("Warnings:", results[0].metadata.warnings);
  }
}

main().catch(console.error);
