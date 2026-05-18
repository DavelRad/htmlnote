---
description: Open visual review on an HTML file
allowed-tools: Bash(htmlnote:*)
disable-model-invocation: true
---

## htmlnote Review

!`htmlnote $ARGUMENTS --json`

## Your task

The output above is one of:

1. A JSON object with a non-empty `feedback` array — the user marked up the rendered HTML. Address each note in `feedback[]`, re-render the file, and stop.
2. Empty output or `{"feedback":[]}` — the user closed the review without leaving notes. Acknowledge in one sentence and stop.
