import { useEffect, useRef, useState } from "react";
import { Music2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { IconButton } from "./ui/IconButton";

function time(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export default function MediaPreview({ mode, url }: { mode: "audio" | "video"; url: string }) {
  const media = useRef<HTMLMediaElement | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [failed, setFailed] = useState(false);

  function togglePlayback() {
    const element = media.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setFailed(true));
    else element.pause();
  }

  function seek(seconds: number) {
    if (media.current && duration) media.current.currentTime = Math.max(0, Math.min(duration, seconds));
  }

  useEffect(() => {
    const shell = wrapper.current?.closest(".preview-shell");
    if (!shell) return;
    const handleShortcut = (event: Event) => {
      if (!(event instanceof KeyboardEvent) || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
        || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
      const element = media.current;
      if (!element) return;
      if (event.key === " " && !failed) {
        if (element.paused) void element.play().catch(() => setFailed(true));
        else element.pause();
      } else if (duration && event.key === "ArrowRight") {
        element.currentTime = Math.min(duration, element.currentTime + 10);
      } else if (duration && event.key === "ArrowLeft") {
        element.currentTime = Math.max(0, element.currentTime - 10);
      } else return;
      event.preventDefault();
    };
    shell.addEventListener("keydown", handleShortcut);
    return () => shell.removeEventListener("keydown", handleShortcut);
  }, [duration, failed]);

  const mediaProps = {
    src: url,
    preload: "metadata",
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onError: () => setFailed(true),
    onTimeUpdate: () => setPosition(media.current?.currentTime ?? 0),
    onDurationChange: () => {
      const next = media.current?.duration;
      setDuration(next && Number.isFinite(next) ? next : 0);
    },
  } as const;

  return (
    <div className="preview-media-wrap" ref={wrapper} aria-label="Media preview">
      <div className="preview-media-stage">
        {mode === "video"
          ? <video {...mediaProps} className="preview-media" ref={(node) => { media.current = node; }} />
          : <><audio {...mediaProps} ref={(node) => { media.current = node; }} /><Music2 aria-hidden="true" size={48} /></>}
      </div>
      {failed && <p className="preview-media-error" role="alert">This media couldn’t be played. Open the original or saved copy.</p>}
      <div className="preview-media-controls">
        <IconButton label={playing ? "Pause" : "Play"} disabled={failed} onClick={togglePlayback}>
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </IconButton>
        <input aria-label="Playback position" type="range" min={0} max={duration || 1} step="any" value={position}
          disabled={!duration} onChange={(event) => seek(Number(event.target.value))} />
        <span className="preview-media-time">{time(position)} / {time(duration)}</span>
        <select aria-label="Playback speed" value={speed} onChange={(event) => {
          const rate = Number(event.target.value);
          if (media.current) media.current.playbackRate = rate;
          setSpeed(rate);
        }}>
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
        <IconButton label={muted ? "Unmute" : "Mute"} onClick={() => {
          if (media.current) media.current.muted = !muted;
          setMuted(!muted);
        }}>
          {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </IconButton>
        <input className="preview-volume" aria-label="Volume" type="range" min={0} max={1} step={0.05}
          value={volume} onChange={(event) => {
            const level = Number(event.target.value);
            if (media.current) media.current.volume = level;
            setVolume(level);
          }} />
      </div>
    </div>
  );
}
