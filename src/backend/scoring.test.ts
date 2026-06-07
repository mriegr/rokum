import { expect, test } from "bun:test";
import {
  calculatePricePerSqm,
  calculateTotalScore,
  combineCustomPoiScore,
  combineWalkAndTransitScore,
  DEFAULT_WEIGHTS,
  scorePricePerSqm,
  scoreRooms,
} from "./scoring";

test("calculatePricePerSqm derives warm rent per area", () => {
  expect(
    calculatePricePerSqm({
      address: "Test",
      squareMeters: 80,
      kaltmiete: 1400,
      warmmiete: 1600,
      floorLevel: "2",
      roomCount: 3,
      description: "",
    }),
  ).toBe(20);
});

test("walking and transit score favors short routes", () => {
  const score = combineWalkAndTransitScore(
    { distanceMeters: 350, durationMinutes: 5, source: "test" },
    { distanceMeters: 1000, durationMinutes: 11, source: "test" },
  );

  expect(score).toBeGreaterThan(7);
});

test("custom POI score emphasizes transit more heavily", () => {
  const score = combineCustomPoiScore(
    { distanceMeters: 3200, durationMinutes: 35, source: "test" },
    { distanceMeters: 9000, durationMinutes: 18, source: "test" },
  );

  expect(score).toBeGreaterThan(4);
});

test("price per sqm score penalizes expensive apartments", () => {
  expect(scorePricePerSqm(16)).toBeGreaterThan(scorePricePerSqm(29));
});

test("rooms score peaks close to three rooms", () => {
  expect(scoreRooms(3)).toBeGreaterThan(scoreRooms(1));
});

test("total score combines weighted criteria", () => {
  const total = calculateTotalScore(
    8,
    7,
    [
      {
        category: "supermarket",
        label: "Supermarket",
        poiName: "Shop",
        poiAddress: "",
        latitude: 1,
        longitude: 1,
        walking: { distanceMeters: 300, durationMinutes: 4, source: "test" },
        transit: { distanceMeters: 300, durationMinutes: 5, source: "test" },
        score: 8.5,
      },
    ],
    [],
    DEFAULT_WEIGHTS,
  );

  expect(total).toBeGreaterThan(7);
});
