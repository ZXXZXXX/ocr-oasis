import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const pollExternalTasks = createServerFn({ method: "POST" }).inputValidator(
  (data) =>
    z
      .object({
        cursor: z.number().optional(),
      })
      .parse(data),
).handler(async ({ data }) => {
  // 从下面框出来的行开始同步：CD202607139758900，时间 2026/7/13 17:51:33 (Asia/Shanghai)
  const HIGHLIGHTED_ROW_CURSOR = new Date("2026-07-13T17:51:33+08:00").getTime();

  // TODO: 后续接入第三方系统 API，替换此处模拟数据
  const cursor = data.cursor ?? HIGHLIGHTED_ROW_CURSOR;

  const MOCK_DRIVERS = [
    { driver: "王建国", plate: "沪B·72841" },
    { driver: "李永强", plate: "浙A·33176" },
    { driver: "陈小龙", plate: "苏E·58902" },
    { driver: "赵国胜", plate: "皖K·10429" },
    { driver: "刘志明", plate: "京N·66317" },
  ];

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function makeKaOrderId(ts: number, seq: number): string {
    const d = new Date(ts);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const tail = String(seq % 10_000_000).padStart(7, "0");
    return `CD${yyyy}${mm}${dd}${tail}`;
  }

  function makeShippingSlipNo(ts: number, seq: number): string {
    const d = new Date(ts);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const tail = String(seq % 100_000).padStart(5, "0");
    return `SH${yyyy}${mm}${dd}-${tail}`;
  }

  function pickDriver(seed: number) {
    return MOCK_DRIVERS[seed % MOCK_DRIVERS.length]!;
  }

  function placeholderImg(w: number, h: number, label: string): string {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'><rect width='100%' height='100%' fill='%23f8fafc'/><rect x='20' y='20' width='${w - 40}' height='${h - 40}' fill='none' stroke='%23cbd5e1' stroke-width='2' stroke-dasharray='8 6'/><text x='50%' y='50%' font-family='sans-serif' font-size='48' fill='%2394a3b8' text-anchor='middle' dominant-baseline='middle'>${label}</text></svg>`;
    return `data:image/svg+xml;utf8,${svg.replace(/#/g, "%23")}`;
  }

  // 模拟从第三方系统拉取新任务：每次 0 ~ 3 条
  const count = Math.floor(Math.random() * 4);
  const newRecords = Array.from({ length: count }, (_, i) => {
    const createdAt = cursor + 1 + i * 1000;
    const rid = uid();
    const seq = Math.floor(Math.random() * 10_000_000);
    return {
      id: makeKaOrderId(createdAt, seq),
      createdAt,
      status: "queued" as const,
      progress: 0,
      confidence: undefined as number | undefined,
      deliveryCount: 1,
      shippingCount: 1,
      images: [
        {
          id: `img-${rid}-delivery`,
          name: `delivery_${rid}.jpg`,
          url: placeholderImg(1920, 720, "送货单（同步）"),
          docType: "delivery_note" as const,
          width: 1920,
          height: 720,
        },
        {
          id: `img-${rid}-shipping`,
          name: `shipping_${rid}.jpg`,
          url: placeholderImg(1920, 720, "出货传票（参考）"),
          docType: "shipping_slip" as const,
          width: 1920,
          height: 720,
        },
      ],
      driver: pickDriver(seq).driver,
      plateNo: pickDriver(seq).plate,
      signatureStatus: (Math.random() < 0.6 ? "perfect" : "partial") as
        | "perfect"
        | "partial",
      shippingSlipNo: makeShippingSlipNo(createdAt, Math.floor(Math.random() * 100_000)),
    };
  });

  const nextCursor = newRecords.length
    ? Math.max(...newRecords.map((r) => r.createdAt))
    : cursor;

  return { records: newRecords, cursor: nextCursor };
});
