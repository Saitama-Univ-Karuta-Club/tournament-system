// @ts-nocheck -- This one-off generator runs in Node, while the project typecheck targets Workers.
import { readFileSync, writeFileSync } from "node:fs";

const fontPath = process.argv[2];
const outputPath = process.argv[3];
if (!fontPath || !outputPath) {
  throw new Error("Usage: generate-general-font.ts <font.otf> <output.ts>");
}

const font = readFileSync(fontPath).toString("base64");
const output = `/*
 * Generated subset of Noto Sans JP, licensed under the SIL Open Font License 1.1.
 * Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name
 * "Source". Noto is a trademark of Google Inc.
 * Source: https://github.com/notofonts/noto-cjk
 * Coverage: ASCII, Japanese punctuation/kana, JIS X 0208 level-1 kanji,
 * and selected common name variants.
 */
const REGULAR = "${font}";

function decode(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

let fonts: Uint8Array[] | undefined;
export function getGeneralFonts(): Uint8Array[] {
  fonts ??= [decode(REGULAR)];
  return fonts;
}
`;
writeFileSync(outputPath, output);
console.log(`Generated general font module at ${outputPath}`);
