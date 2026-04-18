# Volt Execution Layer

The standalone node client has been moved out of this repo.

Volt itself now acts as the execution layer:

- it writes the canonical transaction ledger
- it writes the canonical system event ledger
- it serves export endpoints for verifier nodes
- it exposes status endpoints so the consensus layer can compare heads
- it accepts consensus reports from external `volt-node` clients

## Endpoints Volt Still Serves

- `GET /exports/ledger.json`
- `GET /exports/system-events.json`
- `GET /node/status`
- `POST /api/consensus/report`
- `GET /api/consensus/reports`

These node-facing routes should now be protected with `VOLT_NODE_AUTH_KEY`.
The same per-operator node auth key is used for register, heartbeat, consensus reports, status, and export access.

## Purpose

This repo should no longer be used to run verifier nodes directly.

Use the separate `volt-node` project for:

- local mirror databases
- peer-backed verification
- checkpoint witnessing
- consensus-layer UI

Volt keeps only the execution-layer side of that handshake.
