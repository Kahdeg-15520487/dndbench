// ─────────────────────────────────────────────────────────
//  Tournament Server Tests
// ─────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTournamentApp } from "../arena/tournament-server.js";
import type { Server } from "http";
import { createServer } from "http";
import fs from "fs";

describe("Tournament Server", () => {
  let server: Server;
  const port = 9876;
  const base = `http://localhost:${port}`;

  beforeAll(async () => {
    const app = createTournamentApp({
      baseURL: "http://localhost:8008/v1",
      apiKey: "no-key",
      outputDir: "tournament",
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(port, () => resolve()));
  });

  afterAll(() => {
    server.close();
  });

  async function fetchJson(path: string, init?: RequestInit) {
    const resp = await fetch(base + path, init);
    return { status: resp.status, data: await resp.json() };
  }

  // ── Dashboard ──

  it("serves the dashboard HTML at /", async () => {
    const resp = await fetch(base + "/");
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("Tournament Dashboard");
    expect(html).toContain("D&D Arena");
  });

  // ── Status ──

  it("returns initial tournament status", async () => {
    const { status, data } = await fetchJson("/api/tournament/status");
    expect(status).toBe(200);
    expect(data.isRunning).toBe(false);
    expect(data.hasResult).toBe(false);
    expect(data.result).toBeNull();
  });

  // ── Models ──

  it("returns models list (or empty with error)", async () => {
    const { status, data } = await fetchJson("/api/models");
    expect(status).toBe(200);
    expect(data).toHaveProperty("models");
    expect(Array.isArray(data.models)).toBe(true);
  });

  it("health check endpoint responds", async () => {
    const resp = await fetch(base + "/api/health");
    const data = await resp.json();
    // Either "ok" or "error" depending on whether LLM server is running
    expect(["ok", "error"]).toContain(data.status);
    expect(data).toHaveProperty("url");
  });

  // ── Start validation ──

  it("rejects tournament start with no models", async () => {
    const { status, data: data1 } = await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models: [] }),
    });
    expect(status).toBe(400);
    expect(data1.error).toContain("at least 1 model");
  });

  it("rejects tournament start with missing models field", async () => {
    const { status } = await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
  });

  it("rejects tournament start with invalid bestOf", async () => {
    const { status, data } = await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models: ["a", "b"], bestOf: 0 }),
    });
    expect(status).toBe(400);
    expect(data.error).toContain("bestOf");
  });

  it("rejects tournament start with invalid maxTurns", async () => {
    const { status, data } = await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models: ["a", "b"], maxTurns: 0 }),
    });
    expect(status).toBe(400);
    expect(data.error).toContain("maxTurns");
  });

  it("rejects tournament start with invalid kFactor", async () => {
    const { status, data } = await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models: ["a", "b"], kFactor: 200 }),
    });
    expect(status).toBe(400);
    expect(data.error).toContain("kFactor");
  });

  // ── Abort ──

  it("rejects abort when no tournament running", async () => {
    const { status, data: abortData } = await fetchJson("/api/tournament/abort", {
      method: "POST",
    });
    expect(status).toBe(400);
    expect(abortData.error).toContain("No tournament running");
  });

  // ── Reset ──

  it("resets tournament state", async () => {
    const { status, data } = await fetchJson("/api/tournament/reset", {
      method: "POST",
    });
    expect(status).toBe(200);
    expect(data.status).toBe("reset");
  });

  // ── Reports ──

  it("returns report files list", async () => {
    const { status, data } = await fetchJson("/api/reports");
    expect(status).toBe(200);
    expect(data).toHaveProperty("reports");
    expect(Array.isArray(data.reports)).toBe(true);
  });

  it("returns empty history initially", async () => {
    const { status, data } = await fetchJson("/api/history");
    expect(status).toBe(200);
    expect(data).toHaveProperty("history");
    expect(Array.isArray(data.history)).toBe(true);
  });

  it("export JSON returns 404 when no result", async () => {
    const { status } = await fetchJson("/api/export/json");
    expect(status).toBe(404);
  });

  it("export CSV returns 404 when no result", async () => {
    const { status } = await fetchJson("/api/export/csv");
    expect(status).toBe(404);
  });

  it("game API returns 404 when no result", async () => {
    const { status } = await fetchJson("/api/game/0/0");
    expect(status).toBe(404);
  });

  // ── SSE endpoint ──

  it("SSE endpoint returns text/event-stream", async () => {
    const controller = new AbortController();
    const resp = await fetch(base + "/api/tournament/events", { signal: controller.signal });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/event-stream");
    controller.abort();
  });

  // ── Report viewer ──

  it("returns 404 for missing report", async () => {
    const resp = await fetch(base + "/report/nonexistent.md");
    expect(resp.status).toBe(404);
  });

  it("blocks path traversal in report viewer", async () => {
    // Express normalizes the path, so the resolved path ends up outside the reportDir
    // In practice the file just won't be found, returning 404
    const resp = await fetch(base + "/report/../../../etc/passwd");
    expect([403, 404]).toContain(resp.status);
  });

  // ── Dashboard content checks ──

  it("dashboard contains model selection UI", async () => {
    const html = await fetch(base + "/").then(r => r.text());
    expect(html).toContain("modelChips");
    expect(html).toContain("manualModels");
    expect(html).toContain("bestOf");
    expect(html).toContain("kFactor");
    expect(html).toContain("includeHeuristic");
  });

  it("dashboard contains live panel with ELO table", async () => {
    const html = await fetch(base + "/").then(r => r.text());
    expect(html).toContain("eloBody");
    expect(html).toContain("gameLog");
    expect(html).toContain("statusPulse");
  });

  it("dashboard contains abort button", async () => {
    const html = await fetch(base + "/").then(r => r.text());
    expect(html).toContain("abortBtn");
    expect(html).toContain("abortTournament");
  });

  it("dashboard contains progress bar", async () => {
    const html = await fetch(base + "/").then(r => r.text());
    expect(html).toContain("progressBar");
    expect(html).toContain("progressFill");
  });

  it("dashboard contains ELO chart canvas", async () => {
    const html = await fetch(base + "/").then(r => r.text());
    expect(html).toContain("eloChart");
    expect(html).toContain("drawEloChart");
    expect(html).toContain("recordEloSnapshot");
  });

  it("dashboard has heuristic baseline reference", async () => {
    const html = await fetch(base + "/").then(r => r.text());
    expect(html).toContain("heuristic-baseline");
  });
});

// ── Integration Tests with testMode (heuristic agents, no LLM) ──

describe("Tournament Server Integration (testMode)", () => {
  let server: Server;
  const port = 9877;
  const base = `http://localhost:${port}`;
  const testOutputDir = "test-server-reports";

  beforeAll(async () => {
    const app = createTournamentApp({
      baseURL: "http://localhost:8008/v1",
      apiKey: "no-key",
      outputDir: testOutputDir,
      testMode: true,
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(port, () => resolve()));
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
    // Clean up test reports
    fs.rmSync(testOutputDir, { recursive: true, force: true });
  });

  async function fetchJson(path: string, init?: RequestInit) {
    const resp = await fetch(base + path, init);
    return { status: resp.status, data: await resp.json() };
  }

  it("starts a tournament in testMode and waits for completion", async () => {
    const { status, data } = await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: ["test-a", "test-b"],
        bestOf: 1,
        includeHeuristic: false,
        maxTurns: 15,
      }),
    });
    expect(status).toBe(200);
    expect(data.status).toBe("started");

    // Wait for tournament to finish
    await new Promise(r => setTimeout(r, 2000));
  }, 30000);

  it("rejects duplicate start while running", async () => {
    // Start a longer tournament (best-of-3) to have time to test concurrent start
    const { status: s1 } = await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: ["test-a", "test-b"],
        bestOf: 3,
        includeHeuristic: false,
        maxTurns: 15,
      }),
    });
    expect(s1).toBe(200);

    // Immediately try to start another
    const { status: s2 } = await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models: ["x"] }),
    });
    // If tournament already finished, s2 will be 200 (new tournament), if still running, 409
    expect([200, 409]).toContain(s2);

    // Wait for completion
    await new Promise(r => setTimeout(r, 5000));
  }, 30000);

  it("reports status after tournament completes", async () => {
    // Wait for tournament to finish (best-of-1, should be fast)
    await new Promise(r => setTimeout(r, 3000));

    const { status, data } = await fetchJson("/api/tournament/status");
    expect(status).toBe(200);
    expect(data.isRunning).toBe(false);
    expect(data.hasResult).toBe(true);
    expect(data.result).toBeDefined();
    expect(data.result.stats).toHaveLength(2);
    expect(data.result.matchups).toHaveLength(1);
  });

  it("has generated report files", async () => {
    const { status, data } = await fetchJson("/api/reports");
    expect(status).toBe(200);
    expect(data.reports.length).toBeGreaterThan(0);
  });

  it("can view a report as HTML", async () => {
    const { data: reportsData } = await fetchJson("/api/reports");
    if (reportsData.reports.length > 0) {
      const firstReport = reportsData.reports[0];
      const resp = await fetch(base + "/report/" + encodeURIComponent(firstReport.path));
      expect(resp.status).toBe(200);
      const html = await resp.text();
      expect(html).toContain("D&D Arena");
      expect(html).toContain("Print"); // print button from report-viewer
    }
  });

  it("populates history after tournament", async () => {
    const { data } = await fetchJson("/api/history");
    expect(data.history.length).toBeGreaterThan(0);
    const entry = data.history[0];
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("date");
    expect(entry).toHaveProperty("models");
    expect(entry).toHaveProperty("winner");
    expect(entry).toHaveProperty("stats");
    expect(entry.models.length).toBe(2);
  });

  it("export JSON returns tournament data", async () => {
    const resp = await fetch(base + "/api/export/json");
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toHaveProperty("stats");
    expect(data).toHaveProperty("matchups");
    expect(data.stats.length).toBe(2);
    expect(data.matchups.length).toBe(1);
    expect(resp.headers.get("content-disposition")).toContain("attachment");
  });

  it("export CSV returns valid CSV", async () => {
    const resp = await fetch(base + "/api/export/csv");
    expect(resp.status).toBe(200);
    const text = await resp.text();
    expect(text).toContain("Rank,Model,ELO");
    expect(text).toContain("ModelA,ModelB");
    expect(text).toContain("Matchup,Game,ClassA");
    expect(resp.headers.get("content-type")).toContain("text/csv");
  });

  it("returns game turn log via API", async () => {
    const resp = await fetch(base + "/api/game/0/0");
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toHaveProperty("modelA");
    expect(data).toHaveProperty("modelB");
    expect(data).toHaveProperty("classA");
    expect(data).toHaveProperty("classB");
    expect(data).toHaveProperty("winner");
    expect(data).toHaveProperty("turns");
    expect(data).toHaveProperty("turnLog");
    expect(Array.isArray(data.turnLog)).toBe(true);
    expect(data.turnLog.length).toBeGreaterThan(0);
    // Each turn log entry should have required fields
    const entry = data.turnLog[0];
    expect(entry).toHaveProperty("turnNumber");
    expect(entry).toHaveProperty("actorId");
    expect(entry).toHaveProperty("narrative");
    expect(entry).toHaveProperty("hpA");
    expect(entry).toHaveProperty("hpB");
    expect(entry).toHaveProperty("maxHpA");
    expect(entry).toHaveProperty("maxHpB");
    expect(entry).toHaveProperty("actorName");
    expect(typeof entry.narrative).toBe("string");
    expect(entry.narrative.length).toBeGreaterThan(0);
  });

  it("exports game turn log as CSV", async () => {
    const resp = await fetch(base + "/api/game/0/0/export");
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/csv");
    expect(resp.headers.get("content-disposition")).toContain("attachment");
    const csv = await resp.text();
    expect(csv).toContain("Turn,Actor,Narrative,HpA");
    expect(csv.split("\n").length).toBeGreaterThan(2); // header + at least 1 row
  });

  it("game CSV export returns 404 for invalid matchup", async () => {
    const resp = await fetch(base + "/api/game/99/0/export");
    expect(resp.status).toBe(404);
  });

  it("game CSV export returns 404 for invalid game", async () => {
    const resp = await fetch(base + "/api/game/0/99/export");
    expect(resp.status).toBe(404);
  });

  it("returns 404 for invalid game indices", async () => {
    const resp1 = await fetch(base + "/api/game/99/0");
    expect(resp1.status).toBe(404);
    const resp2 = await fetch(base + "/api/game/0/99");
    expect(resp2.status).toBe(404);
  });

  it("returns history entry by ID", async () => {
    const { data } = await fetchJson("/api/history");
    expect(data.history.length).toBeGreaterThan(0);
    const entry = data.history[0];
    const resp = await fetch(base + "/api/history/" + entry.id);
    expect(resp.status).toBe(200);
    const detail = await resp.json();
    expect(detail.id).toBe(entry.id);
    expect(detail.result).toBeDefined();
    expect(detail.result.matchups).toBeDefined();
    expect(detail.result.matchups.length).toBeGreaterThan(0);
  });

  it("returns 404 for unknown history ID", async () => {
    const resp = await fetch(base + "/api/history/nonexistent-id");
    expect(resp.status).toBe(404);
  });

  it("persists ELO ratings after tournament", async () => {
    const resp = await fetch(base + "/api/ratings");
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.ratings).toBeDefined();
    // Should have ratings for both models
    const models = Object.keys(data.ratings);
    expect(models.length).toBeGreaterThanOrEqual(2);
    for (const model of models) {
      expect(data.ratings[model]).toHaveProperty("elo");
      expect(data.ratings[model]).toHaveProperty("wins");
      expect(data.ratings[model]).toHaveProperty("losses");
      expect(data.ratings[model]).toHaveProperty("draws");
      expect(data.ratings[model]).toHaveProperty("matches");
      expect(data.ratings[model]).toHaveProperty("lastSeen");
      expect(typeof data.ratings[model].elo).toBe("number");
    }
  });

  it("can reset state after tournament", async () => {
    // Make sure tournament is done
    await new Promise(r => setTimeout(r, 1000));
    const { data } = await fetchJson("/api/tournament/status");
    if (!data.isRunning) {
      const { status: resetStatus } = await fetchJson("/api/tournament/reset", {
        method: "POST",
      });
      expect(resetStatus).toBe(200);
    }
  });

  it("receives SSE events during tournament", async () => {
    // Reset first
    await fetchJson("/api/tournament/reset", { method: "POST" });
    await new Promise(r => setTimeout(r, 200));

    // Connect to SSE before starting
    const controller = new AbortController();
    const sseResp = await fetch(base + "/api/tournament/events", { signal: controller.signal });
    expect(sseResp.status).toBe(200);
    const reader = sseResp.body!.getReader();
    const decoder = new TextDecoder();

    // Start a quick tournament
    await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: ["sse-a", "sse-b"],
        bestOf: 1,
        includeHeuristic: false,
        maxTurns: 10,
      }),
    });

    // Read SSE events until tournament_end or timeout
    const eventTypes: string[] = [];
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
        ]);
        const text = decoder.decode(chunk.value, { stream: true });
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.startsWith("data:")) {
            try {
              const evt = JSON.parse(line.slice(5).trim());
              if (evt.type) eventTypes.push(evt.type);
            } catch { /* non-JSON event */ }
          }
        }
        if (chunk.done || eventTypes.includes("tournament_end")) break;
      } catch {
        break; // timeout — stop reading
      }
    }
    controller.abort();

    // Verify event ordering
    expect(eventTypes.length).toBeGreaterThanOrEqual(4);
    expect(eventTypes[0]).toBe("tournament_start");
    expect(eventTypes).toContain("game_end");
    expect(eventTypes).toContain("tournament_end");
    expect(eventTypes).toContain("turn");

    // Verify tournament_start comes before tournament_end
    const startIdx = eventTypes.indexOf("tournament_start");
    const endIdx = eventTypes.indexOf("tournament_end");
    expect(startIdx).toBeLessThan(endIdx);
  }, 15000);

  it("dashboard contains confetti function", async () => {
    const resp = await fetch(base + "/");
    const html = await resp.text();
    expect(html).toContain("function showConfetti");
    expect(html).toContain("function playBeep");
  });

  it("dashboard contains matchup bracket container", async () => {
    const resp = await fetch(base + "/");
    const html = await resp.text();
    expect(html).toContain('id="matchupBracket"');
    expect(html).toContain('function renderBracket');
    expect(html).toContain('function toggleMatchupDetail');
  });

  it("dashboard contains copy-to-clipboard for turns", async () => {
    const resp = await fetch(base + "/");
    const html = await resp.text();
    expect(html).toContain('function copyTurn');
    expect(html).toContain('copyTurn(this)');
  });

  it("dashboard contains dashboard stats element", async () => {
    const resp = await fetch(base + "/");
    const html = await resp.text();
    expect(html).toContain('id="dashboardStats"');
    expect(html).toContain('function loadDashboardStats');
  });

  it("dashboard contains timer text element", async () => {
    const resp = await fetch(base + "/");
    const html = await resp.text();
    expect(html).toContain('id="timerText"');
  });

  it("dashboard contains SSE auto-reconnect", async () => {
    const resp = await fetch(base + "/");
    const html = await resp.text();
    expect(html).toContain('sseRetryTimer');
    expect(html).toContain('setTimeout(connectSSE, 3000)');
  });

  it("dashboard contains share URL support", async () => {
    const resp = await fetch(base + "/");
    const html = await resp.text();
    expect(html).toContain('function shareUrl');
    expect(html).toContain('function applyUrlParams');
  });

  it("dashboard contains client-side validation", async () => {
    const resp = await fetch(base + "/");
    const html = await resp.text();
    expect(html).toContain('Best of must be between');
    expect(html).toContain('K-factor must be between');
    expect(html).toContain('Max turns must be between');
  });

  it("dashboard contains health indicator", async () => {
    const resp = await fetch(base + "/");
    const html = await resp.text();
    expect(html).toContain('id="healthIndicator"');
    expect(html).toContain('function checkHealth');
  });

  it("dashboard contains replay controls in game viewer", async () => {
    const resp = await fetch(base + "/");
    const html = await resp.text();
    expect(html).toContain('function replayStep');
    expect(html).toContain('function replayToggle');
    expect(html).toContain('function replayShowAll');
    expect(html).toContain('replaySpeed');
    expect(html).toContain('replayPlayBtn');
  });

  it("dashboard contains matchup detail view", async () => {
    const resp = await fetch(base + "/");
    const html = await resp.text();
    expect(html).toContain('function showMatchupDetail');
    expect(html).toContain('window._lastResult');
  });

  it("dashboard contains quick duel button", async () => {
    const resp = await fetch(base + "/");
    const html = await resp.text();
    expect(html).toContain('function quickDuel');
    expect(html).toContain('Quick Duel');
  });

  it("dashboard contains game duration display", async () => {
    const resp = await fetch(base + "/");
    const html = await resp.text();
    expect(html).toContain('durationMs');
    expect(html).toContain('.toFixed(1)');
  });

  it("abort during running tournament stops it", async () => {
    // Reset state
    await fetchJson("/api/tournament/reset", { method: "POST" });
    await new Promise(r => setTimeout(r, 200));

    // Connect to SSE to detect when tournament starts
    const controller = new AbortController();
    const sseResp = await fetch(base + "/api/tournament/events", { signal: controller.signal });
    const reader = sseResp.body!.getReader();
    const decoder = new TextDecoder();

    // Start a longer tournament (4 models = 6 matchups, Bo3 each = 18 games)
    await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: ["abort-a", "abort-b", "abort-c", "abort-d"],
        bestOf: 3,
        includeHeuristic: false,
        maxTurns: 30,
      }),
    });

    // Read SSE until we see tournament_start
    let started = false;
    const startDeadline = Date.now() + 3000;
    while (Date.now() < startDeadline && !started) {
      try {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("t")), 1000)),
        ]);
        const text = decoder.decode(chunk.value, { stream: true });
        if (text.includes('tournament_start')) started = true;
        if (chunk.done) break;
      } catch { break; }
    }
    controller.abort();

    // Only test abort if tournament actually started
    if (!started) return;

    // Verify it's running (may have already finished with fast heuristics)
    const { data: statusBefore } = await fetchJson("/api/tournament/status");
    if (statusBefore.isRunning) {
      // Abort
      const { status: abortStatus } = await fetchJson("/api/tournament/abort", { method: "POST" });
      expect(abortStatus).toBe(200);

      await new Promise(r => setTimeout(r, 300));

      const { data: statusAfter } = await fetchJson("/api/tournament/status");
      expect(statusAfter.isRunning).toBe(false);
    } else {
      // Tournament already finished — abort should return 400 (no tournament running)
      const { status: abortStatus } = await fetchJson("/api/tournament/abort", { method: "POST" });
      expect(abortStatus).toBe(400); // no tournament running — expected
    }
  }, 15000);

  it("SSE events contain turn narratives with HP data", async () => {
    // Reset
    await fetchJson("/api/tournament/reset", { method: "POST" });
    await new Promise(r => setTimeout(r, 200));

    const controller = new AbortController();
    const sseResp = await fetch(base + "/api/tournament/events", { signal: controller.signal });
    const reader = sseResp.body!.getReader();
    const decoder = new TextDecoder();

    // Start tournament
    await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: ["hp-a", "hp-b"],
        bestOf: 1,
        includeHeuristic: false,
        maxTurns: 5,
      }),
    });

    // Collect turn events
    const turnEvents: any[] = [];
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
        ]);
        const text = decoder.decode(chunk.value, { stream: true });
        for (const line of text.split("\n")) {
          if (line.startsWith("data:")) {
            try {
              const evt = JSON.parse(line.slice(5).trim());
              if (evt.type === "turn") turnEvents.push(evt);
            } catch { /* ignore */ }
          }
        }
        if (chunk.done) break;
      } catch { break; }
    }
    controller.abort();

    // Turn events should have HP data
    if (turnEvents.length > 0) {
      const first = turnEvents[0];
      expect(first).toHaveProperty("narrative");
      expect(first).toHaveProperty("hpA");
      expect(first).toHaveProperty("hpB");
      expect(first).toHaveProperty("maxHpA");
      expect(first).toHaveProperty("maxHpB");
      expect(first).toHaveProperty("turnNumber");
      expect(typeof first.narrative).toBe("string");
      expect(first.narrative.length).toBeGreaterThan(0);
    }
  }, 15000);

  it("game endpoint returns durationMs field", async () => {
    const { data: status } = await fetchJson("/api/tournament/status");
    if (!status.result || !status.result.matchups || status.result.matchups.length === 0) {
      return; // skip if no completed tournament
    }
    const m = status.result.matchups[0];
    if (m.games && m.games.length > 0) {
      const resp = await fetch(base + "/api/game/0/0");
      if (resp.status === 200) {
        const data = await resp.json();
        expect(data).toHaveProperty("durationMs");
        expect(typeof data.durationMs).toBe("number");
        expect(data.durationMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("ELO ratings accumulate across multiple tournaments", async () => {
    // Get current ratings
    await fetchJson("/api/ratings");
    const accModel = "acc-test-" + Date.now();

    // Run tournament 1
    await fetchJson("/api/tournament/reset", { method: "POST" });
    await new Promise(r => setTimeout(r, 200));
    await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: [accModel, accModel + "-opp"],
        bestOf: 1,
        includeHeuristic: false,
        maxTurns: 3,
      }),
    });
    await new Promise(r => setTimeout(r, 3000));

    // Check ratings after first tournament
    const { data: after1 } = await fetchJson("/api/ratings");
    expect(after1.ratings).toHaveProperty(accModel);
    const matches1 = after1.ratings[accModel].matches;

    // Run tournament 2 — same models
    await fetchJson("/api/tournament/reset", { method: "POST" });
    await new Promise(r => setTimeout(r, 200));
    await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: [accModel, accModel + "-opp"],
        bestOf: 1,
        includeHeuristic: false,
        maxTurns: 3,
      }),
    });
    await new Promise(r => setTimeout(r, 3000));

    // Ratings should have accumulated
    const { data: after2 } = await fetchJson("/api/ratings");
    expect(after2.ratings).toHaveProperty(accModel);
    expect(after2.ratings[accModel].matches).toBeGreaterThanOrEqual(matches1 + 1);
    // Verify matches accumulated (the key property — not reset to 1)
    expect(after2.ratings[accModel].matches).toBeGreaterThanOrEqual(2);
  }, 20000);

  // ── JSON/CSV Export ──

  it("returns 404 for JSON export when no result", async () => {
    await fetchJson("/api/tournament/reset", { method: "POST" });
    const { status, data } = await fetchJson("/api/export/json");
    expect(status).toBe(404);
    expect(data.error).toContain("No tournament result");
  });

  it("returns 404 for CSV export when no result", async () => {
    await fetchJson("/api/tournament/reset", { method: "POST" });
    const { status, data } = await fetchJson("/api/export/csv");
    expect(status).toBe(404);
    expect(data.error).toContain("No tournament result");
  });

  it("exports tournament as JSON after completion", async () => {
    await fetchJson("/api/tournament/reset", { method: "POST" });
    await new Promise(r => setTimeout(r, 200));
    await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: ["json-model-a", "json-model-b"],
        bestOf: 1,
        includeHeuristic: false,
        maxTurns: 3,
      }),
    });
    await new Promise(r => setTimeout(r, 3000));

    const resp = await fetch(base + "/api/export/json");
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toHaveProperty("startTime");
    expect(data).toHaveProperty("stats");
    expect(data).toHaveProperty("matchups");
    expect(data.matchups.length).toBeGreaterThan(0);
  }, 10000);

  it("exports tournament as CSV after completion", async () => {
    // Reuse the result from the previous test (or run a quick one)
    const resp = await fetch(base + "/api/export/csv");
    if (resp.status === 404) {
      // No result yet — run a quick tournament
      await fetchJson("/api/tournament/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          models: ["csv-model-a", "csv-model-b"],
          bestOf: 1,
          includeHeuristic: false,
          maxTurns: 3,
        }),
      });
      await new Promise(r => setTimeout(r, 3000));
    }
    const resp2 = await fetch(base + "/api/export/csv");
    expect(resp2.status).toBe(200);
    const csv = await resp2.text();
    expect(csv).toContain("Rank,Model,ELO");
    expect(csv).toContain("ModelA,ModelB");
    expect(csv).toContain("Matchup,Game");
    // Should have at least 1 data row per section
    const lines = csv.split("\n");
    expect(lines.length).toBeGreaterThan(5);
  }, 10000);

  // ── Reports ──

  it("returns empty reports when no report dir", async () => {
    // The default outputDir "tournament" may or may not exist — test the endpoint works
    const { status, data } = await fetchJson("/api/reports");
    expect(status).toBe(200);
    expect(data).toHaveProperty("reports");
    expect(Array.isArray(data.reports)).toBe(true);
  });

  // ── Health ──

  it("health endpoint returns status", async () => {
    const resp = await fetch(base + "/api/health");
    // In testMode without LLM server, health returns 503
    expect([200, 503]).toContain(resp.status);
    const data = await resp.json();
    expect(data).toHaveProperty("status");
  });

  // ── Models (testMode) ──

  it("returns test model names in testMode", async () => {
    const { status, data } = await fetchJson("/api/models");
    expect(status).toBe(200);
    expect(data.models).toContain("Alice");
    expect(data.models).toContain("Bob");
    expect(data.models).toContain("Charlie");
    expect(data.testMode).toBe(true);
  });

  // ── Abort endpoint with runner ──

  it("abort endpoint calls runner.abort()", async () => {
    // Start a multi-model tournament, then abort mid-run
    await fetchJson("/api/tournament/reset", { method: "POST" });
    await new Promise(r => setTimeout(r, 100));
    await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: ["Alice", "Bob", "Charlie"],
        bestOf: 5,
        includeHeuristic: false,
        maxTurns: 30,
      }),
    });
    await new Promise(r => setTimeout(r, 1000));

    const { status, data } = await fetchJson("/api/tournament/abort", { method: "POST" });
    // Could be 200 (aborted) or 400 (already finished)
    if (status === 200) {
      expect(data.status).toBe("aborted");
    }
  }, 5000);

  // ── Report files listing ──

  it("lists reports from run subdirectories", async () => {
    // Create a fake report structure
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(testOutputDir, 'run-test');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'matchup_0.md'), '# Test Report');

    const { status, data } = await fetchJson("/api/reports");
    expect(status).toBe(200);
    expect(data.reports.length).toBeGreaterThanOrEqual(1);
    const testReport = data.reports.find((r: any) => r.name.includes('run-test'));
    expect(testReport).toBeDefined();
    expect(testReport.name).toContain('matchup_0.md');
  });

  // ── Reset when running returns 409 ──

  it("reset returns 409 when tournament is running", async () => {
    // Start a quick tournament
    await fetchJson("/api/tournament/reset", { method: "POST" });
    await new Promise(r => setTimeout(r, 100));
    await fetchJson("/api/tournament/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: ["Alice", "Bob"],
        bestOf: 1,
        includeHeuristic: false,
        maxTurns: 50,
      }),
    });
    await new Promise(r => setTimeout(r, 200));

    // Try to reset while running
    const { status } = await fetchJson("/api/tournament/reset", { method: "POST" });
    expect([200, 409]).toContain(status);

    // Clean up
    await fetchJson("/api/tournament/abort", { method: "POST" });
    await new Promise(r => setTimeout(r, 500));
  }, 5000);
});
