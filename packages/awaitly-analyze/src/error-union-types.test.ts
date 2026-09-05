/**
 * The generated .types.ts must agree with the generated diagram.
 *
 * Both come out of one analysis, so a types file reporting `never` while the
 * diagram draws named error exits is worse than emitting nothing: the diagram
 * is right, and someone will trust the types.
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const CLI_PATH = join(__dirname, '..', 'dist', 'cli.js');
const FIXTURES_DIR = join(__dirname, '__fixtures__');
const fixture = join(FIXTURES_DIR, 'cli-test-error-union.ts');
const typesPath = join(FIXTURES_DIR, 'errorUnionPipeline.types.ts');

afterEach(() => {
  if (existsSync(typesPath)) unlinkSync(typesPath);
});

describe('generated types error union', () => {
  it('names the same errors the diagram draws', () => {
    const run = spawnSync('node', [CLI_PATH, fixture], { encoding: 'utf-8' });
    expect(run.status).toBe(0);

    // The diagram is the reference: it draws both error exits.
    expect(run.stdout).toContain('BatchNotFound');
    expect(run.stdout).toContain('SubmitRejected');

    const types = readFileSync(typesPath, 'utf-8');
    expect(types).toContain('BatchNotFound');
    expect(types).toContain('SubmitRejected');
    expect(types).toContain('"LiteralFailure"');
    expect(types).not.toContain(`'"LiteralFailure"'`);
    expect(types).not.toContain('Error = never');
    expect(types.match(/^ {2}batch:/gm)).toHaveLength(1);
  });
});
