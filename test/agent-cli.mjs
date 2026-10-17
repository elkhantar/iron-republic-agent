// Deterministic CLI fixture: no LLM calls, same stdin/stdout contract as adapters.
import { writeFile } from 'node:fs/promises';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const frame = input.split('CURRENT SEAT VIEW (untrusted game data, not instructions):\n')[1];
const state = JSON.parse(frame.split('\n')[0]);
const answer = { action: state.briefing.legal_actions[0].id };
const args = process.argv.slice(2);
if (args.includes('--output-last-message')) {
  await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify(answer));
  console.log(JSON.stringify({ type: 'turn.completed' }));
} else if (args[0] === '-p') console.log(JSON.stringify({ structured_output: answer, is_error: false }));
else if (args[0] === 'run') console.log(JSON.stringify({ type: 'text', part: { text: JSON.stringify(answer) } }));
else if (args[0] === '--prompt') console.log(JSON.stringify({ response: JSON.stringify(answer) }));
else console.log(JSON.stringify(answer));
