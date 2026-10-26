'use strict';

const DEFAULT_REWARD_CONFIG = Object.freeze({
  completionTokens: 50,
  souvenirs: [
    { id: 'tumbler', name: 'Eco-Friendly Tumbler', type: 'Matte Green, Double-walled insulation', cost: 1000 },
    { id: 'tote', name: 'CENRO Tote Bag', type: 'Canvas, Heavy Duty', cost: 500 },
    { id: 'kit', name: 'Reusable Utensil Kit', type: 'Bamboo with pouch', cost: 2000 },
  ],
});

const boundedInteger = (value, fallback, minimum, maximum) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
};

function normalizeRewardConfig(value = {}) {
  const configuredSouvenirs = Array.isArray(value.souvenirs) ? value.souvenirs : [];
  const seen = new Set();
  const souvenirs = configuredSouvenirs.slice(0, 20).flatMap(item => {
    const id = String(item?.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    const name = String(item?.name || '').trim().slice(0, 100);
    const type = String(item?.type || item?.description || '').trim().slice(0, 160);
    const cost = boundedInteger(item?.cost, 0, 1, 1_000_000);
    if (!id || !name || !cost || seen.has(id) || item?.enabled === false) return [];
    seen.add(id);
    return [{ id, name, type, cost }];
  });

  return {
    completionTokens: boundedInteger(value.completionTokens, DEFAULT_REWARD_CONFIG.completionTokens, 1, 100_000),
    souvenirs: souvenirs.length ? souvenirs : DEFAULT_REWARD_CONFIG.souvenirs.map(item => ({ ...item })),
  };
}

function findSouvenir(config, souvenirId) {
  const id = String(souvenirId || '').trim().toLowerCase();
  return normalizeRewardConfig(config).souvenirs.find(item => item.id === id) || null;
}

module.exports = { DEFAULT_REWARD_CONFIG, normalizeRewardConfig, findSouvenir };
