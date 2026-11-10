import { Resvg } from "@cf-wasm/resvg";
import { getGeneralFonts } from "../general/font.generated";
import {
  DEFAULT_PRACTICE_SCHEDULE_SETTINGS,
  type PracticeScheduleSettings,
} from "./schedule-settings";

export interface PracticeCalendarSchedule {
  practice_date: string;
  start_time: string | null;
  end_time?: string | null;
  title?: string;
  location?: string | null;
  note?: string | null;
}

const COLORS = {
  page: "#ffffff",
  ink: "#353430",
  muted: "#aeb1aa",
  green: "#668437",
  coral: "#c74d43",
  stripe: "#f7f8f4",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]!);
}

function monthKeys(schedules: PracticeCalendarSchedule[]): string[] {
  return [...new Set(schedules.map((schedule) => schedule.practice_date.slice(0, 7)))].sort();
}

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function practiceCalendarTimeLabel(
  schedule: PracticeCalendarSchedule,
  settings: PracticeScheduleSettings = DEFAULT_PRACTICE_SCHEDULE_SETTINGS,
): string {
  if (!schedule.start_time) return "時間未定";
  const endTime = schedule.end_time ?? schedule.start_time;
  const exactLabels = new Map([
    [`${settings.morningStartTime}-${settings.morningEndTime}`, "午前"],
    [`${settings.afternoonStartTime}-${settings.afternoonEndTime}`, "午後"],
    [`${settings.eveningStartTime}-${settings.eveningEndTime}`, "夜間"],
    [`${settings.morningStartTime}-${settings.afternoonEndTime}`, "午前・午後"],
    [`${settings.afternoonStartTime}-${settings.eveningEndTime}`, "午後・夜間"],
    [`${settings.morningStartTime}-${settings.eveningEndTime}`, "全日"],
  ]);
  const exact = exactLabels.get(`${schedule.start_time}-${endTime}`);
  if (exact) return exact;
  const start = timeMinutes(schedule.start_time);
  const end = timeMinutes(endTime);
  const afternoonStart = timeMinutes(settings.afternoonStartTime);
  const eveningStart = timeMinutes(settings.eveningStartTime);
  const startsInMorning = start < afternoonStart;
  const reachesAfternoon = end > afternoonStart;
  const reachesNight = end > eveningStart;
  if (startsInMorning) {
    if (reachesNight) return "全日";
    return reachesAfternoon ? "午前・午後" : "午前";
  }
  if (start < eveningStart) return reachesNight ? "午後・夜間" : "午後";
  return "夜間";
}

function truncateCalendarLine(value: string, maxLength = 7): string {
  const characters = [...value.trim()];
  return characters.length <= maxLength
    ? characters.join("")
    : `${characters.slice(0, maxLength - 1).join("")}…`;
}

function venueLabel(schedule: PracticeCalendarSchedule, settings: PracticeScheduleSettings): string {
  const location = schedule.location?.trim() ?? "";
  const configured = settings.venues.find((venue) => venue.name === location);
  if (configured) return configured.shortName;
  return location ? truncateCalendarLine(location) : "会場未定";
}

export function practiceCalendarNoteLines(note?: string | null): string[] {
  const normalized = (note ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const characters = [...normalized];
  const displayed = characters.length > 14
    ? [...characters.slice(0, 13), "…"]
    : characters.slice(0, 14);
  return [displayed.slice(0, 7).join(""), displayed.slice(7, 14).join("")].filter(Boolean);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function text(
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  options: { anchor?: "start" | "middle"; weight?: 400 | 700; extra?: string } = {},
): string {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${options.weight ?? 400}" text-anchor="${options.anchor ?? "start"}"${options.extra ? ` ${options.extra}` : ""}>${escapeXml(value)}</text>`;
}

function drawMonthSvg(
  key: string,
  schedules: PracticeCalendarSchedule[],
  x: number,
  y: number,
  width: number,
  height: number,
  columns: number,
  clipStart: number,
  settings: PracticeScheduleSettings,
): { markup: string; nextClip: number } {
  const [year, month] = key.split("-").map(Number);
  const compact = columns > 1;
  const padding = compact ? 22 : 42;
  const titleSize = compact ? 34 : 58;
  const weekdaySize = compact ? 13 : 18;
  const daySize = compact ? 15 : 20;
  const titleY = y + (compact ? 46 : 78);
  const parts: string[] = [text(`${month}月${year}`, x + padding, titleY, titleSize, COLORS.green, { weight: 400 })];

  const weekdayY = titleY + (compact ? 42 : 64);
  const gridX = x + padding;
  const gridWidth = width - padding * 2;
  const cellWidth = gridWidth / 7;
  ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"].forEach((weekday, index) => {
    parts.push(text(
      weekday,
      gridX + cellWidth * (index + 0.5),
      weekdayY,
      weekdaySize,
      COLORS.green,
      { anchor: "middle", weight: 400 },
    ));
  });
  const lineY = weekdayY + (compact ? 10 : 14);
  parts.push(`<rect x="${gridX}" y="${lineY}" width="${gridWidth}" height="${compact ? 2 : 3}" fill="${COLORS.green}"/>`);

  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const currentDays = daysInMonth(year, month);
  const previousDays = daysInMonth(year, month - 1);
  const weeks = Math.ceil((firstWeekday + currentDays) / 7);
  const memoHeight = compact ? 70 : 112;
  const gridY = lineY + 5;
  const availableHeight = height - (gridY - y) - memoHeight - (compact ? 12 : 22);
  const rowHeight = availableHeight / weeks;
  const events = new Map<number, PracticeCalendarSchedule[]>();
  schedules.filter((schedule) => schedule.practice_date.startsWith(`${key}-`)).forEach((schedule) => {
    const day = Number(schedule.practice_date.slice(8, 10));
    events.set(day, [...(events.get(day) ?? []), schedule]);
  });

  let clipIndex = clipStart;
  for (let week = 0; week < weeks; week += 1) {
    const rowY = gridY + week * rowHeight;
    if (week % 2 === 1) {
      parts.push(`<rect x="${gridX}" y="${rowY}" width="${gridWidth}" height="${rowHeight}" fill="${COLORS.stripe}"/>`);
    }
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const cell = week * 7 + weekday;
      const day = cell - firstWeekday + 1;
      const cellX = gridX + weekday * cellWidth;
      let shownDay = day;
      let muted = false;
      if (day <= 0) {
        shownDay = previousDays + day;
        muted = true;
      } else if (day > currentDays) {
        shownDay = day - currentDays;
        muted = true;
      }
      const dayEvents = !muted ? events.get(day) : undefined;
      if (dayEvents?.length) {
        const clipId = `cell-${clipIndex}`;
        clipIndex += 1;
        const contentX = cellX + (compact ? 6 : 10);
        const roomyCell = !compact && rowHeight >= 135;
        const headerY = rowY + (compact ? 17 : roomyCell ? 26 : 22);
        const venueY = rowY + (compact ? 35 : roomyCell ? 60 : 53);
        const noteFirstY = rowY + (compact ? 51 : roomyCell ? 94 : 80);
        const noteSecondY = rowY + (compact ? 67 : roomyCell ? 123 : 107);
        const venueSize = compact ? 17 : 28;
        const noteSize = compact ? 13 : 23;
        parts.push(`<clipPath id="${clipId}"><rect x="${cellX + 2}" y="${rowY + 2}" width="${cellWidth - 4}" height="${rowHeight - 4}"/></clipPath>`);
        const labels = [...new Set(dayEvents.map((event) => practiceCalendarTimeLabel(event, settings)))].join("・");
        const noteLines = practiceCalendarNoteLines(dayEvents[0].note);
        parts.push(`<g clip-path="url(#${clipId})">`);
        parts.push(text(`${shownDay}日 ${labels}`, contentX, headerY, daySize, COLORS.ink, { weight: 700 }));
        parts.push(text(venueLabel(dayEvents[0], settings), contentX, venueY, venueSize, COLORS.coral, { weight: 700 }));
        if (noteLines[0]) parts.push(text(noteLines[0], contentX, noteFirstY, noteSize, COLORS.ink));
        if (noteLines[1]) parts.push(text(noteLines[1], contentX, noteSecondY, noteSize, COLORS.ink));
        parts.push("</g>");
      } else {
        parts.push(text(
          String(shownDay),
          cellX + (compact ? 6 : 10),
          rowY + (compact ? 16 : 22),
          daySize,
          muted ? COLORS.muted : COLORS.ink,
        ));
      }
    }
  }

  const memoY = gridY + weeks * rowHeight;
  parts.push(`<rect x="${gridX}" y="${memoY}" width="${gridWidth}" height="${memoHeight}" fill="${COLORS.stripe}"/>`);
  parts.push(text("メモ", gridX + gridWidth / 3, memoY + (compact ? 24 : 34), weekdaySize, COLORS.ink, { anchor: "middle", weight: 700 }));
  return { markup: parts.join(""), nextClip: clipIndex };
}

export function buildPracticeScheduleCalendarSvg(
  schedules: PracticeCalendarSchedule[],
  settings: PracticeScheduleSettings = DEFAULT_PRACTICE_SCHEDULE_SETTINGS,
): string {
  if (!schedules.length) throw new Error("カレンダーに表示する練習日程がありません。");
  const months = monthKeys(schedules);
  const columns = months.length <= 2 ? 1 : months.length <= 8 ? 2 : 3;
  const rows = Math.ceil(months.length / columns);
  const width = 1600;
  const margin = 34;
  const gap = 24;
  const tileWidth = (width - margin * 2 - gap * (columns - 1)) / columns;
  const tileHeight = columns === 1 ? 1020 : columns === 2 ? 650 : 500;
  const height = margin * 2 + rows * tileHeight + (rows - 1) * gap;
  const parts: string[] = [];
  let clipIndex = 0;
  months.forEach((key, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const month = drawMonthSvg(
      key,
      schedules,
      margin + column * (tileWidth + gap),
      margin + row * (tileHeight + gap),
      tileWidth,
      tileHeight,
      columns,
      clipIndex,
      settings,
    );
    parts.push(month.markup);
    clipIndex = month.nextClip;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${COLORS.page}"/><g font-family="Noto Sans JP, sans-serif">${parts.join("")}</g></svg>`;
}

export async function generatePracticeScheduleCalendarPng(
  schedules: PracticeCalendarSchedule[],
  settings: PracticeScheduleSettings = DEFAULT_PRACTICE_SCHEDULE_SETTINGS,
): Promise<Uint8Array> {
  const renderer = await Resvg.async(buildPracticeScheduleCalendarSvg(schedules, settings), {
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
