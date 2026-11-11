# Prompt Queue for Claude Code

Queue up your next prompts while Claude is still working. Run them later, by hand or automatically one by one.

Claude Code's own queue sends your message into the running task. This mod holds prompts back until you want them.

Tested with Claude Code 2.1.322. It is a Claude Mod (a plugin with a hooks module), so it needs a Claude Code build that runs mods.

## Install

At the Claude Code prompt:

```
/plugin install prompt-queue --marketplace kuzmany/claude-code-prompt-queue
```

Type `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install prompt-queue --marketplace kuzmany/claude-code-prompt-queue
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `kuzmany/claude-code-prompt-queue`, then **Add plugin**.

Update to the latest version:

```
claude plugin marketplace update prompt-queue
claude plugin update prompt-queue@prompt-queue
```

Remove it:

```
claude plugin uninstall prompt-queue@prompt-queue
```

## Use

| Command | What it does |
| --- | --- |
| `/queue` | Open the queue panel: edit, move up or down, run (▶) or remove (✕) each prompt, and add new ones. |
| `/queue <text>` | Park a prompt. Works while Claude is busy. |
| `/queue list` | Show parked prompts. |
| `/queue run [n]` | Send prompt n now (default 1). |
| `/queue drop <n>` | Remove prompt n. |
| `/queue clear` | Remove all prompts. |
| `/queue-run [n]` | Send the next prompt now (or prompt n). Same as `/queue run`. |
| `/queue-auto` | Toggle auto mode. |
| `/queue unblock` | Stop waiting on background jobs. |

**Auto mode** is off by default. When on, the next prompt starts only after the current task ends **and** every background job or agent it started has finished. Then the next, until the queue is empty. Auto stays on until you toggle it off. Pressing Esc turns it off.

Above the prompt, each queued prompt shows on its own soft amber line, as `#1 <prompt>` (first 5, then `+N more`). In auto mode a dim line below them shows the state, for example `auto · waiting on 1 bg`. Other mods can add to the same row.

`/queue help` lists the commands.

The queue belongs to the current session.

If auto keeps waiting on a job that already ended (for example one a subagent started), run `/queue unblock`.

## Example

```
> run the full test suite in the background
/queue fix the failing tests
/queue update the changelog
/queue-auto
```

Claude finishes the test run, then fixes the tests, then updates the changelog.

## Development

```
git clone https://github.com/kuzmany/claude-code-prompt-queue
cd claude-code-prompt-queue
claude plugin validate .
claude plugin test
claude --plugin-dir .
```

`claude plugin test` runs `hooks/queue.test.tsx` with no session and no network. `claude --plugin-dir .` loads your checkout; saving `hooks/register.tsx` reloads it.

## License

MIT
