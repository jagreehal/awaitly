#!/usr/bin/env node
/* global process, console */
/**
 * Generate markdown documentation from workflow source files.
 *
 * Usage (from repo root after building awaitly-analyze):
 *   node packages/awaitly-analyze/scripts/generate-workflow-docs.mjs path/to/workflows.ts
 *
 * Or from packages/awaitly-analyze:
 *   node scripts/generate-workflow-docs.mjs path/to/workflows.ts
 *
 * Output: one markdown section per workflow (title, description, markdown, step list).
 */

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node generate-workflow-docs.mjs <workflow-file.ts>');
  process.exit(1);
}

async function main() {
  const { analyze, getStaticChildren, isStaticStepNode } = await import('../dist/index.js');
  const result = analyze(filePath);

  let irs;
  try {
    irs = result.all();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  for (const ir of irs) {
    const { root } = ir;
    const lines = [];
    lines.push(`# ${root.workflowName}\n`);
    if (root.description) lines.push(`${root.description}\n`);
    if (root.markdown) lines.push(`${root.markdown}\n`);
    lines.push(`- **Steps:** ${ir.metadata.stats.totalSteps}`);
    if (ir.metadata.stats.conditionalCount) lines.push(`- **Decision points:** ${ir.metadata.stats.conditionalCount}`);
    if (ir.metadata.stats.parallelCount) lines.push(`- **Parallel operations:** ${ir.metadata.stats.parallelCount}`);
    lines.push('');

    function listSteps(node, depth = 0) {
      if (isStaticStepNode(node)) {
        const name = node.name || node.key || 'step';
        const desc = node.description ? ` — ${node.description}` : '';
        lines.push(`${'  '.repeat(depth)}- **${name}**${desc}`);
      }
      for (const child of getStaticChildren(node)) {
        listSteps(child, depth + 1);
      }
    }
    lines.push('## Steps\n');
    for (const child of root.children) {
      listSteps(child);
    }
    console.log(lines.join('\n'));
    console.log('\n---\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
