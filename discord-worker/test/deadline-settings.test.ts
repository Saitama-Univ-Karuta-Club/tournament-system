import { describe, expect, it, vi } from "vitest";
import {
  DeadlineAutomationSettingError,
  getDeadlineAutomationSettings,
  resetDeadlineAutomationSettings,
  saveDeadlineAutomationSettings,
} from "../src/deadline-settings";

describe("deadline automation settings", () => {
  it("uses the established deadlines when no custom settings are saved", async () => {
    const first = vi.fn().mockResolvedValue(null);
    const prepare = vi.fn().mockReturnValue({ first });

    await expect(
      getDeadlineAutomationSettings({ prepare } as unknown as D1Database),
    ).resolves.toMatchObject({
      internalDeadlineDaysBefore: 3,
      internalDeadlineTimeMode: "custom",
      internalDeadlineTime: "23:59",
      organizerPaymentDaysBefore: 2,
      organizerPaymentTimeMode: "custom",
      organizerPaymentTime: "23:59",
      paymentDeadlineDaysBefore: 1,
      paymentDeadlineTimeMode: "custom",
      paymentDeadlineTime: "23:59",
      responseReminderDaysBefore: 2,
      responseReminderTimeMode: "custom",
      responseReminderTime: "00:00",
      customized: false,
    });
  });

  it("validates and saves custom deadline rules", async () => {
    const run = vi.fn().mockResolvedValue({});
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const input = {
      internalDeadlineDaysBefore: 4,
      internalDeadlineTimeMode: "same",
      internalDeadlineTime: "20:15",
      organizerPaymentDaysBefore: 3,
      organizerPaymentTimeMode: "custom",
      organizerPaymentTime: "18:30",
      paymentDeadlineDaysBefore: 2,
      paymentDeadlineTimeMode: "same",
      paymentDeadlineTime: "21:00",
      responseReminderDaysBefore: 1,
      responseReminderTimeMode: "custom",
      responseReminderTime: "12:30",
    };

    await expect(saveDeadlineAutomationSettings(
      { prepare } as unknown as D1Database,
      input,
      "admin@example.com",
      "2026-10-20T00:00:00.000Z",
    )).resolves.toMatchObject({ ...input, customized: true });
    expect(bind).toHaveBeenCalledWith(
      4,
      "same",
      "20:15",
      3,
      "custom",
      "18:30",
      2,
      "same",
      "21:00",
      1,
      "custom",
      "12:30",
      "admin@example.com",
      "2026-10-20T00:00:00.000Z",
      "2026-10-20T00:00:00.000Z",
    );
  });

  it("rejects invalid times and restores the defaults", async () => {
    await expect(saveDeadlineAutomationSettings(
      { prepare: vi.fn() } as unknown as D1Database,
      {
        internalDeadlineDaysBefore: 3,
        internalDeadlineTimeMode: "custom",
        internalDeadlineTime: "23:59",
        organizerPaymentDaysBefore: 2,
        organizerPaymentTimeMode: "custom",
        organizerPaymentTime: "24:00",
        paymentDeadlineDaysBefore: 1,
        paymentDeadlineTimeMode: "custom",
        paymentDeadlineTime: "23:59",
        responseReminderDaysBefore: 2,
        responseReminderTimeMode: "custom",
        responseReminderTime: "00:00",
      },
      "admin@example.com",
    )).rejects.toBeInstanceOf(DeadlineAutomationSettingError);

    const run = vi.fn().mockResolvedValue({});
    const prepare = vi.fn().mockReturnValue({ run });
    await expect(
      resetDeadlineAutomationSettings({ prepare } as unknown as D1Database),
    ).resolves.toMatchObject({ customized: false, internalDeadlineDaysBefore: 3 });
    expect(run).toHaveBeenCalledOnce();
  });
});
