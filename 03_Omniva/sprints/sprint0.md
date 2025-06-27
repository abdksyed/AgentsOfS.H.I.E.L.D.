# Sprint 0 PRD — **Foundational Window‑Tracker Prototype**

> Repos: **omniva‑ui** (Next.js), **omniva‑py** (FastAPI), **omniva‑shell** (Tauri)
> Document version: 2025‑05‑19

---

## 1 · Objective

Deliver an end‑to‑end proof of concept that:

* Captures the title & bundle ID of the **front‑most macOS window every second**.
* Persists those events in a local SQLite DB via **omniva‑py**.
* Displays a live‑updating list in **omniva‑ui**.
* Ships as a single desktop executable (**omniva‑shell**) which automatically launches the Python API in the background.

This establishes the cross‑process contract and proves the Rust ↔ Python ↔ React stack before we add browser extensions or embeddings.

---

## 2 · Success Criteria

| ID        | Description                                                  | Verification                                                   |
| --------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| **FR‑1**  | UI updates ≤1 s after window focus change                    | Manual test: switch apps, stopwatch refresh latency            |
| **FR‑2**  | Total idle RAM <70 MB                                        | Activity Monitor after 5 min idle                              |
| **FR‑3**  | Killing API causes shell to respawn it automatically         | `kill -9` API process → ping still ingested                    |
| **NFR‑1** | Codebase lint‑clean                                          | CI runs ESLint v9, Ruff 0.4, `cargo clippy` with `-D warnings` |
| **NFR‑2** | Universal binary runs on macOS 12‑14 (Intel & Apple Silicon) | CI matrix build succeeds                                       |

---

## 3 · Scope

### In scope

* System‑tray icon with single **Open Dashboard** menu.
* Local development environment (no Docker, no Windows/Linux build).
* One SQLite table `window_pings`.

### Out of scope (deferred)

* Browser tab watcher.
* Embeddings, chat, voice mode.
* User settings, auth, cloud sync.

---

## 4 · Technical Stack (pinned versions – May 19 2025)

| Layer          | Package                                                                                 | Version |
| -------------- | --------------------------------------------------------------------------------------- | ------- |
| **Shell**      | Tauri 2.0.0‑beta.11                                                                     |         |
| **Rust libs**  | `active-win-pos-rs` 0.8.0  ·  `reqwest` 0.11.23  ·  `chrono` 0.4.38  ·  `serde` 1.0.197 |         |
| **Python API** | FastAPI 0.111, `uvicorn[standard]` 0.30, `aiosqlite` 0.20                               |         |
| **Web UI**     | Next.js 14.2 (App Router), Tailwind 3.4, TypeScript 5.4, SWR 2.3                        |         |
| **Toolchain**  | Rust 1.79‑stable · Node 20 · Python 3.11                                                |         |

---

## 5 · Development Plan & Timeline

### Day 0 – Repo Bootstrap

| Task           | Command                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Init monorepo  | `git init omniva && cd omniva`                                                                                                                       |
| Scaffold UI    | `npm create t3-app@latest omniva-ui -- --tailwind --trpc no`                                                                                         |
| Scaffold API   | `mkdir omniva-py && cd omniva-py && python -m venv .venv && source .venv/bin/activate && pip install fastapi "uvicorn[standard]" aiosqlite pydantic` |
| Scaffold shell | `npm create tauri-app@latest omniva-shell --template vanilla`                                                                                        |

### Day 1 – omniva‑py API

1. Create `app/api.py` with `POST /pings` and `GET /pings`.
2. SQLite migration:

   ```sql
   CREATE TABLE IF NOT EXISTS window_pings (
     id TEXT PRIMARY KEY,
     ts TEXT,
     app TEXT,
     title TEXT
   );
   ```
3. Enable CORS for `http://localhost:3000` and `tauri://localhost`.
4. Add `make dev` (`uvicorn app.api:app --reload --port 8000`).

### Day 2 – omniva‑shell heartbeat

1. Append crates to `src-tauri/Cargo.toml`:

   ```toml
   active-win-pos-rs = "0.8"
   reqwest = { version = "0.11", features = ["blocking", "json"] }
   chrono = { version = "0.4", features = ["serde"] }
   serde = { version = "1", features = ["derive"] }
   ```
2. Implement background thread:

   ```rust
   loop {
     if let Ok(info) = get_active_window() {
       let ping = Ping { /* ts, app_name, title */ };
       let _ = client.post("http://127.0.0.1:8000/pings").json(&ping).send();
     }
     std::thread::sleep(Duration::from_secs(1));
   }
   ```
3. Add system‑tray with *Open Dashboard* item: `shell::open("http://localhost:3000/pings")`.
4. Sidecar config in `tauri.conf.json` to auto‑start Python API.

### Day 3 – omniva‑ui live list

1. Proxy in `next.config.mjs`:

   ```js
   async rewrites() {
     return [{ source: '/api/:path*', destination: 'http://localhost:8000/:path*' }];
   }
   ```
2. Install SWR 2.3: `npm i swr`.
3. Create `/app/pings/page.tsx` that polls `/api/pings` every 2 s and lists rows.

### Day 4 – QA & Polish

| Check           | Command                                     |
| --------------- | ------------------------------------------- |
| ESLint/Prettier | `npm run lint` in UI                        |
| Rust warnings   | `cargo clippy --all-targets -- -D warnings` |
| Python style    | `pip install ruff && ruff omniva-py`        |
| Memory idle     | Manual: Activity Monitor after 5 min        |
| Tag release     | `git tag v0.1.0-sprint0`                    |

---

## 6 · Deliverables

1. **omniva-shell** macOS `.app` (<10 MB).
2. **omniva-py** source (`make dev`).
3. **omniva-ui** Next.js project with `/pings` page.
4. Root **README.md** with one‑command dev instructions.

---

### Appendix · REST Schema Example

```jsonc
{
  "ts": "2025-05-19T12:00:01Z",
  "app_name": "Google Chrome",
  "title": "FastAPI — Docs"
}
```

All times are UTC (RFC 3339). The Rust command and any future plugins must use this schema when posting to `/pings`.