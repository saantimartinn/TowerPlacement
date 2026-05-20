# Tower Placement Game

React + Leaflet application for a participatory tower placement activity.

Players place 5 towers with a fixed 2 km coverage radius across several information phases. The goal is to show how data availability changes the quality of decision-making.

## Game phases

1. **Phase 1 — Map only**  
   The player only sees the base map.

2. **Phase 2 — Places**  
   Place/location points become visible.

3. **Phase 3 — Population**  
   The population density layer becomes visible. Places are no longer shown in this phase.

4. **Phase 4 — Optimal benchmark**  
   A precomputed benchmark solution is shown. It cannot be moved.

5. **Final results**  
   The player sees their results, the global ranking, and the difference compared with the benchmark.

## Multiplayer mode

The app uses **Firebase Firestore** to synchronize the game across multiple devices.

- Players enter their name.
- The host enters using the name:

```text
Santi123
