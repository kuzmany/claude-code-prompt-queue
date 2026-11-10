# Prompt Queue for Claude Code

Queue up your next prompts and slash commands while Claude is still working. Run them later, by hand or automatically one by one.

Claude Code's own queue sends your message into the running task. This mod holds prompts back until you want them.

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

## Use

| Command | What it does |
| --- | --- |
| `/queue` | Open the queue panel: edit, move up or down, run (▶) or remove (✕) each entry, and add new ones. |
| `/queue <text>` | Park a prompt. Works while Claude is busy. |
| `/queue /name [args]` | Park a slash command to run as if you typed it. |
| `/queue list` | Show parked entries. |
| `/queue run [n]` | Send entry n now (default 1). |
| `/queue drop <n>` | Remove entry n. |
| `/queue clear` | Remove all entries. |
| `/queue-auto` | Toggle auto mode. |
| `/queue unblock` | Stop waiting on background jobs. |

**Auto mode** is off by default. When on, the next entry starts only after the current task ends **and** every background job or agent it started has finished. Then the next, until the queue is empty. Auto stays on until you toggle it off. Pressing Esc turns it off.

A parked slash command runs through `$.command.run`, so it reaches the same command, arguments and hooks as typing it. A command that starts no turn lets the next entry go by itself.

If an entry cannot be sent, it stays in the queue: auto entries return to the front and auto turns off with a toast; a manual run puts it back where it was. `/queue-auto` resumes.

A dim line above the prompt shows the state, for example `3 queued: /review-pr 12 · auto · waiting on 1 bg`. Other mods can add to the same row.

`/queue help` lists the commands.

The queue belongs to the current session.

If auto keeps waiting on a job that already ended (for example one a subagent started), run `/queue unblock`.

## Example

```
> run the full test suite in the background
/queue fix the failing tests
/queue /review-pr 123
/queue update the changelog
/queue-auto
```

Claude finishes the test run, then fixes the tests, then reviews the PR, then updates the changelog.

## License

MIT
