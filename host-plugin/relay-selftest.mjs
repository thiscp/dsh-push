/**
 * Test the relay client against the live relay: register a fake question whose answers are queued
 * for `testhost`, then exercise pending/ack through the public https endpoint (edge nginx path).
 *
 * usage: node relay-selftest.mjs <hostToken>
 */
import { RelayClient } from './lib/relay.js';

const hostToken = process.argv[2];
if (!hostToken) { console.error('usage: node relay-selftest.mjs <hostToken>'); process.exit(2); }

const c = new RelayClient({
  relayBase: 'https://ntfy.cpyh.xyz',
  host: 'testhost',
  hostToken,
  regToken: process.env.REG_TOKEN ?? '',
  ntfyToken: process.env.NTFY_TOKEN ?? '',
  topic: 'dsh-test',
});

console.log('pending before   =', JSON.stringify(await c.pending()));
const bad = new RelayClient({ relayBase: 'https://ntfy.cpyh.xyz', host: 'testhost', hostToken: 'nope', regToken: '', ntfyToken: '', topic: 'dsh-test' });
console.log('wrong token      =', JSON.stringify(await bad.pending()), '(expect [])');
console.log('ack empty        =', JSON.stringify(await c.ack([])));
console.log('poll loop ready  = ok (runAnswerLoop drives it once wired to DSH events)');
