import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Circle,
  CircleMarker,
  GeoJSON,
  ImageOverlay,
  MapContainer,
  Marker,
  Pane,
  Tooltip,
  useMap,
} from 'react-leaflet';

const RADIUS_M = 2000;

const PHASES = {
  1: { title: 'Phase 1', subtitle: 'Map + grid', color: '#2563eb' },
  2: { title: 'Phase 2', subtitle: '+ places', color: '#f97316' },
  3: { title: 'Phase 3', subtitle: '+ population', color: '#16a34a' },
};

function asset(path) {
  return `${import.meta.env.BASE_URL}${path}`.replace(/\/\//g, '/').replace(':/', '://');
}

async function fetchJson(path) {
  const res = await fetch(asset(path));
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.json();
}

function cloneTowers(towers) {
  return towers.map((t) => ({ lat: Number(t.lat), lng: Number(t.lng) }));
}

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

function formatPopulation(value) {
  return Math.round(value).toLocaleString('en-US');
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return 'N/A';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function formatShare(value) {
  if (!Number.isFinite(value)) return '0.0%';
  return `${value.toFixed(1)}%`;
}

function percentIncrease(current, baseline) {
  if (!baseline || baseline <= 0) return Number.NaN;
  return ((current - baseline) / baseline) * 100;
}

function getGeoJsonCenter(boundary) {
  const coords = [];

  function walk(value) {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      coords.push(value);
      return;
    }
    value.forEach(walk);
  }

  boundary.features?.forEach((feature) => walk(feature.geometry?.coordinates));

  if (!coords.length) return [38.98, 1.42];

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  coords.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  });

  return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
}

function FitToBoundary({ boundary }) {
  const map = useMap();

  useEffect(() => {
    if (!boundary) return;
    const layer = L.geoJSON(boundary);
    const bounds = layer.getBounds();

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [14, 14] });
    }
  }, [boundary, map]);

  return null;
}

function MapPanes() {
  const map = useMap();

  useEffect(() => {
    const panes = [
      ['landPane', 210],
      ['populationPane', 260],
      ['gridPane', 310],
      ['placesPane', 360],
      ['boundaryPane', 410],
      ['coveragePane', 450],
    ];

    panes.forEach(([name, zIndex]) => {
      if (!map.getPane(name)) {
        map.createPane(name);
      }
      map.getPane(name).style.zIndex = zIndex;
    });
  }, [map]);

  return null;
}

function Tower({
  tower,
  index,
  disabled,
  onMove,
  color,
  phaseLabel,
  showCoverage = true,
  faint = false,
}) {
  const rafRef = useRef(null);

  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'tower-div-icon',
        html: `<div class="tower-marker ${faint ? 'tower-marker-faint' : ''}" style="background:${color}">${index + 1}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      }),
    [color, faint, index]
  );

  const handleMove = useCallback(
    (event) => {
      if (disabled || !onMove) return;
      const { lat, lng } = event.target.getLatLng();
      onMove(index, { lat, lng });
    },
    [disabled, index, onMove]
  );

  const handleDrag = useCallback(
    (event) => {
      if (disabled) return;
      if (rafRef.current) return;

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        handleMove(event);
      });
    },
    [disabled, handleMove]
  );

  return (
    <>
      {showCoverage && (
        <Circle
          pane="coveragePane"
          center={[tower.lat, tower.lng]}
          radius={RADIUS_M}
          pathOptions={{
            color,
            weight: faint ? 1.4 : 2,
            fillColor: color,
            fillOpacity: faint ? 0.055 : 0.12,
            opacity: faint ? 0.72 : 1,
          }}
        />
      )}

      <Marker
        position={[tower.lat, tower.lng]}
        icon={icon}
        draggable={!disabled}
        eventHandlers={{
          drag: handleDrag,
          dragend: handleMove,
        }}
      >
        <Tooltip direction="top" offset={[0, -18]} opacity={0.95} permanent={false}>
          {phaseLabel ? `${phaseLabel} · ` : ''}Tower {index + 1} · 2 km radius
        </Tooltip>
      </Marker>
    </>
  );
}

function PlacesLayer({ places }) {
  return (
    <>
      {places.features?.map((feature, index) => {
        if (feature.geometry?.type !== 'Point') return null;

        const [lng, lat] = feature.geometry.coordinates;

        return (
          <CircleMarker
            pane="placesPane"
            key={feature.id ?? index}
            center={[lat, lng]}
            radius={3.4}
            pathOptions={{
              color: '#111827',
              weight: 0,
              fillColor: '#111827',
              fillOpacity: 0.72,
            }}
          />
        );
      })}
    </>
  );
}

function ResultsPanel({ phaseTowers, populationPoints, totalPopulation, onReset }) {
  const rows = useMemo(() => {
    return [1, 2, 3].map((phaseNumber) => {
      const score = scorePhase(phaseTowers[phaseNumber], populationPoints);
      const pctTotal = totalPopulation ? (score.population / totalPopulation) * 100 : 0;

      return {
        phase: phaseNumber,
        population: score.population,
        pctTotal,
      };
    });
  }, [phaseTowers, populationPoints, totalPopulation]);

  const row1 = rows[0];
  const row2 = rows[1];
  const row3 = rows[2];

  const phase1 = row1.population;
  const phase2 = row2.population;
  const phase3 = row3.population;
  return (
    <section className="results-panel" aria-label="Results comparison">
      <div className="results-header">
        <div>
          <p className="eyebrow">Final comparison</p>
          <h1>Impact of better data</h1>
        </div>

        <button className="ghost-button small" onClick={onReset}>
          Reset
        </button>
      </div>

      <div className="legend">
        {[1, 2, 3].map((phaseNumber) => (
          <div className="legend-item" key={phaseNumber}>
            <span className="legend-dot" style={{ background: PHASES[phaseNumber].color }} />
            <strong>{PHASES[phaseNumber].title}</strong>
          </div>
        ))}
      </div>

      <div className="result-block phase-1">
        <h2>Phase 1</h2>
        <p>Population reached</p>
        <strong>
          {formatPopulation(phase1)} <span>({formatShare(row1.pctTotal)})</span>
        </strong>
      </div>

      <div className="result-block phase-2">
        <h2>Phase 2</h2>
        <p>Population reached</p>
        <strong>
          {formatPopulation(phase2)} <span>({formatShare(row2.pctTotal)})</span>
        </strong>
        <small>Increase over Phase 1: {formatPercent(percentIncrease(phase2, phase1))}</small>
      </div>

      <div className="result-block phase-3">
        <h2>Phase 3</h2>
        <p>Population reached</p>
        <strong>
          {formatPopulation(phase3)} <span>({formatShare(row3.pctTotal)})</span>
        </strong>
        <small>Increase over Phase 1: {formatPercent(percentIncrease(phase3, phase1))}</small>
        <small>Increase over Phase 2: {formatPercent(percentIncrease(phase3, phase2))}</small>
      </div>

      <p className="results-note">
        Coverage overlaps are counted only once. The score is the population inside the union of the five 2 km coverage areas.
      </p>
    </section>
  );
}

function HelpModal({ onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card help-card">
        <div className="modal-title">Instructions</div>

        <p>
          Drag the <strong>5 towers</strong> on the map. Each circle shows a fixed{' '}
          <strong>2 km</strong> coverage radius.
        </p>

        <p>
          Confirm each phase. First you decide with limited information, then places appear, and finally population data is revealed.
        </p>

        <p className="muted">
          The score is hidden until the end to avoid biasing the decision.
        </p>

        <button className="primary-button full" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}

function PhaseInfoModal({ title, body, onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card help-card">
        <div className="modal-title">{title}</div>

        <p>{body}</p>

        <button className="primary-button full" onClick={onClose}>
          Continue
        </button>
      </div>
    </div>
  );
}

function MapLegend({ phase, showResults, phaseColor }) {
  const showPlaces = phase >= 2 || showResults;
  const showPopulation = phase >= 3 || showResults;

  return (
    <div className={`map-legend ${showResults ? 'results-legend' : ''}`}>
      <div className="legend-title">Visible layers</div>

      <div className="map-legend-row">
        <span className="legend-swatch land-swatch" />
        <span>Land area</span>
      </div>

      <div className="map-legend-row">
        <span className="legend-swatch grid-swatch" />
        <span>Planning grid</span>
      </div>

      {showPlaces && (
        <div className="map-legend-row">
          <span className="legend-swatch places-swatch" />
          <span>Places</span>
        </div>
      )}

      {showPopulation && (
        <div className="map-legend-row">
          <span className="legend-swatch population-swatch" />
          <span>Population density</span>
        </div>
      )}

      {!showResults && (
        <div className="map-legend-row">
          <span
            className="legend-swatch tower-swatch"
            style={{ background: phaseColor }}
          />
          <span>Towers · 2 km radius</span>
        </div>
      )}

      {showResults && (
        <>
          <div className="map-legend-row">
            <span
              className="legend-swatch tower-swatch"
              style={{ background: PHASES[1].color }}
            />
            <span>Phase 1 towers</span>
          </div>

          <div className="map-legend-row">
            <span
              className="legend-swatch tower-swatch"
              style={{ background: PHASES[2].color }}
            />
            <span>Phase 2 towers</span>
          </div>

          <div className="map-legend-row">
            <span
              className="legend-swatch tower-swatch"
              style={{ background: PHASES[3].color }}
            />
            <span>Phase 3 towers</span>
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [phase, setPhase] = useState(1);
  const [phaseTowers, setPhaseTowers] = useState(null);
  const [locked, setLocked] = useState({ 1: false, 2: false, 3: false });
  const [showHelp, setShowHelp] = useState(true);
  const [showResults, setShowResults] = useState(false);
  const [phaseMessage, setPhaseMessage] = useState(null);

  useEffect(() => {
    let alive = true;

    Promise.all([
      fetchJson('data/grid.geojson'),
      fetchJson('data/places.geojson'),
      fetchJson('data/boundaries.geojson'),
      fetchJson('data/population_points.json'),
      fetchJson('data/population_meta.json'),
      fetchJson('data/default_towers.json'),
    ])
      .then(([grid, places, boundary, populationPoints, populationMeta, defaultTowers]) => {
        if (!alive) return;

        setData({
          grid,
          places,
          boundary,
          populationPoints,
          populationMeta,
          defaultTowers,
        });

        setPhaseTowers({
          1: cloneTowers(defaultTowers),
          2: cloneTowers(defaultTowers),
          3: cloneTowers(defaultTowers),
        });
      })
      .catch((error) => {
        if (!alive) return;
        setLoadError(error.message || String(error));
      });

    return () => {
      alive = false;
    };
  }, []);

  const center = useMemo(
    () => (data?.boundary ? getGeoJsonCenter(data.boundary) : [38.98, 1.42]),
    [data]
  );

  const pathRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);

  const updateTower = useCallback(
    (index, nextPosition) => {
      if (locked[phase] || showResults) return;

      setPhaseTowers((current) => ({
        ...current,
        [phase]: current[phase].map((tower, i) => (i === index ? nextPosition : tower)),
      }));
    },
    [locked, phase, showResults]
  );

  const confirmPhase = useCallback(() => {
    setLocked((current) => ({ ...current, [phase]: true }));

    if (phase === 1) {
      setPhaseTowers((current) => ({
        ...current,
        2: cloneTowers(current[1]),
      }));

      setPhase(2);
      setPhaseMessage({
        title: 'New data layer unlocked',
        body: 'Places are now visible. These points reveal where settlements and relevant locations are, helping you make a more informed decision than with the grid alone.',
      });
      return;
    }

    if (phase === 2) {
      setPhaseTowers((current) => ({
        ...current,
        3: cloneTowers(current[2]),
      }));

      setPhase(3);
      setPhaseMessage({
        title: 'Population layer unlocked',
        body: 'Population density is now visible. This is the most important layer: it shows not only where places exist, but where people are actually concentrated.',
      });
      return;
    }

    setShowResults(true);
  }, [phase]);

  const reset = useCallback(() => {
    if (!data?.defaultTowers) return;

    setPhase(1);
    setLocked({ 1: false, 2: false, 3: false });
    setShowResults(false);
    setShowHelp(true);
    setPhaseMessage(null);

    setPhaseTowers({
      1: cloneTowers(data.defaultTowers),
      2: cloneTowers(data.defaultTowers),
      3: cloneTowers(data.defaultTowers),
    });
  }, [data]);

  if (loadError) {
    return (
      <div className="load-screen error-screen">
        <h1>Could not load the app</h1>
        <p>{loadError}</p>
      </div>
    );
  }

  if (!data || !phaseTowers) {
    return (
      <div className="load-screen">
        <div className="spinner" />
        <p>Loading map…</p>
      </div>
    );
  }

  const currentTowers = phaseTowers[phase];
  const phaseInfo = PHASES[phase];
  const currentPhaseColor = PHASES[phase].color;

  return (
    <main className={`app-shell ${showResults ? 'results-mode' : ''}`}>
      <div className="map-area">
        <MapContainer
          center={center}
          zoom={11}
          minZoom={10}
          maxZoom={16}
          zoomControl={false}
          attributionControl={false}
          className="map"
        >
          <Pane name="landPane" style={{ zIndex: 200 }}>
            <GeoJSON
              key="land-fill"
              data={data.boundary}
              style={{
                color: 'transparent',
                weight: 0,
                fillColor: '#f8fafc',
                fillOpacity: 0.94,
              }}
            />
          </Pane>

          {(phase >= 3 || showResults) && (
            <Pane name="populationPane" style={{ zIndex: 250 }}>
              <ImageOverlay
                url={asset('data/pop_overlay.png')}
                bounds={data.populationMeta.bounds}
                opacity={0.86}
              />
            </Pane>
          )}

          <Pane name="gridPane" style={{ zIndex: 300 }}>
            <GeoJSON
              key="grid"
              data={data.grid}
              style={{
                color: '#64748b',
                weight: 0.5,
                fillColor: '#cbd5e1',
                fillOpacity: 0.16,
              }}
            />
          </Pane>

          {(phase >= 2 || showResults) && (
            <Pane name="placesPane" style={{ zIndex: 380 }}>
              <PlacesLayer places={data.places} />
            </Pane>
          )}

          <Pane name="boundaryPane" style={{ zIndex: 420 }}>
            <GeoJSON
              key="boundary-outline"
              data={data.boundary}
              style={{
                color: '#0f172a',
                weight: 2.2,
                fillOpacity: 0,
              }}
            />
          </Pane>

          <Pane name="coveragePane" style={{ zIndex: 520 }}>
            {!showResults &&
              currentTowers.map((tower, index) => (
                <Tower
                  key={index}
                  tower={tower}
                  index={index}
                  color={currentPhaseColor}
                  phaseLabel={phaseInfo.title}
                  disabled={locked[phase]}
                  onMove={updateTower}
                />
              ))}

            {showResults &&
              [1, 2, 3].map((phaseNumber) =>
                phaseTowers[phaseNumber].map((tower, index) => (
                  <Tower
                    key={`${phaseNumber}-${index}`}
                    tower={tower}
                    index={index}
                    color={PHASES[phaseNumber].color}
                    phaseLabel={PHASES[phaseNumber].title}
                    disabled
                    faint={phaseNumber !== 3}
                  />
                ))
              )}
          </Pane>

          <FitToBoundary boundary={data.boundary} />
        </MapContainer>
      </div>

      <MapLegend
        phase={phase}
        showResults={showResults}
        phaseColor={currentPhaseColor}
      />

      {!showResults && (
        <>
          <div className="top-pill" style={{ '--phase-color': currentPhaseColor }}>
            <span className="phase-dot" />
            <strong>{phaseInfo.title}</strong>
            <span>{phaseInfo.subtitle}</span>
          </div>

          <button
            className="help-button"
            aria-label="Open instructions"
            onClick={() => setShowHelp(true)}
          >
            ?
          </button>

          <div className="bottom-bar">
            <button className="ghost-button small" onClick={reset}>
              Reset
            </button>

            <div className="radius-pill">Fixed radius · 2 km</div>

            <button
              className="primary-button small"
              style={{ '--phase-color': currentPhaseColor }}
              onClick={confirmPhase}
            >
              {phase < 3 ? 'Confirm phase' : 'Show results'}
            </button>
          </div>
        </>
      )}

      {showResults && (
        <ResultsPanel
          phaseTowers={phaseTowers}
          populationPoints={data.populationPoints}
          totalPopulation={data.populationMeta.total_population}
          onReset={reset}
        />
      )}

      {showHelp && !showResults && <HelpModal onClose={() => setShowHelp(false)} />}

      {phaseMessage && !showResults && (
        <PhaseInfoModal
          title={phaseMessage.title}
          body={phaseMessage.body}
          onClose={() => setPhaseMessage(null)}
        />
      )}
    </main>
  );
}