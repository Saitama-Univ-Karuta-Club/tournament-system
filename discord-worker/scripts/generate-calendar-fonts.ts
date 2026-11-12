// @ts-nocheck -- This one-off generator runs in Node, while the project typecheck targets Workers.
import { readFileSync, writeFileSync } from "node:fs";

const regularPath = process.argv[2];
const boldPath = process.argv[3];
const outputPath = process.argv[4];
if (!regularPath || !boldPath || !outputPath) {
  throw new Error("Usage: generate-calendar-fonts.ts <regular.ttf> <bold.ttf> <output.ts>");
}

const regular = readFileSync(regularPath).toString("base64");
const bold = readFileSync(boldPath).toString("base64");
const output = `/*
 * Generated subsets of Noto Sans JP, licensed under the SIL Open Font License 1.1.
 * Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name
 * "Source". Noto is a trademark of Google Inc.
 * Source: https://fonts.google.com/noto/specimen/Noto+Sans+JP
 */
const REGULAR = "${regular}";
const BOLD = "${bold}";

function decode(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

let fonts: Uint8Array[] | undefined;
export function getCalendarFonts(): Uint8Array[] {
  fonts ??= [decode(REGULAR), decode(BOLD)];
  return fonts;
}
`;
writeFileSync(outputPath, output);
console.log(`Generated calendar font module at ${outputPath}`);
