import type { LabelProgram, PStmt } from "./program";
import { mergeShow, type ImageCatalog, type StageSprite } from "./stage";

/**
 * Interactive static walk through a label: shows dialogue line by line, applies scene /
 * show / hide to a stage, stops at menus and conditions for the user to pick a branch,
 * follows jumps, calls and fall-through, and keeps a rewindable history of decisions.
 * It never executes Python; conditions are chosen by the user.
 */

interface Cursor {
  block: PStmt[];
  index: number;
}

interface CallFrame {
  label: string;
  stack: Cursor[];
}

export interface Decision {
  kind: "menu" | "if";
  stmt: Extract<PStmt, { t: "menu" | "if" }>;
  label: string;
}

export interface HistoryEntry {
  kind: "menu" | "if";
  label: string;
  line: number;
  chosen: string;
  /** State right before the decision, for rewinding. */
  before: PlayerState;
}

export interface PlayerState {
  label: string;
  stack: Cursor[];
  calls: CallFrame[];
  background: string | null;
  sprites: StageSprite[];
  transition: string | null;
  /** Statement on screen: the current say, or the decision / end point. */
  current: PStmt | null;
  /** Statements passed silently since the last stop (python, audio, ...). */
  passed: PStmt[];
  decision: Decision | null;
  /** A label program the UI must load before stepping again. */
  waitingFor: string | null;
  ended: null | "return" | "end" | "dynamic";
  history: HistoryEntry[];
  steps: number;
}

export interface PlayerEnv {
  programs: Map<string, LabelProgram>;
  catalog: ImageCatalog;
  /** Label execution falls into when `label`'s block ends. */
  fallthrough(label: string): string | null;
}

export function startPlayer(label: string, env: PlayerEnv, opts: { background?: string | null } = {}): PlayerState {
  const s: PlayerState = {
    label,
    stack: [],
    calls: [],
    background: opts.background ?? null,
    sprites: [],
    transition: null,
    current: null,
    passed: [],
    decision: null,
    waitingFor: null,
    ended: null,
    history: [],
    steps: 0,
  };
  enter(s, label, env);
  return step(s, env);
}

/**
 * Start inside `label` at the statement on `line` (e.g. a line of dialogue inside a menu
 * option), with the stage set up by the scene / show / hide statements before it.
 */
export function startPlayerAt(label: string, line: number, env: PlayerEnv, opts: { background?: string | null } = {}): PlayerState {
  const prog = env.programs.get(label);
  const path = prog ? pathTo(prog.body, line) : null;
  if (!prog || !path) return startPlayer(label, env, opts);
  const s: PlayerState = {
    label,
    stack: [],
    calls: [],
    background: opts.background ?? null,
    sprites: [],
    transition: null,
    current: null,
    passed: [],
    decision: null,
    waitingFor: null,
    ended: null,
    history: [],
    steps: 0,
  };
  let block = prog.body;
  for (let k = 0; k < path.length; k += 2) {
    const i = path[k];
    for (const st of block.slice(0, i)) applyVisual(s, st, env);
    const last = k === path.length - 1;
    // Cursors of enclosing blocks point past the menu / if, as after choosing a branch.
    s.stack.push({ block, index: last ? i : i + 1 });
    if (!last) {
      const st = block[i];
      const b = path[k + 1];
      block = st.t === "menu" ? st.items[b].block : st.t === "if" ? st.entries[b].block : [];
    }
  }
  return step(s, env);
}

/** Indices (per nesting level) of the statement on `line`; branch blocks are addressed as [stmt, branch, ...]. */
function pathTo(body: PStmt[], line: number): number[] | null {
  for (let i = 0; i < body.length; i++) {
    const st = body[i];
    if (st.line === line && st.t !== "menu" && st.t !== "if") return [i];
    const branches = st.t === "menu" ? st.items.map((it) => it.block) : st.t === "if" ? st.entries.map((e) => e.block) : [];
    for (let b = 0; b < branches.length; b++) {
      const sub = pathTo(branches[b], line);
      if (sub) return [i, b, ...sub];
    }
    if (st.line === line) return [i];
  }
  return null;
}

function applyVisual(s: PlayerState, st: PStmt, env: PlayerEnv) {
  if (st.t === "scene") {
    s.background = st.image;
    s.sprites = [];
  } else if (st.t === "show") {
    const prev = s.sprites.find((x) => x.tag === st.tag);
    s.sprites = [...s.sprites.filter((x) => x.tag !== st.tag), { tag: st.tag, image: mergeShow(env.catalog, prev?.image, st.image), at: st.at.length ? st.at : (prev?.at ?? []) }];
  } else if (st.t === "hide") s.sprites = s.sprites.filter((x) => x.tag !== st.tag);
}

function enter(s: PlayerState, label: string, env: PlayerEnv) {
  const prog = env.programs.get(label);
  if (!prog) {
    s.waitingFor = label;
    s.label = label;
    s.stack = [];
    return;
  }
  s.waitingFor = null;
  s.label = label;
  s.stack = [{ block: prog.body, index: 0 }];
}

function clone(s: PlayerState): PlayerState {
  return {
    ...s,
    stack: s.stack.map((c) => ({ ...c })),
    calls: s.calls.map((f) => ({ label: f.label, stack: f.stack.map((c) => ({ ...c })) })),
    sprites: [...s.sprites],
    passed: [],
    history: [...s.history],
  };
}

/** Advance to the next line of dialogue, decision or end point. */
export function step(prev: PlayerState, env: PlayerEnv): PlayerState {
  const s = clone(prev);
  if (s.decision || s.ended) return s;
  if (s.waitingFor) {
    if (!env.programs.has(s.waitingFor)) return s;
    enter(s, s.waitingFor, env);
  }
  s.transition = null;
  for (let guard = 0; guard < 10_000; guard++) {
    const top = s.stack[s.stack.length - 1];
    if (!top) {
      // Label finished without jumping: Ren'Py continues with the next label in the file.
      const next = env.fallthrough(s.label);
      if (next) {
        enter(s, next, env);
        if (s.waitingFor) return s;
        continue;
      }
      return finish(s, "end");
    }
    if (top.index >= top.block.length) {
      s.stack.pop();
      continue;
    }
    const st = top.block[top.index];
    switch (st.t) {
      case "say":
        top.index++;
        s.current = st;
        s.steps++;
        return s;
      case "scene":
        top.index++;
        s.background = st.image;
        s.sprites = [];
        break;
      case "show": {
        top.index++;
        const prevSprite = s.sprites.find((x) => x.tag === st.tag);
        const sprite = { tag: st.tag, image: mergeShow(env.catalog, prevSprite?.image, st.image), at: st.at.length ? st.at : (prevSprite?.at ?? []) };
        s.sprites = [...s.sprites.filter((x) => x.tag !== st.tag), sprite];
        break;
      }
      case "hide":
        top.index++;
        s.sprites = s.sprites.filter((x) => x.tag !== st.tag);
        break;
      case "with":
        top.index++;
        s.transition = st.transition;
        break;
      case "menu":
      case "if":
        s.decision = { kind: st.t, stmt: st, label: s.label };
        s.current = st;
        return s;
      case "jump":
        top.index++;
        if (st.dynamic) return finish(s, "dynamic", st);
        enter(s, st.target, env);
        if (s.waitingFor) return s;
        break;
      case "call":
        top.index++;
        if (st.dynamic) {
          s.passed.push(st);
          break;
        }
        s.calls.push({ label: s.label, stack: s.stack.map((c) => ({ ...c })) });
        enter(s, st.target, env);
        if (s.waitingFor) return s;
        break;
      case "return": {
        top.index++;
        const frame = s.calls.pop();
        if (!frame) return finish(s, "return", st);
        s.label = frame.label;
        s.stack = frame.stack;
        break;
      }
      default:
        top.index++;
        s.passed.push(st);
    }
  }
  return finish(s, "end");
}

function finish(s: PlayerState, how: NonNullable<PlayerState["ended"]>, st: PStmt | null = null): PlayerState {
  s.ended = how;
  s.current = st;
  return s;
}

/** Options offered at the current decision. For conditions, the last option skips every branch. */
export function decisionOptions(d: Decision): { text: string; condition: string | null }[] {
  if (d.stmt.t === "menu") return d.stmt.items.map((it) => ({ text: it.text, condition: it.condition }));
  const opts = d.stmt.entries.map((e, i) => ({ text: e.condition ? (i === 0 ? `if ${e.condition}` : `elif ${e.condition}`) : "else", condition: e.condition }));
  if (d.stmt.entries.every((e) => e.condition !== null)) opts.push({ text: "Skip condition (none true)", condition: null });
  return opts;
}

/** Take option `i` at the current decision and continue. */
export function choose(prev: PlayerState, i: number, env: PlayerEnv): PlayerState {
  if (!prev.decision) return prev;
  const s = clone(prev);
  const d = s.decision!;
  const top = s.stack[s.stack.length - 1];
  top.index++;
  const options = decisionOptions(d);
  s.history.push({ kind: d.kind, label: d.label, line: d.stmt.line, chosen: options[i]?.text ?? "", before: prev });
  s.decision = null;
  const block = d.stmt.t === "menu" ? d.stmt.items[i]?.block : d.stmt.entries[i]?.block;
  if (block?.length) s.stack.push({ block, index: 0 });
  return step(s, env);
}

/** Go back to the state before history entry `i`, so that decision can be made again. */
export function rewind(s: PlayerState, i: number): PlayerState {
  return s.history[i]?.before ?? s;
}
