import { describe, expect, it } from "vitest";
import { drawCardSelection } from "../src/practice/cards";

describe("practice card selection", () => {
  it("draws five stable, unique labels", () => {
    const first = drawCardSelection("hiragana", "session-1");
    const second = drawCardSelection("hiragana", "session-1");

    expect(first).toEqual(second);
    expect(first.labels).toHaveLength(5);
    expect(new Set(first.labels)).toHaveLength(5);
    expect(first.cardNumbers).toBeNull();
  });

  it("selects exactly fifty cards by the ones digit", () => {
    const result = drawCardSelection("number_ones", "session-2");

    expect(result.labels).toHaveLength(5);
    expect(result.cardNumbers).toHaveLength(50);
    expect(result.cardNumbers?.every((number) => result.labels.includes(String(number % 10))))
      .toBe(true);
  });

  it("selects exactly fifty cards by the tens digit including card 100 as digit zero", () => {
    const result = drawCardSelection("number_tens", "session-3");

    expect(result.cardNumbers).toHaveLength(50);
    expect(result.cardNumbers?.every((number) =>
      result.labels.includes(String(Math.floor(number / 10) % 10))
    )).toBe(true);
  });
});
