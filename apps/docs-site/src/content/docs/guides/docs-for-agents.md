---
title: Docs for agents
description: Agent-friendly entry points for awaitly docs
---

Use these internal docs entry points when configuring coding agents for this site:

- **Agent setup**: [/guides/claude-skill/](/guides/claude-skill/)
- **Foundations overview**: [/foundations/](/foundations/)
- **Rules index (slug spine)**: [/rules/](/rules/)
- **Static analysis**: [/guides/static-analysis/](/guides/static-analysis/)

## Skill file location

In this repository, the awaitly Claude skill lives at:

`.claude/skills/awaitly-patterns/SKILL.md`

## Suggested agent bootstrap prompt

```text
Read these docs first:
1) /guides/claude-skill/
2) /rules/
3) /guides/static-analysis/
Then follow awaitly step-id and workflow conventions exactly.
```
