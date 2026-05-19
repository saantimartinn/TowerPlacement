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

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';

import { db } from './firebase';

const RADIUS_M = 2000;
const GAME_ID = 'tower-placement-demo';

const PHASES = {
  1: { title: 'Phase 1', subtitle: 'Map only', color: '#2563eb' },
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

function getOrCreateParticipantId() {
  const key = 'towerPlacementParticipantId';
  let id = localStorage.getItem(key);

  if (!id) {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    localStorage.setItem(key, id);
  }

  return id;
}

function cloneTowers(towers) {
  return towers.map((tower) => ({
    lat: Number(tower.lat),
    lng: Number(tower.lng),
  }));
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
  return Math.round(value || 0).toLocaleString('en-US');
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

function JoinScreen({ nameInput, setNameInput, onJoin }) {
  return (
    <div className="join-screen">
      <div className="join-card">
        <p className="eyebrow">Tower placement challenge</p>
        <h1>Enter your name</h1>

        <p className="join-text">
          Place five towers across three phases. Scores stay hidden until the end.
        </p>

        <form onSubmit={onJoin}>
          <input
            autoFocus
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
            placeholder="Your name"
            className="name-input"
          />

          <button className="primary-button full" type="submit">
            Continue
          </button>
        </form>
      </div>
    </div>
  );
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
          interactive={false}
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
        pane="towerPane"
        position={[tower.lat, tower.lng]}
        icon={icon}
        draggable={!disabled}
        zIndexOffset={1000 + index}
        riseOnHover
        riseOffset={1500}
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
            radius={3.8}
            interactive={false}
            pathOptions={{
              color: '#111827',
              weight: 0,
              fillColor: '#111827',
              fillOpacity: 0.78,
            }}
          />
        );
      })}
    </>
  );
}

function ResultsPanel({ myParticipant, totalPopulation }) {
  const phases = myParticipant?.phases || {};

  const p1 = phases['1']?.population || 0;
  const p2 = phases['2']?.population || 0;
  const p3 = phases['3']?.population || 0;

  const row1 = {
    population: p1,
    pctTotal: totalPopulation ? (p1 / totalPopulation) * 100 : 0,
  };

  const row2 = {
    population: p2,
    pctTotal: totalPopulation ? (p2 / totalPopulation) * 100 : 0,
  };

  const row3 = {
    population: p3,
    pctTotal: totalPopulation ? (p3 / totalPopulation) * 100 : 0,
  };

  return (
    <section className="results-panel" aria-label="Results comparison">
      <div className="results-header">
        <div>
          <p className="eyebrow">Final comparison</p>
          <h1>Your result</h1>
        </div>
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
          {formatPopulation(row1.population)} <span>({formatShare(row1.pctTotal)})</span>
        </strong>
      </div>

      <div className="result-block phase-2">
        <h2>Phase 2</h2>
        <p>Population reached</p>
        <strong>
          {formatPopulation(row2.population)} <span>({formatShare(row2.pctTotal)})</span>
        </strong>
        <small>
          Increase over Phase 1: {formatPercent(percentIncrease(row2.population, row1.population))}
        </small>
      </div>

      <div className="result-block phase-3">
        <h2>Phase 3</h2>
        <p>Population reached</p>
        <strong>
          {formatPopulation(row3.population)} <span>({formatShare(row3.pctTotal)})</span>
        </strong>
        <small>
          Increase over Phase 1: {formatPercent(percentIncrease(row3.population, row1.population))}
        </small>
        <small>
          Increase over Phase 2: {formatPercent(percentIncrease(row3.population, row2.population))}
        </small>
      </div>

      <p className="results-note">
        Coverage overlaps are counted only once. The score is the population inside the union of the five 2 km coverage areas.
      </p>
    </section>
  );
}

function HostDashboard({
  stage,
  participants,
  totalPopulation,
  onStartGame,
  onUnlockNext,
  onEndGame,
  busy,
}) {
  const isLobby = stage === 'lobby';
  const isResults = stage === 'results';
  const phase = isResults ? 3 : Math.max(1, Math.min(3, Number(stage) || 1));

  const sortedParticipants = useMemo(() => {
    return [...participants].sort((a, b) => {
      const aScore = a.phases?.[String(phase)]?.population || 0;
      const bScore = b.phases?.[String(phase)]?.population || 0;
      return bScore - aScore;
    });
  }, [participants, phase]);

  let primaryLabel = 'Start game';

  if (!isLobby && !isResults) {
    primaryLabel = phase < 3 ? `Unlock Phase ${phase + 1}` : 'Show final results';
  }

  if (isResults) {
    primaryLabel = 'End game & clear data';
  }

  const handlePrimary = () => {
    if (isLobby) {
      onStartGame();
      return;
    }

    if (isResults) {
      onEndGame();
      return;
    }

    onUnlockNext();
  };

  return (
    <div className="host-screen">
      <div className="modal-card host-card host-dashboard-card">
        <div className="host-header">
          <div>
            <p className="eyebrow">Host dashboard</p>
            <h2>
              {isLobby && 'Lobby'}
              {!isLobby && !isResults && `Phase ${phase}`}
              {isResults && 'Final results'}
            </h2>
          </div>

          <button className="primary-button small" onClick={handlePrimary} disabled={busy}>
            {busy ? 'Updating…' : primaryLabel}
          </button>
        </div>

        <p className="host-note">
          {isLobby
            ? 'Players can join now. Start the game when everyone is ready.'
            : isResults
              ? 'The game is finished. End the game to clear all saved participants and results.'
              : 'Players cannot move to the next phase until you unlock it.'}
        </p>

        {!isLobby && !isResults && (
          <button className="danger-button" onClick={onEndGame} disabled={busy}>
            End game & clear data
          </button>
        )}

        <div className="host-table-wrap">
          <table className="host-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Phase 1</th>
                <th>Phase 2</th>
                <th>Phase 3</th>
              </tr>
            </thead>

            <tbody>
              {sortedParticipants.map((participant) => (
                <tr key={participant.id}>
                  <td>{participant.name || 'Anonymous'}</td>

                  {[1, 2, 3].map((phaseNumber) => {
                    const result = participant.phases?.[String(phaseNumber)];
                    const pct =
                      result?.population && totalPopulation
                        ? (result.population / totalPopulation) * 100
                        : 0;

                    return (
                      <td key={phaseNumber}>
                        {result ? (
                          <>
                            {formatPopulation(result.population)}
                            <span className="table-pct">({formatShare(pct)})</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {!sortedParticipants.length && (
                <tr>
                  <td colSpan="4">No players yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function WaitingPanel({ title, body }) {
  return (
    <div className="modal-backdrop waiting-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card waiting-card">
        <p className="eyebrow">Please wait</p>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </div>
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

  return (
    <div className={`map-legend ${showResults ? 'results-legend' : ''}`}>
      <div className="legend-title">Visible layers</div>

      <div className="map-legend-row">
        <span className="legend-swatch land-swatch" />
        <span>Land area</span>
      </div>

      {showPlaces && (
        <div className="map-legend-row">
          <span className="legend-swatch places-swatch" />
          <span>Places</span>
        </div>
      )}

      {!showResults && (
        <div className="map-legend-row">
          <span className="legend-swatch tower-swatch" style={{ background: phaseColor }} />
          <span>Towers · 2 km radius</span>
        </div>
      )}

      {showResults && (
        <>
          <div className="map-legend-row">
            <span className="legend-swatch tower-swatch" style={{ background: PHASES[1].color }} />
            <span>Phase 1 towers</span>
          </div>

          <div className="map-legend-row">
            <span className="legend-swatch tower-swatch" style={{ background: PHASES[2].color }} />
            <span>Phase 2 towers</span>
          </div>

          <div className="map-legend-row">
            <span className="legend-swatch tower-swatch" style={{ background: PHASES[3].color }} />
            <span>Phase 3 towers</span>
          </div>
        </>
      )}
    </div>
  );
}

function PopulationLegend({ visible }) {
  if (!visible) return null;

  return (
    <div className="population-legend">
      <div className="population-legend-title">Population density</div>

      <div className="population-scale" />

      <div className="population-scale-labels">
        <span>Low</span>
        <span>Medium</span>
        <span>High</span>
      </div>
    </div>
  );
}

export default function App() {
  const [participantId] = useState(() => getOrCreateParticipantId());
  const [nameInput, setNameInput] = useState(
    () => localStorage.getItem('towerPlacementName') || ''
  );
  const [playerName, setPlayerName] = useState('');
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [phaseTowers, setPhaseTowers] = useState(null);
  const [showHelp, setShowHelp] = useState(true);
  const [phaseMessage, setPhaseMessage] = useState(null);
  const [gameState, setGameState] = useState({ stage: 'lobby' });
  const [participants, setParticipants] = useState([]);
  const [syncError, setSyncError] = useState(null);
  const [busy, setBusy] = useState(false);

  const previousPhaseRef = useRef(1);

  const isHost = playerName.trim().toLowerCase() === 'santi';

  const gameRef = useMemo(() => doc(db, 'games', GAME_ID), []);
  const participantRef = useMemo(
    () => doc(db, 'games', GAME_ID, 'participants', participantId),
    [participantId]
  );

  useEffect(() => {
    let alive = true;

    Promise.all([
      fetchJson('data/places.geojson'),
      fetchJson('data/boundaries.geojson'),
      fetchJson('data/population_points.json'),
      fetchJson('data/population_meta.json'),
      fetchJson('data/default_towers.json'),
    ])
      .then(([places, boundary, populationPoints, populationMeta, defaultTowers]) => {
        if (!alive) return;

        setData({
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

  useEffect(() => {
    if (!playerName) return undefined;

    let cancelled = false;

    async function connectGame() {
      try {
        const gameSnap = await getDoc(gameRef);

        if (!gameSnap.exists()) {
          await setDoc(gameRef, {
            stage: 'lobby',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        if (!isHost) {
          await setDoc(
            participantRef,
            {
              id: participantId,
              name: playerName,
              isHost: false,
              joinedAt: serverTimestamp(),
              lastSeen: serverTimestamp(),
            },
            { merge: true }
          );
        }
      } catch (error) {
        if (!cancelled) {
          setSyncError(error.message || String(error));
        }
      }
    }

    connectGame();

    const unsubGame = onSnapshot(
      gameRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setGameState({ stage: 'lobby' });
          return;
        }

        setGameState(snapshot.data());
      },
      (error) => setSyncError(error.message || String(error))
    );

    const unsubParticipants = onSnapshot(
      collection(db, 'games', GAME_ID, 'participants'),
      (snapshot) => {
        const rows = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        setParticipants(rows);
      },
      (error) => setSyncError(error.message || String(error))
    );

    return () => {
      cancelled = true;
      unsubGame();
      unsubParticipants();
    };
  }, [gameRef, isHost, participantId, participantRef, playerName]);

  const rawStage = gameState?.stage ?? 'lobby';
  const isLobby = rawStage === 'lobby';
  const showResults = rawStage === 'results';
  const phase = showResults ? 3 : Math.max(1, Math.min(3, Number(rawStage) || 1));

  const myParticipant = useMemo(
    () => participants.find((participant) => participant.id === participantId),
    [participants, participantId]
  );

  const hasSubmittedCurrentPhase = Boolean(myParticipant?.phases?.[String(phase)]);

  useEffect(() => {
    if (!playerName || showResults || isLobby || isHost) return;

    if (phase !== previousPhaseRef.current) {
      if (phase === 2) {
        setPhaseMessage({
          title: 'New data layer unlocked',
          body: 'Places are now visible. These points reveal where settlements and relevant locations are, helping you make a more informed decision than with the map alone.',
        });
      }

      if (phase === 3) {
        setPhaseMessage({
          title: 'Population layer unlocked',
          body: 'Population density is now visible. This is the most important layer: it shows not only where places exist, but where people are actually concentrated.',
        });
      }

      previousPhaseRef.current = phase;
    }
  }, [phase, playerName, showResults, isLobby, isHost]);

  useEffect(() => {
    if (!data || showResults || isLobby || phase <= 1 || isHost) return;

    setPhaseTowers((current) => {
      if (!current) return current;

      const savedCurrent = myParticipant?.phases?.[String(phase)]?.towers;

      if (savedCurrent) {
        return {
          ...current,
          [phase]: cloneTowers(savedCurrent),
        };
      }

      const previousSaved = myParticipant?.phases?.[String(phase - 1)]?.towers;
      const startTowers = previousSaved || current[phase - 1] || data.defaultTowers;

      return {
        ...current,
        [phase]: cloneTowers(startTowers),
      };
    });
  }, [phase, data, myParticipant, showResults, isLobby, isHost]);

  const center = useMemo(
    () => (data?.boundary ? getGeoJsonCenter(data.boundary) : [38.98, 1.42]),
    [data]
  );

  const updateTower = useCallback(
    (index, nextPosition) => {
      if (hasSubmittedCurrentPhase || showResults || isLobby || isHost) return;

      setPhaseTowers((current) => ({
        ...current,
        [phase]: current[phase].map((tower, i) => (i === index ? nextPosition : tower)),
      }));
    },
    [hasSubmittedCurrentPhase, phase, showResults, isLobby, isHost]
  );

  const submitPhase = useCallback(async () => {
    if (!data || !phaseTowers || isHost || isLobby) return;

    try {
      setBusy(true);

      const towers = cloneTowers(phaseTowers[phase]);
      const score = scorePhase(towers, data.populationPoints);

      const pctTotal = data.populationMeta.total_population
        ? (score.population / data.populationMeta.total_population) * 100
        : 0;

      await setDoc(
        participantRef,
        {
          id: participantId,
          name: playerName,
          isHost: false,
          lastUpdated: serverTimestamp(),
          phases: {
            [String(phase)]: {
              towers,
              population: score.population,
              pctTotal,
              coveredCells: score.coveredCells,
              submittedAt: serverTimestamp(),
            },
          },
        },
        { merge: true }
      );
    } catch (error) {
      setSyncError(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }, [
    data,
    isHost,
    isLobby,
    participantId,
    participantRef,
    phase,
    phaseTowers,
    playerName,
  ]);

  const startGame = useCallback(async () => {
    if (!isHost) return;

    try {
      setBusy(true);

      await setDoc(
        gameRef,
        {
          stage: 1,
          startedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: playerName,
        },
        { merge: true }
      );
    } catch (error) {
      setSyncError(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }, [gameRef, isHost, playerName]);

  const unlockNextPhase = useCallback(async () => {
    if (!isHost) return;

    try {
      setBusy(true);

      const nextStage = phase < 3 ? phase + 1 : 'results';

      await setDoc(
        gameRef,
        {
          stage: nextStage,
          updatedAt: serverTimestamp(),
          updatedBy: playerName,
        },
        { merge: true }
      );
    } catch (error) {
      setSyncError(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }, [gameRef, isHost, phase, playerName]);

  const endGameAndClearData = useCallback(async () => {
    if (!isHost) return;

    try {
      setBusy(true);

      const batch = writeBatch(db);
      const participantsSnapshot = await getDocs(collection(db, 'games', GAME_ID, 'participants'));

      participantsSnapshot.forEach((participantDoc) => {
        batch.delete(participantDoc.ref);
      });

      batch.delete(gameRef);

      await batch.commit();

      setParticipants([]);
      setGameState({ stage: 'lobby' });
    } catch (error) {
      setSyncError(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }, [gameRef, isHost]);

  const handleJoin = useCallback(
    (event) => {
      event.preventDefault();

      const cleanName = nameInput.trim();

      if (!cleanName) return;

      localStorage.setItem('towerPlacementName', cleanName);
      setPlayerName(cleanName);
    },
    [nameInput]
  );

  if (!playerName) {
    return (
      <JoinScreen
        nameInput={nameInput}
        setNameInput={setNameInput}
        onJoin={handleJoin}
      />
    );
  }

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

  if (isHost) {
    return (
      <>
        <HostDashboard
          stage={rawStage}
          participants={participants}
          totalPopulation={data.populationMeta.total_population}
          onStartGame={startGame}
          onUnlockNext={unlockNextPhase}
          onEndGame={endGameAndClearData}
          busy={busy}
        />

        {syncError && <div className="sync-error">{syncError}</div>}
      </>
    );
  }

  if (isLobby) {
    return (
      <main className="app-shell">
        <WaitingPanel
          title="Waiting for the game to start"
          body="You have joined the game. The first phase will unlock automatically when the host starts."
        />

        {syncError && <div className="sync-error">{syncError}</div>}
      </main>
    );
  }

  const currentTowers = phaseTowers[phase];
  const phaseInfo = PHASES[phase];
  const currentPhaseColor = PHASES[phase].color;
  const showPopulation = phase >= 3 || showResults;

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

          {showPopulation && (
            <Pane name="populationPane" style={{ zIndex: 250 }}>
              <ImageOverlay
                url={asset('data/pop_overlay.png')}
                bounds={data.populationMeta.bounds}
                opacity={0.86}
              />
            </Pane>
          )}

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

          <Pane name="coveragePane" style={{ zIndex: 520 }} />
          <Pane name="towerPane" style={{ zIndex: 650 }} />

          {!showResults &&
            currentTowers.map((tower, index) => (
              <Tower
                key={index}
                tower={tower}
                index={index}
                color={currentPhaseColor}
                phaseLabel={phaseInfo.title}
                disabled={hasSubmittedCurrentPhase}
                onMove={updateTower}
              />
            ))}

          {showResults &&
            [1, 2, 3].map((phaseNumber) => {
              const towers =
                myParticipant?.phases?.[String(phaseNumber)]?.towers ||
                phaseTowers[phaseNumber];

              return towers.map((tower, index) => (
                <Tower
                  key={`${phaseNumber}-${index}`}
                  tower={tower}
                  index={index}
                  color={PHASES[phaseNumber].color}
                  phaseLabel={PHASES[phaseNumber].title}
                  disabled
                  faint={phaseNumber !== 3}
                />
              ));
            })}

          <FitToBoundary boundary={data.boundary} />
        </MapContainer>
      </div>

      <MapLegend
        phase={phase}
        showResults={showResults}
        phaseColor={currentPhaseColor}
      />

      <PopulationLegend visible={showPopulation} />

      {!showResults && !hasSubmittedCurrentPhase && (
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

          <div className="bottom-bar no-reset-bar">
            <div className="radius-pill">Fixed radius · 2 km</div>

            <button
              className="primary-button small"
              style={{ '--phase-color': currentPhaseColor }}
              onClick={submitPhase}
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Submit phase'}
            </button>
          </div>
        </>
      )}

      {showResults && (
        <ResultsPanel
          myParticipant={myParticipant}
          totalPopulation={data.populationMeta.total_population}
        />
      )}

      {hasSubmittedCurrentPhase && !showResults && (
        <WaitingPanel
          title={`Phase ${phase} submitted`}
          body="Your result has been saved. The next phase will unlock automatically when the host continues."
        />
      )}

      {showHelp && !showResults && !hasSubmittedCurrentPhase && (
        <HelpModal onClose={() => setShowHelp(false)} />
      )}

      {phaseMessage && !showResults && !hasSubmittedCurrentPhase && (
        <PhaseInfoModal
          title={phaseMessage.title}
          body={phaseMessage.body}
          onClose={() => setPhaseMessage(null)}
        />
      )}

      {syncError && <div className="sync-error">{syncError}</div>}
    </main>
  );
}