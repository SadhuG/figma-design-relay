// Icons exported from Figma's "Brand kit: Rising sun" (the `App icon` and `Icon` sets) as used on
// the "Plugin UI screens" page. Re-export from Figma rather than editing the path data. Colours
// never live here: glyphs paint with currentColor and the app icon with the role variables, so
// both themes draw them right.

import type { ReactNode } from "react";

type IconProps = { size: number };

const C = "currentColor";

/** One glyph drawn twice in the set: 12 px for the collapsed bar, 14 px everywhere else. */
function Glyph({ size, small, large }: IconProps & { small: ReactNode; large: ReactNode }) {
  const box = size <= 12 ? 12 : 14;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {box === 12 ? small : large}
    </svg>
  );
}

/**
 * The app icon. Stable is the sun over the horizon; Dev puts it on an ink tile. Offline sets the
 * sun. The 20 px icon in the set is this 16 px drawing scaled.
 */
export function AppIcon({
  channel,
  state,
  size,
}: IconProps & { channel: "stable" | "dev"; state: "live" | "offline" }) {
  if (channel === "dev") {
    const sun = state === "live" ? "var(--sun-on-ink)" : "var(--sun-set)";
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect width="16" height="16" rx="3.5" fill="var(--surface-ink)" />
        <path
          d="M11.8423 8C11.2421 9.53624 9.74879 10.625 8 10.625C6.25121 10.625 4.7579 9.53624 4.15771 8H11.8423Z"
          fill={sun}
        />
        <path
          d="M8 2.375C10.2782 2.375 12.125 4.22183 12.125 6.5C12.125 6.75617 12.1008 7.00675 12.0562 7.25H3.94385C3.89916 7.00675 3.875 6.75617 3.875 6.5C3.875 4.22183 5.72183 2.375 8 2.375Z"
          fill={sun}
        />
        <rect x="2.75" y="11.75" width="10.5" height="1.5" rx="0.75" fill="var(--sun-on-ink)" />
      </svg>
    );
  }
  const sun = state === "live" ? "var(--sun-rising)" : "var(--sun-set)";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.123 8C12.3228 10.0483 10.3317 11.5 8 11.5C5.66828 11.5 3.6772 10.0483 2.87695 8H13.123Z"
        fill={sun}
      />
      <path
        d="M8 0.5C11.0376 0.5 13.5 2.96243 13.5 6C13.5 6.34157 13.4678 6.67566 13.4082 7H2.5918C2.53221 6.67566 2.5 6.34157 2.5 6C2.5 2.96243 4.96243 0.5 8 0.5Z"
        fill={sun}
      />
      <rect x="1" y="13" width="14" height="2" rx="1" fill="var(--line-horizon)" />
    </svg>
  );
}

/** The working chip's mark. */
export function PixelCursorIcon({ size }: IconProps) {
  return (
    <Glyph
      size={size}
      small={
        <path
          d="M3.32106 1.71431H4.39249V2.78574H5.46392V3.85717H6.53535V4.9286H7.60678V6.00003H8.67821V7.07146H9.74963V8.14288H6.53535V9.21431H7.60678V10.2857H8.67821V11.3572H6.53535V10.2857H5.46392V9.21431H4.39249V10.2857H3.32106V11.3572H2.24963V0.642883H3.32106V1.71431Z"
          fill={C}
        />
      }
      large={
        <path
          d="M3.8746 2H5.1246V3.25H6.3746V4.5H7.6246V5.75H8.8746V7H10.1246V8.25H11.3746V9.5H7.6246V10.75H8.8746V12H10.1246V13.25H7.6246V12H6.3746V10.75H5.1246V12H3.8746V13.25H2.6246V0.75H3.8746V2Z"
          fill={C}
        />
      }
    />
  );
}

/** The lost chip's mark: the relay moved out of reach. */
export function MovedIcon({ size }: IconProps) {
  return (
    <Glyph
      size={size}
      small={
        <>
          <path
            d="M1.5 4.71874V4.71428H1.50446M1.5 6.63839V6.64731M1.5 8.56696V8.57589M1.5 10.4955V10.5H1.50446M3.42411 10.5H3.43304M5.35268 10.5H5.36161M7.28125 10.5H7.28571V10.4955M7.28571 8.57589V8.56696M7.28571 6.64732V6.63839M7.28571 4.71874V4.71428H7.28125M5.36161 4.71428H5.35268M3.43304 4.71428H3.42411"
            stroke={C}
            strokeWidth="1.25"
          />
          <rect x="4.71436" y="1.5" width="5.78571" height="5.78571" rx="0.857143" fill={C} />
        </>
      }
      large={
        <>
          <path
            d="M1.75 5.50448V5.5H1.75448M1.75 7.74552V7.75448M1.75 9.99552V10.0045M1.75 12.2455V12.25H1.75448M3.99552 12.25H4.00448M6.24552 12.25H6.25448M8.49552 12.25H8.5V12.2455M8.5 10.0045V9.99552M8.5 7.75448V7.74552M8.5 5.50448V5.5H8.49552M6.25448 5.5H6.24552M4.00448 5.5H3.99552"
            stroke={C}
            strokeWidth="1.5"
          />
          <rect x="5.5" y="1.75" width="6.75" height="6.75" rx="1" fill={C} />
        </>
      }
    />
  );
}

/** The sent chip's mark: the selection, handed on. */
export function SelectionOutIcon({ size }: IconProps) {
  return (
    <Glyph
      size={size}
      small={
        <>
          <path
            d="M2.57141 2.57141H9.42855V9.42855H2.57141V2.57141Z"
            stroke={C}
            strokeWidth="1.25"
          />
          <rect x="1.28571" y="1.28577" width="2.57143" height="2.57143" rx="0.642857" fill={C} />
          <rect x="8.14288" y="1.28577" width="2.57143" height="2.57143" rx="0.642857" fill={C} />
          <rect x="1.28571" y="8.14282" width="2.57143" height="2.57143" rx="0.642857" fill={C} />
          <rect x="8.14288" y="8.14282" width="2.57143" height="2.57143" rx="0.642857" fill={C} />
          <path
            d="M4.92859 7.07145L7.07145 4.92859M7.07145 6.85716V4.92859H5.14287"
            stroke={C}
            strokeWidth="1.25"
          />
        </>
      }
      large={
        <>
          <path d="M3 3H11V11H3V3Z" stroke={C} strokeWidth="1.5" />
          <rect x="1.5" y="1.5" width="3" height="3" rx="0.75" fill={C} />
          <rect x="9.5" y="1.5" width="3" height="3" rx="0.75" fill={C} />
          <rect x="1.5" y="9.5" width="3" height="3" rx="0.75" fill={C} />
          <rect x="9.5" y="9.5" width="3" height="3" rx="0.75" fill={C} />
          <path d="M5.75 8.25L8.25 5.75M8.25 8V5.75H6" stroke={C} strokeWidth="1.5" />
        </>
      }
    />
  );
}

/** The syncing chip's mark: layers, read one by one. */
export function OutlineStackIcon({ size }: IconProps) {
  return (
    <Glyph
      size={size}
      small={
        <>
          <path
            d="M6.00005 1.28577L10.7143 3.64291L6.00005 6.00005L1.28577 3.64291L6.00005 1.28577Z"
            fill={C}
            stroke={C}
            strokeWidth="0.75"
          />
          <path d="M1.28577 6L6.00005 8.35714L10.7143 6" stroke={C} strokeWidth="1.25" />
          <path
            d="M1.28577 8.35718L6.00005 10.7143L10.7143 8.35718"
            stroke={C}
            strokeWidth="1.25"
          />
        </>
      }
      large={
        <>
          <path d="M7 1.5L12.5 4.25L7 7L1.5 4.25L7 1.5Z" fill={C} stroke={C} />
          <path d="M1.5 7L7 9.75L12.5 7" stroke={C} strokeWidth="1.5" />
          <path d="M1.5 9.75L7 12.5L12.5 9.75" stroke={C} strokeWidth="1.5" />
        </>
      }
    />
  );
}

/** The diagram chip's mark: three shapes, connected. */
export function ShapeRelayIcon({ size }: IconProps) {
  return (
    <Glyph
      size={size}
      small={
        <>
          <circle cx="2.24997" cy="5.99997" r="1.60714" fill={C} />
          <path
            d="M4.60718 7.39289L6.00003 4.60718L7.39289 7.39289H4.60718Z"
            fill={C}
            stroke={C}
            strokeWidth="0.75"
          />
          <rect x="8.14282" y="4.39282" width="3.21429" height="3.21429" rx="0.857143" fill={C} />
        </>
      }
      large={
        <>
          <circle cx="2.625" cy="7" r="1.875" fill={C} />
          <path d="M5.375 8.625L7 5.375L8.625 8.625H5.375Z" fill={C} stroke={C} />
          <rect x="9.5" y="5.125" width="3.75" height="3.75" rx="1" fill={C} />
        </>
      }
    />
  );
}

/** The leader chip's mark: one relay, many followers. */
export function DartsIcon({ size }: IconProps) {
  return (
    <Glyph
      size={size}
      small={
        <>
          <path
            d="M6 0.75L8.25 3.75L6 2.81229L3.75 3.75L6 0.75Z"
            fill={C}
            stroke={C}
            strokeWidth="0.75"
          />
          <path
            d="M3.37549 4.5L5.62549 7.5L3.37549 6.56229L1.12549 7.5L3.37549 4.5ZM8.62549 4.5L10.8755 7.5L8.62549 6.56229L6.37549 7.5L8.62549 4.5Z"
            fill={C}
            stroke={C}
            strokeWidth="0.75"
          />
          <path
            d="M6 8.25L8.25 11.25L6 10.3123L3.75 11.25L6 8.25Z"
            fill={C}
            stroke={C}
            strokeWidth="0.75"
          />
        </>
      }
      large={
        <>
          <path d="M7 0.875L9.625 4.375L7 3.281L4.375 4.375L7 0.875Z" fill={C} stroke={C} />
          <path
            d="M3.93799 5.25L6.56299 8.75L3.93799 7.656L1.31299 8.75L3.93799 5.25ZM10.063 5.25L12.688 8.75L10.063 7.656L7.43799 8.75L10.063 5.25Z"
            fill={C}
            stroke={C}
          />
          <path d="M7 9.625L9.625 13.125L7 12.031L4.375 13.125L7 9.625Z" fill={C} stroke={C} />
        </>
      }
    />
  );
}

/** The collapse toggle's mark. */
export function ChevronIcon({ size, direction }: IconProps & { direction: "up" | "down" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d={direction === "up" ? "M3.5 8.75L7 5.25L10.5 8.75" : "M3.5 5.25L7 8.75L10.5 5.25"}
        stroke={C}
        strokeWidth="1.5"
      />
    </svg>
  );
}
