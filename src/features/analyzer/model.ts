/** Plain-data index of a Ren'Py project, built in a worker from the compiled scripts. */

export interface Loc {
  /** Tree node id of the .rpyc the statement came from (for jump-to-source). */
  fileId: string;
  /** Script path as recorded by Ren'Py, e.g. "game/script.rpy". */
  file: string;
  line: number;
}

export type EdgeKind = "jump" | "call" | "fallthrough";

/** A decision on the way to an edge: a menu option to pick or a condition that must hold. */
export type Via =
  | { kind: "choice"; menu: number; item: number; text: string; condition: string | null }
  | { kind: "condition"; code: string }
  /** `else` branch: none of these conditions hold. */
  | { kind: "else"; not: string[] };

export interface Edge {
  from: string;
  to: string;
  kind: EdgeKind;
  loc: Loc;
  /** Inside an if/menu branch rather than always taken. */
  conditional: boolean;
  /** Target came from `jump expression` with a non-literal value. */
  dynamic?: boolean;
  /** Decisions (outermost first) that lead to this edge. */
  via?: Via[];
}

export interface LabelInfo {
  name: string;
  loc: Loc;
  parameters: string | null;
  dialogue: number;
  words: number;
  menus: number;
  /** Ren'Py entry points such as start, splashscreen, main_menu. */
  entry: boolean;
  /** How the label's block ends when nothing jumps away. */
  ending: "return" | "jump" | "fallthrough" | "menu";
  /** scene/show statements in the label. */
  visuals: number;
  /** First background shown in (or carried into) the label. */
  background: string | null;
  /** Variable assignments in the label. */
  writes: number;
  /** Reachable from an entry point through static jumps/calls/fall-through. */
  reachable: boolean;
  /** Ranking for "most interesting": dialogue, choices and visuals. */
  score: number;
  /** First lines of dialogue, for previews. */
  preview: { who: string | null; what: string }[];
  /** Last line of dialogue, for endings. */
  last: { who: string | null; what: string } | null;
  /** Calls renpy.full_restart() / renpy.quit() / MainMenu(): the game ends here. */
  endsGame: boolean;
  /** Ends a replay (renpy.end_replay()) — a gallery replay scene. */
  replay: boolean;
}

export interface CharacterInfo {
  /** Variable the character is bound to (e.g. "e"), or the literal name for ad-hoc speakers. */
  id: string;
  name: string | null;
  defined: boolean;
  color: string | null;
  image: string | null;
  kind: string | null;
  loc: Loc | null;
  lines: number;
  words: number;
  /** Labels the character speaks in, with line counts. */
  labels: Record<string, number>;
  sample: string | null;
  /** Image used as the character's portrait (most-shown image of their tag, or side image). */
  portrait: string | null;
  /** Share of all dialogue lines (0..1). */
  share: number;
}

export type ImageKind = "file" | "expression" | "atl" | "layered" | "movie" | "solid" | "auto" | "composite";

export interface CompositePart {
  x: number;
  y: number;
  displayable: string;
}

export interface LayeredLayer {
  /** null for always-on layers and conditions. */
  group: string | null;
  attribute: string | null;
  isDefault: boolean;
  condition: string | null;
  /** Image name or file path the layer displays. */
  displayable: string;
}

export interface ImageInfo {
  /** Full name, e.g. "eileen happy". */
  name: string;
  tag: string;
  attributes: string[];
  kind: ImageKind;
  /** Expression or summary from the definition. */
  code: string | null;
  /** Game-relative image file this resolves to, when known ("images/bg room.png"). */
  file: string | null;
  loc: Loc | null;
  layers?: LayeredLayer[];
  composite?: { width: number; height: number; parts: CompositePart[] };
  /** Movie file for Movie(play=...) images. */
  movie?: string | null;
  uses: number;
}

export interface ImageUse {
  image: string;
  statement: "show" | "scene" | "hide";
  loc: Loc;
  label: string | null;
}

export type ChoiceOutcome = "shared" | "rejoins" | "distinct";

export interface ChoiceItem {
  text: string;
  condition: string | null;
  targets: string[];
  /** Dialogue lines / words directly inside the option's block. */
  lines: number;
  words: number;
  /** Variables assigned in the option's block (and its branch-only labels, after analysis). */
  writes: string[];
  outcome: ChoiceOutcome;
  /** First label shared with another option. */
  rejoin: string | null;
  /** Labels only reachable through this option before the routes rejoin. */
  uniqueLabels: string[];
  uniqueLines: number;
  uniqueWords: number;
  major: boolean;
  /** Images shown only on this option's path (its block and branch-only labels). */
  visuals: string[];
}

export interface MenuInfo {
  id: number;
  loc: Loc;
  label: string | null;
  name: string | null;
  caption: { who: string | null; what: string } | null;
  items: ChoiceItem[];
  impact: number;
  important: boolean;
}

export type RefKind = "declare" | "write" | "read" | "condition";

/** What a condition decides. */
export type Gate =
  | { kind: "choice"; text: string }
  | { kind: "branch"; targets: string[]; elif: boolean }
  | { kind: "loop" }
  | { kind: "screen"; screen: string; showif: boolean };

export interface VarRef {
  kind: RefKind;
  loc: Loc;
  label: string | null;
  code: string;
  /** Screen the reference is in (screen code has no label). */
  screen?: string;
  gate?: Gate;
}

export type VariableCategory = "currency" | "relationship" | "resource" | "progress" | "flag" | "other";

export interface VariableFacts {
  /** Highest `var >= N` / `var > N` requirement found. */
  needsAtLeast: number | null;
  /** Lowest `var <= N` / `var < N` check found. */
  checkedAtMost: number | null;
  /** Largest literal assigned (`var = N`) or reached by summing increments. */
  assignedMax: number | null;
  increments: number;
  decrements: number;
  maxIncrement: number | null;
  booleans: boolean;
}

export type VariableTag = "worth-changing" | "repeatedly-increased" | "clear-target" | "numeric-requirement" | "state-flag" | "grind";

export interface VariableInfo {
  name: string;
  declared: "default" | "define" | null;
  initial: string | null;
  refs: VarRef[];
  category: VariableCategory;
  facts: VariableFacts;
  tags: VariableTag[];
  /** Ren'Py console command that sets a useful value, e.g. `money = 9999`. */
  command: string | null;
  score: number;
}

export type SceneEvent =
  | { type: "scene"; image: string | null; loc: Loc }
  | { type: "show"; image: string; tag: string; at: string[]; loc: Loc }
  | { type: "hide"; tag: string; loc: Loc }
  | { type: "with"; transition: string; loc: Loc }
  | { type: "say"; who: string | null; what: string; loc: Loc }
  | { type: "menu"; items: string[]; loc: Loc };

export interface SceneInfo {
  id: number;
  label: string;
  loc: Loc;
  background: string | null;
  dialogue: number;
  events: SceneEvent[];
}

export type AudioStatement = "play" | "queue" | "voice" | "python" | "config";

export interface AudioUse {
  channel: string;
  statement: AudioStatement;
  loc: Loc;
  label: string | null;
  /** For voice: the line of dialogue it is spoken with. */
  line?: { who: string | null; what: string } | null;
}

export interface AudioInfo {
  /** Game-relative file path when known, otherwise the expression as written. */
  id: string;
  /** Existing game file this resolves to. */
  file: string | null;
  /** `audio.x` names that point at this file. */
  aliases: string[];
  /** `define audio.x = ...` location, if defined. */
  loc: Loc | null;
  kind: "music" | "sound" | "voice";
  uses: AudioUse[];
  /** Referenced by the script but no such file was found. */
  missing: boolean;
}

export interface GalleryButton {
  /** Variable holding the Gallery object. */
  gallery: string;
  name: string;
  /** Images shown by the button, in order (each entry may layer several displayables). */
  images: string[][];
  /** Python conditions that must be true (g.condition). */
  conditions: string[];
  /** Images that must have been seen (g.unlock / g.unlock_image). */
  unlockImages: string[];
  thumbnail: string | null;
  loc: Loc;
}

export interface ReplayInfo {
  label: string;
  loc: Loc;
  /** Screen the Replay() action appears in, or null for Python code. */
  screen: string | null;
}

export interface GalleryIndex {
  buttons: GalleryButton[];
  replays: ReplayInfo[];
  /** persistent.x variables → screens that mention them. */
  persistentInScreens: Record<string, string[]>;
}

export interface FileStats {
  file: string;
  fileId: string;
  dialogue: number;
  words: number;
  labels: number;
}

export interface Diagnostics {
  parsedFiles: number;
  failedFiles: number;
  pythonBlocks: number;
  /** jump/call expression targets that couldn't be resolved statically. */
  dynamicRoutes: number;
  contentLabels: number;
  scenesWithVisuals: number;
  unreachableLabels: number;
  screens: number;
  transforms: number;
  /** $ / python statements inside story labels. */
  pythonInLabels: number;
}

export interface GameInfo {
  name: string | null;
  version: string | null;
}

export interface AnalyzerIndex {
  game: GameInfo;
  diagnostics: Diagnostics;
  files: FileStats[];
  labels: LabelInfo[];
  edges: Edge[];
  characters: CharacterInfo[];
  images: ImageInfo[];
  imageUses: ImageUse[];
  menus: MenuInfo[];
  variables: VariableInfo[];
  scenes: SceneInfo[];
  audio: AudioInfo[];
  gallery: GalleryIndex;
  totals: { dialogue: number; words: number; choices: number };
  errors: { path: string; message: string }[];
}

export interface AnalyzerInput {
  scripts: { fileId: string; path: string; source: import("../../core/vfs/source").FileSource }[];
  /** Image files, with their path relative to the game directory. */
  imageFiles: { fileId: string; gamePath: string }[];
  /** Audio files, with their path relative to the game directory. */
  audioFiles?: { fileId: string; gamePath: string }[];
}
