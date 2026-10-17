# What this runner can see and do

The public runner contains transport and process orchestration, not the game
implementation. Its source reveals API/tool names, JSON field names, the game
name and the generic objective of winning with Victory Points. It does not bundle
rules text, card data, artwork, game-engine code, bot logic or credentials.

## Information flow

1. The private connection file supplies a room URL and a token for one seat.
2. The runner sends that token only to the configured MCP endpoint over HTTPS
   (or HTTP on loopback for local testing). HTTP redirects are refused.
3. The server returns that seat's rules/reference and game view. Hidden
   information is filtered by the server, not by the runner.
4. Rules, the reference and the seat view go to the selected CLI on stdin. The
   CLI uses its own provider connection and saved sign-in. This necessarily
   discloses the supplied game information to that model provider.
5. The CLI returns a move. The runner checks it is currently legal, then submits
   it with the seat token. The server also checks turn, decision and revision.

The runner does not put the seat token in model prompts. `IR_SEAT_TOKEN` is removed from the child
process environment. The runner does not read your CLI's authentication files,
copy provider credentials, contact a runner telemetry service, or configure a
remote agent service. Your chosen CLI can have its own logging, telemetry,
plugins, authentication and retention behavior; those are outside this runner.

## Local execution

Prompts are piped to native processes with `shell: false`, in an isolated
temporary working directory. Claude's built-in tools and MCP configuration are
disabled for the invocation, with safe mode and user hooks disabled (managed
hooks can still run); OpenCode disables external plugins with `--pure` and
receives deny permissions; Codex ignores
user configuration and project rules, disables its shell tool and uses its
read-only sandbox. Gemini gets temporary project settings disabling built-in
tools, hooks, MCP, extensions and skills; genuine managed system settings retain
their normal precedence. Other CLI settings and credentials are inherited from your
own account. This is **not** a universal sandbox for arbitrary executables. A
custom command is software you choose to trust. No dangerous blanket approval
or sandbox-bypass option is enabled by the runner. Tool restrictions are defense
in depth, not an operating-system security boundary: a trusted CLI or plugin can
still access files and inherited provider credentials under your account. Keep
connection files outside any shared agent project, and use only trusted CLIs and
local configuration. The runner cannot sanitize arbitrary malicious software.

Only one legal action is requested at a time, with no model calls while waiting
for another seat. Invalid output stops after bounded retries. A timeout ends a
stalled CLI and attempts to terminate its process tree. It stops waiting even
if OS cleanup fails; detached or orphaned processes are not a universal billing
or isolation guarantee. Ctrl+C stops the runner. CLI stderr is not
printed automatically because it can contain private data. A local journal stores a pending action,
revision, decision ID and request ID so a restart can safely retry an uncertain
submission. It does not store the token or entire game view. A CLI may separately
retain prompts in its own history; check that CLI's settings. The journal records
a one-way connection fingerprint to catch accidental reuse with a different
seat. Legacy journals without that fingerprint must be used with their original
connection. Unknown submission errors retain the pending request; only confirmed
invalid/conflicting actions clear it. Transient reads have bounded retries, and
repeated decisions stop instead of repeatedly spending model calls.

## Keep private

- Connection JSON files contain seat credentials. Share only with that seat's
  operator. A token holder can control the seat and read its private information.
- Do not publish connection files, runner state, game dumps, CLI logs or your
  provider's authentication files. The repository's `.gitignore` excludes the
  usual connection filenames; inspect any files you add yourself.
- The room owner can retrieve the invited external seat's token. It is not a
  mechanism for hiding that seat's credentials from the owner.
- Deleting or expiring the room removes access. Lobby logout alone does not
  revoke a previously shared seat token.

Downloading the public source grants no game access. Access still requires a
valid seat token from an authenticated room owner. A legitimate player's rules
and observations are necessarily available to that player and their model; do
not rely on client code to keep those materials secret from invited players.
