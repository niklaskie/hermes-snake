/**
 * hermes-snake — Snake as a Hermes Desktop page with a live, community-wide scoreboard.
 *
 * UI-only plugin: no Python backend. Scores go straight to a public Cloudflare Worker
 * (see ../worker). Install guide: https://snake.niklaskietaibl.com/install.md
 *
 * What this file does, and nothing else:
 *  - draws the game, keeps your name + best score in the plugin's own storage
 *  - sends {name, score, run id} to snake.niklaskietaibl.com/api and reads the scoreboard
 * It does not call Hermes (no sessions, files, tools, config) and loads no other code.
 */
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState, useCallback } from "react";
import { host, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA, useQuery } from "@hermes/plugin-sdk";

const ID = "snake";
const VERSION = "0.2.0";
const ROUTE = "/snake";
const SITE = "https://snake.niklaskietaibl.com";
const API = SITE + "/api";
const GRID = 20;
const START_MS = 130;
const MIN_MS = 65;
const HEARTBEAT_MS = 2000;

let CTX = null;
const store = {
  get(k, d) {
    try {
      const v = CTX?.storage?.get?.(k);
      return v === undefined || v === null ? d : v;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      CTX?.storage?.set?.(k, v);
    } catch {}
  },
};

function randomId() {
  const a = new Uint8Array(10);
  crypto.getRandomValues(a);
  return [...a].map((b) => (b % 36).toString(36)).join("");
}

async function post(path, body) {
  try {
    const r = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await r.json().catch(() => ({}));
  } catch (e) {
    return { error: String(e) };
  }
}

function defaultName() {
  const p = host?.state?.profile?.get?.();
  return typeof p === "string" && p && p !== "default" ? p : "";
}

// ---------- game engine (pure, no React) ----------
function newGame() {
  const mid = Math.floor(GRID / 2);
  const g = {
    snake: [
      { x: mid, y: mid },
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid },
    ],
    dir: { x: 1, y: 0 },
    queue: [],
    food: null,
    score: 0,
    state: "ready", // ready | playing | paused | over
    started: 0,
    playedMs: 0,
    stepMs: START_MS,
  };
  g.food = placeFood(g.snake);
  return g;
}

function placeFood(snake) {
  const taken = new Set(snake.map((s) => s.x + "," + s.y));
  const free = [];
  for (let x = 0; x < GRID; x++) for (let y = 0; y < GRID; y++) if (!taken.has(x + "," + y)) free.push({ x, y });
  return free[Math.floor(Math.random() * free.length)] || { x: 0, y: 0 };
}

function turn(g, d) {
  const last = g.queue.length ? g.queue[g.queue.length - 1] : g.dir;
  if (d.x === -last.x && d.y === -last.y) return; // no 180°
  if (d.x === last.x && d.y === last.y) return;
  if (g.queue.length < 3) g.queue.push(d);
}

function step(g) {
  if (g.queue.length) g.dir = g.queue.shift();
  const head = { x: g.snake[0].x + g.dir.x, y: g.snake[0].y + g.dir.y };
  const eats = head.x === g.food.x && head.y === g.food.y;
  const body = eats ? g.snake : g.snake.slice(0, -1);
  if (head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID || body.some((s) => s.x === head.x && s.y === head.y)) {
    g.state = "over";
    return "over";
  }
  g.snake = [head, ...body];
  if (eats) {
    g.score += 1;
    g.stepMs = Math.max(MIN_MS, START_MS - g.score * 3);
    g.food = placeFood(g.snake);
    return "eat";
  }
  return "move";
}

// ---------- theme colours for the canvas ----------
function palette(el) {
  const cs = getComputedStyle(el);
  const v = (n, f) => (cs.getPropertyValue(n) || "").trim() || f;
  return {
    snake: v("--ui-accent", "#7c8cff"),
    head: v("--ui-text-primary", "#eee"),
    food: v("--ui-red", "#f06"),
    grid: v("--ui-stroke-tertiary", "rgba(127,127,127,.15)"),
    text: v("--ui-text-primary", "#eee"),
    muted: v("--ui-text-tertiary", "#999"),
  };
}

function draw(canvas, g, size) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const px = size * dpr;
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const c = palette(canvas);
  const cell = size / GRID;
  ctx.clearRect(0, 0, size, size);

  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  for (let i = 1; i < GRID; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, size);
    ctx.moveTo(0, i * cell);
    ctx.lineTo(size, i * cell);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // food
  ctx.fillStyle = c.food;
  ctx.beginPath();
  ctx.arc((g.food.x + 0.5) * cell, (g.food.y + 0.5) * cell, cell * 0.36, 0, Math.PI * 2);
  ctx.fill();

  // snake
  g.snake.forEach((s, i) => {
    ctx.fillStyle = i === 0 ? c.head : c.snake;
    ctx.globalAlpha = i === 0 ? 1 : Math.max(0.45, 1 - i / (g.snake.length + 8));
    const pad = cell * 0.08;
    roundRect(ctx, s.x * cell + pad, s.y * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.28);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  if (g.state !== "playing") {
    ctx.fillStyle = c.text;
    ctx.textAlign = "center";
    ctx.font = `600 ${Math.round(size / 14)}px system-ui, sans-serif`;
    const title = g.state === "over" ? "Game over · " + g.score : g.state === "paused" ? "Paused" : "Snake";
    ctx.fillText(title, size / 2, size / 2 - size / 40);
    ctx.fillStyle = c.muted;
    ctx.font = `${Math.round(size / 30)}px system-ui, sans-serif`;
    ctx.fillText(g.state === "paused" ? "Space to continue" : "Space or click to start · arrows / WASD", size / 2, size / 2 + size / 18);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const KEYS = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
};

// ---------- styles ----------
const S = {
  page: { display: "flex", height: "100%", width: "100%", overflow: "auto", gap: 24, padding: 24, boxSizing: "border-box", alignItems: "flex-start", justifyContent: "center", flexWrap: "wrap" },
  left: { display: "flex", flexDirection: "column", gap: 12, flex: "1 1 420px", maxWidth: 640, minWidth: 300 },
  head: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  title: { fontSize: 20, fontWeight: 600, color: "var(--ui-text-primary)" },
  big: { fontSize: 28, fontWeight: 700, color: "var(--ui-text-primary)", fontVariantNumeric: "tabular-nums" },
  muted: { color: "var(--ui-text-tertiary)", fontSize: 13 },
  board: { position: "relative", width: "100%", aspectRatio: "1 / 1", borderRadius: 16, background: "color-mix(in srgb, var(--foreground) 4%, transparent)", outline: "none", cursor: "pointer" },
  right: { flex: "0 1 300px", minWidth: 260, display: "flex", flexDirection: "column", gap: 12 },
  card: { borderRadius: 16, padding: 16, background: "color-mix(in srgb, var(--foreground) 4%, transparent)", display: "flex", flexDirection: "column", gap: 8 },
  label: { fontSize: 12, color: "var(--ui-text-tertiary)", display: "flex", alignItems: "center", gap: 6 },
  row: (me) => ({ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, fontSize: 14, background: me ? "color-mix(in srgb, var(--ui-accent) 16%, transparent)" : "transparent" }),
  rank: { width: 22, color: "var(--ui-text-tertiary)", fontVariantNumeric: "tabular-nums", fontSize: 12 },
  name: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ui-text-primary)" },
  score: { fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--ui-text-primary)" },
  input: { width: "100%", boxSizing: "border-box", borderRadius: 10, border: "none", padding: "8px 10px", fontSize: 14, color: "var(--ui-text-primary)", background: "color-mix(in srgb, var(--foreground) 6%, transparent)", outline: "none" },
  dot: { width: 8, height: 8, borderRadius: 4, background: "var(--ui-green)", display: "inline-block", animation: "hsnake-pulse 1.4s ease-in-out infinite" },
  btn: { border: "none", borderRadius: 10, padding: "8px 12px", fontSize: 13, cursor: "pointer", color: "var(--ui-text-primary)", background: "color-mix(in srgb, var(--foreground) 8%, transparent)" },
};

const MEDALS = ["🥇", "🥈", "🥉"];

function List({ rows, me, myPid, empty, live }) {
  if (!rows || !rows.length) return jsx("div", { style: S.muted, children: empty });
  return jsx(Fragment, {
    children: rows.map((r, i) => {
      const isMe = live ? r.pid === myPid : me && r.name === me;
      return jsxs(
        "div",
        {
          style: S.row(isMe),
          children: [
            jsx("span", { style: S.rank, children: !live && i < 3 ? MEDALS[i] : i + 1 }),
            jsx("span", { style: S.name, children: r.name + (isMe ? " (you)" : "") }),
            jsx("span", { style: S.score, children: r.score }),
          ],
        },
        (r.pid || r.name) + ":" + i
      );
    }),
  });
}

function Scoreboard({ name, pid, myLive }) {
  const q = useQuery({
    queryKey: ["snake:v1", "board"],
    queryFn: async () => {
      const r = await fetch(API + "/board", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    },
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const d = q.data || {};
  let live = Array.isArray(d.live) ? d.live.slice() : [];
  // Show my own run instantly, before the server round-trip.
  if (myLive !== null) {
    const i = live.findIndex((r) => r.pid === pid);
    if (i >= 0) live[i] = { ...live[i], score: Math.max(live[i].score, myLive) };
    else live.push({ pid, name: name || "anon", score: myLive });
    live.sort((a, b) => b.score - a.score);
  }
  return jsxs("div", {
    style: S.right,
    children: [
      jsxs("div", {
        style: S.card,
        children: [
          jsxs("div", { style: S.label, children: [jsx("span", { style: S.dot }), `Playing now · ${live.length}`] }),
          jsx(List, { rows: live, myPid: pid, live: true, empty: "Nobody is playing right now. Start a run!" }),
        ],
      }),
      jsxs("div", {
        style: S.card,
        children: [
          jsx("div", { style: S.label, children: "Best today" }),
          jsx(List, { rows: d.today, me: name, empty: "No scores today yet." }),
        ],
      }),
      jsxs("div", {
        style: S.card,
        children: [
          jsx("div", { style: S.label, children: "All-time" }),
          jsx(List, { rows: d.top, me: name, empty: q.isError ? "Scoreboard offline: " + String(q.error?.message || q.error) : q.isLoading ? "Loading…" : "No scores yet." }),
          jsxs("div", {
            style: { ...S.muted, fontSize: 12, display: "flex", justifyContent: "space-between" },
            children: [
              jsx("span", { children: d.players ? `${d.players} player${d.players === 1 ? "" : "s"} · ${d.runs} run${d.runs === 1 ? "" : "s"}` : "" }),
              jsx("a", { href: SITE, target: "_blank", rel: "noreferrer", style: { color: "var(--ui-text-tertiary)" }, children: "snake.niklaskietaibl.com ↗" }),
            ],
          }),
        ],
      }),
    ],
  });
}

function SnakePage() {
  const canvasRef = useRef(null);
  const boxRef = useRef(null);
  const gameRef = useRef(newGame());
  const sizeRef = useRef(400);
  const pidRef = useRef(randomId());
  const lastBeat = useRef(0);
  const [name, setName] = useState(() => store.get("name", "") || defaultName());
  const nameRef = useRef(name);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => Number(store.get("best", 0)) || 0);
  const [phase, setPhase] = useState("ready");
  const [myLive, setMyLive] = useState(null);
  const [msg, setMsg] = useState("");

  nameRef.current = name;

  const redraw = useCallback(() => {
    if (canvasRef.current) draw(canvasRef.current, gameRef.current, sizeRef.current);
  }, []);

  // keep the canvas sized to its box
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => {
      sizeRef.current = Math.max(200, Math.floor(box.clientWidth));
      if (canvasRef.current) {
        canvasRef.current.style.width = sizeRef.current + "px";
        canvasRef.current.style.height = sizeRef.current + "px";
      }
      redraw();
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [redraw]);

  const finish = useCallback(async (g) => {
    setPhase("over");
    setMyLive(null);
    const ms = g.playedMs;
    const pid = pidRef.current;
    pidRef.current = randomId();
    if (g.score > Number(store.get("best", 0))) {
      store.set("best", g.score);
      setBest(g.score);
    }
    if (g.score > 0) {
      const r = await post("/score", { pid, name: nameRef.current || "anon", score: g.score, ms });
      setMsg(r.ok ? "Score submitted." : "Score not saved: " + (r.error || "offline"));
    } else {
      post("/end", { pid });
    }
  }, []);

  const start = useCallback(() => {
    const g = gameRef.current;
    if (g.state === "playing") return;
    if (g.state === "paused") {
      g.state = "playing";
      setPhase("playing");
      return;
    }
    if (!nameRef.current.trim()) {
      setMsg("Pick a name first, so the scoreboard knows you.");
      return;
    }
    gameRef.current = newGame();
    gameRef.current.state = "playing";
    setScore(0);
    setMsg("");
    setPhase("playing");
    setMyLive(0);
    lastBeat.current = 0;
    boxRef.current?.focus();
  }, []);

  // game loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now) => {
      const g = gameRef.current;
      const dt = Math.min(250, now - last);
      last = now;
      if (g.state === "playing") {
        g.playedMs += dt;
        acc += dt;
        while (acc >= g.stepMs && g.state === "playing") {
          acc -= g.stepMs;
          const r = step(g);
          if (r === "eat") {
            setScore(g.score);
            setMyLive(g.score);
          }
          if (r === "over") finish(g);
        }
        if (g.state === "playing" && now - lastBeat.current > HEARTBEAT_MS) {
          lastBeat.current = now;
          post("/live", { pid: pidRef.current, name: nameRef.current || "anon", score: g.score });
        }
      } else acc = 0;
      redraw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      const g = gameRef.current;
      if (g.state === "playing" || g.state === "paused") post("/end", { pid: pidRef.current });
    };
  }, [finish, redraw]);

  // keyboard: only while focus is not in a text field
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const g = gameRef.current;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === " " || k === "Enter") {
        e.preventDefault();
        if (g.state === "playing") {
          g.state = "paused";
          setPhase("paused");
        } else start();
        return;
      }
      if (KEYS[k] && g.state === "playing") {
        e.preventDefault();
        turn(g, KEYS[k]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [start]);

  // swipe for touch / trackpad-less play
  const touch = useRef(null);
  const onPointerDown = (e) => {
    touch.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e) => {
    const t = touch.current;
    touch.current = null;
    const g = gameRef.current;
    if (!t) return;
    const dx = e.clientX - t.x,
      dy = e.clientY - t.y;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
      if (g.state !== "playing") start();
      return;
    }
    if (g.state !== "playing") return;
    turn(g, Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) });
  };

  return jsxs("div", {
    style: S.page,
    children: [
      jsx("style", { children: "@keyframes hsnake-pulse{0%,100%{opacity:1}50%{opacity:.35}}" }),
      jsxs("div", {
        style: S.left,
        children: [
          jsxs("div", {
            style: S.head,
            children: [
              jsxs("div", { children: [jsx("div", { style: S.title, children: "Snake" }), jsx("div", { style: S.muted, children: "Everyone on Hermes, one scoreboard." })] }),
              jsxs("div", { style: { textAlign: "right" }, children: [jsx("div", { style: S.big, children: score }), jsx("div", { style: S.muted, children: "best " + best })] }),
            ],
          }),
          jsx("div", {
            ref: boxRef,
            tabIndex: 0,
            style: S.board,
            onPointerDown,
            onPointerUp,
            children: jsx("canvas", { ref: canvasRef, style: { display: "block", borderRadius: 16 } }),
          }),
          jsxs("div", {
            style: { display: "flex", gap: 8, alignItems: "center" },
            children: [
              jsx("input", {
                style: S.input,
                value: name,
                maxLength: 16,
                placeholder: "Your name on the scoreboard",
                "aria-label": "Your name",
                onChange: (e) => {
                  setName(e.target.value);
                  store.set("name", e.target.value);
                },
                onKeyDown: (e) => {
                  if (e.key === "Enter") {
                    e.target.blur();
                    start();
                  }
                },
                disabled: phase === "playing" || phase === "paused",
              }),
              jsx("button", {
                type: "button",
                style: S.btn,
                onClick: () => {
                  const g = gameRef.current;
                  if (g.state === "playing") {
                    g.state = "paused";
                    setPhase("paused");
                  } else start();
                },
                children: phase === "playing" ? "Pause" : phase === "paused" ? "Resume" : phase === "over" ? "Again" : "Play",
              }),
            ],
          }),
          msg ? jsx("div", { style: S.muted, children: msg }) : null,
        ],
      }),
      jsx(Scoreboard, { name: name.trim(), pid: pidRef.current, myLive: phase === "playing" || phase === "paused" ? myLive ?? 0 : null }),
    ],
  });
}

export default {
  id: ID,
  name: "Snake",
  version: VERSION,
  register(ctx) {
    CTX = ctx;
    ctx.register({ id: "page", area: ROUTES_AREA, data: { path: ROUTE }, render: () => jsx(SnakePage, {}) });
    ctx.register({ id: "nav", area: SIDEBAR_NAV_AREA, order: 95, data: { path: ROUTE, label: "Snake", codicon: "game" } });
    ctx.register({
      id: "open",
      area: PALETTE_AREA,
      data: { id: `${ID}.open`, label: "Play Snake", keywords: ["snake", "game", "spiel", "play", "scoreboard"], run: () => host.navigate(ROUTE) },
    });
  },
};
