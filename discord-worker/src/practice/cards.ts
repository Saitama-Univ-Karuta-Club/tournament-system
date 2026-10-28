export type CardScheme =
  | "number_ones"
  | "number_tens"
  | "hiragana"
  | "katakana"
  | "kanji"
  | "alphabet";

export interface CardSelection {
  scheme: CardScheme;
  labels: string[];
  cardNumbers: number[] | null;
}

export const CARD_SCHEME_LABELS: Record<CardScheme, string> = {
  number_ones: "札番号の1の位",
  number_tens: "札番号の10の位",
  hiragana: "ひらがな",
  katakana: "カタカナ",
  kanji: "漢数字",
  alphabet: "アルファベット",
};

const CARD_LABELS: Record<CardScheme, string[]> = {
  number_ones: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  number_tens: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  hiragana: ["あ", "い", "う", "え", "お", "か", "き", "く", "け", "こ"],
  katakana: ["サ", "シ", "ス", "セ", "ソ", "タ", "チ", "ツ", "テ", "ト"],
  kanji: ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"],
  alphabet: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
};

function seedToUint32(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed: string): () => number {
  let state = seedToUint32(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function drawCardSelection(scheme: CardScheme, seed: string): CardSelection {
  const labels = shuffled(CARD_LABELS[scheme], seededRandom(seed)).slice(0, 5)
    .sort((left, right) => CARD_LABELS[scheme].indexOf(left) - CARD_LABELS[scheme].indexOf(right));
  return { scheme, labels, cardNumbers: cardNumbersForSelection(scheme, labels) };
}

export function cardNumbersForSelection(
  scheme: CardScheme,
  labels: readonly string[],
): number[] | null {
  const selected = new Set(labels.map(Number));
  return scheme === "number_ones"
    ? Array.from({ length: 100 }, (_, index) => index + 1)
      .filter((number) => selected.has(number % 10))
    : scheme === "number_tens"
      ? Array.from({ length: 100 }, (_, index) => index + 1)
        .filter((number) => selected.has(Math.floor(number / 10) % 10))
      : null;
}

export function isCardScheme(value: unknown): value is CardScheme {
  return typeof value === "string" && value in CARD_SCHEME_LABELS;
}
