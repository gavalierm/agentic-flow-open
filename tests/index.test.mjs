// P-039, P-010, P-022: generated indexes and limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setup, memoryRecord } from './helpers.mjs';
import { buildIndexes } from '../scripts/index.mjs';
import { loadPolicy } from '../scripts/config.mjs';

test('indexes land in local/ (ignored, never committed) and limits 50/50/10 are reported', () => {
  const fx = setup();
  try {
    for (let i = 1; i <= 51; i++) fs.writeFileSync(path.join(fx.brain, 'memory', `service-s${i}.md`), memoryRecord(`service-s${i}`, `service ${i}`));
    for (let i = 1; i <= 11; i++) {
      const dir = path.join(fx.brain, 'topics', `t${i}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'topic.json'), JSON.stringify({ id: `t${i}`, subject: 's', kind: 'discussion', state: 'working' }));
      fs.writeFileSync(path.join(dir, 'holder.json'), '{}');
      fs.writeFileSync(path.join(dir, 'handover.md'), '## Zadanie\nx\n## Hotové\n-\n## Ďalší krok\nstep 2\n## Súbory\n-\n## Otvorené otázky\n-\n');
    }
    const policy = loadPolicy(fx.brain);
    const res = buildIndexes(fx.brain, policy);
    assert.equal(res.counts.memory, 51);
    assert.ok(res.warnings.some((w) => /memory index 51 lines > 50/.test(w)), res.warnings.join());
    assert.ok(res.warnings.some((w) => /open topics 11 > 10/.test(w)));
    assert.ok(fs.existsSync(path.join(fx.brain, 'local', 'index', 'memory.md')));
    assert.match(fs.readFileSync(path.join(fx.brain, 'local', 'index', 'topics.md'), 'utf8'), /t1 \(working, -, next: step 2\)/);
    assert.equal(spawnSync('git', ['check-ignore', '-q', 'local/index/memory.md'], { cwd: fx.brain }).status, 0, 'index is ignored by git');
    const status = spawnSync('git', ['status', '--porcelain', 'local'], { cwd: fx.brain, encoding: 'utf8' }).stdout;
    assert.equal(status.trim(), '');
    // decisions limit
    for (let i = 1; i <= 51; i++) fs.writeFileSync(path.join(fx.brain, 'decisions', `d-${String(i).padStart(4, '0')}-x.md`), `---\nkey: D-${String(i).padStart(4, '0')}\nid: D-${String(i).padStart(4, '0')}\ntitle: d${i}\nstatus: valid\nrelates_to: [x]\n---\nx\n`);
    assert.ok(buildIndexes(fx.brain, policy).warnings.some((w) => /decision index 51 lines > 50/.test(w)));
  } finally { fx.cleanup(); }
});
