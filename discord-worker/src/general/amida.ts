import { Resvg } from "@cf-wasm/resvg";
import { getGeneralFonts } from "./font.generated";

const MIN_COLUMNS = 2;

export interface AmidaAssignment {
  participant: string;
  destination: string;
  topIndex: number;
  bottomIndex: number;
}

export interface AmidaDraw {
  title: string;
  participants: string[];
  destinations: string[];
  rungs: number[];
  rungLevels: number[][];
  assignments: AmidaAssignment[];
}

type RandomSource = () => number;

function secureRandom(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}

function randomIndex(length: number, random: RandomSource): number {
  if (length <= 1) return 0;
  const value = random();
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(value, 0.9999999999999999)) : 0;
  return Math.floor(normalized * length);
}

function shuffle<T>(values: T[], random: RandomSource): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomIndex(index + 1, random);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function normalizeEntry(value: string): string {
  return value
    .trim()
    .replace(/^(?:[-*・]\s*|\d+[.)、]\s*)/, "")
    .trim();
}

export function parseAmidaEntries(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(normalizeEntry)
    .filter(Boolean);
}

function validateEntries(participants: string[], destinations: string[]): void {
  if (participants.length !== destinations.length) {
    throw new Error("参加者と行き先の数を同じにしてください。");
  }
  if (participants.length < MIN_COLUMNS || destinations.length < MIN_COLUMNS) {
    throw new Error("参加者と行き先を、それぞれ2件以上入力してください。");
  }
  if (new Set(participants).size !== participants.length) {
    throw new Error("参加者に同じ名前が複数あります。");
  }
  if (new Set(destinations).size !== destinations.length) {
    throw new Error("行き先に同じ項目が複数あります。");
  }
  if ([...participants, ...destinations].some((entry) => entry.length > 40)) {
    throw new Error("参加者名と行き先は、1件40文字以内にしてください。");
  }
}

function buildRungLevels(
  columnCount: number,
  targetBottomTokens: number[],
  random: RandomSource,
): number[][] {
  const currentTokens = Array.from({ length: columnCount }, (_, index) => index);
  const targetPosition = new Map(
    targetBottomTokens.map((token, index) => [token, index]),
  );
  const levels: number[][] = [];

  for (let phase = 0; phase < columnCount; phase += 1) {
    const level: number[] = [];
    for (let rung = phase % 2; rung + 1 < columnCount; rung += 2) {
      const leftTarget = targetPosition.get(currentTokens[rung]) ?? 0;
      const rightTarget = targetPosition.get(currentTokens[rung + 1]) ?? 0;
      if (leftTarget > rightTarget) {
        [currentTokens[rung], currentTokens[rung + 1]] = [
          currentTokens[rung + 1],
          currentTokens[rung],
        ];
        level.push(rung);
      }
    }
    if (level.length > 0) levels.push(level);
  }

  while (levels.length < 6) {
    const rung = randomIndex(columnCount - 1, random);
    const insertion = randomIndex(levels.length + 1, random);
    levels.splice(insertion, 0, [rung], [rung]);
  }
  return levels;
}

function assignmentsFromRungs(
  participants: string[],
  destinations: string[],
  rungs: number[],
): AmidaAssignment[] {
  const bottomTokens = participants.map((_, index) => index);
  for (const rung of rungs) {
    [bottomTokens[rung], bottomTokens[rung + 1]] = [bottomTokens[rung + 1], bottomTokens[rung]];
  }
  const bottomByTop = new Array<number>(participants.length);
  bottomTokens.forEach((topIndex, bottomIndex) => {
    bottomByTop[topIndex] = bottomIndex;
  });
  return participants.map((participant, topIndex) => ({
    participant,
    destination: destinations[bottomByTop[topIndex]],
    topIndex,
    bottomIndex: bottomByTop[topIndex],
  }));
}

export function createAmidaDraw(
  participants: string[],
  destinations: string[],
  title = "あみだくじ",
  random: RandomSource = secureRandom,
): AmidaDraw {
  const normalizedParticipants = participants.map(normalizeEntry).filter(Boolean);
  const normalizedDestinations = destinations.map(normalizeEntry).filter(Boolean);
  validateEntries(normalizedParticipants, normalizedDestinations);
  const targetBottomTokens = shuffle(
    normalizedParticipants.map((_, index) => index),
    random,
  );
  const rungLevels = buildRungLevels(
    normalizedParticipants.length,
    targetBottomTokens,
    random,
  );
  const rungs = rungLevels.flat();
  return {
    title: title.trim().slice(0, 80) || "あみだくじ",
    participants: normalizedParticipants,
    destinations: normalizedDestinations,
    rungs,
    rungLevels,
    assignments: assignmentsFromRungs(normalizedParticipants, normalizedDestinations, rungs),
  };
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]!);
}

function shorten(value: string, maximum: number): string {
  const characters = [...value];
  return characters.length <= maximum ? value : `${characters.slice(0, maximum - 1).join("")}…`;
}

export function buildAmidaSvg(draw: AmidaDraw): string {
  const columnCount = draw.participants.length;
  const preferredSpacing = columnCount <= 12 ? 110 : columnCount <= 30 ? 76 : 58;
  const width = Math.max(900, 180 + (columnCount - 1) * preferredSpacing);
  const height = 680;
  const left = 90;
  const right = width - 90;
  const top = 220;
  const bottom = 510;
  const gap = columnCount === 1 ? 0 : (right - left) / (columnCount - 1);
  const x = (index: number) => left + index * gap;
  const rungGap = (bottom - top) / (draw.rungLevels.length + 1);
  const parts: string[] = [
    `<rect width="${width}" height="${height}" rx="30" fill="#f8f5ec"/>`,
    `<text x="${width / 2}" y="42" text-anchor="middle" font-size="28" font-weight="700" fill="#24352b">${escapeXml(shorten(draw.title, 30))}</text>`,
    `<text x="${width / 2}" y="76" text-anchor="middle" font-size="18" font-weight="700" fill="#668437">スタート</text>`,
  ];

  draw.participants.forEach((participant, index) => {
    const tspans = [...shorten(participant, 7)].map((character, characterIndex) => (
      `<tspan x="${x(index)}" dy="${characterIndex === 0 ? 0 : 18}">${escapeXml(character)}</tspan>`
    )).join("");
    parts.push(`<text x="${x(index)}" y="98" text-anchor="middle" font-size="17" font-weight="700" fill="#24352b">${tspans}</text>`);
    parts.push(`<circle cx="${x(index)}" cy="${top}" r="8" fill="#668437"/>`);
    parts.push(`<line x1="${x(index)}" y1="${top}" x2="${x(index)}" y2="${bottom}" stroke="#3e4741" stroke-width="5" stroke-linecap="round"/>`);
  });

  draw.rungLevels.forEach((level, levelIndex) => {
    const y = top + rungGap * (levelIndex + 1);
    level.forEach((rung) => {
      parts.push(`<line x1="${x(rung)}" y1="${y}" x2="${x(rung + 1)}" y2="${y}" stroke="#668437" stroke-width="6" stroke-linecap="round"/>`);
    });
  });

  draw.destinations.forEach((destination, index) => {
    parts.push(`<circle cx="${x(index)}" cy="${bottom}" r="8" fill="#c74d43"/>`);
    const numeric = /^\d+$/.test(destination);
    const fontSize = numeric ? 30 : 18;
    const maximum = numeric ? 6 : Math.max(2, Math.floor(gap / 18));
    parts.push(`<text x="${x(index)}" y="558" text-anchor="middle" font-size="${fontSize}" font-weight="700" fill="#24352b">${escapeXml(shorten(destination, maximum))}</text>`);
  });

  parts.push(`<text x="${width / 2}" y="612" text-anchor="middle" font-size="18" font-weight="700" fill="#c74d43">ゴール</text>`);
  parts.push(`<text x="${width / 2}" y="650" text-anchor="middle" font-size="16" fill="#6f7772">裏方bot</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g font-family="Noto Sans JP, sans-serif">${parts.join("")}</g></svg>`;
}

export async function generateAmidaPng(draw: AmidaDraw): Promise<Uint8Array> {
  const renderer = await Resvg.async(buildAmidaSvg(draw), {
    font: {
      fontBuffers: getGeneralFonts(),
      defaultFontFamily: "Noto Sans JP",
      sansSerifFamily: "Noto Sans JP",
    },
    shapeRendering: 2,
    textRendering: 1,
  });
  const rendered = renderer.render();
  const png = rendered.asPng().slice();
  rendered.free();
  renderer.free();
  return png;
}

export function formatAmidaAssignments(draw: AmidaDraw): string {
  return draw.assignments
    .map((assignment, index) => `${index + 1}. ${assignment.participant} → **${assignment.destination}**`)
    .join("\n");
}
