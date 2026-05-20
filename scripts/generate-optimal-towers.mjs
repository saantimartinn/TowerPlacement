import fs from 'fs/promises';
import path from 'path';

const RADIUS_M = 2000;

const ROOT = process.cwd();
const POPULATION_PATH = path.join(ROOT, 'public', 'data', 'population_points.json');
const OUTPUT_PATH = path.join(ROOT, 'public', 'data', 'optimal_towers.json');

function approximateDistanceSqMeters(aLat, aLng, bLat, bLng) {
  const meanLatRad = ((aLat + bLat) * Math.PI) / 360;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(meanLatRad);
  const dx = (bLng - aLng) * metersPerDegLng;
  const dy = (bLat - aLat) * metersPerDegLat;
  return dx * dx + dy * dy;
}

function scorePhase(towers, populationPoints) {
  const r2 = RADIUS_M * RADIUS_M;
  let population = 0;
  let coveredCells = 0;

  for (let i = 0; i < populationPoints.length; i += 1) {
    const [lat, lng, pop] = populationPoints[i];
    let covered = false;

    for (let j = 0; j < towers.length; j += 1) {
      const tower = towers[j];

      if (approximateDistanceSqMeters(tower.lat, tower.lng, lat, lng) <= r2) {
        covered = true;
        break;
      }
    }

    if (covered) {
      population += pop;
      coveredCells += 1;
    }
  }

  return { population, coveredCells };
}

function computeOptimalBenchmark(
  populationPoints,
  {
    candidateLimit = 2500,
    scoringPointLimit = 12000,
  } = {}
) {
  const validPoints = populationPoints
    .filter(([lat, lng, pop]) => Number.isFinite(lat) && Number.isFinite(lng) && pop > 0)
    .sort((a, b) => b[2] - a[2]);

  if (!validPoints.length) {
    return {
      towers: [],
      population: 0,
      coveredCells: 0,
    };
  }

  /*
    Greedy max-coverage benchmark over population grid points.

    Important:
    This is much stronger than doing it in the browser because it runs once,
    but it is still a greedy benchmark, not a guaranteed continuous mathematical optimum.
  */

  const candidates = validPoints.slice(0, candidateLimit);
  const scoringPoints = validPoints.slice(0, scoringPointLimit);

  const covered = new Uint8Array(scoringPoints.length);
  const towers = [];
  const r2 = RADIUS_M * RADIUS_M;

  for (let towerIndex = 0; towerIndex < 5; towerIndex += 1) {
    console.log(`Selecting tower ${towerIndex + 1}/5...`);

    let bestCandidate = null;
    let bestGain = -1;

    for (let c = 0; c < candidates.length; c += 1) {
      const [candidateLat, candidateLng] = candidates[c];
      let gain = 0;

      for (let i = 0; i < scoringPoints.length; i += 1) {
        if (covered[i]) continue;

        const [lat, lng, pop] = scoringPoints[i];

        if (approximateDistanceSqMeters(candidateLat, candidateLng, lat, lng) <= r2) {
          gain += pop;
        }
      }

      if (gain > bestGain) {
        bestGain = gain;
        bestCandidate = candidates[c];
      }
    }

    if (!bestCandidate || bestGain <= 0) break;

    const [bestLat, bestLng] = bestCandidate;

    towers.push({
      lat: bestLat,
      lng: bestLng,
    });

    for (let i = 0; i < scoringPoints.length; i += 1) {
      if (covered[i]) continue;

      const [lat, lng] = scoringPoints[i];

      if (approximateDistanceSqMeters(bestLat, bestLng, lat, lng) <= r2) {
        covered[i] = 1;
      }
    }
  }

  const score = scorePhase(towers, populationPoints);

  return {
    method: 'precomputed greedy max-coverage benchmark',
    radius_m: RADIUS_M,
    candidate_limit: candidateLimit,
    scoring_point_limit: scoringPointLimit,
    towers,
    population: score.population,
    coveredCells: score.coveredCells,
    generatedAt: new Date().toISOString(),
  };
}

async function main() {
  console.log('Loading population points...');

  const raw = await fs.readFile(POPULATION_PATH, 'utf8');
  const populationPoints = JSON.parse(raw);

  console.log(`Population points loaded: ${populationPoints.length.toLocaleString('en-US')}`);

  const result = computeOptimalBenchmark(populationPoints, {
    candidateLimit: 2500,
    scoringPointLimit: 12000,
  });

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  console.log('');
  console.log('Optimal benchmark saved to:');
  console.log(OUTPUT_PATH);
  console.log('');
  console.log('Population reached:', Math.round(result.population).toLocaleString('en-US'));
  console.log('Covered cells:', result.coveredCells.toLocaleString('en-US'));
  console.log('Towers:');
  console.table(result.towers);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});