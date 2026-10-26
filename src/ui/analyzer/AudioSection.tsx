import { Box, Chip, Collapse, IconButton, Paper, Slider, Stack, Tooltip, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RepeatIcon from "@mui/icons-material/Repeat";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import PlaylistPlayIcon from "@mui/icons-material/PlaylistPlay";
import { useEffect, useMemo, useRef, useState } from "react";
import { speakerId } from "../../features/analyzer/dialogue";
import type { AudioInfo, AudioUse } from "../../features/analyzer/model";
import { MONO } from "../theme";
import { LabelLink, SourceLink, useAnalyzer } from "./context";
import { useImageUrl } from "./StageImage";
import { Pager, SearchField, SelectField, StatCard, StatRow, Toolbar, usePaged } from "./ui";

type Filter = "all" | "music" | "sound" | "voice" | "unused" | "missing";
type Sort = "uses" | "name";

const STATEMENT: Record<AudioUse["statement"], string> = {
  play: "play",
  queue: "queue",
  voice: "voice",
  python: "Python / screen",
  config: "main menu music",
};

const title = (a: AudioInfo) => a.id.split("/").pop()!.replace(/\.[^.]+$/, "");
const time = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

export function AudioSection() {
  const { index } = useAnalyzer();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("uses");
  const [current, setCurrent] = useState<string | null>(null);
  const audio = index.audio ?? [];
  const counts = useMemo(
    () => ({
      music: audio.filter((a) => a.kind === "music" && a.file).length,
      sound: audio.filter((a) => a.kind === "sound" && a.file).length,
      voice: audio.filter((a) => a.kind === "voice" && a.file).length,
      unused: audio.filter((a) => a.file && a.uses.length === 0).length,
      missing: audio.filter((a) => a.missing).length,
    }),
    [audio],
  );
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = audio.filter((a) => {
      if (filter === "unused" ? !(a.file && a.uses.length === 0) : filter === "missing" ? !a.missing : filter !== "all" && a.kind !== filter) return false;
      return !q || [a.id, ...a.aliases, ...a.uses.map((u) => u.label), ...a.uses.map((u) => u.line?.what)].some((s) => s?.toLowerCase().includes(q));
    });
    return sort === "name" ? [...list].sort((a, b) => title(a).localeCompare(title(b))) : list;
  }, [audio, filter, query, sort]);
  const paged = usePaged(items, 50);
  const playlist = useMemo(() => items.filter((a) => a.file), [items]);

  return (
    <Box sx={{ pb: current ? 10 : 0 }}>
      <StatRow>
        <StatCard value={counts.music} label="Music tracks" active={filter === "music"} onClick={() => setFilter(filter === "music" ? "all" : "music")} />
        <StatCard value={counts.sound} label="Sound effects" active={filter === "sound"} onClick={() => setFilter(filter === "sound" ? "all" : "sound")} />
        <StatCard value={counts.voice} label="Voice files" active={filter === "voice"} onClick={() => setFilter(filter === "voice" ? "all" : "voice")} />
        <StatCard value={counts.unused} label="Never played" sub="files no script plays" active={filter === "unused"} onClick={() => setFilter(filter === "unused" ? "all" : "unused")} />
        <StatCard value={counts.missing} label="Missing files" sub="played but not found" active={filter === "missing"} onClick={() => setFilter(filter === "missing" ? "all" : "missing")} />
      </StatRow>
      <Toolbar summary={`${items.length.toLocaleString()} of ${audio.length.toLocaleString()} audio files`}>
        <SearchField value={query} onChange={setQuery} placeholder="Search audio" />
        <SelectField
          label="Type"
          value={filter}
          onChange={setFilter}
          options={[["all", "All audio"], ["music", "Music"], ["sound", "Sound effects"], ["voice", "Voice"], ["unused", "Never played"], ["missing", "Missing files"]]}
        />
        <SelectField label="Sort" value={sort} onChange={setSort} options={[["uses", "Most played"], ["name", "Name"]]} />
      </Toolbar>
      {audio.length === 0 && <Typography color="text.secondary">No audio found in the scripts or game folders.</Typography>}
      <Pager paged={paged as never} total={items.length} noun="files" sizes={[50, 100, 250]} />
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        {paged.slice.map((a, i) => (
          <TrackRow key={a.id} track={a} first={i === 0} playing={current === a.id} onPlay={() => setCurrent(current === a.id ? null : a.id)} />
        ))}
      </Paper>
      <Pager paged={paged as never} total={items.length} noun="files" sizes={[50, 100, 250]} />
      {current && <Jukebox key="jukebox" playlist={playlist} current={audio.find((a) => a.id === current) ?? null} onChange={setCurrent} />}
    </Box>
  );
}

function TrackRow({ track, first, playing, onPlay }: { track: AudioInfo; first: boolean; playing: boolean; onPlay(): void }) {
  const { index } = useAnalyzer();
  const [open, setOpen] = useState(false);
  const names = useMemo(() => new Map(index.characters.map((c) => [c.id, c.name ?? c.id])), [index]);
  const labels = [...new Set(track.uses.map((u) => u.label).filter((l): l is string => !!l))];
  return (
    <Box sx={{ borderTop: first ? 0 : 1, borderColor: "divider", bgcolor: playing ? "action.selected" : undefined }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1.25, px: 1.25, py: 0.75 }}>
        <IconButton size="small" color="primary" disabled={!track.file} onClick={onPlay} aria-label={`${playing ? "Stop" : "Play"} ${title(track)}`}>
          {playing ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", flexWrap: "wrap" }}>
            <Typography sx={{ fontWeight: 700 }} noWrap>{title(track)}</Typography>
            <Chip size="small" variant="outlined" label={track.kind} sx={{ height: 20 }} />
            {track.missing && <Chip size="small" color="error" variant="outlined" label="file not found" sx={{ height: 20 }} />}
            {track.file && track.uses.length === 0 && <Chip size="small" color="warning" variant="outlined" label="never played" sx={{ height: 20 }} />}
            {track.aliases.map((a) => (
              <Typography key={a} variant="caption" sx={{ fontFamily: MONO, color: "text.secondary" }}>audio.{a}</Typography>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" noWrap component="div" sx={{ fontFamily: MONO }}>{track.id}</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", sm: "block" }, whiteSpace: "nowrap" }}>
          {track.uses.length ? `${track.uses.length} use${track.uses.length === 1 ? "" : "s"} · ${labels.length} label${labels.length === 1 ? "" : "s"}` : ""}
        </Typography>
        <IconButton size="small" disabled={!track.uses.length && !track.loc} onClick={() => setOpen(!open)} aria-label="Where it plays" aria-expanded={open}>
          <ExpandMoreIcon sx={{ transform: open ? "rotate(180deg)" : undefined }} />
        </IconButton>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={0.5} sx={{ pl: 6.5, pr: 2, pb: 1.25 }}>
          {track.loc && (
            <Typography variant="caption">
              Defined as <code>audio.{track.aliases[0]}</code> · <SourceLink loc={track.loc} />
            </Typography>
          )}
          {track.uses.slice(0, 200).map((u, i) => (
            <Box key={i}>
              <Typography variant="caption" component="div">
                <b>{STATEMENT[u.statement]}</b>
                {u.statement !== "voice" && u.statement !== "config" && <> on <code>{u.channel}</code></>}
                {u.label ? <> in <LabelLink name={u.label} /></> : null} · <SourceLink loc={u.loc} />
              </Typography>
              {u.line && (
                <Typography variant="caption" color="text.secondary" component="div" sx={{ fontStyle: "italic" }}>
                  {u.line.who && <b>{names.get(speakerId(u.line.who)) ?? u.line.who}: </b>}“{u.line.what.replace(/\{[^{}]*\}/g, "")}”
                </Typography>
              )}
            </Box>
          ))}
          {track.uses.length > 200 && <Typography variant="caption" color="text.secondary">+{track.uses.length - 200} more</Typography>}
        </Stack>
      </Collapse>
    </Box>
  );
}

/** Player bar at the bottom of the section: play / pause, seek, previous / next, loop and auto-advance. */
function Jukebox({ playlist, current, onChange }: { playlist: AudioInfo[]; current: AudioInfo | null; onChange(id: string | null): void }) {
  const url = useImageUrl(current?.file ?? null);
  const ref = useRef<HTMLAudioElement>(null);
  const [paused, setPaused] = useState(false);
  const [pos, setPos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState(false);
  const [advance, setAdvance] = useState(true);
  const [failed, setFailed] = useState(false);
  const i = playlist.findIndex((a) => a.id === current?.id);
  const go = (d: number) => {
    if (!playlist.length) return;
    onChange(playlist[(Math.max(i, 0) + d + playlist.length) % playlist.length].id);
  };
  useEffect(() => {
    setFailed(false);
    setPos(0);
    const el = ref.current;
    if (el && url) void el.play().catch(() => setPaused(true));
  }, [url]);
  if (!current) return null;
  return (
    <Paper
      elevation={8}
      sx={{ position: "sticky", bottom: 8, mt: 2, p: 1.25, display: "flex", alignItems: "center", gap: 1, flexWrap: { xs: "wrap", sm: "nowrap" }, zIndex: 2 }}
      role="region"
      aria-label="Jukebox"
    >
      <GraphicEqIcon color="primary" sx={{ display: { xs: "none", sm: "block" } }} />
      <Box sx={{ minWidth: 0, width: { xs: "100%", sm: 220 }, flexShrink: 0 }}>
        <Typography sx={{ fontWeight: 700 }} noWrap>{title(current)}</Typography>
        <Typography variant="caption" color={failed ? "error" : "text.secondary"} noWrap component="div">
          {failed ? "This browser can't play this file format." : `${current.kind} · ${i >= 0 ? `${i + 1} of ${playlist.length}` : "not in the list"}`}
        </Typography>
      </Box>
      <Stack direction="row" sx={{ alignItems: "center" }}>
        <IconButton aria-label="Previous track" onClick={() => go(-1)}><SkipPreviousIcon /></IconButton>
        <IconButton
          color="primary"
          aria-label={paused ? "Resume" : "Pause"}
          onClick={() => {
            const el = ref.current;
            if (!el) return;
            if (el.paused) void el.play();
            else el.pause();
          }}
        >
          {paused ? <PlayArrowIcon /> : <PauseIcon />}
        </IconButton>
        <IconButton aria-label="Next track" onClick={() => go(1)}><SkipNextIcon /></IconButton>
      </Stack>
      <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{time(pos)}</Typography>
      <Slider
        size="small"
        value={pos}
        max={duration || 1}
        step={0.1}
        onChange={(_, v) => {
          const el = ref.current;
          if (el) el.currentTime = v as number;
          setPos(v as number);
        }}
        aria-label="Seek"
        sx={{ flex: 1, minWidth: 120, mx: 1 }}
      />
      <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{time(duration)}</Typography>
      <Tooltip title="Repeat this track">
        <IconButton aria-label="Repeat" aria-pressed={loop} color={loop ? "primary" : "default"} onClick={() => setLoop(!loop)}><RepeatIcon /></IconButton>
      </Tooltip>
      <Tooltip title="Play the next track when this one ends">
        <IconButton aria-label="Auto-advance" aria-pressed={advance} color={advance ? "primary" : "default"} onClick={() => setAdvance(!advance)}><PlaylistPlayIcon /></IconButton>
      </Tooltip>
      {url && (
        <audio
          ref={ref}
          src={url}
          loop={loop}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onError={() => setFailed(true)}
          onEnded={() => (advance && playlist.length > 1 ? go(1) : setPaused(true))}
        />
      )}
    </Paper>
  );
}
