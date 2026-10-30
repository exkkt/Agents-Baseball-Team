import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MAP, W, H, SPOTS, findPath, isBlocked } from '../dist/ballclub/world.js';
import { Club } from '../dist/ballclub/sim.js';
import { DemoDirector, STORY_STEPS } from '../dist/ballclub/director.js';
import { CAST } from '../dist/ballclub/cast.js';

const run = (secs, seed = 21) => {
  const c = new Club({ seed }); new DemoDirector().start(c);
  for (let i = 0; i < secs * 30; i++) c.step(1 / 30);
  return c;
};

test('map is a full grid and every spot can reach every other spot', () => {
  assert.equal(MAP.length, H);
  MAP.forEach(row => assert.equal(row.length, W));
  const ids = Object.keys(SPOTS);
  for (const a of ids) for (const b of ids) if (a !== b) assert.ok(findPath(SPOTS[a].x, SPOTS[a].y, SPOTS[b].x, SPOTS[b].y), `${a} -> ${b}`);
  for (const [id, s] of Object.entries(SPOTS)) if (s.pose === 'stand') assert.ok(!isBlocked(s.x, s.y), `standing spot ${id} is free`);
});

test('demo story runs notice -> consult -> decide -> tell in order and changes the lineup', () => {
  const c = new Club({ seed: 21 }); new DemoDirector().start(c);
  let reasonAtDecision = null, toldAt = null, aokiAfter = null;
  c.on((type, e) => {
    if (type === 'event' && e.step === 'decide') reasonAtDecision = c.person('gm').reason.text;
    if (type === 'event' && e.step === 'tell') toldAt = c.t;
  });
  for (let i = 0; i < 200 * 30; i++) { c.step(1 / 30); if (toldAt != null && aokiAfter == null && c.t > toldAt + 20) aokiAfter = c.person('aoki').activity; }
  const steps = c.events.filter(e => e.step).map(e => e.step);
  assert.deepEqual(steps, STORY_STEPS.map(s => s.id));
  const aoki = c.lineup.find(m => m.num === 21), sato = c.lineup.find(m => m.num === 3);
  assert.equal(aoki.slot, 6); assert.equal(sato.bench, 0); assert.equal(sato.slot, undefined);
  assert.match(reasonAtDecision, /3点/);
  assert.equal(aokiAfter, 'catchball');
});

test('the same seed gives the same day (positions and events)', () => {
  const a = run(150), b = run(150);
  assert.deepEqual(a.events.map(e => e.time + e.text), b.events.map(e => e.time + e.text));
  for (const p of a.people.values()) { const q = b.person(p.id); assert.equal(Math.round(p.x * 100), Math.round(q.x * 100)); assert.equal(p.activity, q.activity); }
});

test('intend() moves a person to a spot and switches the activity on arrival', () => {
  const c = new Club({ seed: 3 });
  c.place('gm', 'gm-seat', 'pc');
  c.intend('gm', { do: 'goto', spot: 'lineup-view', then: 'look', reason: '起用表を確かめたい' });
  assert.equal(c.status(c.person('gm')), 'work');
  for (let i = 0; i < 60 * 20 && !c.isAt('gm', 'lineup-view'); i++) c.step(1 / 60);
  const p = c.person('gm');
  assert.equal(p.at, 'lineup-view'); assert.equal(p.activity, 'look'); assert.equal(p.dir, 'up');
  assert.equal(p.reason.text, '起用表を確かめたい');
});

test('snapshot for an AI is plain data covering everyone', () => {
  const c = run(30), s = c.snapshot();
  assert.equal(s.people.length, CAST.length);
  for (const p of s.people) { assert.ok(p.name && p.role && p.status && p.doing && p.place); }
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
});

test('state layer does not depend on the DOM or canvas', async () => {
  for (const f of ['world.js', 'sim.js', 'director.js', 'cast.js']) {
    const src = await readFile(new URL(`../dist/ballclub/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /document\.|window\.|getContext|requestAnimationFrame/, f);
  }
});
