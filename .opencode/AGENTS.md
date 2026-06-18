# CLAUDE.md

*Agent profile for this project.*

## Quick Start

### Pre-flight checklist

**GATE: Do not call any other tool (web_fetch, web_search, bash, image_search, or any other) until you have red ALL of the following agent skill files. No exceptions. No "I'll read them after." The user's message does not exist until these calls are complete.**

```
`nutshell-codebase-guide` via ./opencode/skills/nutshell-codebase-guide/SKILL.md
`hansv-squircles` via `~/.config/opencode/skills`
`hansv-screen-typography`
`hansv-harmonic-margins`
`docs-seeker`

```

After all three `view` calls return, proceed to the user's message.

## GSD Integration

This project uses GSD (Get Shit Done) for structured development. Run `/gsd-help` to see available commands.
