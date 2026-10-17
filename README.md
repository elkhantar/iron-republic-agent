# Iron Republic agent runner

A small, dependency-free local runner that lets your own agent play a reserved
seat in an Iron Republic playtest game. Supports **Codex CLI, Claude Code,
OpenCode, Gemini CLI**, and custom command-line adapters.

The runner joins your seat, waits for your decisions, asks your chosen CLI for
one legal move, validates it, and submits it. It stops when the game finishes.
Waiting turns do not invoke the model. Invalid output never becomes a random move.

## Quick start

1. Install [Node.js](https://nodejs.org/) 22 or newer.
2. Install and sign in to your chosen agent's official CLI:

| Agent | Sign-in/setup |
| --- | --- |
| [Codex CLI](https://developers.openai.com/codex/cli/) | Run `codex login` and sign in with your eligible ChatGPT account, or use your configured API account. |
| [Claude Code](https://code.claude.com/docs/en/quickstart) | Start `claude` and sign in using its supported account flow. Eligible Claude subscriptions can provide Claude Code access. |
| [OpenCode](https://opencode.ai/docs/) | Run `opencode auth login` and select your provider. Provider access and billing depend on your configuration. |
| [Gemini CLI](https://geminicli.com/docs/get-started/authentication/) | Start `gemini` and complete its Google sign-in or your chosen supported authentication method. |

3. Ask the room owner to reserve an **External LLM** seat. From **Connect LLM**,
   download `iron-republic-agent.mjs` and your private
   `iron-republic-seat-2.json` connection file into the same folder.
4. Open a terminal in that folder and run:

```sh
node iron-republic-agent.mjs --config iron-republic-seat-2.json
```

Keep the terminal running. **Ctrl+C** stops it. Run the same command to resume.
The game starts automatically when all humans and external agents have joined.

The selected CLI uses its normal saved sign-in. We do not turn browser
subscriptions into API credentials or promise access outside each provider's
supported CLI. Model availability, plan eligibility, usage limits and costs are
controlled by your provider. ChatGPT users use Codex CLI, not the ChatGPT browser
chat. Claude users use Claude Code. No model API key is uploaded to the game.

## Choose an agent or model

The downloaded connection file remembers the agent selected in the lobby. You
can override it:

```sh
node iron-republic-agent.mjs --config iron-republic-seat-2.json --agent claude
node iron-republic-agent.mjs --config iron-republic-seat-2.json --agent opencode --model provider/model-name
node iron-republic-agent.mjs --doctor
```

`--doctor` checks which CLIs are on PATH without contacting a model. There are no
fixed model names: the provider's configured default is used unless `--model`
is supplied. On Windows, native executables and the supported npm JS entry points
work without running prompts through a command shell.

You can also supply the connection without a file:

```powershell
$env:IR_SEAT_TOKEN = 'your-seat-token'
node iron-republic-agent.mjs --agent codex --url https://api.ironrepublicgame.com/mcp/ROOM_ID
```

Prefer the downloaded file to avoid entering credentials into terminal history.
Never commit or share it publicly. Each seat has its own credential.

## How it chooses moves

Each decision gets a fresh CLI invocation with the game's rules digest, session
reference and current private seat view. The agent is told to maximize final VP,
improve its winning position relative to rivals, and deny opponents' scoring when
worthwhile. The runner expects only `{"action":"exact-legal-id"}` and validates
the answer against the current legal actions. The model receives no seat token.
It does not need tools or an MCP configuration; the runner handles the MCP calls.

The rules and game views are downloaded only after authenticating. This repository
does **not** contain the game engine, rules catalogue, cards, artwork, bot
strategies, replays or any account credentials. See [SECURITY.md](SECURITY.md) for
the boundaries and the information sent to model providers.

## Reliability and limits

- Same-action network retries reuse the same request ID to prevent double moves.
- Pending submissions are journaled under `~/.iron-republic/agents/` before being
  sent. After a crash, the same command retries the uncertain submission before
  asking for a new move. Keep the state file until recovery completes.
- The runner validates every returned action; after three invalid answers it
  stops. Login failures, exhausted usage limits and stalled CLIs also stop with
  an error. Sign in or restore your quota, then restart to resume.
- Defaults: 3 seconds between waiting polls, 180 seconds per CLI invocation,
  1,000 decisions and 24 hours per run. Overrides: `--poll`, `--timeout`,
  `--max-decisions`, `--max-hours`, `--state`. Run `--help` for details.
- Run only one runner per seat. Separate seats can use separate terminals.
- No agent, subscription or network service is guaranteed to remain available.
  This is a runner, not a hosted LLM service.

## Other CLIs

An adapter can receive the prompt on stdin and return only a JSON action on
stdout. Supply an executable and argument array; no shell interpolation is used:

```sh
node iron-republic-agent.mjs --config iron-republic-seat-2.json --agent custom --command-json '["my-agent","--print"]'
```

On Windows use a native executable, or `node` with a JS script, rather than a
`.cmd` wrapper. Do not include secrets in the command argument array.

## Inspect and test

There are no package dependencies or install hooks. Read the `.mjs` file directly.

```sh
node --check iron-republic-agent.mjs
npm test
```

Tests use deterministic local fixtures, not paid model calls. They exercise all
four process adapters, invalid-move rejection, polling, timeouts and crash-safe
submission recovery. Full-engine integration tests remain in the private game
repository. `SHA256SUMS` lets you compare the runner downloaded from the game
with this source. On PowerShell: `Get-FileHash iron-republic-agent.mjs -Algorithm SHA256`.

Official CLI references:
[Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/),
[Codex authentication](https://developers.openai.com/codex/auth/),
[Claude Code headless](https://code.claude.com/docs/en/headless),
[OpenCode CLI](https://opencode.ai/docs/cli/),
[Gemini headless](https://geminicli.com/docs/cli/headless/).
