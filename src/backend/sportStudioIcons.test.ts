import { expect, test } from "bun:test";
import { makeSportStudioSvg, SPORT_STUDIO_GLYPH_NAMES } from "./sportStudioIcons";

const EXPECTED_SUBCATEGORIES = [
  "Aerial",
  "Aqua",
  "Archery",
  "Badminton",
  "Barre",
  "Beach Volleyball",
  "Bootcamp",
  "Bouldering",
  "Boxing Sports",
  "Capoeira",
  "Climbing",
  "Crosstraining",
  "Cryotherapy",
  "Cycling",
  "Dance",
  "EMS",
  "EMS Cardio",
  "Fitness",
  "Football",
  "Free Fight",
  "Functional Training",
  "Game of Golf",
  "Golf Driving Range",
  "Hiking",
  "Hyrox",
  "Ice Skating",
  "Indoor Cycling",
  "Massage",
  "Meditation",
  "Mixed Martial Arts",
  "Modern Self Defense",
  "Padel",
  "Personal Training",
  "Pilates",
  "Pilates Reformer",
  "Pole Dance",
  "Qi Gong and Tai Chi",
  "Relaxation",
  "Running",
  "Sauna",
  "Spa",
  "Squash",
  "Stand Up Paddling",
  "Swimming",
  "Table Tennis",
  "Tennis",
  "Traditional Asian Martial Arts",
  "Trampoline",
  "Vibration Training",
  "Wellness",
  "Yoga",
].sort();

test("defines a fresh semantic glyph for every sport studio subcategory", () => {
  expect(SPORT_STUDIO_GLYPH_NAMES).toEqual(EXPECTED_SUBCATEGORIES);

  const concepts = EXPECTED_SUBCATEGORIES.map((name) => {
    const svg = makeSportStudioSvg(name);
    expect(svg).not.toContain("<text");
    expect(svg).toContain(`aria-label="${name}"`);
    return svg.match(/data-concept="([^"]+)"/)?.[1];
  });

  expect(concepts.every(Boolean)).toBe(true);
  expect(new Set(concepts).size).toBe(EXPECTED_SUBCATEGORIES.length);
});

test("rejects unknown subcategories instead of silently reusing a fallback glyph", () => {
  expect(() => makeSportStudioSvg("Unknown Sport")).toThrow(
    "Missing sport studio glyph for Unknown Sport",
  );
});

test("uses a circular map marker for every sport studio subcategory", () => {
  for (const subcategory of EXPECTED_SUBCATEGORIES) {
    const svg = makeSportStudioSvg(subcategory);
    expect(svg).toContain('data-shape="circle"');
    expect(svg).toContain('<clipPath id="liquid-clip"><circle');
    expect(svg).not.toContain('<rect x="0.75"');
  }

  const fitnessSvg = makeSportStudioSvg("Fitness");
  expect(fitnessSvg).toContain(
    'data-concept="bold loaded barbell inside a circular marker"',
  );
  expect(fitnessSvg).toContain('stroke-width="2.4"');
});
