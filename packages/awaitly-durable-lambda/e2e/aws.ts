/**
 * Deploy or destroy the end-to-end function in a real AWS account.
 *
 *   AWS_PROFILE=my-profile AWS_REGION=eu-north-1 pnpm aws:deploy
 *   AWS_PROFILE=my-profile AWS_REGION=eu-north-1 pnpm aws:destroy
 *
 * Creates exactly three things, all named `awaitly-durable-lambda-e2e`: an IAM
 * role, a durable function, and its `live` alias. `destroy` removes all three.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AttachRolePolicyCommand,
  CreateRoleCommand,
  DeleteRoleCommand,
  DetachRolePolicyCommand,
  GetRoleCommand,
  IAMClient,
  NoSuchEntityException,
} from "@aws-sdk/client-iam";
import {
  CreateAliasCommand,
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  InvalidParameterValueException,
  LambdaClient,
  PublishVersionCommand,
  ResourceNotFoundException,
  UpdateAliasCommand,
  UpdateFunctionCodeCommand,
  waitUntilFunctionActiveV2,
  waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import { build } from "esbuild";

export const NAME = "awaitly-durable-lambda-e2e";
export const ALIAS = "live";
const POLICY_ARN = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy";

const here = dirname(fileURLToPath(import.meta.url));
const buildDir = join(here, ".build");
export const deployedFile = join(here, ".deployed.json");

export type Deployed = { functionArn: string; aliasArn: string; region: string };

function requireTarget(): string {
  const { AWS_PROFILE, AWS_REGION } = process.env;
  if (!AWS_PROFILE || !AWS_REGION) {
    throw new Error("Set AWS_PROFILE and AWS_REGION explicitly; this script never guesses an account.");
  }
  return AWS_REGION;
}

async function bundle(): Promise<Buffer> {
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  await build({
    entryPoints: [join(here, "handler.ts")],
    outfile: join(buildDir, "index.mjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    // CommonJS dependencies call require() for Node built-ins.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });
  const zip = join(buildDir, "function.zip");
  execFileSync("zip", ["-qj", zip, join(buildDir, "index.mjs")]);
  return readFileSync(zip);
}

async function ensureRole(iam: IAMClient): Promise<string> {
  const roleArn = (await getRoleArn(iam)) ?? (await createRole(iam));
  // Idempotent, so every deploy attaches the policy, including to an existing role.
  await iam.send(new AttachRolePolicyCommand({ RoleName: NAME, PolicyArn: POLICY_ARN }));
  return roleArn;
}

async function getRoleArn(iam: IAMClient): Promise<string | undefined> {
  try {
    const { Role } = await iam.send(new GetRoleCommand({ RoleName: NAME }));
    return Role?.Arn;
  } catch (error) {
    if (error instanceof NoSuchEntityException) return undefined;
    throw error;
  }
}

async function createRole(iam: IAMClient): Promise<string> {
  const { Role } = await iam.send(
    new CreateRoleCommand({
      RoleName: NAME,
      Description: "awaitly-durable-lambda end-to-end tests",
      AssumeRolePolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
      }),
    })
  );
  if (!Role?.Arn) throw new Error("CreateRole returned no ARN");
  return Role.Arn;
}

async function functionExists(lambda: LambdaClient): Promise<boolean> {
  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: NAME }));
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) return false;
    throw error;
  }
}

async function createFunction(lambda: LambdaClient, roleArn: string, zip: Buffer): Promise<void> {
  // A new role takes a few seconds to become assumable by Lambda.
  for (let attempt = 1; ; attempt++) {
    try {
      await lambda.send(
        new CreateFunctionCommand({
          FunctionName: NAME,
          Runtime: "nodejs22.x",
          Handler: "index.handler",
          Role: roleArn,
          Code: { ZipFile: zip },
          Timeout: 60,
          MemorySize: 512,
          // Durable from creation: adding DurableConfig later replaces the function.
          DurableConfig: { ExecutionTimeout: 900, RetentionPeriodInDays: 1 },
        })
      );
      return;
    } catch (error) {
      const roleNotReady = error instanceof InvalidParameterValueException && /role/i.test(error.message);
      if (!roleNotReady || attempt >= 15) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

export async function deploy(): Promise<Deployed> {
  const region = requireTarget();
  const iam = new IAMClient({ region });
  const lambda = new LambdaClient({ region });
  const zip = await bundle();
  const roleArn = await ensureRole(iam);

  if (await functionExists(lambda)) {
    await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: NAME, ZipFile: zip }));
    await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: NAME });
  } else {
    await createFunction(lambda, roleArn, zip);
    await waitUntilFunctionActiveV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: NAME });
  }

  // Durable executions run against a qualified ARN, pinned to one version.
  const { Version, FunctionArn } = await lambda.send(new PublishVersionCommand({ FunctionName: NAME }));
  if (!Version || !FunctionArn) throw new Error("PublishVersion returned no version");
  let aliasArn: string | undefined;
  try {
    ({ AliasArn: aliasArn } = await lambda.send(
      new UpdateAliasCommand({ FunctionName: NAME, Name: ALIAS, FunctionVersion: Version })
    ));
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) throw error;
    ({ AliasArn: aliasArn } = await lambda.send(
      new CreateAliasCommand({ FunctionName: NAME, Name: ALIAS, FunctionVersion: Version })
    ));
  }
  if (!aliasArn) throw new Error("Alias returned no ARN");

  const deployed: Deployed = { functionArn: FunctionArn, aliasArn, region };
  writeFileSync(deployedFile, JSON.stringify(deployed, null, 2) + "\n");
  return deployed;
}

export async function destroy(): Promise<void> {
  const region = requireTarget();
  const iam = new IAMClient({ region });
  const lambda = new LambdaClient({ region });
  const ignoreMissing = (error: unknown) => {
    if (!(error instanceof ResourceNotFoundException) && !(error instanceof NoSuchEntityException)) throw error;
  };
  // Deleting the function removes its versions and aliases.
  await lambda.send(new DeleteFunctionCommand({ FunctionName: NAME })).catch(ignoreMissing);
  await iam.send(new DetachRolePolicyCommand({ RoleName: NAME, PolicyArn: POLICY_ARN })).catch(ignoreMissing);
  await iam.send(new DeleteRoleCommand({ RoleName: NAME })).catch(ignoreMissing);
  rmSync(deployedFile, { force: true });
  rmSync(buildDir, { recursive: true, force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === "deploy") {
    const deployed = await deploy();
    console.log(`Deployed ${deployed.aliasArn}`);
  } else if (command === "destroy") {
    await destroy();
    console.log(`Destroyed ${NAME} (function, alias, role)`);
  } else {
    console.error("Usage: tsx e2e/aws.ts <deploy|destroy>");
    process.exitCode = 1;
  }
}
