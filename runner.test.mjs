import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createDecisionProvider, parseChoice, runGame, runProcess, validateConnection, mcpClient } from './iron-republic-agent.mjs';

const fixture = fileURLToPath(new URL('./test/agent-cli.mjs', import.meta.url));
const state = { you: 1, acting_seat: 1, status: 'active', room_revision: 1, briefing: { decision_id: 'd1', legal_actions: [{ id: 'legal-1' }] } };

test('all four CLI adapters pass real stdin and decode their own output formats', async () => {
  for (const agent of ['codex', 'claude', 'opencode', 'gemini']) {
    const provider = await createDecisionProvider(agent, { command: [process.execPath, fixture], timeoutMs: 10000 });
    try {
      const { buildPrompt } = await import('./iron-republic-agent.mjs');
      assert.equal(await provider.decide(buildPrompt({}, state)), 'legal-1');
    } finally { await provider.close(); }
  }
  assert.throws(() => parseChoice('claude', '{"is_error":true,"result":"rate limited"}'), /reported an error/);
  assert.throws(() => parseChoice('gemini', '{"response":"I would pick legal-1"}'), /did not return/);
  assert.throws(() => validateConnection({ url: 'http://example.com/mcp/' + 'a'.repeat(32), token: 'secret' }), /HTTPS/);
  assert.throws(() => validateConnection({ url: 'https://example.com/mcp/' + 'a'.repeat(32) + '?token=x', token: 'secret' }), /private MCP URL/);
});

test('runner never submits illegal output, waits without invoking a model, and times out stalled CLIs', async () => {
  let submitted = 0, slept = 0, choices = 0, reads = 0;
  const client = { initialize: async () => {}, tool: async name => {
    if (name === 'join_game') return {};
    if (name === 'play_action') submitted++;
    if (name === 'get_game') return ++reads === 1 ? { ...state, acting_seat: 0 } : state;
  } };
  await assert.rejects(runGame({}, { client, decide: async () => { choices++; return 'illegal'; }, sleep: async () => { slept++; }, log: () => {} }), /legal move/);
  assert.equal(submitted, 0); assert.equal(slept, 1); assert.equal(choices, 3);
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 }), /timed out/);
});

test('uncertain submissions survive a restart and retry the same id without another model call', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'ir-runner-test-'));
  const journalFile = path.join(folder, 'state.json');
  const submissions = [];
  let choices = 0;
  const client = { initialize: async () => {}, tool: async (name, args) => {
    if (name === 'get_game') return state;
    if (name === 'play_action') { submissions.push(args); throw new Error('connection lost'); }
    return {};
  } };
  try {
    await assert.rejects(runGame({}, { client, journalFile, decide: async () => { choices++; return 'legal-1'; }, sleep: async () => {}, log: () => {} }), /uncertain/);
    const pending = JSON.parse(await readFile(journalFile, 'utf8')).pending;
    assert.equal(submissions.length, 3);
    assert.ok(submissions.every(item => item.request_id === pending.request_id));
    const recovered = { initialize: async () => {}, tool: async (name, args) => {
      if (name === 'play_action') { assert.deepEqual(args, pending); return {}; }
      if (name === 'get_game') return { ...state, status: 'finished', scores: [1, 4], winners: [1] };
      return {};
    } };
    await runGame({}, { client: recovered, journalFile, decide: async () => { choices++; }, log: () => {} });
    assert.equal(choices, 1);
    assert.deepEqual(JSON.parse(await readFile(journalFile, 'utf8')), {});
  } finally { await rm(folder, { recursive: true, force: true }); }
});
