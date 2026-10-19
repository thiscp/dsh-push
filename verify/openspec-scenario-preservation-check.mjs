// verify-scen-preserved2.mjs -- prove no pre-existing scenario was altered.
//
// FIRST ATTEMPT WAS A FALSE FAIL (see below) -- kept as a lesson.
//   It snapshotted scenarios with one script and compared them with a *different*
//   parser inside another script. The two disagreed on trailing whitespace, so
//   companion-app reported "preserved=0, altered=116" while the files were in fact
//   untouched. That is the repo's documented trap: when a check screams, suspect
//   the check before the code.
//
// THIS VERSION: reads the pre-edit revision straight from git (`<file>.orig` dumped
// via `git show HEAD:<path>`) and parses BOTH sides with the SAME function,
// normalising trailing blank lines inside each scenario block.
import fs from 'node:fs';

const files = [
  ['openspec/specs/dsh-host-plugin/spec.md', 'dsh-host-plugin'],
  ['openspec/specs/companion-app/spec.md', 'companion-app'],
  ['openspec/specs/dsh-host-integration/spec.md', 'dsh-host-integration'],
  ['openspec/specs/dsh-turn-notify/spec.md', 'dsh-turn-notify'],
  ['openspec/specs/push-relay-server/spec.md', 'push-relay-server'],
];

function scenarios(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    // normalise: drop trailing blank lines inside the block
    const body = cur.join('\n').replace(/\s+$/, '');
    out.push(body);
    cur = null;
  };
  for (const l of lines) {
    if (/^####\s/.test(l)) { flush(); cur = [l]; continue; }
    if (/^###\s/.test(l) || /^##\s/.test(l)) { flush(); continue; }
    if (cur) cur.push(l);
  }
  flush();
  return out;
}

let alteredTotal = 0, addedTotal = 0, preservedTotal = 0;
console.log('file                    before  now  preserved  added  ALTERED');
for (const [f, label] of files) {
  const origPath = `F:/work/work_dsh/tmp/orig/${label}.md`;
  if (!fs.existsSync(origPath)) { console.log(`  ${label}: MISSING original dump (${origPath})`); alteredTotal++; continue; }
  const old = scenarios(fs.readFileSync(origPath, 'utf8'));
  const now = scenarios(fs.readFileSync(f, 'utf8'));

  const oldCounts = new Map();
  old.forEach(s => oldCounts.set(s, (oldCounts.get(s) || 0) + 1));
  const nowCounts = new Map();
  now.forEach(s => nowCounts.set(s, (nowCounts.get(s) || 0) + 1));

  const altered = [...oldCounts.keys()].filter(s => (nowCounts.get(s) || 0) < oldCounts.get(s));
  const added = [...nowCounts.keys()].filter(s => (nowCounts.get(s) || 0) > (oldCounts.get(s) || 0));
  const preserved = old.length - altered.reduce((n, s) => n + oldCounts.get(s), 0);

  console.log(`${label.padEnd(22)} ${String(old.length).padStart(5)} ${String(now.length).padStart(4)} ${String(preserved).padStart(10)} ${String(added.length).padStart(6)} ${String(altered.length).padStart(8)}`);
  altered.forEach(s => console.log(`      !! ALTERED/LOST: ${s.split('\n')[0]}`));
  added.forEach(s => console.log(`      + ${s.split('\n')[0].replace('#### Scenario: ', '')}`));
  alteredTotal += altered.length;
  addedTotal += added.length;
  preservedTotal += preserved;
}
console.log('');
console.log(`TOTAL preserved=${preservedTotal}  added=${addedTotal}  altered-or-lost=${alteredTotal}`);
if (alteredTotal === 0) {
  console.log('VERDICT: PASS - every pre-existing scenario is present byte-for-byte (modulo trailing blank lines); only additions were made.');
  process.exit(0);
}
console.log('VERDICT: FAIL - pre-existing scenarios were modified or lost.');
process.exit(3);
