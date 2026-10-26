const test = require('node:test');
const assert = require('node:assert/strict');

test('1:1 drive simulation duration matches realistic 10-minute urban drive', () => {
  const totalDistanceKm = 4.0;
  const targetSpeedKph = 24; // typical urban collection speed in Danao City
  const totalDurationSeconds = Math.round((totalDistanceKm / targetSpeedKph) * 3600);
  
  // 4.0 km at 24 km/h should be exactly 600 seconds = 10 minutes
  assert.equal(totalDurationSeconds, 600);
  const minutes = totalDurationSeconds / 60;
  assert.equal(minutes, 10);
});

test('1:1 ratio timing advances 1 simulation second per 1 wall second', () => {
  let simElapsedSeconds = 0;
  const speedMultiplier = 1; // 1:1 Ratio
  
  // 10 ticks of 1 second
  for (let tick = 0; tick < 10; tick++) {
    simElapsedSeconds += 1.0 * speedMultiplier;
  }
  assert.equal(simElapsedSeconds, 10);
});

test('speed multipliers scale drive duration proportionately', () => {
  const totalDurationSeconds = 600; // 10-minute drive
  
  // 1x takes 600 wall seconds (10 min)
  assert.equal(totalDurationSeconds / 1, 600);
  
  // 2x takes 300 wall seconds (5 min)
  assert.equal(totalDurationSeconds / 2, 300);
  
  // 5x takes 120 wall seconds (2 min)
  assert.equal(totalDurationSeconds / 5, 120);
  
  // 10x takes 60 wall seconds (1 min)
  assert.equal(totalDurationSeconds / 10, 60);
});

test('fuel consumption formula accurately tracks liters and PHP cost during 1:1 drive', () => {
  const kmPerLiter = 3.2;
  const loadPenalty = 1.10;
  const idleLitersPerHour = 1.2;
  const pricePerLiter = 60.0;
  
  const totalDistanceKm = 4.0;
  const totalDurationSeconds = 600; // 10 minutes
  
  const drivingLiters = (totalDistanceKm / kmPerLiter) * loadPenalty;
  const idleLiters = (totalDurationSeconds / 3600) * idleLitersPerHour;
  const totalFuelLiters = Math.round((drivingLiters + idleLiters) * 100) / 100;
  const totalCostPhp = Math.round(totalFuelLiters * pricePerLiter);
  
  // Driving: (4.0 / 3.2) * 1.1 = 1.375 L
  // Idle: (600 / 3600) * 1.2 = 0.20 L
  // Total: 1.58 L
  assert.equal(totalFuelLiters, 1.58);
  assert.equal(totalCostPhp, 95); // 1.58 * 60 = 94.8 -> 95 PHP
  
  // At 50% drive (5 minutes, 2.0 km)
  const halfDist = 2.0;
  const halfSeconds = 300;
  const halfFuel = Math.round(((halfDist / kmPerLiter) * loadPenalty + (halfSeconds / 3600) * idleLitersPerHour) * 100) / 100;
  const halfCost = Math.round(halfFuel * pricePerLiter);
  
  assert.equal(halfFuel, 0.79);
  assert.equal(halfCost, 47); // 0.79 * 60 = 47.4 -> 47 PHP
});
