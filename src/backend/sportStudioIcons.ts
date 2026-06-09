const SPORT_ICON_PALETTES = [
  { start: "#48C6EF", middle: "#5B7CFA", end: "#7A4DFF", accent: "#5EF2D6" },
  { start: "#FF6CAB", middle: "#B44CFF", end: "#5B58FF", accent: "#73E8FF" },
  { start: "#00D2B8", middle: "#00A7E8", end: "#4263EB", accent: "#8CFFB7" },
  { start: "#FF9A44", middle: "#FF5E7A", end: "#A34BFF", accent: "#FFE66D" },
  { start: "#8B5CF6", middle: "#526DFF", end: "#12B8C4", accent: "#FF8BD8" },
  { start: "#35D07F", middle: "#00A8A8", end: "#3973E6", accent: "#B9FF66" },
] as const;

type SportGlyph = {
  concept: string;
  body: string;
};

const SPORT_GLYPHS: Record<string, SportGlyph> = {
  Aerial: {
    concept: "performer suspended inside an aerial hoop",
    body: `<circle cx="12" cy="11" r="5.5"/><path d="M12 4V2.8M9.4 8.5c1.2-1.6 4-1.2 4.4.8.3 1.5-1.1 2.4-2.5 2.8m.1 0c-1.8.8-3.1 2.4-3.5 4.3m3.5-4.3c1.8.9 3 2.3 3.5 4.1"/><circle cx="11.1" cy="7.2" r="1" fill="currentColor" stroke="none"/>`,
  },
  Aqua: {
    concept: "water droplet above a pool wave",
    body: `<path d="M12 4.2c2.2 2.6 3.5 4.4 3.5 6.2a3.5 3.5 0 0 1-7 0c0-1.8 1.3-3.6 3.5-6.2Z"/><path d="M5 17c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0 3-1.4 4.5 0"/>`,
  },
  Archery: {
    concept: "arrow striking a bullseye",
    body: `<circle cx="10.5" cy="12" r="5.4"/><circle cx="10.5" cy="12" r="2.1"/><path d="M12.1 10.4 18.7 3.8M15.8 3.8h2.9v2.9M12.1 10.4l2.3-.2.2-2.3"/>`,
  },
  Badminton: {
    concept: "diagonal shuttlecock in flight",
    body: `<path d="m7.2 5.2 4.7 4.7M5.2 7.2l4.7 4.7M6 4.5l-1.5 1.5 5.6 7.7 3.6-3.6L6 4.5Z"/><path d="m12.5 12.5 5.1 5.1"/><circle cx="17.8" cy="17.8" r="1.2" fill="currentColor" stroke="none"/>`,
  },
  Barre: {
    concept: "ballet leg extended from a studio barre",
    body: `<path d="M4.5 7h15M6 7v10M18 7v10M10 9.2c1.3 1 2.2 2.2 2.5 3.7m0 0 4.5 2.4m-4.5-2.4-2.2 4.3"/><circle cx="9.1" cy="8.9" r="1.1" fill="currentColor" stroke="none"/>`,
  },
  "Beach Volleyball": {
    concept: "volleyball crossing a beach net under the sun",
    body: `<circle cx="7" cy="6.2" r="2"/><path d="M4.5 14.2h15M6 11.2v7M18 11.2v7M6 14.2c2 1.1 4 1.1 6 0s4-1.1 6 0M11 8.8c1.8-1.6 3.6-1.5 5.4.2"/>`,
  },
  Bootcamp: {
    concept: "obstacle tire and training cone",
    body: `<circle cx="9" cy="12" r="4.2"/><circle cx="9" cy="12" r="1.8"/><path d="m15.2 17 2.1-7 2.2 7h-4.3ZM15.8 14.4h3"/>`,
  },
  Bouldering: {
    concept: "faceted boulder wall with climbing holds",
    body: `<path d="m5.2 18 1.4-10.5 4-2.5 6.7 2.1 1.5 10.9H5.2Z"/><path d="m8.2 9.2 1.5-.7m3.8.2 1.4.8m-5.6 4.3 1.5.8m4.2.2 1.3-.8" stroke-width="2.2"/>`,
  },
  "Boxing Sports": {
    concept: "laced boxing glove",
    body: `<path d="M8 9.2V7.3c0-2.2 3-2.7 3.7-.7.9-1.7 3.6-1 3.6 1v1.7c1.7.3 2.7 1.7 2.4 3.4l-.7 3.7c-.2 1-1 1.6-2 1.6H9.2c-1.8 0-3.2-1.4-3.2-3.2v-2.4c0-1.5.8-2.7 2-3.2Z"/><path d="M8 9.2h7.3M9 15.2h7.8"/>`,
  },
  Capoeira: {
    concept: "inverted capoeira kick with motion arc",
    body: `<circle cx="8.2" cy="15.8" r="1.2" fill="currentColor" stroke="none"/><path d="M9.2 14.5 12 11l2.7 2.2M12 11 9.8 8.2m2.2 2.8 4.8-3.5M9.8 8.2 6 10.5M5.2 16.8c-1.4-4.6.8-9.4 5.2-11.1"/>`,
  },
  Climbing: {
    concept: "locking climbing carabiner",
    body: `<path d="M15.8 5.1a5.8 5.8 0 0 0-8.2.3l-2 2A5.8 5.8 0 0 0 13.8 15l1.8-1.8a5.8 5.8 0 0 0 .2-8.1Z"/><path d="m9.1 14.9 5.8-5.8m-4.7 4.7 1.7 1.7m.8-4.8 1.7 1.7"/>`,
  },
  Crosstraining: {
    concept: "kettlebell with crossing movement arrows",
    body: `<path d="M9.3 8a2.7 2.7 0 0 1 5.4 0M8.5 9h7l1.8 8H6.7l1.8-8Z"/><path d="M5 6.2h2.8M6.5 4.7v3M16.5 5.2l2.3 2.3m0-2.3-2.3 2.3"/>`,
  },
  Cryotherapy: {
    concept: "snowflake inside a cryotherapy chamber",
    body: `<path d="M7 4.5h10v15H7z"/><path d="M12 7.2v9.6m-4.2-7.2 8.4 4.8m0-4.8-8.4 4.8M12 7.2l-1.2 1.2m1.2-1.2 1.2 1.2M12 16.8l-1.2-1.2m1.2 1.2 1.2-1.2"/>`,
  },
  Cycling: {
    concept: "road bicycle",
    body: `<circle cx="7" cy="15.2" r="3.3"/><circle cx="17" cy="15.2" r="3.3"/><path d="m7 15.2 3.2-6.5 3.1 6.5H7Zm3.2-6.5h4.5m-1.4 6.5L16 9.8m-7.2-3h3"/>`,
  },
  Dance: {
    concept: "dance step with music note and motion ribbon",
    body: `<path d="M14.2 5.2v8.2a2.2 2.2 0 1 1-1.2-2V6.8l5-1.3v6.4a2.2 2.2 0 1 1-1.2-2V4.2l-2.6 1Z"/><path d="M5.2 16.5c2.2-2 4.3-2 6.3 0M5.4 12.8c1.3-1 2.6-1 3.9 0"/>`,
  },
  EMS: {
    concept: "electrical muscle stimulation vest",
    body: `<path d="m8.3 5.2 2.1 1.3h3.2l2.1-1.3 2.1 3.1-2.1 1.3V18H8.3V9.6L6.2 8.3l2.1-3.1Z"/><path d="m12.8 8.2-2.2 3.6h2l-1.4 3.4 3.3-4.6h-2.1l.4-2.4Z"/>`,
  },
  "EMS Cardio": {
    concept: "heart pulse charged by EMS lightning",
    body: `<path d="M12 18s-6.5-3.8-6.5-8.1c0-3.5 4.5-4.8 6.5-1.6 2-3.2 6.5-1.9 6.5 1.6 0 4.3-6.5 8.1-6.5 8.1Z"/><path d="M5.8 12h3l1.3-2.4 2.2 5 1.4-2.6h4.5"/>`,
  },
  Fitness: {
    concept: "bold loaded barbell inside a circular marker",
    body: `<path d="M5.2 10v4M7.6 8.5v7M16.4 8.5v7M18.8 10v4M7.6 12h8.8" stroke-width="2.4"/>`,
  },
  Football: {
    concept: "classic football with pentagon panels",
    body: `<circle cx="12" cy="12" r="7"/><path d="m12 8.2 2.5 1.8-.9 3H10.4l-.9-3L12 8.2Zm0-3.2v3.2m6.7 1.7-4.2.1m2.3 6.6-3.2-3.6m-6.4 3.6 3.2-3.6M5.3 9.9l4.2.1"/>`,
  },
  "Free Fight": {
    concept: "raised fist breaking through a ring",
    body: `<circle cx="12" cy="12" r="7" stroke-dasharray="2 2"/><path d="M8.2 13V9.2c0-1.4 1.9-1.7 2.3-.4V7.5c0-1.4 2-1.4 2 0v1c.5-1.2 2.3-.8 2.3.5v.8c.7-1 2.2-.4 2.2.8v3.1c0 2.5-1.7 4.3-4.3 4.3-2.8 0-4.5-1.9-4.5-5Z"/>`,
  },
  "Functional Training": {
    concept: "medicine ball moving through agility markers",
    body: `<circle cx="9" cy="10" r="3.5"/><path d="M6.6 7.5 11.4 12.5M11.4 7.5 6.6 12.5M14.5 7h4M14.5 11h3M14.5 15h4M6 17h6"/>`,
  },
  "Game of Golf": {
    concept: "golf flag, green and resting ball",
    body: `<path d="M9 5v12M9 5l6 2.2L9 9.4M5 17c4-2 9-2 14 0"/><circle cx="15.8" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>`,
  },
  "Golf Driving Range": {
    concept: "teed golf ball with a long flight arc",
    body: `<circle cx="7.2" cy="15.2" r="1.5"/><path d="M7.2 16.7V19M4.8 19h4.8M9 13c3.5-5.4 6.6-7.5 10-6.4M16.7 4.8 19 6.6l-2.8 1"/>`,
  },
  Hiking: {
    concept: "mountain trail ending at a summit marker",
    body: `<path d="m4.5 18 5.2-9 2.2 3 2.4-4.2 5.2 10.2h-15Z"/><path d="M8.2 18c1.1-2.8 2.8-4.3 5.2-4.6M14.3 7.8V4.5m0 0 3 1.2-3 1.2"/>`,
  },
  Hyrox: {
    concept: "athlete driving a weighted sled",
    body: `<path d="M5 17h14M7 17V9h4v8m0-5h5l2 5M6.5 7.3 10 9m-3.5-1.7-1.8 3.2"/><circle cx="6.5" cy="5.7" r="1.3" fill="currentColor" stroke="none"/>`,
  },
  "Ice Skating": {
    concept: "figure skate boot and blade",
    body: `<path d="M8 5.2h5.2v6.2c0 1.4 1.1 2.3 2.5 2.3h2.1v3.1H6.2v-2.5H8V5.2Z"/><path d="M6.2 18.5h9.5c1.2 0 2-.5 2.5-1.7M10 7.5h3.2M10 10h3.2"/>`,
  },
  "Indoor Cycling": {
    concept: "stationary spin bike",
    body: `<circle cx="10" cy="14" r="4.2"/><path d="m10 14 3.4-5h3.8M13.4 9l1.9 5H10M7 18.2h8M8.2 7.2h3M16.8 8.8l1.2-2"/><circle cx="16" cy="14" r="1.2"/>`,
  },
  Massage: {
    concept: "hand applying pressure to massage points",
    body: `<path d="M5.2 15.5c2-1.5 3.2-3.5 3.7-6 .2-1.1 1.8-1.1 2 0l.2 1.5.7-4.3c.2-1.2 1.9-1 1.9.2v3.6l.8-2.4c.4-1.1 2-.6 1.7.5l-.8 3.5 1.2-1.5c.8-1 2.3.1 1.5 1.2l-3.3 4.4c-.9 1.2-2.2 1.8-3.7 1.8H8c-1.2 0-2.2-.9-2.8-2.5Z"/><circle cx="8" cy="7" r="1" fill="currentColor" stroke="none"/>`,
  },
  Meditation: {
    concept: "calm lotus with centered breath point",
    body: `<path d="M12 17.8c-4.5 0-7.2-2.2-7.2-5.8 3.5-.3 5.8 1 7.2 3.8 1.4-2.8 3.7-4.1 7.2-3.8 0 3.6-2.7 5.8-7.2 5.8Z"/><path d="M12 15.8c-2.7-2.3-2.7-5.2 0-8.6 2.7 3.4 2.7 6.3 0 8.6Z"/><circle cx="12" cy="5" r="1" fill="currentColor" stroke="none"/>`,
  },
  "Mixed Martial Arts": {
    concept: "crossed combat gloves inside an octagon",
    body: `<path d="m8 4.8 8 0 3.2 3.2v8L16 19.2H8L4.8 16V8L8 4.8Z"/><path d="m8 9.2 3.2 3.2-2.7 2.7-3.2-3.2L8 9.2Zm8 0-3.2 3.2 2.7 2.7 3.2-3.2L16 9.2Z"/>`,
  },
  "Modern Self Defense": {
    concept: "open defensive hand in front of a shield",
    body: `<path d="M12 4.2 18 6v5.1c0 3.7-2 6.3-6 8.1-4-1.8-6-4.4-6-8.1V6l6-1.8Z"/><path d="M8.3 13.5V9.8c0-1.1 1.5-1.2 1.7-.2V8.3c0-1.1 1.6-1.1 1.6 0v1c.3-.9 1.7-.7 1.7.3v.7c.5-.7 1.7-.3 1.7.7v2c0 2.2-1.4 3.5-3.4 3.5-2.1 0-3.3-1.1-3.3-3Z"/>`,
  },
  Padel: {
    concept: "perforated padel racket and ball",
    body: `<path d="M14.8 5.3c3.1 2.5 2.7 7.3-.8 9.4-2.8 1.7-6.3.9-7.8-1.8-1.6-2.9-.4-6.4 2.4-8 2.1-1.2 4.5-.9 6.2.4Z"/><path d="m8.2 14.5-3.4 4"/><circle cx="10" cy="8" r=".7" fill="currentColor" stroke="none"/><circle cx="13" cy="8" r=".7" fill="currentColor" stroke="none"/><circle cx="11.5" cy="11" r=".7" fill="currentColor" stroke="none"/><circle cx="18.5" cy="5.5" r="1.2"/>`,
  },
  "Personal Training": {
    concept: "coach whistle beside an athlete target",
    body: `<path d="m6 7 5.5 3.2-2.7 4.6-2.3-1.3c-1.8-1-2.4-3.2-1.4-5L6 7Zm5.5 3.2 3-1.7"/><circle cx="16" cy="14" r="3.5"/><path d="M16 12.2v3.6m-1.8-1.8h3.6"/>`,
  },
  Pilates: {
    concept: "controlled shoulder bridge on a mat",
    body: `<path d="M4.5 18h15M6.2 15.5c1.4-4 3.3-6 5.8-6 2.2 0 3.7 1.2 5.8 4.5M9 15.5h8.8"/><circle cx="6.5" cy="14.4" r="1.2" fill="currentColor" stroke="none"/>`,
  },
  "Pilates Reformer": {
    concept: "reformer carriage with shoulder blocks and straps",
    body: `<path d="M4.5 15.5h15M6 15.5V18m12-2.5V18M7 12h7.5v3.5H7zM14.5 12l3-4m0 0 1.8 1.3M8 12V9.5M10 12V9.5"/>`,
  },
  "Pole Dance": {
    concept: "dancer arcing around a vertical pole",
    body: `<path d="M13 3v18M11 7.2c-2.3.5-3.7 2-4.2 4.5m4.2-4.5c2.2 1.3 3.7 3.3 4.5 6m-8.7-1.5 4.7 1.8m4-0.3-4.2 3.8"/><circle cx="10.8" cy="5.4" r="1.2" fill="currentColor" stroke="none"/>`,
  },
  "Qi Gong and Tai Chi": {
    concept: "two balanced flowing energy spirals",
    body: `<circle cx="12" cy="12" r="7"/><path d="M12 5c3.8 2.3 3.8 5.3 0 7s-3.8 4.7 0 7"/><circle cx="12" cy="8.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="15.5" r="1" fill="none"/>`,
  },
  Relaxation: {
    concept: "crescent moon with a soft sparkle",
    body: `<path d="M15.5 17.2A6.8 6.8 0 0 1 9.2 5.3a6.8 6.8 0 1 0 6.3 11.9Z"/><path d="M16.8 5.2v3m-1.5-1.5h3M18.5 10v2m-1-1h2"/>`,
  },
  Running: {
    concept: "winged running shoe",
    body: `<path d="M6 13.2c2.8.2 4.7-1 5.8-3.8l2.3 3.2c.7 1 1.8 1.6 3 1.7l1.9.2v2.8H6c-1.3 0-2-.8-2-1.8 0-1.1.8-2.1 2-2.3Z"/><path d="M6.8 10.8H3.5m4.5-2H5m8.1 4.8-2.2 1.2m3.8-.5-2.1 1.2"/>`,
  },
  Sauna: {
    concept: "wooden sauna bench with rising heat waves",
    body: `<path d="M5 13h14v4H5zM7 17v2m10-2v2M6.5 10h11"/><path d="M8 8.5c-1.2-1.5 1.2-2.2 0-3.8m4 3.8c-1.2-1.5 1.2-2.2 0-3.8m4 3.8c-1.2-1.5 1.2-2.2 0-3.8"/>`,
  },
  Spa: {
    concept: "lotus floating among spa bubbles",
    body: `<path d="M12 17c-3.8 0-6.3-1.7-7-4.8 3-.4 5.4.5 7 2.8 1.6-2.3 4-3.2 7-2.8-.7 3.1-3.2 4.8-7 4.8Z"/><path d="M12 15c-2-2-2-4.4 0-7 2 2.6 2 5 0 7Z"/><circle cx="6.5" cy="7" r="1.2"/><circle cx="17.5" cy="6" r="1.5"/>`,
  },
  Squash: {
    concept: "squash racket sending a ball into a wall corner",
    body: `<path d="M18.5 5v14H5M14.5 7.5c2.4 2.4 1.8 6.5-1.2 8.1-2.1 1.1-4.8.5-6.2-1.4-1.6-2.3-.8-5.5 1.6-7 1.9-1.1 4.2-.9 5.8.3Z"/><path d="m8.2 15.7-3 3"/><circle cx="17.2" cy="10" r="1" fill="currentColor" stroke="none"/>`,
  },
  "Stand Up Paddling": {
    concept: "standing paddler on a long board",
    body: `<path d="M4 17h16M8 19h8M12 7v7m0-5-3 3m3-3 3 2M16.5 5l-3 10.5"/><circle cx="12" cy="5" r="1.3" fill="currentColor" stroke="none"/><path d="m16.5 5 1.2-1.5m-4.2 12 1.1 2"/>`,
  },
  Swimming: {
    concept: "swim goggles above lane waves",
    body: `<circle cx="9" cy="10" r="2.5"/><circle cx="15" cy="10" r="2.5"/><path d="M11.5 10h1M6.5 9 5 7.5m12.5 1L19 7.5M5 16c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 4.5 0"/>`,
  },
  "Table Tennis": {
    concept: "table tennis paddle striking a small ball",
    body: `<circle cx="10" cy="10" r="4.5"/><path d="m7 13.4-2.8 4.2 2.2 1.4 2.8-4.4"/><circle cx="17.5" cy="7" r="1.5" fill="currentColor" stroke="none"/><path d="M14.5 8.5 16 7.7"/>`,
  },
  Tennis: {
    concept: "strung tennis racket and ball",
    body: `<ellipse cx="11" cy="9.5" rx="4.5" ry="5.5" transform="rotate(35 11 9.5)"/><path d="m8.2 14-3 4M8 7.5l5.8 4m-7.4-1.3 5-5.2m-1.2 9.5 5-5.2"/><circle cx="18" cy="6" r="1.4" fill="currentColor" stroke="none"/>`,
  },
  "Traditional Asian Martial Arts": {
    concept: "martial arts gi jacket with tied belt",
    body: `<path d="m8 5 4 2 4-2 3 4-2.2 2V19H7.2v-8L5 9l3-4Z"/><path d="m9 6 3 5 3-5M7.2 13h9.6M10 13v2.5m4-2.5v2.5"/>`,
  },
  Trampoline: {
    concept: "airborne athlete above a trampoline bed",
    body: `<path d="M5 16c4.7 1.5 9.3 1.5 14 0M6 16v3m12-3v3M10.5 8.5 12 11l2.5-2.5M12 11v3"/><circle cx="10" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><path d="M7 8c.7-2.8 2.3-4.4 4.8-5"/>`,
  },
  "Vibration Training": {
    concept: "feet on a vibrating training platform",
    body: `<path d="M6 16h12l1 3H5l1-3ZM9 7v6m6-6v6M8 6h2m4 0h2"/><path d="M4.5 11c-1 1-1 2 0 3m15-3c1 1 1 2 0 3M3 9c-1.7 2.3-1.7 4.7 0 7m18-7c1.7 2.3 1.7 4.7 0 7"/>`,
  },
  Wellness: {
    concept: "heart cradled by a growing leaf",
    body: `<path d="M12 18s-6-3.5-6-7.3c0-3.1 4-4.2 6-1.4 2-2.8 6-1.7 6 1.4 0 3.8-6 7.3-6 7.3Z"/><path d="M12 13c.6-4.2 3-7 7-8-.3 3.8-2.7 6.2-7 7M12 13c-1.2-2.6-3-4.1-5.5-4.5"/>`,
  },
  Yoga: {
    concept: "balanced tree pose",
    body: `<circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"/><path d="M12 7v6m0-4-4-2m4 2 4-2m-4 6-3 5m3-5 3 5m-5.5-3.3L12 16l2.5-1.3"/>`,
  },
};

export const SPORT_STUDIO_GLYPH_NAMES = Object.freeze(Object.keys(SPORT_GLYPHS).sort());

function sportIconPalette(tag: string) {
  let hash = 0;
  for (const character of tag) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return SPORT_ICON_PALETTES[hash % SPORT_ICON_PALETTES.length]!;
}

export function makeSportStudioSvg(tag: string): string {
  const palette = sportIconPalette(tag);
  const glyph = SPORT_GLYPHS[tag];
  if (!glyph) {
    throw new Error(`Missing sport studio glyph for ${tag}`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="${tag}" data-shape="circle">
  <defs>
    <linearGradient id="liquid-bg" x1="2" y1="1" x2="22" y2="23" gradientUnits="userSpaceOnUse">
      <stop stop-color="${palette.start}"/>
      <stop offset="0.52" stop-color="${palette.middle}"/>
      <stop offset="1" stop-color="${palette.end}"/>
    </linearGradient>
    <radialGradient id="liquid-glow" cx="0" cy="0" r="1" gradientTransform="translate(7 5) rotate(52) scale(15)">
      <stop stop-color="#fff" stop-opacity="0.72"/>
      <stop offset="0.45" stop-color="#fff" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="glass-sheen" x1="5" y1="3" x2="18" y2="21" gradientUnits="userSpaceOnUse">
      <stop stop-color="#fff" stop-opacity="0.42"/>
      <stop offset="0.46" stop-color="#fff" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0.2"/>
    </linearGradient>
    <clipPath id="liquid-clip"><circle cx="12" cy="12" r="11.25"/></clipPath>
    <filter id="liquid-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="0.8" stdDeviation="0.8" flood-color="#07162d" flood-opacity="0.45"/>
    </filter>
    <filter id="symbol-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="0.6" stdDeviation="0.45" flood-color="#07162d" flood-opacity="0.62"/>
    </filter>
  </defs>
  <g filter="url(#liquid-shadow)">
    <circle cx="12" cy="12" r="11.25" fill="url(#liquid-bg)"/>
    <g clip-path="url(#liquid-clip)">
      <ellipse cx="4.5" cy="3.5" rx="12" ry="9" fill="url(#liquid-glow)"/>
      <path d="M-2 17c5-4 8-3 11-1s7 3 17-3v13H-2Z" fill="#fff" fill-opacity="0.12"/>
      <circle cx="20" cy="19" r="7" fill="${palette.accent}" fill-opacity="0.36"/>
    </g>
    <circle cx="12" cy="12" r="10.75" fill="none" stroke="#fff" stroke-opacity="0.55"/>
    <circle cx="12" cy="12" r="8.9" fill="url(#glass-sheen)" stroke="#fff" stroke-opacity="0.16" stroke-width="0.6"/>
    <path d="M5.2 5.2c2.8-2.1 8.4-2.5 12.5-0.4" stroke="#fff" stroke-opacity="0.5" stroke-width="1.1" stroke-linecap="round" fill="none"/>
  </g>
  <g data-concept="${glyph.concept}" color="#fff" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#symbol-shadow)">${glyph.body}</g>
</svg>`;
}
