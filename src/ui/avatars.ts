/**
 * Player looks: a bold colour and a little piece of office hardware. All drawn
 * here as inline SVG (no image files).
 */
import { esc } from './dom';

export const COLORS = ['#ff4d6d', '#ffb703', '#3ddc97', '#4cc9f0', '#b388ff', '#ff8c42', '#f15bb5', '#a3e635'];
export const LOOK_NAMES = ['Monitor', 'Floppy', 'Server', 'Mouse', 'Router', 'Printer', 'Laptop', 'Bug'];

const INK = '#120c2c';
// Each icon is drawn on a 64×64 grid, in ink on top of the player's colour.
const ICONS: string[] = [
  // Monitor
  `<rect x="12" y="15" width="40" height="27" rx="4" fill="${INK}"/><rect x="16" y="19" width="32" height="19" rx="2" fill="#fff" opacity=".9"/><rect x="28" y="42" width="8" height="6" fill="${INK}"/><rect x="21" y="47" width="22" height="4" rx="2" fill="${INK}"/><circle cx="26" cy="27" r="2.4" fill="${INK}"/><circle cx="38" cy="27" r="2.4" fill="${INK}"/><path d="M26 32q6 4 12 0" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  // Floppy disk
  `<path d="M14 14h30l8 8v28a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V16a2 2 0 0 1 2-2z" fill="${INK}"/><rect x="21" y="14" width="20" height="12" fill="#fff" opacity=".9"/><rect x="35" y="16" width="4" height="8" fill="${INK}"/><rect x="18" y="33" width="28" height="16" rx="2" fill="#fff" opacity=".9"/><path d="M22 39h20M22 44h14" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`,
  // Server tower
  `<rect x="18" y="9" width="28" height="46" rx="4" fill="${INK}"/><rect x="22" y="14" width="20" height="7" rx="1.5" fill="#fff" opacity=".9"/><rect x="22" y="25" width="20" height="7" rx="1.5" fill="#fff" opacity=".9"/><rect x="22" y="36" width="20" height="7" rx="1.5" fill="#fff" opacity=".9"/><circle cx="38" cy="17.5" r="1.8" fill="#3ddc97"/><circle cx="38" cy="28.5" r="1.8" fill="#3ddc97"/><circle cx="38" cy="39.5" r="1.8" fill="#ff4d6d"/>`,
  // Mouse
  `<rect x="19" y="14" width="26" height="40" rx="13" fill="${INK}"/><path d="M32 14v14" stroke="#fff" stroke-width="2.4" opacity=".9"/><rect x="30" y="19" width="4" height="7" rx="2" fill="#fff" opacity=".9"/><path d="M32 14C32 8 40 8 44 6" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  // Router
  `<rect x="10" y="32" width="44" height="16" rx="4" fill="${INK}"/><path d="M18 32l-4-18M46 32l4-18" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><circle cx="18" cy="40" r="2.2" fill="#3ddc97"/><circle cx="25" cy="40" r="2.2" fill="#3ddc97"/><circle cx="32" cy="40" r="2.2" fill="#ffb703"/><path d="M26 22a9 9 0 0 1 12 0M22 17a15 15 0 0 1 20 0" stroke="${INK}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`,
  // Printer
  `<rect x="20" y="10" width="24" height="14" fill="#fff" stroke="${INK}" stroke-width="3"/><rect x="10" y="24" width="44" height="20" rx="4" fill="${INK}"/><rect x="18" y="38" width="28" height="16" fill="#fff" stroke="${INK}" stroke-width="3"/><path d="M23 44h18M23 49h12" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/><circle cx="47" cy="30" r="2.2" fill="#ffb703"/>`,
  // Laptop
  `<rect x="15" y="14" width="34" height="24" rx="3" fill="${INK}"/><rect x="19" y="18" width="26" height="16" rx="1.5" fill="#fff" opacity=".9"/><path d="M8 42h48l-4 7H12z" fill="${INK}"/><path d="M27 26l3 3 7-7" stroke="${INK}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  // Bug
  `<ellipse cx="32" cy="36" rx="13" ry="16" fill="${INK}"/><circle cx="32" cy="18" r="7" fill="${INK}"/><path d="M32 22v30" stroke="#fff" stroke-width="2" opacity=".8"/><path d="M19 30l-9-4M19 38H9M19 46l-8 5M45 30l9-4M45 38h10M45 46l8 5M28 12l-4-5M36 12l4-5" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><circle cx="29" cy="17" r="1.6" fill="#fff"/><circle cx="35" cy="17" r="1.6" fill="#fff"/>`,
];

export function color(look: number): string {
  return COLORS[((look % COLORS.length) + COLORS.length) % COLORS.length];
}

/** Round avatar badge as an SVG string. */
export function avatar(look: number, size = 64, title = ''): string {
  const i = ((look % ICONS.length) + ICONS.length) % ICONS.length;
  return `<svg class="avatar" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="${esc(title || LOOK_NAMES[i])}"><circle cx="32" cy="32" r="31" fill="${color(look)}"/>${ICONS[i]}</svg>`;
}
