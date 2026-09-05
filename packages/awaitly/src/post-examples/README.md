# Post examples — Code Is the Workflow

Executable examples for the [Code Is the Workflow](https://arrangeactassert.com) blog series. Each file is a Vitest test that mirrors a post's "In awaitly" section.

| Test file | Blog post |
| --- | --- |
| `charge-idempotency.test.ts` | [Steps Are Where Side Effects Live](https://arrangeactassert.com/posts/steps-are-where-side-effects-live/) |
| `refund-errors.test.ts` | [Two Kinds of Failure in Long Running Code](https://arrangeactassert.com/posts/two-kinds-of-failure-in-long-running-code/) |
| `crash-resume.test.ts` | [What Happens When the Process Dies](https://arrangeactassert.com/posts/what-happens-when-the-process-dies/) |
| `approval-hook.test.ts` | [Waiting for Humans, Webhooks, and the Outside World](https://arrangeactassert.com/posts/waiting-for-humans-webhooks-and-the-outside-world/) |
| `version-mismatch.test.ts` | [Changing Code While Workflows Are Still Running](https://arrangeactassert.com/posts/changing-code-while-workflows-are-still-running/) |

## Run

From `packages/awaitly`:

```bash
pnpm test src/post-examples
```
