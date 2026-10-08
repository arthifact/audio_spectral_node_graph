import test from 'node:test';
import assert from 'node:assert/strict';
import { isHighlighted, nodeRenderOrder } from '../src/rendering.js';

test('white recent nodes render above history even when farther away', () => {
  const nodes = [
    { burstId: 2, age: 4 },
    { burstId: 1, age: 10 },
    { burstId: 2, age: 70 },
    { burstId: 2, age: 2 },
  ];
  const projections = [
    { depth: 500 },
    { depth: -400 },
    { depth: 200 },
    { depth: -200 },
  ];
  assert.deepEqual(nodeRenderOrder(nodes, projections, 2), [2, 1, 0, 3]);
  assert.equal(nodes[0].age, 4);
});

test('a sustained burst does not keep old nodes permanently highlighted', () => {
  assert.equal(isHighlighted({ burstId: 1, age: 0 }, 1), true);
  assert.equal(isHighlighted({ burstId: 1, age: 46 }, 1), false);
  assert.equal(isHighlighted({ burstId: 0, age: 0 }, 1), false);
  assert.deepEqual(nodeRenderOrder([], [], 1), []);
});
