'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRewardConfig, findSouvenir } = require('../lib/rewards');

test('reward configuration provides safe defaults', () => {
  const config = normalizeRewardConfig({});
  assert.equal(config.completionTokens, 50);
  assert.equal(config.souvenirs.length, 3);
  assert.equal(findSouvenir(config, 'tote').cost, 500);
});

test('reward configuration accepts valid backend overrides', () => {
  const config = normalizeRewardConfig({
    completionTokens: 150,
    souvenirs: [{ id: 'seedling-kit', name: 'Seedling Kit', type: 'Native tree seedling', cost: 750 }],
  });
  assert.equal(config.completionTokens, 150);
  assert.deepEqual(config.souvenirs, [
    { id: 'seedling-kit', name: 'Seedling Kit', type: 'Native tree seedling', cost: 750 },
  ]);
});

test('reward configuration rejects invalid prices and duplicate identifiers', () => {
  const config = normalizeRewardConfig({
    completionTokens: -5,
    souvenirs: [
      { id: 'bad', name: 'Invalid', cost: -1 },
      { id: 'valid', name: 'Valid Reward', cost: 50 },
      { id: 'valid', name: 'Duplicate Reward', cost: 75 },
    ],
  });
  assert.equal(config.completionTokens, 50);
  assert.deepEqual(config.souvenirs, [{ id: 'valid', name: 'Valid Reward', type: '', cost: 50 }]);
});
