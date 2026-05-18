# htmlnote

Visual review for AI-generated HTML. When Claude Code writes or edits an HTML file, htmlnote opens a browser tab that lets you click any element, leave notes, and copy them back into chat so Claude can apply your changes.

No interruption mid-turn. No "Send to agent" hidden in a button somewhere. You see the final result, you mark it up, you paste back. Honest about how Claude Code plugins actually work.

## How it works

```
You: "make me a landing page"
        ↓
Claude writes/edits HTML (no popups during the turn)
        ↓
Claude finishes responding
        ↓
↳ htmlnote tab opens in your browser ← only if HTML was touched
        ↓
You click elements / drag-select text / leave notes
        ↓
Click "Copy for chat" → your notes are on the clipboard
        ↓
Paste into Claude Code chat → submit
        ↓
Claude applies your notes → loop until you're happy
```

If your prompt isn't about HTML (asking a question, editing Python, etc.) — no tab. htmlnote only fires when Claude actually wrote/edited a `.html` or `.htm` file in the turn that just ended.

## Install

Two pieces — the Claude Code plugin and the binary.

**1. Register the plugin** — inside Claude Code, run each line as a **separate** prompt (don't paste both at once):

```
/plugin marketplace add https://github.com/DavelRad/htmlnote.git
```

```
/plugin install htmlnote
```

**2. Install the binary** — in your terminal:

```
curl -fsSL https://raw.githubusercontent.com/DavelRad/htmlnote/main/install.sh | bash
```

Downloads a precompiled binary for your platform (macOS arm64/x64, Linux x64/arm64), verifies the SHA256, and installs to `~/.local/bin/htmlnote`. Make sure that directory is in your `PATH`.

After both steps, **restart Claude Code** (quit and relaunch — not just a new conversation) so it loads the new hook configuration.

## Using it

You don't run any command. After Claude writes or edits HTML during a turn, a tab opens automatically when the turn ends. Click any element to annotate it; drag-select text to highlight a specific phrase; press `N` for a general note not tied to anything.

When you're done annotating, click **Copy for chat**. Your notes are formatted as markdown and put on your clipboard. Paste into Claude Code chat and submit — Claude reads them like normal input and applies the changes. If the file gets touched again during the new turn, a fresh tab opens with the updated state. Loop until you're satisfied.

### Keyboard shortcuts

| Key | What |
|---|---|
| `E` | Toggle annotate mode (click elements vs. just look) |
| `Click` | Drop a pin on an element |
| `Drag` | Highlight text and annotate it |
| `N` | Add a general note (no element target) |
| `J` / `K` | Walk through annotations |
| `Del` / `Backspace` | Delete the selected annotation |
| `⌘+↵` | Copy notes for chat |
| `⌘+K` | Command palette |
| `?` | Show this list |
| `Esc` | Cancel composer / exit annotate mode |

### Manual review

Want to review an HTML file outside of Claude Code's flow?

```
htmlnote path/to/file.html
```

Opens the same review UI in your browser. Same hotkeys, same Copy button.

## Updating

```
htmlnote --update
```

Self-updates the binary to the latest release. Verifies SHA256 before replacing itself. Won't downgrade.

For the plugin side (if a release changes hook configuration), refresh inside Claude Code:

```
/plugin marketplace update DavelRad/htmlnote
/plugin update htmlnote
```

Then restart Claude Code so the new hooks load.

## Troubleshooting

**The tab doesn't pop up after Claude finishes editing HTML.**
Claude Code caches the plugin's hook config at app startup. After installing or updating, fully **quit and relaunch Claude Code** (not just a new conversation). Then try again.

**Daemon isn't responding.**
htmlnote runs a small background process (the "daemon") that serves the review UI. Restart it:

```
htmlnote --stop
htmlnote --daemon
```

Your saved annotations live on disk and survive the restart.

**Reset everything.**

```
htmlnote --stop
rm -rf ~/.htmlnote
```

Wipes all session history and the daemon's discovery file. Next HTML edit will start fresh.

**Dev install (different platform, or contributing).**
If your platform doesn't have a prebuilt binary, clone and install from source:

```
git clone https://github.com/DavelRad/htmlnote
cd htmlnote
bash install.sh --local .
```

Requires Node 18+ and npm. Builds and symlinks `~/.local/bin/htmlnote` to your checkout.

## What it does NOT do

- Doesn't intercept non-HTML edits. Only `.html` and `.htm` files trigger the popup.
- Doesn't send anything to the network. The daemon binds to `127.0.0.1` only; no telemetry; no cloud.
- Doesn't auto-submit feedback. You explicitly hit Copy and paste — htmlnote never types into Claude on your behalf.
- Doesn't loosen the iframe sandbox. AI-generated HTML runs `sandbox="allow-scripts"` with no `allow-same-origin`. Your host page, cookies, and DOM are safe from whatever Claude wrote.

## License

[MIT](./LICENSE)
