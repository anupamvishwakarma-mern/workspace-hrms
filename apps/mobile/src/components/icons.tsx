import { type ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'clock'
  | 'calendar'
  | 'inbox'
  | 'user'
  | 'check'
  | 'info'
  | 'alert'
  | 'team'
  | 'grid'
  | 'doc'
  | 'wallet'
  | 'globe'
  | 'gear'
  | 'book'
  | 'leaf'
  | 'chevron'
  | 'menu'
  | 'search'
  | 'bell'
  | 'close'
  | 'home'
  | 'logout'
  | 'lock'
  | 'pin'
  | 'camera'
  | 'swap'
  | 'eye'
  | 'shield'
  | 'help'
  | 'more';

/** One path per stroke, drawn in a 24-unit box. */
const PATHS: Partial<Record<IconName, string[]>> = {
  home: ['M3 10.5 12 3l9 7.5V19a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z'],
  clock: ['M12 7v5l3 2'],
  calendar: ['M8 3v4M16 3v4M3 10h18', 'm9 15.5 2 2 4-4'],
  inbox: ['m8.5 12.5 2.5 2.5 4.5-5'],
  user: ['M4.5 21c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5'],
  team: ['M2.5 20c0-3.4 2.9-5.8 6.5-5.8s6.5 2.4 6.5 5.8', 'M16 14.4c3.2 0 5.5 2 5.5 5'],
  grid: [],
  doc: [
    'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z',
    'M14 3v5h5',
    'M9 13h6M9 17h4',
  ],
  wallet: ['M3 10h18', 'M16.5 15h1.5'],
  globe: ['M3 12h18', 'M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18'],
  gear: ['M4 7h9M17 7h3M4 17h3M11 17h9'],
  book: [
    'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v14H6.5A2.5 2.5 0 0 0 4 19.5z',
    'M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  ],
  leaf: [
    'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z',
    'M2 21c0-3 1.9-5.4 5-6',
  ],
  chevron: ['m9 6 6 6-6 6'],
  menu: ['M4 6h16M4 12h16M4 18h16'],
  search: ['m21 21-4.3-4.3'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  close: ['M18 6 6 18M6 6l12 12'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  lock: ['M8 11V8a4 4 0 0 1 8 0v3'],
  pin: ['M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z'],
  camera: ['M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z'],
  swap: ['m17 3 4 4-4 4M21 7H8M7 21l-4-4 4-4M3 17h13'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z'],
  shield: ['M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'],
  help: ['M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  info: ['M12 11v5'],
  alert: ['M12 3 2 20h20z', 'M12 10v4'],
  more: [],
};

/** Line icons (SVG), one set for the whole app. */
export function Icon({
  name,
  color,
  size = 22,
}: {
  name: IconName;
  color: ColorValue;
  size?: number;
}) {
  const sw = 1.75;
  const c = color as string;
  const ring = (cx: number, cy: number, r: number) => (
    <Circle cx={cx} cy={cy} r={r} stroke={c} strokeWidth={sw} fill="none" />
  );
  const dot = (cx: number, cy: number, r = 1.1) => <Circle cx={cx} cy={cy} r={r} fill={c} />;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {(PATHS[name] ?? []).map((d) => (
        <Path
          key={d}
          d={d}
          stroke={c}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
      {name === 'clock' || name === 'inbox' || name === 'globe' || name === 'help'
        ? ring(12, 12, 9)
        : null}
      {name === 'info' ? ring(12, 12, 9) : null}
      {name === 'calendar' ? (
        <Rect x={3} y={5} width={18} height={16} rx={2} stroke={c} strokeWidth={sw} fill="none" />
      ) : null}
      {name === 'wallet' ? (
        <Rect x={3} y={6} width={18} height={13} rx={2.5} stroke={c} strokeWidth={sw} fill="none" />
      ) : null}
      {name === 'doc' ? null : null}
      {name === 'user' ? ring(12, 8, 4) : null}
      {name === 'team' ? (
        <>
          {ring(9, 8, 3.5)}
          {ring(17, 9, 2.5)}
        </>
      ) : null}
      {name === 'search' ? ring(11, 11, 7) : null}
      {name === 'gear' ? (
        <>
          {ring(15, 7, 2)}
          {ring(9, 17, 2)}
        </>
      ) : null}
      {name === 'lock' ? (
        <Rect x={5} y={11} width={14} height={10} rx={2} stroke={c} strokeWidth={sw} fill="none" />
      ) : null}
      {name === 'pin' ? ring(12, 9, 2.5) : null}
      {name === 'camera' ? ring(12, 13, 3.8) : null}
      {name === 'eye' ? ring(12, 12, 3) : null}
      {name === 'grid'
        ? [
            [4, 4],
            [14, 4],
            [4, 14],
            [14, 14],
          ].map(([x, y]) => (
            <Rect
              key={`${x}${y}`}
              x={x}
              y={y}
              width={6}
              height={6}
              rx={1.5}
              stroke={c}
              strokeWidth={sw}
              fill="none"
            />
          ))
        : null}
      {name === 'help' ? dot(12, 17) : null}
      {name === 'info' ? dot(12, 8) : null}
      {name === 'alert' ? dot(12, 17) : null}
      {name === 'more' ? (
        <>
          {dot(5, 12, 1.5)}
          {dot(12, 12, 1.5)}
          {dot(19, 12, 1.5)}
        </>
      ) : null}
    </Svg>
  );
}
