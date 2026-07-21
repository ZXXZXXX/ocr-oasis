import { createFileRoute } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  Plus,
  FileText,
  Truck,
  ScrollText,
  X,
  Minimize2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Sparkles,
  Trash2,
  Eye,
  Filter,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Pencil,
  Type,
  Heading,
  Table as TableIcon,
  Image as ImageIcon,
  MoreHorizontal,
  Search,
  GripVertical,
  ThumbsUp,
  ThumbsDown,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Link,
  Link2Off,
  Info,
} from "lucide-react";

import receiptRtmartAsset from "@/assets/receipt_rtmart.jpg.asset.json";
import receiptJdAsset from "@/assets/receipt_jd.jpg.asset.json";
import receiptLingshiAsset from "@/assets/receipt_lingshi.png.asset.json";
import receiptKualuDgAsset from "@/assets/receipt_kualu_dg.png.asset.json";
import receiptKualuTjAsset from "@/assets/receipt_kualu_tj.png.asset.json";
import tongyiSrmP1Asset from "@/assets/tongyi_srm_p1.jpg.asset.json";
import tongyiSrmP2Asset from "@/assets/tongyi_srm_p2.jpg.asset.json";







import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";


export const Route = createFileRoute("/")({
  component: Workbench,
});

// ---------- Constants ----------
const CURRENT_USER = "审核员 · 李婷";
const LOW_CONF_THRESHOLD = 0.8;
const AI_FAILURE_REASONS = ["图片无法识别", "图片质量过低"] as const;
const AI_REJECTION_REASONS = [
  "与“签收数据”不匹配",
  "与“KA验收数据”不匹配",
  "与“出货数据”不匹配",
] as const;
type AiRejectionReason = (typeof AI_REJECTION_REASONS)[number];
// 特定任务的固定不通过原因（用于演示）
const AI_REJECTION_OVERRIDES: Record<string, AiRejectionReason> = {
  CD202607143260522: "与“KA验收数据”不匹配",
  CD202607141000274: "与“出货数据”不匹配",
};
// 不通过原因 → 第三方数据来源标签（用于不匹配单元格括号内展示）
const REJECTION_SOURCE_LABEL: Record<AiRejectionReason, string> = {
  "与“签收数据”不匹配": "签收数据",
  "与“KA验收数据”不匹配": "KA验收数据",
  "与“出货数据”不匹配": "出货数据",
};
// 供子组件读取当前详情记录信息
const DetailRecordContext = createContext<{
  recordId?: string;
  aiRejectionReason?: AiRejectionReason;
}>({});
const AI_FAILURE_CHANCE = 0.1; // 模拟识别失败概率


// ---------- Types ----------
type DocType = "delivery_note" | "shipping_slip";
type Status = "queued" | "recognizing" | "pending_review" | "verified" | "failed";
const MAX_CONCURRENT_OCR = 3;
type SignatureStatus = "perfect" | "partial";
type AiVerdict = "pass" | "fail";

const SIGNATURE_LABEL: Record<SignatureStatus, string> = {
  perfect: "完美签收",
  partial: "部分签收",
};
const VERDICT_LABEL: Record<AiVerdict, string> = {
  pass: "通过",
  fail: "不通过",
};
const STATUS_LABEL: Record<Status, string> = {
  queued: "排队中",
  recognizing: "AI 识别中",
  pending_review: "待审核",
  verified: "已审核",
  failed: "识别异常",
};
type ChunkLabel = "Section-Header" | "Text" | "Table" | "Image";

const DOC_LABEL: Record<DocType, string> = {
  delivery_note: "送货单",
  shipping_slip: "出货传票",
};

const LABEL_META: Record<
  ChunkLabel,
  { text: string; icon: React.ComponentType<{ className?: string }> }
> = {
  "Section-Header": { text: "标题", icon: Heading },
  Text: { text: "文本", icon: Type },
  Table: { text: "表格", icon: TableIcon },
  Image: { text: "图像", icon: ImageIcon },
};

interface UploadedImage {
  id: string;
  name: string;
  url: string;
  docType: DocType;
  // natural dimensions used for bbox scaling (mocked)
  width: number;
  height: number;
}

interface EditLog {
  by: string;
  at: string; // ISO
}

interface Chunk {
  id: string;
  bbox: [number, number, number, number]; // x1,y1,x2,y2 in source image coords
  label: ChunkLabel;
  content: string; // HTML string, matches algorithm output
  confidence?: number; // 0-1, may be absent
  edited?: boolean;
  confirmed?: boolean; // user reviewed low-conf chunk and confirmed OCR was correct
  original?: string;
  lastEdit?: EditLog;
}

interface DocPage {
  imageId: string;
  sourceImage: string;
  pageBox: [number, number, number, number];
  chunks: Chunk[];
}

interface OcrRecord {
  id: string;
  createdAt: number;
  status: Status;
  progress: number;
  confidence?: number; // 0-100
  deliveryCount: number;
  shippingCount: number;
  images: UploadedImage[];
  // one page per source image, grouped by doc type
  results?: Partial<Record<DocType, DocPage[]>>;
  // 新增：任务级字段
  driver: string;
  plateNo: string;
  signatureStatus: SignatureStatus;
  aiVerdict?: AiVerdict; // 识别完成后由AI给出
  aiRejectionReason?: AiRejectionReason; // AI 不通过原因
  failedReason?: string; // AI 识别失败原因，如 "图片无法识别" / "图片质量过低"
  verifiedAt?: number; // 人工提交验收结论时间
  verifiedBy?: string;
  shippingSlipNo?: string; // 出货传票单号，用于搜索
}



// ---------- Helpers ----------
const uid = () => Math.random().toString(36).slice(2, 10);

// KA 订单号: CD + yyyymmdd + 7位数
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

function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase().trim();
  if (!q) return true;
  if (!t.includes(q)) {
    let i = 0;
    for (const char of t) {
      if (char === q[i]) i++;
      if (i === q.length) return true;
    }
    return false;
  }
  return true;
}


const fmtTime = (t: number) =>
  new Date(t).toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
  });

function confidenceTone(c?: number) {
  if (c == null) return "high"; // absent = treat as clean
  if (c >= 0.9) return "high";
  if (c >= LOW_CONF_THRESHOLD) return "mid";
  return "low";
}

// Synchronized color palette for confidence tones, using the same semantic tokens as status badges.
function confidenceBadgeClasses(tone: "high" | "mid" | "low") {
  if (tone === "high") return "text-[color:var(--success)] bg-[color:var(--success)]/15";
  if (tone === "mid") return "text-[color:var(--warning-foreground)] bg-[color:var(--warning)]/25";
  return "text-[color:var(--destructive)] bg-[color:var(--destructive)]/15";
}
function confidenceBorderClasses(tone: "high" | "mid" | "low") {
  if (tone === "high") return "border-[color:var(--success)]/70 bg-[color:var(--success)]/5";
  if (tone === "mid") return "border-[color:var(--warning)] bg-[color:var(--warning)]/15";
  return "border-[color:var(--destructive)] bg-[color:var(--destructive)]/15";
}
function confidenceDotClasses(tone: "high" | "mid" | "low") {
  if (tone === "high") return "bg-[color:var(--success)]";
  if (tone === "mid") return "bg-[color:var(--warning)]";
  return "bg-[color:var(--destructive)]";
}
function confidenceTextClasses(tone: "high" | "mid" | "low") {
  if (tone === "high") return "text-[color:var(--success)]";
  if (tone === "mid") return "text-[color:var(--warning-foreground)]";
  return "text-[color:var(--destructive)]";
}

// Compute overall record confidence: average of scored chunks. Unscored counted as 1.0.
function averageConfidence(pages: DocPage[]): number {
  const scores: number[] = [];
  pages.forEach((p) =>
    p.chunks.forEach((c) => {
      if (c.label === "Image") return; // images not scored
      scores.push(c.confidence ?? 1);
    }),
  );
  if (scores.length === 0) return 100;
  return Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 100);
}

function collectChunks(r: OcrRecord): Chunk[] {
  if (!r.results) return [];
  const out: Chunk[] = [];
  (Object.values(r.results) as DocPage[][]).forEach((pages) =>
    pages.forEach((p) => out.push(...p.chunks)),
  );
  return out;
}

// 将 chunks 按上/中/下三段分组：
// 上区 = 首个 Table 之前；中区 = 首个 Table 到最后一个 Table（含之间任意块）；下区 = 最后一个 Table 之后
// 无 Table 时全部归入上区。
function groupChunksByRegion(chunks: Chunk[]): {
  top: Chunk[];
  middle: Chunk[];
  bottom: Chunk[];
} {
  const first = chunks.findIndex((c) => c.label === "Table");
  if (first === -1) return { top: chunks, middle: [], bottom: [] };
  let last = first;
  for (let i = chunks.length - 1; i >= first; i--) {
    if (chunks[i].label === "Table") {
      last = i;
      break;
    }
  }
  return {
    top: chunks.slice(0, first),
    middle: chunks.slice(first, last + 1),
    bottom: chunks.slice(last + 1),
  };
}

function pendingLowConf(r: OcrRecord): number {
  return collectChunks(r).filter(
    (c) =>
      c.label !== "Image" &&
      c.confidence != null &&
      c.confidence < LOW_CONF_THRESHOLD &&
      !c.edited &&
      !c.confirmed,
  ).length;
}

// 生成 AI 不通过原因说明（枚举值）
function makeAiRejectionReason(record: OcrRecord): AiRejectionReason | undefined {
  if (record.aiVerdict !== "fail") return undefined;
  const override = AI_REJECTION_OVERRIDES[record.id];
  if (override) return override;
  // 按记录创建时间稳定选取一条枚举原因，保证同任务原因不变
  const idx = record.createdAt % AI_REJECTION_REASONS.length;
  return AI_REJECTION_REASONS[idx];
}

// Extract plain text from a simple HTML string (handles <p>, <br>, entities)
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<\/?p[^>]*>/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<p>${escaped.replace(/\n/g, "<br/>")}</p>`;
}

// ---------- Mock chunk generators (mimic algorithm output) ----------

// Delivery-note template modeled directly on the sample the user uploaded
function mockDeliveryChunks(): Chunk[] {
  const raw: Omit<Chunk, "id">[] = [
    {
      bbox: [867, 24, 1116, 73],
      label: "Section-Header",
      content: "<p>快驴送货入库单</p>",
      confidence: 1.0,
    },
    {
      bbox: [51, 77, 429, 111],
      label: "Text",
      content: "<p>来源单号: CG202604170000180543745</p>",
    },
    {
      bbox: [51, 105, 356, 135],
      label: "Text",
      content: "<p>入库单号: R2026041756153123</p>",
    },
    {
      bbox: [47, 130, 399, 166],
      label: "Text",
      content: "<p>送货方: 福州统一企业有限公司</p>",
      confidence: 0.72,
    },
    {
      bbox: [44, 158, 280, 186],
      label: "Text",
      content: "<p>货主: 泉州中小B</p>",
    },
    {
      bbox: [988, 77, 1285, 111],
      label: "Text",
      content: "<p>入库仓库: 泉州禾富批市仓</p>",
    },
    {
      bbox: [988, 111, 1124, 139],
      label: "Text",
      content: "<p>预计到货时间:</p>",
      confidence: 0.61,
    },
    {
      bbox: [988, 135, 1235, 166],
      label: "Text",
      content: "<p>入库完成日期: 2026-04-21</p>",
    },
    {
      bbox: [23, 186, 1915, 540],
      label: "Table",
      content:
        '<table border="1"><thead><tr><th>序号</th><th>SKU编码</th><th>品牌</th><th>品名</th><th>规格</th><th>生产批次</th><th>单位</th><th>应收</th><th>实收</th><th>金额(元)</th><th>备注</th></tr></thead><tbody><tr><td>1</td><td>10028007</td><td>统一</td><td>冰红茶1L</td><td>8瓶/箱</td><td>2026-03-30</td><td>箱</td><td>2</td><td>2</td><td>0.00</td><td>常温</td></tr><tr><td>2</td><td>10028003</td><td>统一</td><td>冰红茶500ml</td><td>15瓶/箱</td><td>2026-04-11</td><td>箱</td><td>2</td><td>2</td><td>0.00</td><td>常温</td></tr><tr><td>3</td><td>10028005</td><td>统一</td><td>绿茶1L</td><td>8瓶/箱</td><td>2026-03-26</td><td>箱</td><td>2</td><td>2</td><td>0.00</td><td>常温</td></tr><tr><td>4</td><td>10028002</td><td>统一</td><td>绿茶500ml</td><td>15瓶/箱</td><td>2026-03-30</td><td>箱</td><td>2</td><td>2</td><td>0.00</td><td>常温</td></tr></tbody></table>',
      confidence: 0.68,
    },
    {
      bbox: [23, 558, 186, 584],
      label: "Text",
      content: "<p>制单人: 林诗涛</p>",
    },
    {
      bbox: [527, 558, 615, 584],
      label: "Text",
      content: '<p>仓库签字: &lt;img alt="Signature of warehouse staff"/&gt;</p>',
    },
    {
      bbox: [992, 558, 1103, 584],
      label: "Text",
      content: '<p>送货方签字: &lt;img alt="Signature of supplier"/&gt;</p>',
    },
    {
      bbox: [1448, 551, 1548, 575],
      label: "Text",
      content: "<p>财务签字:</p>",
    },
    {
      bbox: [17, 597, 1573, 633],
      label: "Text",
      content:
        "<p>注:该送货物流为供应商指定物流,供应商认可该物流司机签字确认的《快驴采购入库单》。</p>",
      confidence: 1.0,
    },
    {
      bbox: [598, 481, 867, 678],
      label: "Image",
      content:
        "<img alt=\"Red circular stamp of '统一企业有限公司' with the number '0058' in the center.\"/>",
    },
  ];
  return raw.map((c) => ({ ...c, id: uid() }));
}

function mockShippingChunks(): Chunk[] {
  const raw: Omit<Chunk, "id">[] = [
    {
      bbox: [780, 20, 1180, 78],
      label: "Section-Header",
      content: "<p>出货传票</p>",
      confidence: 1.0,
    },
    {
      bbox: [50, 90, 480, 122],
      label: "Text",
      content: "<p>传票编号: SH20260421-00873</p>",
    },
    {
      bbox: [50, 122, 420, 154],
      label: "Text",
      content: "<p>客户名称: 泉州禾富商贸有限公司</p>",
      confidence: 0.74,
    },
    {
      bbox: [50, 154, 520, 186],
      label: "Text",
      content: "<p>送货地址: 泉州市丰泽区华大街道禾富仓储中心 A3 库</p>",
      confidence: 0.66,
    },
    {
      bbox: [980, 90, 1300, 122],
      label: "Text",
      content: "<p>出库日期: 2026-04-21</p>",
    },
    {
      bbox: [980, 122, 1280, 154],
      label: "Text",
      content: "<p>承运方: 顺达物流</p>",
    },
    {
      bbox: [20, 200, 1900, 520],
      label: "Table",
      content:
        '<table border="1"><thead><tr><th>序号</th><th>SKU</th><th>品名</th><th>规格</th><th>数量</th><th>单位</th><th>备注</th></tr></thead><tbody><tr><td>1</td><td>10028007</td><td>冰红茶1L</td><td>8瓶/箱</td><td>2</td><td>箱</td><td>常温</td></tr><tr><td>2</td><td>10028003</td><td>冰红茶500ml</td><td>15瓶/箱</td><td>2</td><td>箱</td><td>常温</td></tr><tr><td>3</td><td>10028005</td><td>绿茶1L</td><td>8瓶/箱</td><td>2</td><td>箱</td><td>常温</td></tr></tbody></table>',
      confidence: 0.71,
    },
    {
      bbox: [30, 560, 320, 596],
      label: "Text",
      content: "<p>装车人: 陈志强</p>",
    },
    {
      bbox: [980, 560, 1280, 596],
      label: "Text",
      content: "<p>司机签字: 王建国</p>",
    },
  ];
  return raw.map((c) => ({ ...c, id: uid() }));
}

// 大润发 商品收货单 + 出货传票 叠拍 (1080x1920)
function mockRtMartChunks(): Chunk[] {
  const raw: Omit<Chunk, "id">[] = [
    { bbox: [340, 500, 760, 570], label: "Section-Header", content: "<p>商品收货单</p>", confidence: 0.98 },
    { bbox: [60, 580, 460, 618], label: "Text", content: "<p>列印时间: 2026/04/23 12:32:58</p>" },
    { bbox: [60, 618, 460, 654], label: "Text", content: "<p>预约时间: 2026/04/23 08:00:00</p>" },
    { bbox: [60, 654, 300, 686], label: "Text", content: "<p>厂编: 68480</p>" },
    { bbox: [60, 686, 320, 720], label: "Text", content: "<p>收货码头: B28-1</p>" },
    { bbox: [470, 580, 850, 618], label: "Text", content: "<p>采购单号: 999261071633</p>" },
    { bbox: [470, 618, 900, 654], label: "Text", content: "<p>订单类型: B 采购越库</p>", confidence: 0.74 },
    { bbox: [470, 654, 980, 690], label: "Text", content: "<p>厂商名称: 统一商贸(昆山)有限公司上海分公司</p>", confidence: 0.68 },
    { bbox: [470, 690, 1000, 726], label: "Text", content: "<p>备注: 苏州高新区浒墅关镇青花路9号</p>", confidence: 0.62 },
    { bbox: [860, 580, 1040, 618], label: "Text", content: "<p>收货代号: SH2604230006</p>" },
    { bbox: [860, 618, 1040, 654], label: "Text", content: "<p>预约编号: YY1012604220006</p>" },
    {
      bbox: [40, 740, 1050, 890],
      label: "Table",
      content:
        '<table border="1"><thead><tr><th>货号(序号)</th><th>条码</th><th>入数</th><th>外箱</th><th>规格</th><th>订购量</th><th>投单量</th><th>实收箱数</th><th>实收件数</th><th>拒收量</th></tr></thead><tbody><tr><td>709303-1</td><td>6925303773106</td><td>12</td><td>12</td><td>120克/桶</td><td>132(11)</td><td>132(11)</td><td>11</td><td>0</td><td>0</td></tr><tr><td>760111-1</td><td>6902447169378</td><td>12</td><td>12</td><td>103克/桶</td><td>144(12)</td><td>144(12)</td><td>12</td><td>0</td><td>0</td></tr></tbody></table>',
      confidence: 0.71,
    },
    { bbox: [60, 900, 620, 940], label: "Text", content: "<p>品名: 统一来一桶老坛酸菜牛肉面(桶) 2026.04.16</p>", confidence: 0.66 },
    { bbox: [60, 940, 620, 980], label: "Text", content: "<p>品名: 统一来一桶红烧牛肉面 2026.04.14</p>", confidence: 0.64 },
    { bbox: [340, 1020, 760, 1080], label: "Section-Header", content: "<p>出货传票</p>", confidence: 0.96 },
    { bbox: [60, 1090, 480, 1128], label: "Text", content: "<p>统一商贸(昆山)有限公司 2026-04-22 10:49:10</p>", confidence: 0.72 },
    { bbox: [60, 1128, 460, 1160], label: "Text", content: "<p>客户订单号: 999261071633</p>" },
    { bbox: [60, 1160, 460, 1194], label: "Text", content: "<p>客户代号: 1101</p>" },
    { bbox: [60, 1194, 460, 1226], label: "Text", content: "<p>客户名称: 大润发(RT-Mart)</p>", confidence: 0.7 },
    { bbox: [460, 1090, 900, 1160], label: "Text", content: "<p>传票号码: 1383RY202604220013</p>" },
    { bbox: [460, 1160, 900, 1200], label: "Text", content: "<p>单据号: 83RY/0013/2020</p>" },
    { bbox: [460, 1200, 900, 1240], label: "Text", content: "<p>业务员: 01618 姚云平</p>" },
    {
      bbox: [40, 1260, 1050, 1520],
      label: "Table",
      content:
        '<table border="1"><thead><tr><th>序号</th><th>产品代号</th><th>品名称</th><th>规格</th><th>单位</th><th>数量</th><th>单价</th><th>金额</th></tr></thead><tbody><tr><td>1</td><td>4016432</td><td>来一桶老坛酸菜牛肉面桶潮源版</td><td>120g*12</td><td>箱</td><td>11</td><td>41.522</td><td>456.74</td></tr><tr><td>2</td><td>4016133</td><td>来一桶红烧牛肉面桶24升级版</td><td>103g*12</td><td>箱</td><td>12</td><td>41.522</td><td>498.26</td></tr></tbody></table>',
      confidence: 0.69,
    },
    { bbox: [60, 1560, 400, 1600], label: "Text", content: "<p>折让金额: 148.31</p>" },
    { bbox: [60, 1600, 400, 1640], label: "Text", content: "<p>未税金额: 845.13</p>" },
    { bbox: [60, 1640, 400, 1680], label: "Text", content: "<p>应收金额: 806.69</p>" },
    { bbox: [420, 1560, 720, 1640], label: "Text", content: "<p>经办人: 陈检容 04/22</p>", confidence: 0.65 },
    { bbox: [420, 1640, 720, 1720], label: "Text", content: "<p>车号: 鲁DD8791</p>" },
    { bbox: [720, 1560, 1000, 1720], label: "Text", content: "<p>司机: 王峰 04/22</p>" },
    { bbox: [60, 1750, 500, 1800], label: "Text", content: "<p>收货工号: 99921603-田敏</p>" },
    { bbox: [60, 1800, 400, 1840], label: "Text", content: "<p>PA确认人: 王峰</p>" },
    { bbox: [60, 1840, 400, 1880], label: "Text", content: "<p>VA确认人: 99921603</p>" },
    { bbox: [600, 1750, 1000, 1800], label: "Text", content: "<p>收货日期: 2026/04/23</p>" },
    { bbox: [600, 1800, 1000, 1840], label: "Text", content: "<p>收货主管: 李翠</p>" },
    { bbox: [600, 1840, 1000, 1890], label: "Text", content: '<p>送货人: &lt;img alt="Signature of driver"/&gt;</p>' },
  ];
  return raw.map((c) => ({ ...c, id: uid() }));
}

// 京东商城供应商送货验收单 (1423x1920)
function mockJdReceiptChunks(): Chunk[] {
  const raw: Omit<Chunk, "id">[] = [
    { bbox: [340, 340, 1080, 410], label: "Section-Header", content: "<p>京东商城供应商送货验收单</p>", confidence: 0.99 },
    { bbox: [1180, 300, 1400, 340], label: "Text", content: "<p>页次: 1/1</p>" },
    { bbox: [130, 440, 500, 480], label: "Text", content: "<p>2742713727</p>" },
    { bbox: [640, 470, 1200, 510], label: "Text", content: "<p>打印时间: 2026/5/23 11:47:21</p>" },
    { bbox: [80, 550, 460, 590], label: "Text", content: "<p>预约单号: 26052340786</p>" },
    { bbox: [460, 550, 750, 590], label: "Text", content: "<p>机构: 南宁京东达资</p>" },
    { bbox: [750, 550, 1080, 590], label: "Text", content: "<p>供应商代码: gztyqy</p>" },
    { bbox: [1080, 550, 1400, 590], label: "Text", content: "<p>验收人: 郭勇</p>" },
    { bbox: [80, 590, 460, 630], label: "Text", content: "<p>PO编号: 2742713727</p>" },
    { bbox: [460, 590, 750, 630], label: "Text", content: "<p>仓库: 1153号库</p>" },
    { bbox: [750, 590, 1080, 640], label: "Text", content: "<p>供应商名称: 广州统一企业有限公司</p>", confidence: 0.78 },
    { bbox: [1080, 590, 1400, 630], label: "Text", content: "<p>单据状态: 已完成</p>" },
    { bbox: [80, 640, 460, 680], label: "Text", content: "<p>ASN编号: 2742713727</p>" },
    { bbox: [460, 640, 750, 680], label: "Text", content: "<p>是否配货: 否</p>" },
    { bbox: [750, 640, 1080, 680], label: "Text", content: "<p>货主: 京东商城</p>" },
    { bbox: [1080, 640, 1400, 680], label: "Text", content: "<p>预约起始: 2026/5/23 9:30:00</p>" },
    { bbox: [80, 680, 460, 720], label: "Text", content: "<p>单据类型: 一般采购</p>" },
    { bbox: [1080, 680, 1400, 720], label: "Text", content: "<p>预约结束: 2026/5/23 10:00:00</p>" },
    { bbox: [80, 720, 460, 760], label: "Text", content: "<p>备注:</p>" },
    {
      bbox: [60, 780, 1380, 950],
      label: "Table",
      content:
        '<table border="1"><thead><tr><th>序号</th><th>商品编码</th><th>商品名称</th><th>预到量</th><th>验收量</th><th>批次验收量</th><th>拒收量</th><th>差异量</th><th>差异原因</th><th>贴码量</th></tr></thead><tbody><tr><td>1</td><td>967977</td><td>统一 绿茶 2L*6瓶 大包装 茶饮料 整箱装(新老包装随机发货)</td><td>16</td><td>16</td><td>0</td><td>0</td><td>0</td><td></td><td>0</td></tr><tr><td colspan="3">总计</td><td>16</td><td>16</td><td>0</td><td>0</td><td>0</td><td></td><td>0</td></tr></tbody></table>',
      confidence: 0.73,
    },
    { bbox: [80, 1020, 500, 1070], label: "Text", content: '<p>送货人: &lt;img alt="Signature of driver"/&gt;</p>' },
    { bbox: [80, 1080, 500, 1140], label: "Text", content: "<p>车牌号: 桂CV865</p>", confidence: 0.68 },
    { bbox: [640, 1020, 1080, 1070], label: "Text", content: "<p>联系方式:</p>" },
    { bbox: [640, 1080, 1080, 1130], label: "Text", content: "<p>送货日期:</p>" },
    {
      bbox: [140, 1620, 380, 1820],
      label: "Image",
      content: "<img alt=\"Red circular stamp of '南宁市中华路3号 收货专用章' with '郭勇'\"/>",
    },
    { bbox: [80, 1830, 340, 1870], label: "Text", content: "<p>签收人: 郭勇</p>" },
    { bbox: [640, 1830, 1080, 1870], label: "Text", content: "<p>签收日期: 2026.5.23</p>" },
  ];
  return raw.map((c) => ({ ...c, id: uid() }));
}

// 零食有鸣收货回执单 (1098x609)
function mockLingshiChunks(): Chunk[] {
  const raw: Omit<Chunk, "id">[] = [
    { bbox: [420, 40, 720, 85], label: "Section-Header", content: "<p>零食有鸣收货回执单</p>", confidence: 0.98 },
    { bbox: [80, 100, 380, 128], label: "Text", content: "<p>收货单号: X10130432026051800034</p>", confidence: 0.86 },
    { bbox: [400, 100, 620, 128], label: "Text", content: "<p>供应商: 1001010057</p>" },
    { bbox: [660, 100, 900, 128], label: "Text", content: "<p>仓储中心: 新疆物流中心</p>" },
    { bbox: [80, 130, 380, 158], label: "Text", content: "<p>ERP单号: 0016510102605113750</p>", confidence: 0.82 },
    { bbox: [400, 130, 700, 158], label: "Text", content: "<p>SRM送货单号: 0840710112605180012</p>", confidence: 0.78 },
    { bbox: [660, 130, 900, 158], label: "Text", content: "<p>签到时间: 2026-05-20 14:40:59</p>" },
    { bbox: [80, 160, 300, 188], label: "Text", content: "<p>产地仓:</p>" },
    { bbox: [80, 190, 300, 218], label: "Text", content: "<p>备注:</p>" },
    { bbox: [660, 190, 940, 218], label: "Text", content: "<p>打印时间: 2026-05-20 14:50:35</p>" },
    {
      bbox: [80, 230, 960, 320],
      label: "Table",
      content:
        '<table border="1"><thead><tr><th>商品编码</th><th>商品名称</th><th>单位</th><th>预约总数量</th><th>实收总数量</th><th>拒收数量</th><th>是否赠品</th><th>生产日期</th></tr></thead><tbody><tr><td>10100956</td><td>统一海之言柠檬味1L 1L</td><td>箱</td><td>700</td><td>700</td><td>0</td><td>否</td><td>2026-5-4</td></tr><tr><td colspan="3">总计</td><td>700</td><td>700</td><td>0</td><td></td><td></td></tr></tbody></table>',
      confidence: 0.74,
    },
    { bbox: [80, 430, 380, 465], label: "Text", content: "<p>司机姓名: 麦吾兰·塞麦提</p>", confidence: 0.62 },
    { bbox: [80, 465, 380, 500], label: "Text", content: "<p>司机电话: 13029634454</p>" },
    { bbox: [80, 500, 380, 540], label: "Text", content: "<p>车牌号: 新A9JU80</p>", confidence: 0.7 },
    { bbox: [720, 430, 940, 465], label: "Text", content: "<p>收货人姓名:</p>" },
    { bbox: [720, 465, 940, 500], label: "Text", content: "<p>日期:</p>" },
    {
      bbox: [800, 380, 1000, 560],
      label: "Image",
      content: "<img alt=\"Red circular stamp '收货专用章 新疆仓'\"/>",
    },
  ];
  return raw.map((c) => ({ ...c, id: uid() }));
}

// 快驴送货入库单 - 东莞虎门仓 (839x1182)
function mockKualuDgChunks(): Chunk[] {
  const raw: Omit<Chunk, "id">[] = [
    { bbox: [280, 50, 560, 110], label: "Section-Header", content: "<p>快驴送货入库单</p>", confidence: 0.98 },
    { bbox: [40, 130, 400, 165], label: "Text", content: "<p>采购单号: CG202605200000186584208</p>", confidence: 0.85 },
    { bbox: [440, 130, 780, 165], label: "Text", content: "<p>入库仓库: 东莞虎门仓</p>" },
    { bbox: [40, 165, 400, 200], label: "Text", content: "<p>入库单号: R2026052166894287</p>", confidence: 0.82 },
    { bbox: [440, 165, 780, 200], label: "Text", content: "<p>预计到货时间:</p>" },
    { bbox: [40, 200, 400, 235], label: "Text", content: "<p>供应商: 广州统一企业有限公司</p>", confidence: 0.78 },
    { bbox: [440, 200, 780, 235], label: "Text", content: "<p>入库完成日期: 2026-05-26</p>" },
    { bbox: [40, 235, 400, 270], label: "Text", content: "<p>货主: 东莞中小B</p>" },
    {
      bbox: [30, 290, 810, 800],
      label: "Table",
      content:
        '<table border="1"><thead><tr><th>序号</th><th>SKU编码</th><th>调出货主</th><th>调入货主</th><th>品牌</th><th>品名</th><th>规格</th><th>生产批次</th><th>SKU单位</th><th>箱规</th><th>托规</th><th>码托说明</th><th>应收整包装数量</th><th>实收</th><th>实收整包装数量</th><th>实际贴码数量</th><th>单价(元)</th><th>金额(元)</th><th>备注</th></tr></thead><tbody><tr><td>1</td><td>10036304</td><td></td><td></td><td>统一</td><td>冰红茶250ml</td><td>24盒箱</td><td>2026-05-08</td><td>箱</td><td>1</td><td>150</td><td>150*10</td><td>10.0箱</td><td>10</td><td>10.0箱</td><td>0</td><td>0.00</td><td>0.00</td><td>常温</td></tr><tr><td>2</td><td>10502490</td><td></td><td></td><td>太魔性</td><td>柠檬红茶250ml</td><td>6L/箱(24盒)</td><td>2026-04-16</td><td>箱</td><td>1</td><td>170</td><td>170*10</td><td>50.0箱</td><td>50</td><td>50.0箱</td><td>0</td><td>0.00</td><td>0.00</td><td>常温</td></tr><tr><td>3</td><td>10025498</td><td></td><td></td><td>鲜橙多</td><td>鲜橙多2L</td><td>6瓶/箱</td><td>2026-05-06</td><td>箱</td><td>1</td><td>40</td><td>10*4</td><td>50.0箱</td><td>50</td><td>50.0箱</td><td>0</td><td>0.00</td><td>0.00</td><td>常温</td></tr><tr><td>4</td><td>10571319</td><td></td><td></td><td>鲜橙多</td><td>鲜橙多橙汁饮料310ml/罐</td><td>7440ml/箱(24罐)</td><td>2026-05-09</td><td>箱</td><td>1</td><td></td><td></td><td>50.0箱</td><td>50</td><td>50.0箱</td><td>0</td><td>0.00</td><td>0.00</td><td>常温</td></tr></tbody></table>',
      confidence: 0.66,
    },
    { bbox: [40, 830, 780, 880], label: "Text", content: "<p>备注: 合计: 整件:160,散件:0</p>" },
    { bbox: [40, 900, 260, 940], label: "Text", content: "<p>制单人: 何钦扩</p>", confidence: 0.72 },
    { bbox: [260, 900, 480, 940], label: "Text", content: "<p>仓库签字:</p>" },
    { bbox: [480, 900, 700, 940], label: "Text", content: "<p>供应商签字:</p>" },
    { bbox: [700, 900, 810, 940], label: "Text", content: "<p>财务签字:</p>" },
    {
      bbox: [260, 870, 470, 990],
      label: "Image",
      content: "<img alt=\"Red circular stamp '收货专用章'\"/>",
    },
  ];
  return raw.map((c) => ({ ...c, id: uid() }));
}

// 快驴送货入库单 - 天津东丽仓 (877x1174)
function mockKualuTjChunks(): Chunk[] {
  const raw: Omit<Chunk, "id">[] = [
    { bbox: [300, 140, 580, 200], label: "Section-Header", content: "<p>快驴送货入库单</p>", confidence: 0.98 },
    { bbox: [40, 220, 400, 255], label: "Text", content: "<p>来源单号: CG202605250000187515851</p>", confidence: 0.84 },
    { bbox: [440, 220, 820, 255], label: "Text", content: "<p>入库仓库: 天津东丽仓</p>" },
    { bbox: [40, 255, 400, 290], label: "Text", content: "<p>入库单号: R2026052668522838</p>", confidence: 0.82 },
    { bbox: [440, 255, 820, 290], label: "Text", content: "<p>预计到货时间:</p>" },
    { bbox: [40, 290, 400, 325], label: "Text", content: "<p>送货方: 北京统一饮品有限公司</p>", confidence: 0.78 },
    { bbox: [440, 290, 820, 325], label: "Text", content: "<p>入库完成日期: 2026-05-29</p>" },
    { bbox: [40, 325, 400, 360], label: "Text", content: "<p>货主: 天津中小B</p>" },
    { bbox: [440, 325, 820, 360], label: "Text", content: "<p>货主类型: 自营</p>" },
    {
      bbox: [30, 400, 850, 780],
      label: "Table",
      content:
        '<table border="1"><thead><tr><th>序号</th><th>SKU编码</th><th>品牌</th><th>品名</th><th>规格</th><th>生产批次</th><th>SKU单位</th><th>箱规</th><th>码托说明</th><th>应收整包装数量</th><th>实收</th><th>总重(抄重)</th><th>实收整包装数量</th><th>实际贴码数量</th><th>单价(元)</th><th>金额(元)</th><th>库位</th></tr></thead><tbody><tr><td>1</td><td>10028026</td><td>统一阿萨姆</td><td>阿萨姆奶茶500ml</td><td>15瓶/箱</td><td></td><td>箱</td><td>1</td><td>90</td><td>50</td><td>50.0箱</td><td>50</td><td>50.0箱</td><td>0</td><td>0.00</td><td>0.00</td><td></td></tr><tr><td>2</td><td>10502490</td><td>太魔性</td><td>柠檬红茶250ml</td><td>6L/箱(24盒)</td><td></td><td>箱</td><td>1</td><td>170</td><td>50</td><td>50.0箱</td><td>50</td><td>50.0箱</td><td>0</td><td>0.00</td><td>0.00</td><td></td></tr><tr><td>3</td><td>10571319</td><td>鲜橙多</td><td>鲜橙多橙汁饮料310ml/罐</td><td>7440ml/箱(24罐)</td><td></td><td>箱</td><td>1</td><td></td><td>50</td><td>50.0箱</td><td>50</td><td>50.0箱</td><td>0</td><td>0.00</td><td>0.00</td><td></td></tr></tbody></table>',
      confidence: 0.68,
    },
    { bbox: [40, 820, 820, 900], label: "Text", content: "<p>备注: 截止至2026-05-29 11:10的实际收货数据 合计: 整件:100,散件:0,总净重(抄重):-</p>", confidence: 0.62 },
    { bbox: [40, 940, 260, 980], label: "Text", content: "<p>制单人: 姜金凤</p>", confidence: 0.7 },
    { bbox: [260, 940, 480, 980], label: "Text", content: "<p>仓库签字:</p>" },
    { bbox: [480, 940, 700, 980], label: "Text", content: "<p>送货方签字:</p>" },
    { bbox: [700, 940, 850, 980], label: "Text", content: "<p>财务签字:</p>" },
  ];
  return raw.map((c) => ({ ...c, id: uid() }));
}

// 长沙统一企业 · 零食很忙SRM送货单（第1页 / 共2页，1920x870）
function mockTongyiSrmP1Chunks(): Chunk[] {
  const raw: Omit<Chunk, "id">[] = [
    { bbox: [560, 70, 1240, 130], label: "Section-Header", content: "<p>长沙统一企业有限公司</p>", confidence: 0.97 },
    { bbox: [640, 135, 1160, 190], label: "Section-Header", content: "<p>零食很忙SRM送货单</p>", confidence: 0.95 },
    { bbox: [200, 235, 720, 275], label: "Text", content: "<p>收货组织: 宜春鸣忙食品有限公司绍兴仓</p>", confidence: 0.86 },
    { bbox: [860, 235, 1260, 275], label: "Text", content: "<p>预约日期: 2026-05-31</p>", confidence: 0.92 },
    { bbox: [200, 285, 720, 325], label: "Text", content: "<p>单据号: DN202605290450</p>", confidence: 0.88 },
    { bbox: [860, 285, 1260, 325], label: "Text", content: "<p>采购订单: CD202605264523484</p>", confidence: 0.84 },
    { bbox: [200, 335, 760, 405], label: "Text", content: "<p>客户地址: 浙江省绍兴市上虞区上诸高速公路菜鸟网络浙江上虞园区3号库</p>", confidence: 0.78 },
    { bbox: [860, 335, 1200, 375], label: "Text", content: "<p>卸货类型: 仓卸</p>", confidence: 0.9 },
    { bbox: [200, 415, 620, 455], label: "Text", content: "<p>采购员: L02211_任晴元</p>", confidence: 0.82 },
    { bbox: [860, 415, 1200, 455], label: "Text", content: "<p>带板运输: 否</p>", confidence: 0.93 },
    { bbox: [200, 465, 620, 505], label: "Text", content: "<p>收货联系电话: 150-6852-5321</p>", confidence: 0.85 },
    { bbox: [860, 465, 1200, 505], label: "Text", content: "<p>是否年货: 否</p>", confidence: 0.93 },
    { bbox: [200, 515, 620, 555], label: "Text", content: "<p>3.0中式糕点: 否</p>", confidence: 0.9 },
    { bbox: [860, 515, 1200, 555], label: "Text", content: "<p>预约时段: 上午</p>", confidence: 0.92 },
    { bbox: [200, 565, 720, 605], label: "Text", content: "<p>送货公司: 长沙统一企业有限公司</p>", confidence: 0.88 },
    {
      bbox: [180, 640, 1800, 780],
      label: "Table",
      content:
        '<table border="1"><thead><tr><th>序号</th><th>物料编码</th><th>产品名称</th><th>规格</th><th>计价单位</th><th>订单数量</th><th>发货数量</th><th>生产批号</th><th>是否赠品</th><th>备注</th><th>层件数</th><th>层数</th><th>堆码方式</th><th>固定物</th><th>拒收数量</th><th>是否单品允收</th></tr></thead><tbody><tr><td>10</td><td>111594</td><td>汤达人酸辣豚骨面130g*5</td><td>130g*5包*6中袋</td><td>箱</td><td>180</td><td>180</td><td>2026-05-23</td><td>否</td><td>top300</td><td>15</td><td>3</td><td>3层/每层15件/码</td><td>绑带</td><td></td><td></td></tr><tr><td colspan="6">合计</td><td>180</td><td colspan="9"></td></tr></tbody></table>',
      confidence: 0.72,
    },
    { bbox: [960, 795, 1500, 835], label: "Text", content: "<p>收货人: 向涛军 5.31 实收180件</p>", confidence: 0.6 },
    { bbox: [860, 835, 1260, 870], label: "Text", content: "<p>发货日期: 2026年05月29日</p>", confidence: 0.86 },
  ];
  return raw.map((c) => ({ ...c, id: uid() }));
}

// 长沙统一企业 · 零食很忙SRM送货单（第2页 / 共2页，明细续表，1920x870）
function mockTongyiSrmP2Chunks(): Chunk[] {
  const raw: Omit<Chunk, "id">[] = [
    {
      bbox: [340, 90, 1780, 720],
      label: "Table",
      content:
        '<table border="1"><thead><tr><th>序号</th><th>物料编码</th><th>产品名称</th><th>规格</th><th>计价单位</th><th>订单数量</th><th>发货数量</th><th>生产批号</th><th>是否赠品</th><th>备注</th><th>层件数</th><th>层数</th><th>堆码方式</th><th>固定物</th></tr></thead><tbody>' +
        '<tr><td>80</td><td>100764</td><td>统一汤达人海鲜拉面杯80g</td><td>80g*12桶</td><td>件</td><td>168</td><td>168</td><td>2026-05-22</td><td>否</td><td></td><td>17</td><td>3</td><td>3层/每层17件/码</td><td>绑带</td></tr>' +
        '<tr><td>90</td><td>100808</td><td>统一茄皇鸡蛋袋面116g</td><td>116g*5包*6袋</td><td>件</td><td>90</td><td>90</td><td>2026-05-09</td><td>否</td><td></td><td>14</td><td>4</td><td>4层/每层14件/码</td><td>绑带</td></tr>' +
        '<tr><td>100</td><td>128725</td><td>统一酱拌面卤香牛肉风味</td><td>1*12碗</td><td>件</td><td>72</td><td>72</td><td>2026-05-13</td><td>否</td><td></td><td>19</td><td>4</td><td>4层/每层19件/码</td><td>绑带</td></tr>' +
        '<tr><td>110</td><td>128446</td><td>统一老坛酸菜袋面121g</td><td>121g*24袋</td><td>件</td><td>108</td><td>108</td><td>2026-05-24</td><td>否</td><td></td><td>6</td><td>11</td><td>11层/每层6件/码</td><td>缠膜</td></tr>' +
        '<tr><td>120</td><td>123774</td><td>统一香辣牛肉袋面97g</td><td>97g*24袋</td><td>件</td><td>108</td><td>108</td><td>2026-05-25</td><td>否</td><td></td><td>13</td><td>5</td><td>5层/每层13件/码</td><td>绑带</td></tr>' +
        '<tr><td>130</td><td>123778</td><td>统一茄皇牛肉面128g</td><td>1*12桶</td><td>件</td><td>108</td><td>108</td><td>2026-05-21</td><td>否</td><td>top300</td><td>13</td><td>5</td><td>5层/每层13件/码</td><td>绑带</td></tr>' +
        '<tr><td>140</td><td>108996</td><td>统一来一桶老坛酸菜牛肉面120g</td><td>120g*12桶</td><td>件</td><td>108</td><td>108</td><td>2026-05-22</td><td>否</td><td></td><td>6</td><td>11</td><td>11层/每层6件/码</td><td>绑带</td></tr>' +
        '<tr><td>150</td><td>109760</td><td>统一小浣熊烤翅味35g</td><td>35g*40包</td><td>箱</td><td>216</td><td>216</td><td>2026-05-25</td><td>否</td><td></td><td>6</td><td>10</td><td>不打码</td><td>缠膜</td></tr>' +
        '<tr><td>160</td><td>123770</td><td>统一汤达人辣白菜豚骨拉面迷你杯40g</td><td>40g*18杯</td><td>件</td><td>108</td><td>108</td><td>2026-05-14</td><td>否</td><td></td><td>17</td><td>3</td><td>3层/每层17件/码</td><td>缠膜</td></tr>' +
        '<tr><td>170</td><td>150541</td><td>汤达人日式豚骨面125g*5</td><td>125g*5包*6中袋</td><td>箱</td><td>90</td><td>90</td><td>2026-05-23</td><td>否</td><td>top300</td><td>10</td><td>11</td><td>11层/每层10件/码</td><td>绑带</td></tr>' +
        '<tr><td>180</td><td>111487</td><td>统一汤达人酸酸辣豚骨拉面杯90g</td><td>90g*12桶</td><td>件</td><td>168</td><td>138</td><td>2026-05-19</td><td>否</td><td>top300</td><td>10</td><td>6</td><td>6层/每层10件/码</td><td>绑带</td></tr>' +
        '<tr><td>190</td><td>100807</td><td>统一鲜虾鱼板面经典款101g</td><td>101g*12桶</td><td>件</td><td>108</td><td>108</td><td>2026-05-12</td><td>否</td><td></td><td>10</td><td>11</td><td>11层/每层10件/码</td><td>绑带</td></tr>' +
        '<tr><td>200</td><td>129998</td><td>统一鲜虾鱼板面经典款101g</td><td>101g*12桶</td><td>件</td><td>—</td><td>—</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>' +
        '<tr><td colspan="6">合计</td><td>2298</td><td colspan="7"></td></tr>' +
        '</tbody></table>',
      confidence: 0.68,
    },
    { bbox: [960, 735, 1560, 780], label: "Text", content: "<p>收货人: 向涛军 5.31 实收2298件</p>", confidence: 0.58 },
    { bbox: [860, 780, 1260, 820], label: "Text", content: "<p>发货日期: 2026年05月29日</p>", confidence: 0.84 },
  ];
  return raw.map((c) => ({ ...c, id: uid() }));
}




// 货品明细（Table）标准化为这 6 列
const PRODUCT_TABLE_COLUMNS = [
  "物料名称",
  "物料编码",
  "订单数量",
  "发货数量",
  "拒收数量",
  "签收数量",
] as const;

// 后台必能匹配出数据的列，过滤展示时固定命名且不显示缺失/手动选择
const PRODUCT_REQUIRED_KEYS = new Set<string>(["物料名称", "物料编码"]);

function classifyTableHeader(header: string): string | null {
  const rules = [
    { key: "物料名称", patterns: [/品名/, /商品名称/, /产品名称/, /品名称/, /物料名称/] },
    { key: "物料编码", patterns: [/货号/, /SKU/i, /商品编码/, /产品代号/, /物料编码/, /条码/] },
    // 先匹配具体数量列，避免被“数量”泛化规则吞掉
    // 先匹配具体数量列，避免被“数量”泛化规则吞掉
    { key: "发货数量", patterns: [/发货数量?/, /投单量/] },
    { key: "拒收数量", patterns: [/拒收数量?/, /拒收量/] },
    { key: "签收数量", patterns: [/签收/, /验收量/, /实收总数量/, /实收件数/, /实收箱数/, /实收/] },
    { key: "订单数量", patterns: [/订单数量?/, /订购量/, /预约总数量/, /预到量/, /应收/, /数量/] },
  ];
  for (const rule of rules) {
    if (rule.patterns.some((p) => p.test(header))) return rule.key;
  }
  return null;
}

// 解析表格 HTML 为二维结构（跳过合计/合并行），供过滤展示使用
function parseTableStructure(
  html: string,
): { headerCells: string[]; rows: string[][] } | null {
  const theadMatch = html.match(/<thead>([\s\S]*?)<\/thead>/i);
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!theadMatch || !tbodyMatch) return null;
  const headerCells = Array.from(theadMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map(
    (m) => m[1].replace(/<[^>]+>/g, "").trim(),
  );
  const rowMatches = Array.from(tbodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi));
  const rows: string[][] = [];
  rowMatches.forEach((rm) => {
    const rowHtml = rm[1];
    if (/<td[^>]*colspan\s*=/i.test(rowHtml) || /总计|合计/.test(rowHtml)) return;
    const tds = Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim(),
    );
    rows.push(tds);
  });
  return { headerCells, rows };
}

const PRODUCT_QUANTITY_KEYS = new Set<string>([
  "订单数量",
  "发货数量",
  "拒收数量",
  "签收数量",
]);

function computeAutoTableMapping(headerCells: string[]): Map<string, number> {
  const map = new Map<string, number>();
  const used = new Set<string>();
  headerCells.forEach((h, idx) => {
    const target = classifyTableHeader(h);
    if (target && !used.has(target)) {
      used.add(target);
      map.set(target, idx);
    }
  });
  return map;
}

function stableStrHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// 基于稳定哈希的差异模拟：与 FilteredTableView 完全一致。
function computeMismatch(rowIdx: number, key: string, val: string):
  | { safeThird: number }
  | null {
  if (!val) return null;
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) return null;
  const h = stableStrHash(`${rowIdx}-${key}`);
  if (h % 100 >= 18) return null;
  const delta = (h % 5) + 1;
  const third = h % 2 === 0 ? num - delta : num + delta;
  const safeThird = third < 0 ? num + delta : third;
  return { safeThird };
}

// 剥离注入的差异展示节点，得到干净的原始 HTML
function stripMismatchAnnotations(html: string): string {
  if (typeof document === "undefined") return html;
  const div = document.createElement("div");
  div.innerHTML = html;
  div.querySelectorAll("[data-annotation]").forEach((n) => n.remove());
  div.querySelectorAll("[data-mismatch]").forEach((n) => {
    const p = n.parentNode;
    if (!p) return;
    while (n.firstChild) p.insertBefore(n.firstChild, n);
    p.removeChild(n);
  });
  return div.innerHTML;
}

// 在原始 OCR 表格 DOM 上对数量列进行差异高亮 / 编辑标注
function annotateMismatchesInDOM(
  root: HTMLElement,
  label: string,
  editedCells?: Set<string>,
) {
  const table = root.querySelector("table");
  if (!table) return;
  const thead = table.querySelector("thead");
  if (!thead) return;
  const headerCells = Array.from(thead.querySelectorAll("th")).map(
    (th) => (th.textContent || "").trim(),
  );
  const autoMap = computeAutoTableMapping(headerCells);
  const qtyCols: Array<{ key: string; idx: number }> = [];
  PRODUCT_QUANTITY_KEYS.forEach((key) => {
    const idx = autoMap.get(key);
    if (idx !== undefined) qtyCols.push({ key, idx });
  });
  const bodyRows = Array.from(
    table.querySelectorAll("tbody > tr"),
  ) as HTMLTableRowElement[];
  const dataRows = bodyRows.filter((r) => {
    const inner = r.innerHTML;
    return !/colspan\s*=/i.test(inner) && !/总计|合计/.test(inner);
  });
  const appendEditedTag = (cell: HTMLElement) => {
    const ann = document.createElement("span");
    ann.setAttribute("data-annotation", "");
    ann.setAttribute("contenteditable", "false");
    ann.style.marginLeft = "2px";
    ann.style.color = "inherit";
    ann.textContent = `（已编辑）`;
    cell.appendChild(ann);
  };
  dataRows.forEach((tr, rowIdx) => {
    // 编辑标注：所有列都可能被编辑
    if (editedCells) {
      Array.from(tr.children).forEach((cellNode, colIdx) => {
        const cell = cellNode as HTMLElement;
        if (!editedCells.has(`${rowIdx}-${colIdx}`)) return;
        if (cell.querySelector("[data-annotation]")) return;
        appendEditedTag(cell);
      });
    }
    // 差异高亮（编辑过的单元格跳过）
    qtyCols.forEach(({ key, idx }) => {
      const cell = tr.children[idx] as HTMLElement | undefined;
      if (!cell) return;
      if (editedCells?.has(`${rowIdx}-${idx}`)) return;
      if (cell.querySelector("[data-mismatch]")) return;
      const val = (cell.textContent || "").trim();
      const m = computeMismatch(rowIdx, key, val);
      if (!m) return;
      cell.textContent = "";
      const outer = document.createElement("span");
      outer.setAttribute("data-mismatch", "");
      outer.style.color = "#dc2626";
      outer.appendChild(document.createTextNode(val));
      const ann = document.createElement("span");
      ann.setAttribute("data-annotation", "");
      ann.setAttribute("contenteditable", "false");
      ann.style.fontSize = "0.85em";
      ann.style.marginLeft = "2px";
      ann.textContent = `（${label}：${m.safeThird}）`;
      outer.appendChild(ann);
      cell.appendChild(outer);
    });
  });
}

// 将过滤视图中的单元格文本改动回写到原始 HTML
function updateHtmlTableCell(
  html: string,
  rowIdx: number,
  colIdx: number,
  newText: string,
): string {
  if (typeof document === "undefined") return html;
  const div = document.createElement("div");
  div.innerHTML = html;
  const table = div.querySelector("table");
  if (!table) return html;
  const bodyRows = Array.from(
    table.querySelectorAll("tbody > tr"),
  ) as HTMLTableRowElement[];
  const dataRows = bodyRows.filter((r) => {
    const inner = r.innerHTML;
    return !/colspan\s*=/i.test(inner) && !/总计|合计/.test(inner);
  });
  const row = dataRows[rowIdx];
  if (!row) return html;
  const cell = row.children[colIdx] as HTMLElement | undefined;
  if (!cell) return html;
  cell.textContent = newText;
  return div.innerHTML;
}

// 兼容旧调用：现在保留原始 OCR HTML，不再在数据阶段裁剪表格。
function enrichTableChunks(chunks: Chunk[]): Chunk[] {
  return chunks;
}




function fabricateResult(images: UploadedImage[]) {
  const results: Partial<Record<DocType, DocPage[]>> = {};

  const deliveryImgs = images.filter((i) => i.docType === "delivery_note");
  const shippingImgs = images.filter((i) => i.docType === "shipping_slip");

  if (deliveryImgs.length) {
    results.delivery_note = deliveryImgs.map((img) => ({
      imageId: img.id,
      sourceImage: img.name,
      pageBox: [0, 0, img.width, img.height],
      chunks: enrichTableChunks(mockDeliveryChunks()),
    }));
  }
  if (shippingImgs.length) {
    results.shipping_slip = shippingImgs.map((img) => ({
      imageId: img.id,
      sourceImage: img.name,
      pageBox: [0, 0, img.width, img.height],
      chunks: enrichTableChunks(mockShippingChunks()),
    }));
  }
  const allPages = Object.values(results).flat() as DocPage[];
  return { results, confidence: averageConfidence(allPages) };
}

// ---------- Upload zone ----------
function UploadZone({
  title,
  icon,
  images,
  onAdd,
  onRemove,
  max = 6,
}: {
  title: string;
  icon: React.ReactNode;
  images: UploadedImage[];
  onAdd: (files: FileList) => void;
  onRemove: (id: string) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="text-primary">{icon}</span>
          {title}
        </div>
        <span className="text-xs text-muted-foreground">
          {images.length} / {max}
        </span>
      </div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files) onAdd(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border/70 bg-secondary/40 px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-accent/40",
          drag && "border-primary bg-accent/60",
        )}
      >
        <Upload className="size-6 text-muted-foreground" />
        <div className="text-sm text-foreground">拖拽图片到此处或点击上传</div>
        <div className="text-xs text-muted-foreground">
          支持 JPG / PNG，单张 ≤ 3MB，最多 {max} 张
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => e.target.files && onAdd(e.target.files)}
        />
      </div>
      {images.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {images.map((img) => (
            <div
              key={img.id}
              className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
            >
              <img src={img.url} alt={img.name} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(img.id);
                }}
                className="absolute right-1 top-1 rounded-full bg-background/90 p-1 text-foreground shadow-sm opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Remove"
              >
                <X className="size-3" />
              </button>
              <div className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                {img.name}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Seed demo records ----------
function placeholderImg(w: number, h: number, label: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'><rect width='100%' height='100%' fill='%23f8fafc'/><rect x='20' y='20' width='${w - 40}' height='${h - 40}' fill='none' stroke='%23cbd5e1' stroke-width='2' stroke-dasharray='8 6'/><text x='50%' y='50%' font-family='sans-serif' font-size='48' fill='%2394a3b8' text-anchor='middle' dominant-baseline='middle'>${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${svg.replace(/#/g, "%23")}`;
}

function createRand(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function adjustChunkConfidences(
  chunks: Chunk[],
  mode: "high" | "mid" | "low",
  rand: () => number = Math.random,
): Chunk[] {
  return chunks.map((c) => {
    if (c.label === "Image") return c;
    let base = c.confidence ?? 0.95;
    if (mode === "high") base = Math.min(0.99, Math.max(0.9, base + 0.2));
    else if (mode === "mid") base = 0.82 + rand() * 0.1;
    else base = 0.55 + rand() * 0.2;
    return { ...c, confidence: Number(base.toFixed(2)) };
  });
}

const MOCK_DRIVERS = [
  { driver: "王建国", plate: "沪B·72841" },
  { driver: "李永强", plate: "浙A·33176" },
  { driver: "陈小龙", plate: "苏E·58902" },
  { driver: "赵国胜", plate: "皖K·10429" },
  { driver: "刘志明", plate: "京N·66317" },
];

function pickDriver(seed: number) {
  return MOCK_DRIVERS[seed % MOCK_DRIVERS.length]!;
}

function seedRecords(): OcrRecord[] {
  const now = new Date(2026, 6, 15, 0, 0, 0, 0).getTime();
  type Seed = {
    minutesAgo: number;
    mode?: "high" | "mid" | "low";
    signatureStatus: SignatureStatus;
    status: Extract<Status, "pending_review" | "verified" | "failed">;
    aiVerdict?: AiVerdict;
    failedReason?: string;
  };
  // 送货单始终有；出货传票作为参考图，一定附带
  const seeds: Seed[] = [
    {
      minutesAgo: 4,
      mode: "high",
      signatureStatus: "perfect",
      status: "pending_review",
      aiVerdict: "pass",
    },
    {
      minutesAgo: 45,
      mode: "mid",
      signatureStatus: "partial",
      status: "pending_review",
      aiVerdict: "fail",
    },
    {
      minutesAgo: 180,
      mode: "low",
      signatureStatus: "partial",
      status: "pending_review",
      aiVerdict: "fail",
    },
    {
      minutesAgo: 320,
      mode: "high",
      signatureStatus: "perfect",
      status: "verified",
      aiVerdict: "pass",
    },
    {
      minutesAgo: 90,
      signatureStatus: "perfect",
      status: "failed",
      failedReason: "图片无法识别",
    },
    {
      minutesAgo: 140,
      signatureStatus: "partial",
      status: "failed",
      failedReason: "图片质量过低",
    },
  ];

  const docTypes: DocType[] = ["delivery_note", "shipping_slip"];
  const records: OcrRecord[] = seeds.map((s, idx) => {
    const images: UploadedImage[] = docTypes.map((dt) => ({
      id: `img-${idx}-${dt}`,
      name: `${dt === "delivery_note" ? "delivery" : "shipping"}_sample_${idx + 1}.jpg`,
      url: placeholderImg(
        1920,
        720,
        dt === "delivery_note" ? "送货单示例" : "出货传票示例（参考）",
      ),
      docType: dt,
      width: 1920,
      height: 720,
    }));
    // 只对送货单执行 OCR；识别失败的任务无结果
    const isFailed = s.status === "failed";
    const results: Partial<Record<DocType, DocPage[]>> = {};
    if (!isFailed) {
      const dImg = images.find((i) => i.docType === "delivery_note")!;
      const rand = createRand(idx + 1);
      results.delivery_note = [
        {
          imageId: dImg.id,
          sourceImage: dImg.name,
          pageBox: [0, 0, dImg.width, dImg.height],
          chunks: enrichTableChunks(adjustChunkConfidences(mockDeliveryChunks(), s.mode!, rand)),
        },
      ];
    }
    const allPages = Object.values(results).flat() as DocPage[];
    const who = pickDriver(idx);
    const createdAt = now - s.minutesAgo * 60_000;
    const record: OcrRecord = {
      id: makeKaOrderId(createdAt, 1_000_000 + idx * 137),
      createdAt,
      status: s.status,
      progress: 100,
      confidence: isFailed ? undefined : averageConfidence(allPages),
      deliveryCount: 1,
      shippingCount: 1,
      images,
      results,
      driver: who.driver,
      plateNo: who.plate,
      signatureStatus: s.signatureStatus,
      aiVerdict: isFailed ? undefined : s.aiVerdict,
      failedReason: isFailed ? s.failedReason : undefined,
      verifiedAt: s.status === "verified" ? now - (s.minutesAgo - 10) * 60_000 : undefined,
      verifiedBy: s.status === "verified" ? CURRENT_USER : undefined,
      shippingSlipNo: makeShippingSlipNo(createdAt, 1_000 + idx * 137),
    };
    return { ...record, aiRejectionReason: isFailed ? undefined : makeAiRejectionReason(record) };

  });

  // 真实照片任务（大润发 商品收货单 + 京东 送货验收单）
  const realCreatedAt = now - 12 * 60_000;
  const realImages: UploadedImage[] = [
    {
      id: "img-real-delivery",
      name: "rtmart_receipt.jpg",
      url: receiptRtmartAsset.url,
      docType: "delivery_note",
      width: 1080,
      height: 1920,
    },
    {
      id: "img-real-shipping",
      name: "jd_receipt.jpg",
      url: receiptJdAsset.url,
      docType: "shipping_slip",
      width: 1423,
      height: 1920,
    },
  ];
  const realResults: Partial<Record<DocType, DocPage[]>> = {
    delivery_note: [
      {
        imageId: realImages[0]!.id,
        sourceImage: realImages[0]!.name,
        pageBox: [0, 0, realImages[0]!.width, realImages[0]!.height],
        chunks: enrichTableChunks(mockRtMartChunks()),
      },
    ],
    shipping_slip: [
      {
        imageId: realImages[1]!.id,
        sourceImage: realImages[1]!.name,
        pageBox: [0, 0, realImages[1]!.width, realImages[1]!.height],
        chunks: enrichTableChunks(mockJdReceiptChunks()),
      },
    ],
  };
  const realPages = Object.values(realResults).flat() as DocPage[];
  const realRecord: OcrRecord = {
    id: makeKaOrderId(realCreatedAt, 2_260_423),
    createdAt: realCreatedAt,
    status: "pending_review",
    progress: 100,
    confidence: averageConfidence(realPages),
    deliveryCount: 1,
    shippingCount: 1,
    images: realImages,
    results: realResults,
    driver: "王峰",
    plateNo: "鲁DD8791",
    signatureStatus: "perfect",
    aiVerdict: "pass",
    shippingSlipNo: "1383RY202604220013",
  };

  // 三个只有送货单、无出货传票的真实照片任务
  type NoSlipSeed = {
    key: string;
    asset: { url: string };
    width: number;
    height: number;
    chunks: () => Chunk[];
    minutesAgo: number;
    driver: string;
    plateNo: string;
    aiVerdict: AiVerdict;
    signatureStatus: SignatureStatus;
    idSeed: number;
  };
  const noSlipSeeds: NoSlipSeed[] = [
    {
      key: "lingshi",
      asset: receiptLingshiAsset,
      width: 1098,
      height: 609,
      chunks: mockLingshiChunks,
      minutesAgo: 22,
      driver: "麦吾兰·塞麦提",
      plateNo: "新A9JU80",
      aiVerdict: "pass",
      signatureStatus: "perfect",
      idSeed: 3_180_034,
    },
    {
      key: "kualu-dg",
      asset: receiptKualuDgAsset,
      width: 839,
      height: 1182,
      chunks: mockKualuDgChunks,
      minutesAgo: 68,
      driver: "何钦扩",
      plateNo: "粤S·47188",
      aiVerdict: "pass",
      signatureStatus: "partial",
      idSeed: 3_260_287,
    },
    {
      key: "kualu-tj",
      asset: receiptKualuTjAsset,
      width: 877,
      height: 1174,
      chunks: mockKualuTjChunks,
      minutesAgo: 150,
      driver: "姜金凤",
      plateNo: "津B·22838",
      aiVerdict: "fail",
      signatureStatus: "partial",
      idSeed: 3_260_522,
    },
  ];
  const noSlipRecords: OcrRecord[] = noSlipSeeds.map((s) => {
    const createdAt = now - s.minutesAgo * 60_000;
    const img: UploadedImage = {
      id: `img-${s.key}-delivery`,
      name: `${s.key}_delivery.png`,
      url: s.asset.url,
      docType: "delivery_note",
      width: s.width,
      height: s.height,
    };
    const results: Partial<Record<DocType, DocPage[]>> = {
      delivery_note: [
        {
          imageId: img.id,
          sourceImage: img.name,
          pageBox: [0, 0, img.width, img.height],
          chunks: enrichTableChunks(s.chunks()),
        },
      ],
    };
    const pages = Object.values(results).flat() as DocPage[];
    const record: OcrRecord = {
      id: makeKaOrderId(createdAt, s.idSeed),
      createdAt,
      status: "pending_review",
      progress: 100,
      confidence: averageConfidence(pages),
      deliveryCount: 1,
      shippingCount: 0,
      images: [img],
      results,
      driver: s.driver,
      plateNo: s.plateNo,
      signatureStatus: s.signatureStatus,
      aiVerdict: s.aiVerdict,
    };
    return { ...record, aiRejectionReason: makeAiRejectionReason(record) };
  });

  // 多送货单任务：长沙统一企业 · 零食很忙SRM送货单（同一验收任务包含2张送货单照片）
  const tongyiCreatedAt = now - 6 * 60_000;
  const tongyiImages: UploadedImage[] = [
    {
      id: "img-tongyi-p1",
      name: "tongyi_srm_p1.jpg",
      url: tongyiSrmP1Asset.url,
      docType: "delivery_note",
      width: 1920,
      height: 870,
    },
    {
      id: "img-tongyi-p2",
      name: "tongyi_srm_p2.jpg",
      url: tongyiSrmP2Asset.url,
      docType: "delivery_note",
      width: 1920,
      height: 870,
    },
  ];
  const tongyiResults: Partial<Record<DocType, DocPage[]>> = {
    delivery_note: [
      {
        imageId: tongyiImages[0]!.id,
        sourceImage: tongyiImages[0]!.name,
        pageBox: [0, 0, tongyiImages[0]!.width, tongyiImages[0]!.height],
        chunks: enrichTableChunks(mockTongyiSrmP1Chunks()),
      },
      {
        imageId: tongyiImages[1]!.id,
        sourceImage: tongyiImages[1]!.name,
        pageBox: [0, 0, tongyiImages[1]!.width, tongyiImages[1]!.height],
        chunks: enrichTableChunks(mockTongyiSrmP2Chunks()),
      },
    ],
  };
  const tongyiPages = Object.values(tongyiResults).flat() as DocPage[];
  const tongyiRecord: OcrRecord = {
    id: makeKaOrderId(tongyiCreatedAt, 3_290_450),
    createdAt: tongyiCreatedAt,
    status: "pending_review",
    progress: 100,
    confidence: averageConfidence(tongyiPages),
    deliveryCount: 2,
    shippingCount: 0,
    images: tongyiImages,
    results: tongyiResults,
    driver: "向涛军",
    plateNo: "湘A·88231",
    signatureStatus: "perfect",
    aiVerdict: "pass",
  };
  const tongyiRecordFinal: OcrRecord = {
    ...tongyiRecord,
    aiRejectionReason: makeAiRejectionReason(tongyiRecord),
  };

  return [tongyiRecordFinal, realRecord, ...noSlipRecords, ...records];
}





// ---------- Main Workbench ----------
function Workbench() {
  const [records, setRecords] = useState<OcrRecord[]>(() => seedRecords());

  const [progressMinimized, setProgressMinimized] = useState(false);
  const [progressDismissed, setProgressDismissed] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailEditing, setDetailEditing] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Filters
  const [filterOpen, setFilterOpen] = useState(false);

  // Applied filters (only update after clicking "完成")
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedConfidenceTones, setSelectedConfidenceTones] = useState<Set<"high" | "mid" | "low">>(
    new Set(["high", "mid", "low"]),
  );
  const [aiVerdictFilter, setAiVerdictFilter] = useState<"all" | "pass" | "fail">("all");

  // Draft filters for the popover UI
  const [draftDateFrom, setDraftDateFrom] = useState("");
  const [draftDateTo, setDraftDateTo] = useState("");
  const [draftConfidenceTones, setDraftConfidenceTones] = useState<Set<"high" | "mid" | "low">>(
    new Set(["high", "mid", "low"]),
  );
  const [draftAiVerdictFilter, setDraftAiVerdictFilter] = useState<"all" | "pass" | "fail">("all");

  useEffect(() => {
    if (filterOpen) {
      setDraftDateFrom(dateFrom);
      setDraftDateTo(dateTo);
      setDraftConfidenceTones(new Set(selectedConfidenceTones));
      setDraftAiVerdictFilter(aiVerdictFilter);
    }
  }, [filterOpen, dateFrom, dateTo, selectedConfidenceTones, aiVerdictFilter]);

  const [quickStatus, setQuickStatus] = useState<"all" | "pending_review">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  // 筛选/搜索变化时重置到第一页
  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, selectedConfidenceTones, aiVerdictFilter, quickStatus, searchQuery]);


  const activeRecords = useMemo(
    () => records.filter((r) => r.status === "recognizing" || r.status === "queued"),
    [records],
  );

  const detailRecord = records.find((r) => r.id === detailId) ?? null;

  useEffect(() => {
    if (activeRecords.length === 0) return;
    const t = setInterval(() => {
      setRecords((prev) =>
        prev.map((r) => {
          if (r.status !== "recognizing") return r;
          const next = Math.min(100, r.progress + 4 + Math.random() * 6);
          if (next >= 100) {
            if (Math.random() < AI_FAILURE_CHANCE) {
              return {
                ...r,
                progress: 100,
                status: "failed",
                confidence: undefined,
                results: undefined,
                aiVerdict: undefined,
                aiRejectionReason: undefined,
                failedReason:
                  AI_FAILURE_REASONS[Math.floor(Math.random() * AI_FAILURE_REASONS.length)],
              };
            }
            const result = fabricateResult(r.images);
            // AI 结论：置信度 >= 80 通过，否则不通过
            const verdict: AiVerdict = result.confidence >= 80 ? "pass" : "fail";
            const updated: OcrRecord = {
              ...r,
              progress: 100,
              status: "pending_review",
              confidence: result.confidence,
              results: result.results,
              aiVerdict: verdict,
            };
            return { ...updated, aiRejectionReason: makeAiRejectionReason(updated) };
          }

          return { ...r, progress: next };
        }),
      );
    }, 500);
    return () => clearInterval(t);
  }, [activeRecords.length]);

  // 并发调度：最多同时识别 MAX_CONCURRENT_OCR 条，超出自动排队
  useEffect(() => {
    setRecords((prev) => {
      const running = prev.filter((r) => r.status === "recognizing").length;
      const slots = MAX_CONCURRENT_OCR - running;
      if (slots <= 0) return prev;
      const queuedOrdered = prev
        .filter((r) => r.status === "queued")
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, slots)
        .map((r) => r.id);
      if (queuedOrdered.length === 0) return prev;
      const promote = new Set(queuedOrdered);
      return prev.map((r) =>
        promote.has(r.id) ? { ...r, status: "recognizing" as Status, progress: 4 } : r,
      );
    });
  }, [records]);

  const filteredRecords = useMemo(() => {
    const allTonesSelected = selectedConfidenceTones.size === 3;
    const fromT = dateFrom ? new Date(dateFrom).getTime() : -Infinity;
    const toT = dateTo ? new Date(dateTo).getTime() + 86400000 : Infinity;
    return records.filter((r) => {
      if (quickStatus !== "all" && r.status !== quickStatus) return false;
      if (r.createdAt < fromT || r.createdAt > toT) return false;
      if (r.status !== "recognizing" && r.status !== "failed" && r.status !== "queued" && r.confidence != null) {
        const tone = confidenceTone(r.confidence / 100);
        if (!selectedConfidenceTones.has(tone)) return false;
      } else {
        if (!allTonesSelected) return false;
      }
      if (aiVerdictFilter !== "all" && r.aiVerdict !== aiVerdictFilter) return false;
      if (searchQuery.trim()) {
        const kaMatch = fuzzyMatch(searchQuery, r.id);
        const shippingMatch = r.shippingSlipNo ? fuzzyMatch(searchQuery, r.shippingSlipNo) : false;
        if (!kaMatch && !shippingMatch) return false;
      }
      return true;
    });
  }, [records, dateFrom, dateTo, selectedConfidenceTones, aiVerdictFilter, quickStatus, searchQuery]);

  const filterActive =
    !!dateFrom ||
    !!dateTo ||
    selectedConfidenceTones.size !== 3 ||
    aiVerdictFilter !== "all";

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const paginatedRecords = filteredRecords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);




  // 提交人工验收结论 → 状态置为已验收，模拟自动回传用户系统
  function submitVerification(id: string, verdict?: AiVerdict) {
    const target = records.find((r) => r.id === id);
    if (!target) return;
    if (target.status !== "pending_review" && target.status !== "failed") {
      toast.error("该任务当前状态无法提交验收");
      return;
    }

    const finalVerdict: AiVerdict = verdict ?? target.aiVerdict ?? "pass";
    setRecords((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: "verified",
              verifiedAt: Date.now(),
              verifiedBy: CURRENT_USER,
              aiVerdict: finalVerdict,
            }
          : r,
      ),
    );
    // 模拟回传接口
    console.log("[MOCK 回传用户系统]", {
      taskId: id,
      verifiedBy: CURRENT_USER,
      verifiedAt: new Date().toISOString(),
      signatureStatus: target.signatureStatus,
      aiVerdict: finalVerdict,
    });
    toast.success(
      finalVerdict === "pass" ? "已通过，结果已回传至用户系统" : "已标记不通过，结果已回传至用户系统",
    );
  }

  function mutateChunk(
    recordId: string,
    docType: DocType,
    pageIdx: number,
    chunkId: string,
    mut: (c: Chunk) => Chunk | null,
  ) {
    setRecords((prev) =>
      prev.map((r) => {
        if (r.id !== recordId || !r.results) return r;
        const pages = r.results[docType];
        if (!pages) return r;
        const newPages = pages.map((p, i) => {
          if (i !== pageIdx) return p;
          return {
            ...p,
            chunks: p.chunks.map((c) => {
              if (c.id !== chunkId) return c;
              return mut(c) ?? c;
            }),
          };
        });
        return { ...r, results: { ...r.results, [docType]: newPages } };
      }),
    );
  }

  function updateChunk(
    recordId: string,
    docType: DocType,
    pageIdx: number,
    chunkId: string,
    newContent: string,
  ) {
    mutateChunk(recordId, docType, pageIdx, chunkId, (c) => {
      if (c.content === newContent) return null;
      return {
        ...c,
        content: newContent,
        edited: true,
        confirmed: false,
        original: c.original ?? c.content,
        lastEdit: { by: CURRENT_USER, at: new Date().toISOString() },
      };
    });
  }


  function replaceResults(recordId: string, results: NonNullable<OcrRecord["results"]>) {
    setRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, results } : r)));
  }

  function updateSignatureStatus(recordId: string, signatureStatus: SignatureStatus) {
    setRecords((prev) =>
      prev.map((r) => (r.id === recordId ? { ...r, signatureStatus } : r)),
    );
  }




  function deleteRecord(id: string) {
    setRecords((p) => p.filter((r) => r.id !== id));
    if (detailId === id) setDetailId(null);
  }

  function resetFilters() {
    setDateFrom("");
    setDateTo("");
    setSelectedConfidenceTones(new Set(["high", "mid", "low"]));
    setAiVerdictFilter("all");
    setDraftDateFrom("");
    setDraftDateTo("");
    setDraftConfidenceTones(new Set(["high", "mid", "low"]));
    setDraftAiVerdictFilter("all");
  }

  function applyFilters() {
    setDateFrom(draftDateFrom);
    setDateTo(draftDateTo);
    setSelectedConfidenceTones(new Set(draftConfidenceTones));
    setAiVerdictFilter(draftAiVerdictFilter);
    setFilterOpen(false);
  }

  return (

    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </div>
              <div>
                <h1 className="text-base font-semibold leading-tight">验收单审核工作台</h1>
                <p className="text-xs text-muted-foreground">
                  自动同步司机上传 · AI 预识别 · 人工审核回传
                </p>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-6 py-6">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium">验收任务</span>
                <span className="text-xs text-muted-foreground">共 {filteredRecords.length}&nbsp;项</span>

              </div>
              <div className="mx-4 flex-1 max-w-md">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="搜索 KA 订单号 / 出货传票单号"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 w-full pl-9"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">

                <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
                  <span className="text-sm font-medium">仅查看未审核</span>
                  <Switch
                    checked={quickStatus === "pending_review"}
                    onCheckedChange={(checked) =>
                      setQuickStatus(checked ? "pending_review" : "all")
                    }
                    aria-label="仅查看未审核"
                  />
                </div>

                <Popover open={filterOpen} onOpenChange={setFilterOpen}>

                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn("gap-1", filterActive && "border-primary/60 text-primary")}
                    >
                      <Filter className="size-3.5" />
                      筛选
                      {filterActive && (
                        <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">
                          已启用
                        </span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[360px] p-0">
                    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Filter className="size-4 text-primary" />
                        筛选条件
                      </div>
                      <button
                        type="button"
                        onClick={resetFilters}
                        disabled={!filterActive}
                        className={cn(
                          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
                          !filterActive && "opacity-50 hover:bg-transparent",
                        )}
                      >
                        <RotateCcw className="size-3" />
                        重置
                      </button>
                    </div>
                    <div className="space-y-4 px-4 py-4">
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs text-muted-foreground">同步时间范围</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="date"
                            value={draftDateFrom}
                            onChange={(e) => setDraftDateFrom(e.target.value)}
                            className="h-9 flex-1"
                          />
                          <span className="text-xs text-muted-foreground">至</span>
                          <Input
                            type="date"
                            value={draftDateTo}
                            onChange={(e) => setDraftDateTo(e.target.value)}
                            className="h-9 flex-1"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs text-muted-foreground">置信度</Label>
                        <div className="flex gap-2">
                          {(["high", "mid", "low"] as const).map((tone) => {
                            const selected = draftConfidenceTones.has(tone);
                            return (
                              <button
                                key={tone}
                                type="button"
                                onClick={() => {
                                  setDraftConfidenceTones((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(tone)) {
                                      next.delete(tone);
                                    } else {
                                      next.add(tone);
                                    }
                                    return next;
                                  });
                                }}
                                className={cn(
                                  "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                                  selected
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                                )}
                              >
                                {CONFIDENCE_LABEL[tone]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs text-muted-foreground">AI 预审结论</Label>
                        <div className="flex gap-2">
                          {[
                            { value: "all", label: "全部" },
                            { value: "pass", label: "通过" },
                            { value: "fail", label: "不通过" },
                          ].map((opt) => {
                            const selected = draftAiVerdictFilter === opt.value;
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => setDraftAiVerdictFilter(opt.value as typeof draftAiVerdictFilter)}
                                className={cn(
                                  "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                                  selected
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                                )}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end border-t border-border bg-muted/30 px-4 py-2">
                      <Button size="sm" onClick={applyFilters}>
                        完成
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-[200px]">KA 订单号</TableHead>
                  <TableHead className="w-[150px]">同步时间</TableHead>
                  <TableHead>签收状态</TableHead>
                  <TableHead>置信度</TableHead>
                  <TableHead>AI预审结论</TableHead>
                  <TableHead>最终审核结论</TableHead>
                  <TableHead className="text-right">操作</TableHead>

                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-16 text-center">

                      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-muted-foreground">
                        <div className="grid size-12 place-items-center rounded-full bg-secondary">
                          <FileText className="size-5" />
                        </div>
                        <div className="text-sm">
                          {records.length === 0 ? "还没有审核单记录" : "没有符合当前筛选条件的记录"}
                        </div>
                        {records.length > 0 && (
                          <Button variant="outline" size="sm" onClick={resetFilters}>
                            <RotateCcw className="mr-1 size-4" /> 重置筛选
                          </Button>
                        )}

                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {paginatedRecords.map((r) => {
                  const inProgress = r.status === "recognizing" || r.status === "queued";
                  const canSelect = !inProgress && r.status !== "failed";
                  const pending = !inProgress && r.status !== "failed" ? pendingLowConf(r) : 0;
                  return (
                    <TableRow key={r.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs text-foreground">{r.id}</TableCell>
                      <TableCell className="text-sm text-muted-foreground" suppressHydrationWarning>
                        {fmtTime(r.createdAt)}
                      </TableCell>
                      <TableCell>
                        <SignatureBadge value={r.signatureStatus} />
                      </TableCell>
                      <TableCell>
                        {r.confidence != null ? (
                          <ConfidenceBadge score={r.confidence} />
                        ) : (
                          <EmptyBadge className="w-12" />
                        )}
                      </TableCell>
                      <TableCell>
                        {r.aiVerdict ? (
                          <VerdictBadge value={r.aiVerdict} />
                        ) : r.status === "recognizing" ? (
                          <span className="text-xs text-secondary-foreground">AI 识别中</span>
                        ) : r.status === "queued" ? (
                          <span className="text-xs text-muted-foreground">排队中</span>
                        ) : (
                          <EmptyBadge />
                        )}
                      </TableCell>

                      <TableCell>
                        <AuditConclusionBadge status={r.status} aiVerdict={r.aiVerdict} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {(r.status === "pending_review" || r.status === "failed") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-sm font-semibold text-primary hover:bg-primary/10 hover:text-primary"
                              onClick={() => {
                                setDetailId(r.id);
                                setDetailEditing(true);
                              }}
                            >
                              审核
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-sm font-semibold"
                            disabled={inProgress}
                            onClick={() => {
                              setDetailId(r.id);
                              setDetailEditing(false);
                            }}
                          >
                            查看
                          </Button>



                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteId(r.id)}
                              >
                                <Trash2 className="mr-2 size-4" />
                                删除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>

                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {filteredRecords.length > 0 && (
              <div className="flex items-center justify-center gap-2 border-t border-border px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  aria-label="上一页"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{page}</span>
                  {" / "}
                  {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  aria-label="下一页"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </div>
        </main>

        <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除</AlertDialogTitle>
              <AlertDialogDescription>
                {(() => {
                  const r = records.find((rec) => rec.id === deleteId);
                  return r
                    ? `确认删除任务 #${r.id} 吗？删除后无法恢复。`
                    : "确认删除该识别任务吗？删除后无法恢复。";
                })()}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setDeleteId(null)}>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (deleteId) deleteRecord(deleteId);
                  setDeleteId(null);
                }}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {!progressDismissed && activeRecords.length > 0 && (
          <div
            className={cn(
              "fixed bottom-6 right-6 z-40 w-[340px] overflow-hidden rounded-xl border border-border bg-card shadow-xl transition-all",
              progressMinimized && "w-[220px]",
            )}
          >
            <div className="flex items-center justify-between border-b border-border bg-primary/5 px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="size-4 animate-spin text-primary" />
                识别进行中 · {activeRecords.length}
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setProgressMinimized((m) => !m)}
                  aria-label="Minimize"
                >
                  <Minimize2 className="size-3.5" />
                </button>
                <button
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setProgressDismissed(true)}
                  aria-label="Close"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
            {!progressMinimized && (
              <div className="max-h-64 space-y-3 overflow-y-auto p-4">
                {activeRecords.map((r) => (
                  <div key={r.id}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-mono text-muted-foreground">{r.id}</span>
                      <span className="tabular-nums text-foreground">
                        {r.status === "queued" ? "排队中" : `${Math.round(r.progress)}%`}
                      </span>
                    </div>
                    <Progress value={r.status === "queued" ? 0 : r.progress} className="h-1.5" />
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {r.images.length} 张图片 · {r.status === "queued" ? `等待识别（最多同时识别 ${MAX_CONCURRENT_OCR} 条）` : "正在进行结构化识别"}
                    </div>
                  </div>
                ))}
                <div className="pt-1 text-[11px] text-muted-foreground">
                  关闭本弹窗不会中断识别过程
                </div>
              </div>
            )}
          </div>
        )}

        <Sheet open={!!detailRecord} onOpenChange={(o) => { if (!o) { setDetailId(null); setDetailEditing(false); }}}>
          <SheetContent
            side="right"
            className="flex w-[80vw] flex-col gap-0 p-0 sm:max-w-[80vw] [&>button]:hidden"
          >
            {detailRecord && (
              <DetailView
                record={detailRecord}
                initialEditing={detailEditing}
                onChange={(docType, pageIdx, chunkId, val) =>
                  updateChunk(detailRecord.id, docType, pageIdx, chunkId, val)
                }
                onReplaceResults={(results) => replaceResults(detailRecord.id, results)}
                onSignatureStatusChange={(value) => updateSignatureStatus(detailRecord.id, value)}
                onSubmit={(verdict) => {
                  submitVerification(detailRecord.id, verdict);
                  setDetailId(null);
                }}
              />

            )}
          </SheetContent>

        </Sheet>

        <Toaster position="top-center" richColors />
      </div>
    </TooltipProvider>
  );
}

// ---------- Sub components ----------
function NeutralTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-normal text-foreground">
      {children}
    </span>
  );
}

function EmptyBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="status"
      className={cn(
        "w-20 justify-center border-0 bg-muted font-normal text-muted-foreground",
        className,
      )}
    >
      —
    </Badge>
  );
}

function StatusBadge({ status, pending: _pending }: { status: Status; pending: number }) {
  if (status === "queued")
    return (
      <Badge variant="status" className="gap-1 bg-muted font-normal text-muted-foreground">
        <Loader2 className="size-3" /> 排队中
      </Badge>
    );
  if (status === "recognizing")
    return (
      <Badge variant="status" className="gap-1 bg-secondary font-normal text-secondary-foreground">
        <Loader2 className="size-3 animate-spin" /> AI 识别中
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge variant="status" className="gap-1 bg-destructive font-normal text-destructive-foreground shadow">
        <AlertTriangle className="size-3" /> 识别异常
      </Badge>
    );
  if (status === "pending_review")
    return (
      <Badge variant="status" className="gap-1 border-0 bg-[color:var(--warning)]/25 font-normal text-[color:var(--warning-foreground)]">
        <AlertTriangle className="size-3" /> 待审核
      </Badge>
    );
  return (
    <Badge variant="status" className="gap-1 border-0 bg-[color:var(--success)]/15 font-normal text-[color:var(--success)]">
      <CheckCircle2 className="size-3" /> 已审核
    </Badge>
  );
}

function AuditConclusionBadge({ status, aiVerdict }: { status: Status; aiVerdict?: AiVerdict }) {
  if (status === "verified" && aiVerdict === "pass")
    return (
      <Badge variant="status" className="w-20 justify-center gap-1 border-0 bg-[color:var(--success)]/15 font-normal text-[color:var(--success)]">
        <CheckCircle2 className="size-3" /> 通过
      </Badge>
    );
  if (status === "verified" && aiVerdict === "fail")
    return (
      <Badge variant="status" className="w-20 justify-center gap-1 border-0 bg-destructive/15 font-normal text-destructive">
        <X className="size-3" /> 不通过
      </Badge>
    );
  return (
    <Badge variant="status" className="w-20 justify-center border-0 bg-muted font-normal text-muted-foreground">
      —
    </Badge>
  );
}

function SignatureBadge({ value }: { value: SignatureStatus }) {
  if (value === "perfect")
    return (
      <Badge variant="status" className="gap-1 border-0 bg-[color:var(--success)]/15 font-normal text-[color:var(--success)]">
        <CheckCircle2 className="size-3" /> {SIGNATURE_LABEL[value]}
      </Badge>
    );
  return (
    <Badge variant="status" className="gap-1 border-0 bg-[color:var(--warning)]/25 font-normal text-[color:var(--warning-foreground)]">
      <AlertTriangle className="size-3" /> {SIGNATURE_LABEL[value]}
    </Badge>
  );
}

function VerdictBadge({ value }: { value: AiVerdict }) {
  if (value === "pass")
    return (
      <Badge variant="status" className="w-20 justify-center gap-1 border-0 bg-[color:var(--success)]/15 font-normal text-[color:var(--success)]">
        <CheckCircle2 className="size-3" /> {VERDICT_LABEL[value]}
      </Badge>
    );
  return (
    <Badge variant="status" className="w-20 justify-center gap-1 border-0 bg-[color:var(--warning)]/20 font-normal text-[color:var(--warning-foreground)]">
      <AlertTriangle className="size-3" /> {VERDICT_LABEL[value]}
    </Badge>
  );
}

const CONFIDENCE_LABEL: Record<"high" | "mid" | "low", string> = {
  high: "高",
  mid: "中",
  low: "低",
};

function ConfidenceBadge({ score }: { score: number }) {
  const tone = confidenceTone(score / 100);
  const Icon = tone === "high" ? CheckCircle2 : AlertTriangle;
  return (
    <Badge
      variant="status"
      className={cn(
        "w-12 justify-center gap-1 border-0 font-normal",
        confidenceBadgeClasses(tone),
      )}
    >
      <Icon className="size-3" />
      {CONFIDENCE_LABEL[tone]}
    </Badge>
  );
}

// ---------- Detail view ----------
function DetailView({
  record,
  initialEditing = false,
  onChange,
  onReplaceResults,
  onSignatureStatusChange,
  onSubmit,
}: {
  record: OcrRecord;
  initialEditing?: boolean;
  onChange: (docType: DocType, pageIdx: number, chunkId: string, value: string) => void;
  onReplaceResults: (results: NonNullable<OcrRecord["results"]>) => void;
  onSignatureStatusChange: (value: SignatureStatus) => void;
  onSubmit: (verdict?: AiVerdict) => void;
}) {


  const pending = pendingLowConf(record);
  const deliveryPages = record.results?.delivery_note ?? [];
  const deliveryImages = record.images.filter((i) => i.docType === "delivery_note");
  const shippingImages = record.images.filter((i) => i.docType === "shipping_slip");
  const [autoFocus, setAutoFocus] = useState(true);



  const [editing, setEditing] = useState(initialEditing);
  const [lastEditedAt, setLastEditedAt] = useState<number | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  // snapshot taken on entering edit mode — used to cancel
  const snapshotRef = useRef<NonNullable<OcrRecord["results"]> | null>(null);
  const hasChanges = lastEditedAt !== null;

  function startEdit() {
    // deep-clone current results so cancel can restore
    snapshotRef.current = JSON.parse(JSON.stringify(record.results ?? {})) as NonNullable<
      OcrRecord["results"]
    >;
    setLastEditedAt(null);
    setEditing(true);
  }
  useEffect(() => {
    if (initialEditing) startEdit();
  }, [initialEditing]);
  function discardAndClose() {
    if (snapshotRef.current) onReplaceResults(snapshotRef.current);
    snapshotRef.current = null;
    setLastEditedAt(null);
    setEditing(false);
    toast.info("已放弃本次修改");
  }
  function keepEditsAndClose() {
    snapshotRef.current = null;
    setLastEditedAt(null);
    setEditing(false);
    toast.success("修改已保存");
  }
  function requestCancel() {
    if (hasChanges) {
      setCancelConfirmOpen(true);
    } else {
      snapshotRef.current = null;
      setEditing(false);
    }
  }
  function handleEditChange(
    docType: DocType,
    pageIdx: number,
    chunkId: string,
    value: string,
  ) {
    onChange(docType, pageIdx, chunkId, value);
    if (editing) setLastEditedAt(Date.now());
  }
  function submitVerdict(verdict: AiVerdict) {
    snapshotRef.current = null;
    setLastEditedAt(null);
    setEditing(false);
    onSubmit(verdict);
  }

  return (
    <DetailRecordContext.Provider value={{ recordId: record.id, aiRejectionReason: record.aiRejectionReason }}>
    <>
      <SheetHeader className="border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <SheetTitle className="flex flex-wrap items-center gap-2">
              任务详情
              <NeutralTag>
                {STATUS_LABEL[record.status] ?? record.status}
              </NeutralTag>
              <NeutralTag>{SIGNATURE_LABEL[record.signatureStatus]}</NeutralTag>
              {editing && (
                <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                  <Pencil className="size-3" /> 编辑中
                </span>
              )}
            </SheetTitle>
            {record.aiVerdict && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">ai识别结果：</span>
                <VerdictBadge value={record.aiVerdict} />
                <ConfidenceBadge score={record.confidence ?? 0} />
              </div>
            )}
            <SheetDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
              <span>#{record.id}</span>
              <span>
                {record.driver} · {record.plateNo}
              </span>
              <span>同步 {fmtTime(record.createdAt)}</span>
              {record.verifiedAt && (
                <span className="text-[color:var(--success)]">
                  已验收 {fmtTime(record.verifiedAt)} · {record.verifiedBy}
                </span>
              )}
            </SheetDescription>
          </div>
          <div className="flex items-center gap-2">
            {!editing && (
              <>
                {record.status === "pending_review" ? (
                  <Button onClick={startEdit} className="gap-2">
                    <Pencil className="size-4" /> 开始审核
                  </Button>
                ) : record.status === "verified" ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[color:var(--success)]/15 px-2 py-1 text-xs text-[color:var(--success)]">
                    <CheckCircle2 className="size-3.5" /> 已验收并回传
                  </span>
                ) : null}
              </>
            )}
            <SheetClose asChild>
              <Button variant="outline" size="icon" className="shrink-0" aria-label="关闭">
                <X className="size-4" />
              </Button>
            </SheetClose>
          </div>
        </div>
      {record.status === "pending_review" &&
        record.aiVerdict === "fail" &&
        record.aiRejectionReason && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-[color:var(--destructive)]/20 bg-[color:var(--destructive)]/10 px-4 py-3 text-xs text-[color:var(--destructive)]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1 leading-relaxed">
              <span className="font-semibold">AI 预审不通过原因：</span>
              {record.aiRejectionReason}
            </div>
          </div>
        )}
      </SheetHeader>

      <DocPanel
        deliveryPages={deliveryPages}
        deliveryImages={deliveryImages}
        shippingImages={shippingImages}
        editing={editing}
        autoFocus={autoFocus}
        setAutoFocus={setAutoFocus}
        failureReason={record.failedReason}
        onChange={(pageIdx, chunkId, v) =>
          handleEditChange("delivery_note", pageIdx, chunkId, v)
        }
      />




      {(editing || record.status === "failed") && (
        <div className="shrink-0 border-t border-border bg-background px-6 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.15)]">
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs text-muted-foreground">
              {record.status === "failed" ? (
                <span className="text-[color:var(--destructive)]">
                  AI 识别失败，请进行人工验收
                </span>
              ) : lastEditedAt ? (
                <span className="inline-flex items-center gap-1">
                  <Pencil className="size-3" />
                  最后修改：{fmtTime(lastEditedAt)}
                </span>
              ) : (
                <span className="text-muted-foreground/70">尚未修改</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {record.status === "failed" ? (
                <SheetClose asChild>
                  <Button variant="outline" className="gap-2">
                    <X className="size-4" /> 取消
                  </Button>
                </SheetClose>
              ) : (
                <Button variant="outline" onClick={requestCancel} className="gap-2">
                  <X className="size-4" /> 取消
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => submitVerdict("fail")}
                className="gap-2 border-[color:var(--destructive)]/40 text-[color:var(--destructive)] hover:bg-[color:var(--destructive)]/10 hover:text-[color:var(--destructive)]"
              >
                <ThumbsDown className="size-4" /> 不通过
              </Button>
              <Button
                onClick={() => submitVerdict("pass")}
                className="gap-2 bg-[color:var(--success)] text-white hover:bg-[color:var(--success)]/90"
              >
                <ThumbsUp className="size-4" /> 通过
              </Button>
            </div>
          </div>
        </div>
      )}


      <AlertDialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>是否保存刚刚编辑的信息？</AlertDialogTitle>
            <AlertDialogDescription>
              你已经修改了识别结果但未提交验收结论。选择「保存修改」将保留修改内容并退出编辑；选择「放弃修改」将恢复到进入编辑前的状态。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setCancelConfirmOpen(false);
                discardAndClose();
              }}
            >
              放弃修改
            </Button>
            <AlertDialogAction
              onClick={() => {
                setCancelConfirmOpen(false);
                keepEditsAndClose();
              }}
            >
              保存修改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
    </DetailRecordContext.Provider>
  );
}

function DocPanel({
  deliveryPages,
  deliveryImages,
  shippingImages,
  editing,
  autoFocus,
  setAutoFocus,
  failureReason,
  onChange,
}: {
  deliveryPages: DocPage[];
  deliveryImages: UploadedImage[];
  shippingImages: UploadedImage[];
  editing: boolean;
  autoFocus: boolean;
  setAutoFocus: (v: boolean) => void;
  failureReason?: string;
  onChange: (pageIdx: number, chunkId: string, value: string) => void;
}) {

  // Image (left) and result (right) navigation are linked for delivery notes:
  // switching the delivery-note image switches the recognition-result page, and vice versa.
  const [deliveryImgIdx, setDeliveryImgIdx] = useState(0);
  const [shippingIdx, setShippingIdx] = useState(0);
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [viewMap, setViewMap] = useState<Record<string, ImgView>>({});
  const [imageTab, setImageTab] = useState<"delivery_note" | "shipping_slip">(
    deliveryImages.length ? "delivery_note" : "shipping_slip",
  );

  const deliveryImage = deliveryImages[deliveryImgIdx];
  const shippingImage = shippingImages[shippingIdx];
  // Derive the recognition-result page from the current delivery image so they stay in sync.
  const pageIdx = Math.max(
    0,
    deliveryImage ? deliveryPages.findIndex((p) => p.imageId === deliveryImage.id) : 0,
  );
  const page = deliveryPages[pageIdx];

  const showingShipping = imageTab === "shipping_slip" && !!shippingImage;
  const leftImage = showingShipping ? shippingImage : deliveryImage;
  const leftDeliveryPage = deliveryImage
    ? deliveryPages.find((p) => p.imageId === deliveryImage.id)
    : undefined;
  const leftPage: DocPage | undefined =
    showingShipping && shippingImage
      ? {
          imageId: shippingImage.id,
          sourceImage: shippingImage.name,
          pageBox: [0, 0, shippingImage.width, shippingImage.height],
          chunks: [],
        }
      : leftDeliveryPage ??
        (deliveryImage
          ? {
              imageId: deliveryImage.id,
              sourceImage: deliveryImage.name,
              pageBox: [0, 0, deliveryImage.width, deliveryImage.height],
              chunks: [],
            }
          : undefined);


  const scrollRef = useRef<HTMLDivElement>(null);
  const chunkRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Resizable split: left (image) width percentage, clamped to 50%~80%.
  const [leftPct, setLeftPct] = useState(38);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!resizingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(60, Math.max(30, pct)));
    };
    const handleUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  useEffect(() => {
    if (!activeChunkId) return;
    const el = chunkRefs.current[activeChunkId];
    const container = scrollRef.current;
    if (!el || !container) return;
    const elRect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const delta = elRect.top - containerRect.top - 12;
    container.scrollTo({ top: container.scrollTop + delta, behavior: "smooth" });
  }, [activeChunkId, pageIdx]);

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden">
      {/* LEFT: image (tabs switch between delivery_note & shipping_slip) */}
      <div
        className="flex flex-col overflow-hidden bg-muted/30"
        style={{ flex: `0 0 ${leftPct}%`, minWidth: 0 }}
      >
        <div className="flex h-10 items-center justify-between gap-3 border-b border-border bg-background/60 px-3 py-1.5">
          <div className="flex items-center gap-1">
            {deliveryImages.length > 0 && (
              <button
                type="button"
                onClick={() => setImageTab("delivery_note")}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2 py-1 text-xs",
                  imageTab === "delivery_note"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                <Truck className="size-3.5" /> 送货单
                <span className="rounded bg-black/10 px-1 text-[10px] tabular-nums">
                  {deliveryImages.length}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setImageTab("shipping_slip")}
              disabled={shippingImages.length === 0}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-1 text-xs",
                imageTab === "shipping_slip"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
                shippingImages.length === 0 && "cursor-default opacity-60",
              )}
            >
              <ScrollText className="size-3.5" /> 出货传票
              <span className="rounded bg-black/10 px-1 text-[10px] tabular-nums">
                {shippingImages.length}
              </span>
            </button>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
          {leftImage && leftPage ? (
            <ImageWithBoxes
              image={leftImage}
              page={leftPage}
              activeChunkId={showingShipping ? null : activeChunkId}
              onSelect={setActiveChunkId}
              autoFocus={!showingShipping && autoFocus}
              setAutoFocus={setAutoFocus}
              showAutoFocus={!showingShipping}
              viewMap={viewMap}
              setViewMap={setViewMap}
              navIndex={showingShipping ? shippingIdx : deliveryImgIdx}
              navCount={showingShipping ? shippingImages.length : deliveryImages.length}
              onPrev={() => {
                if (showingShipping) {
                  setShippingIdx((i) => Math.max(0, i - 1));
                } else {
                  setDeliveryImgIdx((i) => Math.max(0, i - 1));
                }
              }}
              onNext={() => {
                if (showingShipping) {
                  setShippingIdx((i) => Math.min(shippingImages.length - 1, i + 1));
                } else {
                  setDeliveryImgIdx((i) => Math.min(deliveryImages.length - 1, i + 1));
                }
              }}
              navLabel={"张"}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              未上传该类别的图片
            </div>
          )}
        </div>
      </div>

      {/* Resizer */}
      <div
        className="relative z-10 flex shrink-0 items-stretch justify-center border-x border-border hover:bg-primary/5 active:bg-primary/10"
        style={{ width: 8, cursor: "col-resize" }}
        onMouseDown={(e) => {
          e.preventDefault();
          resizingRef.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
      >
        <div className="pointer-events-none absolute top-1/2 -translate-y-1/2 flex h-20 w-5 items-center justify-center rounded-full bg-muted hover:bg-primary/20">
          <GripVertical className="size-4 text-muted-foreground" />
        </div>
      </div>

      {/* RIGHT: recognition results (always delivery_note) */}
      <div className="flex flex-1 flex-col overflow-hidden" style={{ minWidth: 0 }}>
        <div className="flex h-10 items-center justify-between gap-3 border-b border-border bg-background/60 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium text-foreground">
              {failureReason ? "识别失败" : "识别结果 · 送货单"}
            </h3>
            {!failureReason && deliveryPages.length > 1 && (
              <div className="inline-flex items-center gap-1 rounded border border-border bg-background/80 px-1 py-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const prev = deliveryPages[pageIdx - 1];
                    if (!prev) return;
                    const nextImgIdx = deliveryImages.findIndex((img) => img.id === prev.imageId);
                    if (nextImgIdx >= 0) setDeliveryImgIdx(nextImgIdx);
                    setActiveChunkId(null);
                  }}
                  disabled={pageIdx === 0}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-40"
                  aria-label="上一份"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span className="min-w-[3.5rem] text-center text-[11px] tabular-nums text-muted-foreground">
                  第 {pageIdx + 1} / {deliveryPages.length} 份
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const nxt = deliveryPages[pageIdx + 1];
                    if (!nxt) return;
                    const nextImgIdx = deliveryImages.findIndex((img) => img.id === nxt.imageId);
                    if (nextImgIdx >= 0) setDeliveryImgIdx(nextImgIdx);
                    setActiveChunkId(null);
                  }}
                  disabled={pageIdx >= deliveryPages.length - 1}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-40"
                  aria-label="下一份"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            )}
          </div>
          {!failureReason && (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className={cn("size-2 rounded-sm", confidenceDotClasses("high"))} />高
              </span>
              <span className="inline-flex items-center gap-1">
                <span className={cn("size-2 rounded-sm", confidenceDotClasses("mid"))} />中
              </span>
              <span className="inline-flex items-center gap-1">
                <span className={cn("size-2 rounded-sm", confidenceDotClasses("low"))} />低
              </span>
            </div>
          )}
        </div>
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
        >
          <div className="space-y-0.5 px-4 py-3">
            {failureReason ? (
              <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/5 p-8 text-center">
                <AlertTriangle className="mb-2 size-8 text-[color:var(--destructive)]" />
                <div className="text-sm font-medium text-[color:var(--destructive)]">
                  AI 识别失败原因
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{failureReason}</div>
              </div>
            ) : page ? (
              (() => {
                const groups = groupChunksByRegion(page.chunks);
                const renderChunk = (c: Chunk) => (
                  <div
                    key={c.id}
                    ref={(el) => {
                      chunkRefs.current[c.id] = el;
                    }}
                  >
                    <ChunkEditor
                      chunk={c}
                      active={activeChunkId === c.id}
                      editing={editing}
                      onFocus={() => setActiveChunkId(c.id)}
                      onChange={(v) => onChange(pageIdx, c.id, v)}
                    />
                  </div>
                );
                return (
                  <div className="space-y-3">
                    {groups.top.length > 0 && (
                      <ChunkRegion title="基本信息" count={groups.top.length} defaultOpen={false}>
                        {groups.top.map(renderChunk)}
                      </ChunkRegion>
                    )}
                    {groups.middle.length > 0 && (
                      <ChunkRegion title="货品明细" count={groups.middle.length} defaultOpen={true}>
                        {groups.middle.map(renderChunk)}
                      </ChunkRegion>
                    )}
                    {groups.bottom.length > 0 && (
                      <ChunkRegion
                        title="本单信息 / 签字盖章"
                        count={groups.bottom.length}
                        defaultOpen={false}
                      >
                        {groups.bottom.map(renderChunk)}
                      </ChunkRegion>
                    )}
                  </div>
                );
              })()
            ) : (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                暂无识别结果
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

function ChunkRegion({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-1 py-1 text-left text-xs font-medium text-foreground hover:text-foreground/80"
      >
        <span className="flex items-center gap-1.5">
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
          <span className="text-muted-foreground">{title}</span>
        </span>
        <span className="text-[11px] font-normal text-muted-foreground">
          {count} 项
        </span>
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </section>
  );
}




type ImgView = {
  scale: number;
  tx: number; // px offset from centered
  ty: number;
  rotation: number; // degrees, multiples of 90
  manual: boolean; // once user adjusts, stop auto-focus on active chunk
};
const DEFAULT_IMG_VIEW: ImgView = { scale: 1, tx: 0, ty: 0, rotation: 0, manual: false };

function ImageWithBoxes({
  image,
  page,
  activeChunkId,
  onSelect,
  autoFocus,
  setAutoFocus,
  showAutoFocus,
  viewMap,
  setViewMap,
  navIndex,
  navCount,
  onPrev,
  onNext,
  navLabel,
}: {
  image: UploadedImage;
  page: DocPage;
  activeChunkId: string | null;
  onSelect: (id: string | null) => void;
  autoFocus: boolean;
  setAutoFocus?: (v: boolean) => void;
  showAutoFocus?: boolean;
  viewMap: Record<string, ImgView>;
  setViewMap: React.Dispatch<React.SetStateAction<Record<string, ImgView>>>;
  navIndex?: number;
  navCount?: number;
  onPrev?: () => void;
  onNext?: () => void;
  navLabel?: string;
}) {
  const [w, h] = [page.pageBox[2] || image.width, page.pageBox[3] || image.height];
  const view = viewMap[image.id] ?? DEFAULT_IMG_VIEW;

  const updateView = (patch: Partial<ImgView> | ((v: ImgView) => Partial<ImgView>)) => {
    setViewMap((m) => {
      const cur = m[image.id] ?? DEFAULT_IMG_VIEW;
      const next = typeof patch === "function" ? patch(cur) : patch;
      return { ...m, [image.id]: { ...cur, ...next, manual: true } };
    });
  };
  const resetView = () => {
    setViewMap((m) => {
      const { [image.id]: _drop, ...rest } = m;
      return rest;
    });
    onSelect(null);
  };
  const zoomBy = (factor: number) =>
    updateView((v) => ({ scale: Math.min(6, Math.max(0.3, v.scale * factor)) }));
  const rotateBy = (delta: number) =>
    setViewMap((m) => {
      const cur = m[image.id] ?? DEFAULT_IMG_VIEW;
      const rotation = (((cur.rotation + delta) % 360) + 360) % 360;
      return { ...m, [image.id]: { ...cur, rotation } };
    });

  // A click on a bbox or a chunk always focuses the corresponding region,
  // regardless of the auto-focus toggle or prior manual pan/zoom.
  const activeChunk = page.chunks.find((c) => c.id === activeChunkId);
  let transform: string;
  let transitionCls = "";
  if (activeChunk) {
    const [x1, y1, x2, y2] = activeChunk.bbox;
    const bw = Math.max(1, x2 - x1 + 20);
    const fx = (x1 + x2) / 2 / w;
    const fy = (y1 + y2) / 2 / h;
    const scale = Math.min(4, Math.max(1, w / bw));
    const tx = (0.5 - fx) * 100;
    const ty = (0.5 - fy) * 100;
    transform = `translate(${tx}%, ${ty}%) scale(${scale}) rotate(${view.rotation}deg)`;
    transitionCls = "transition-transform duration-500 ease-out";
  } else {
    transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale}) rotate(${view.rotation}deg)`;
  }


  // Wheel to zoom
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        updateView((v) => ({ scale: Math.min(6, Math.max(0.3, v.scale * factor)) }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.id]);

  // Drag to pan
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-bbox]")) return; // let bbox clicks through
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    updateView({ tx: dragRef.current.tx + dx, ty: dragRef.current.ty + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const isDefaultFit =
    !view.manual && view.scale === 1 && view.tx === 0 && view.ty === 0 && view.rotation === 0;
  const isAutoFocused = !!activeChunk;
  const showReset = !isDefaultFit || isAutoFocused;

  return (
    <div className="flex h-full w-full max-w-full flex-col overflow-hidden rounded-lg border border-border bg-background">

      <div
        ref={stageRef}
        className={cn(
          "relative flex-1 flex items-center justify-center overflow-hidden p-4 select-none",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="relative w-full max-w-full"
          style={{ aspectRatio: `${w} / ${h}` }}
        >
          <div
            className={cn("absolute inset-0", transitionCls)}
            style={{ transform, transformOrigin: "50% 50%" }}
          >
            <img
              src={image.url}
              alt={image.name}
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain pointer-events-none"
            />
            {autoFocus && (
              <div className="absolute inset-0">
                {page.chunks.map((c) => {
                  const [x1, y1, x2, y2] = c.bbox;
                  const tone = confidenceTone(c.confidence);
                  const isActive = c.id === activeChunkId;
                  const color = confidenceBorderClasses(tone);
                  return (
                    <button
                      type="button"
                      key={c.id}
                      data-bbox
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(c.id);
                      }}
                      className={cn(
                        "absolute cursor-pointer border transition-all hover:z-10 hover:shadow-md",
                        color,
                        isActive && "z-20 ring-2 ring-primary ring-offset-1",
                      )}
                      style={{
                        left: `${(x1 / w) * 100}%`,
                        top: `${(y1 / h) * 100}%`,
                        width: `${((x2 - x1) / w) * 100}%`,
                        height: `${((y2 - y1) / h) * 100}%`,
                      }}
                      title={`${c.label}${c.confidence != null ? ` · ${CONFIDENCE_LABEL[confidenceTone(c.confidence)]}` : ""}`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {/* Floating controls */}
        <div
          className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border/50 bg-background/90 px-2 py-1.5 shadow-lg backdrop-blur-sm"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => zoomBy(1.2)}
            aria-label="放大"
            title="放大"
          >
            <ZoomIn className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => zoomBy(1 / 1.2)}
            aria-label="缩小"
            title="缩小"
          >
            <ZoomOut className="size-4" />
          </Button>
          <div className="mx-1 h-4 w-px bg-border" />
          {navCount && navCount > 1 ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-full text-muted-foreground hover:text-foreground disabled:opacity-40"
                onClick={onPrev}
                disabled={navIndex === 0}
                aria-label="上一页"
                title="上一页"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-10 text-center text-[11px] tabular-nums text-muted-foreground">
                {navIndex ? navIndex + 1 : 1} / {navCount}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-full text-muted-foreground hover:text-foreground disabled:opacity-40"
                onClick={onNext}
                disabled={navIndex === navCount - 1}
                aria-label="下一页"
                title="下一页"
              >
                <ChevronRight className="size-4" />
              </Button>
              <div className="mx-1 h-4 w-px bg-border" />
            </>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => rotateBy(-90)}
            aria-label="逆时针旋转"
            title="逆时针旋转"
          >
            <RotateCcw className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => rotateBy(90)}
            aria-label="顺时针旋转"
            title="顺时针旋转"
          >
            <RotateCw className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 rounded-full px-2 text-xs disabled:opacity-40",
              showReset ? "text-primary hover:text-primary" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={resetView}
            disabled={!showReset}
            aria-label="重置视图"
            title="重置视图"
          >
            重置
          </Button>
        </div>

        {showAutoFocus && setAutoFocus && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "absolute right-3 top-3 z-20 gap-1.5 rounded-full border border-border/50 bg-background/90 px-2.5 py-1 shadow-sm backdrop-blur-sm hover:bg-background",
              autoFocus ? "text-primary hover:text-primary" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setAutoFocus(!autoFocus)}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={autoFocus ? "图片与文本已连接" : "图片与文本已断开"}
            title={autoFocus ? "图片与识别结果联动中" : "图片与识别结果已断开"}
          >
            {autoFocus ? <Link className="size-4" /> : <Link2Off className="size-4" />}
            <span className="text-xs">{autoFocus ? "自动聚焦" : "断开聚焦"}</span>
          </Button>
        )}

        {(!navCount || navCount <= 1) && (
          <div
            className="absolute top-4 left-4 z-20 max-w-[40%] truncate rounded-full border border-border/50 bg-background/90 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="font-medium text-foreground">{image.name}</span>
            <span> · {w} × {h}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function fmtEditLog(e: EditLog) {
  const d = new Date(e.at);
  return `${e.by} · ${d.toLocaleString("zh-CN", { hour12: false })}`;
}

function ChunkEditor({
  chunk,
  active,
  editing,
  onFocus,
  onChange,
}: {
  chunk: Chunk;
  active: boolean;
  editing: boolean;
  onFocus: () => void;
  onChange: (newContent: string) => void;
}) {
  const tone = confidenceTone(chunk.confidence);
  const isLow =
    chunk.label !== "Image" && chunk.confidence != null && chunk.confidence < LOW_CONF_THRESHOLD;
  const needsReview = isLow && !chunk.edited && !chunk.confirmed;

  const dotColor = confidenceDotClasses(tone);

  const meta = LABEL_META[chunk.label];
  const Icon = meta.icon;

  return (
    <div
      onClick={onFocus}
      className={cn(
        "flex items-start gap-2 py-1.5 pr-1 transition-colors",
        active && "bg-primary/5",
      )}
    >
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dotColor)} />
      <div className="min-w-0 flex-1">
        {active && (
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
                chunk.label === "Section-Header"
                  ? "bg-primary/10 text-primary"
                  : chunk.label === "Table"
                    ? "bg-accent text-accent-foreground"
                    : chunk.label === "Image"
                      ? "bg-muted text-muted-foreground"
                      : "bg-secondary text-secondary-foreground",
              )}
            >
              <Icon className="size-3" />
              {meta.text}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              [{chunk.bbox.join(", ")}]
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            {chunk.edited && (
              <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                <Pencil className="size-2.5" /> 已修改
              </span>
            )}
            {chunk.confirmed && !chunk.edited && (
              <span className="inline-flex items-center gap-1 rounded bg-[color:var(--success)]/15 px-1.5 py-0.5 text-[color:var(--success)]">
                <CheckCircle2 className="size-2.5" /> 已确认
              </span>
            )}
            {chunk.confidence != null ? (
              <span
                className={cn(
                  confidenceTextClasses(tone),
                )}
              >
                置信度 {CONFIDENCE_LABEL[tone]}{needsReview && " · 待人工核验"}
              </span>
            ) : (
              <span className="text-muted-foreground">未评分</span>
            )}
          </div>
        </div>
      )}
      {!active && (chunk.edited || (chunk.confirmed && !chunk.edited) || needsReview) && (
        <div className="mb-0.5 flex items-center gap-1.5 text-[10px]">
          {chunk.edited && (
            <span className="inline-flex items-center gap-0.5 text-primary">
              <Pencil className="size-2.5" /> 已修改
            </span>
          )}
          {chunk.confirmed && !chunk.edited && (
            <span className="inline-flex items-center gap-0.5 text-[color:var(--success)]">
              <CheckCircle2 className="size-2.5" /> 已确认
            </span>
          )}
          {needsReview && (
            <span className="text-[color:var(--warning-foreground)]">待人工核验</span>
          )}
        </div>
      )}

      <ChunkContentEditor
        chunk={chunk}
        onChange={onChange}
        mustEdit={needsReview}
        readOnly={!editing}
      />


      {chunk.lastEdit && active && (
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {chunk.edited ? "最近修改" : "确认于"}：{fmtEditLog(chunk.lastEdit)}
        </div>
      )}
      </div>
    </div>
  );
}


function AutoResizeTextarea({
  value,
  maxRows = 5,
  className,
  ...props
}: React.ComponentProps<"textarea"> & { maxRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure single-row height via a hidden clone to avoid touching React state.
    const clone = el.cloneNode(true) as HTMLTextAreaElement;
    clone.style.height = "auto";
    clone.style.overflow = "hidden";
    clone.style.position = "fixed";
    clone.style.visibility = "hidden";
    clone.style.top = "-9999px";
    clone.value = "M";
    document.body.appendChild(clone);
    const rowHeight = clone.scrollHeight;
    document.body.removeChild(clone);

    const maxHeight = rowHeight * maxRows;
    el.style.height = "auto";
    el.style.overflow = "hidden";
    const targetHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${targetHeight}px`;
    el.style.overflow = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, maxRows]);
  return (
    <Textarea
      ref={ref}
      value={value}
      rows={1}
      className={cn("resize-none overflow-hidden !min-h-9 py-1", className)}
      {...props}
    />
  );
}

function ChunkContentEditor({
  chunk,
  onChange,
  mustEdit,
  readOnly,
}: {
  chunk: Chunk;
  onChange: (v: string) => void;
  mustEdit: boolean;
  readOnly?: boolean;
}) {
  const ring = mustEdit
    ? "border-[color:var(--warning)] focus-visible:ring-[color:var(--warning)]"
    : "";
  const roCls = readOnly
    ? "cursor-default border-none bg-background shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
    : "";

  if (chunk.label === "Image") {
    return (
      <div className="rounded border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">图像分块（不参与文本编辑）</div>
        <div className="font-mono">{chunk.content.trim()}</div>
      </div>
    );
  }

  if (chunk.label === "Table") {
    return (
      <TableChunkView
        chunk={chunk}
        onChange={onChange}
        mustEdit={mustEdit}
        readOnly={!!readOnly}
      />
    );
  }

  // Section-Header / Text: edit plain text; store back as <p>...</p>
  const text = htmlToText(chunk.content);
  const handle = (v: string) => onChange(textToHtml(v));

  // Section header: render as a distinctive section title (not a form field).
  if (chunk.label === "Section-Header") {
    return (
      <AutoResizeTextarea
        value={text}
        readOnly={readOnly}
        onChange={(e) => handle(e.target.value)}
        className={cn(
          "border-none bg-transparent px-0 text-base font-semibold text-foreground shadow-none focus-visible:ring-0",
          mustEdit && "text-[color:var(--warning-foreground)]",
          roCls,
        )}
      />
    );
  }

  // Text: try to parse "字段: 值" into a labeled form row so reviewers can
  // scan structured fields quickly and only edit the value part.
  const kv = parseKeyValue(text);
  const isMulti = text.length > 60 || text.includes("\n");

  if (kv && !isMulti) {
    const handleLabel = (newLabel: string) =>
      handle(`${newLabel}${kv.sep}${kv.value}`);
    const handleValue = (newVal: string) =>
      handle(`${kv.label}${kv.sep}${newVal}`);
    return (
      <div className="grid grid-cols-[minmax(10rem,30%)_minmax(0,1fr)] items-start gap-3">
        <div className="min-w-0">
          <AutoResizeTextarea
            value={kv.label}
            readOnly={readOnly}
            onChange={(e) => handleLabel(e.target.value)}
            placeholder="（字段名）"
            className={cn(
              "text-xs font-medium text-muted-foreground",
              roCls,
            )}
          />
        </div>
        <div className="min-w-0">
          <AutoResizeTextarea
            value={kv.value}
            readOnly={readOnly}
            onChange={(e) => handleValue(e.target.value)}
            placeholder="（空）"
            className={cn(ring, roCls)}
          />
        </div>
      </div>
    );
  }

  return (
    <AutoResizeTextarea
      value={text}
      readOnly={readOnly}
      onChange={(e) => handle(e.target.value)}
      className={cn(ring, roCls)}
    />
  );
}

// Parse "标签: 值" / "标签：值" — keeps the original separator so round-trips
// don't lose punctuation. Returns null if no clear label part is present.
function parseKeyValue(
  text: string,
): { label: string; sep: string; value: string } | null {
  const m = text.match(/^\s*([^：:\n]{1,20}?)\s*([：:])\s*([\s\S]*)$/);
  if (!m) return null;
  const label = m[1].trim();
  if (!label) return null;
  return { label, sep: `${m[2]} `, value: m[3] };
}

function EditableTableHtml({
  html,
  readOnly,
  mustEdit,
  onChange,
}: {
  html: string;
  readOnly: boolean;
  mustEdit: boolean;
  onChange: (v: string) => void;
}) {
  const { aiRejectionReason } = useContext(DetailRecordContext);
  const mismatchSourceLabel = aiRejectionReason
    ? REJECTION_SOURCE_LABEL[aiRejectionReason]
    : "签收数据";
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastAppliedHtmlRef = useRef<string>("");
  // 选中单元格：bodyRow 为 tbody 内行号（0 起）；-1 表示位于 thead
  const [sel, setSel] = useState<{ bodyRow: number; col: number } | null>(null);

  const syncTitles = (el: HTMLElement) => {
    el.querySelectorAll("td").forEach((td) => {
      const text = (td.textContent || "").trim();
      if (text) td.setAttribute("title", text);
      else td.removeAttribute("title");
    });
  };

  // 根据表头文字自然宽度，为每列设置最小宽度（列名可完整展示），
  // 单元格超出则省略号显示；容器变宽时按比例分配剩余空间。
  const layoutTable = () => {
    const el = ref.current;
    const wrap = wrapRef.current;
    if (!el || !wrap) return;
    const table = el.querySelector("table") as HTMLTableElement | null;
    if (!table) return;

    // 先以自然布局测量列头需要的宽度
    table.style.tableLayout = "auto";
    table.style.width = "auto";
    const oldCg = table.querySelector("colgroup[data-auto]");
    if (oldCg) oldCg.remove();

    const ths = Array.from(table.querySelectorAll("thead th")) as HTMLElement[];
    if (ths.length === 0) return;
    const widths = ths.map((th) => Math.ceil(th.getBoundingClientRect().width) + 2);

    const cg = document.createElement("colgroup");
    cg.setAttribute("data-auto", "");
    widths.forEach((w) => {
      const c = document.createElement("col");
      c.style.width = `${w}px`;
      cg.appendChild(c);
    });
    table.insertBefore(cg, table.firstChild);

    const sum = widths.reduce((a, b) => a + b, 0);
    const available = Math.max(0, wrap.clientWidth);
    table.style.tableLayout = "fixed";
    table.style.width = `${Math.max(sum, available)}px`;
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (html !== lastAppliedHtmlRef.current) {
      el.innerHTML = html;
      lastAppliedHtmlRef.current = html;
    }
    annotateMismatchesInDOM(el, mismatchSourceLabel);
    syncTitles(el);
    layoutTable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, mismatchSourceLabel]);

  // 容器宽度变化时重新计算列宽
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => layoutTable());
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 记录选中单元格：点击 td / th 时更新
  const handleCellFocus = (e: React.MouseEvent | React.FocusEvent) => {
    const target = e.target as HTMLElement;
    const cell = target.closest("td, th") as HTMLTableCellElement | null;
    if (!cell) return;
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!row) return;
    const inThead = !!row.closest("thead");
    const col = cell.cellIndex;
    if (inThead) {
      setSel({ bodyRow: -1, col });
    } else {
      const tbody = row.parentElement as HTMLTableSectionElement | null;
      if (!tbody) return;
      const bodyRow = Array.from(tbody.children).indexOf(row);
      setSel({ bodyRow, col });
    }
  };

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    syncTitles(el);
    const clean = stripMismatchAnnotations(el.innerHTML);
    lastAppliedHtmlRef.current = clean;
    onChange(clean);
    // 布局可能因行列数变化需要重新计算
    requestAnimationFrame(() => {
      const cur = ref.current;
      if (cur) annotateMismatchesInDOM(cur, mismatchSourceLabel);
      layoutTable();
    });
  };

  const getTable = () => ref.current?.querySelector("table") as HTMLTableElement | null;

  const insertRow = (offset: 0 | 1) => {
    const table = getTable();
    if (!table) return;
    const tbody = table.querySelector("tbody");
    if (!tbody) return;
    const colCount =
      (table.querySelector("thead tr")?.children.length ??
        tbody.querySelector("tr")?.children.length) ||
      1;
    const tr = document.createElement("tr");
    for (let i = 0; i < colCount; i++) {
      const td = document.createElement("td");
      td.innerHTML = "&nbsp;";
      tr.appendChild(td);
    }
    const rows = Array.from(tbody.children);
    const idx = sel && sel.bodyRow >= 0 ? sel.bodyRow : rows.length - 1;
    const ref = rows[idx] ?? null;
    if (offset === 0) {
      tbody.insertBefore(tr, ref);
    } else {
      tbody.insertBefore(tr, ref ? ref.nextSibling : null);
    }
    commit();
  };

  const deleteRow = () => {
    if (!sel || sel.bodyRow < 0) return;
    const table = getTable();
    const tbody = table?.querySelector("tbody");
    if (!tbody) return;
    const row = tbody.children[sel.bodyRow];
    if (!row) return;
    row.remove();
    setSel(null);
    commit();
  };

  const insertCol = (offset: 0 | 1) => {
    const table = getTable();
    if (!table) return;
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    const headRow = thead?.querySelector("tr");
    const colCount =
      headRow?.children.length ?? tbody?.querySelector("tr")?.children.length ?? 0;
    if (colCount === 0) return;
    const at = sel ? sel.col + offset : colCount;
    const insertInto = (row: Element, cellTag: "th" | "td") => {
      const cell = document.createElement(cellTag);
      cell.innerHTML = "&nbsp;";
      const before = row.children[at] ?? null;
      row.insertBefore(cell, before);
    };
    if (headRow) insertInto(headRow, "th");
    tbody?.querySelectorAll(":scope > tr").forEach((tr) => insertInto(tr, "td"));
    commit();
  };

  const deleteCol = () => {
    if (!sel) return;
    const table = getTable();
    if (!table) return;
    const removeAt = (row: Element) => {
      const c = row.children[sel.col];
      if (c) c.remove();
    };
    table.querySelectorAll("thead > tr").forEach(removeAt);
    table.querySelectorAll("tbody > tr").forEach(removeAt);
    setSel(null);
    commit();
  };

  const hasRowSel = !!sel && sel.bodyRow >= 0;
  const hasColSel = !!sel;

  const btn =
    "inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-1 text-[11px] text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="mr-1">行</span>
          <button
            type="button"
            className={btn}
            onClick={() => insertRow(0)}
            disabled={!hasRowSel}
            title="在选中行上方插入"
          >
            <ArrowUp className="size-3" /> <Plus className="size-3" />
          </button>
          <button
            type="button"
            className={btn}
            onClick={() => insertRow(1)}
            title={hasRowSel ? "在选中行下方插入" : "在末尾追加一行"}
          >
            <ArrowDown className="size-3" /> <Plus className="size-3" />
          </button>
          <button
            type="button"
            className={btn}
            onClick={deleteRow}
            disabled={!hasRowSel}
            title="删除选中行"
          >
            <Trash2 className="size-3" />
          </button>
          <span className="mx-1 h-3 w-px bg-border" />
          <span className="mr-1">列</span>
          <button
            type="button"
            className={btn}
            onClick={() => insertCol(0)}
            disabled={!hasColSel}
            title="在选中列左侧插入"
          >
            <ArrowLeft className="size-3" /> <Plus className="size-3" />
          </button>
          <button
            type="button"
            className={btn}
            onClick={() => insertCol(1)}
            title={hasColSel ? "在选中列右侧插入" : "在末尾追加一列"}
          >
            <ArrowRight className="size-3" /> <Plus className="size-3" />
          </button>
          <button
            type="button"
            className={btn}
            onClick={deleteCol}
            disabled={!hasColSel}
            title="删除选中列"
          >
            <Trash2 className="size-3" />
          </button>
          <span className="ml-auto text-[10px]">
            {sel
              ? sel.bodyRow < 0
                ? `已选中：表头 · 第 ${sel.col + 1} 列`
                : `已选中：第 ${sel.bodyRow + 1} 行 · 第 ${sel.col + 1} 列`
              : "点击单元格以选择行 / 列"}
          </span>
        </div>
      )}
      <div
        ref={wrapRef}
        className={cn(
          "overflow-x-auto text-xs outline-none transition-colors",
          // 单元格样式：超出宽度省略号 + title 悬浮气泡展示完整内容；核心数据加大内边距与行高
          "[&_table]:border-0",
          "[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-sm [&_th]:font-medium [&_th]:whitespace-nowrap",
          "[&_td]:border [&_td]:border-border [&_td]:px-4 [&_td]:py-2.5 [&_td]:text-sm [&_td]:leading-loose [&_td]:min-h-[2.75rem] [&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap",
          !readOnly && "[&_td]:cursor-text [&_th]:cursor-text",
        )}
        onClickCapture={handleCellFocus}
      >
        <div
          ref={ref}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          spellCheck={false}
          onInput={(e) => {
            const el = e.currentTarget as HTMLDivElement;
            syncTitles(el);
            const clean = stripMismatchAnnotations(el.innerHTML);
            lastAppliedHtmlRef.current = clean;
            onChange(clean);
          }}
        />
      </div>
    </div>
  );
}

function TableChunkView({
  chunk,
  onChange,
  mustEdit,
  readOnly,
}: {
  chunk: Chunk;
  onChange: (v: string) => void;
  mustEdit: boolean;
  readOnly: boolean;
}) {
  const [filterOn, setFilterOn] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const handleOverride = (key: string, idx: number | undefined) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (idx === undefined) delete next[key];
      else next[key] = idx;
      return next;
    });
  };
  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="size-3.5 cursor-help text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            <p className="max-w-[16rem] text-xs">仅显示核心 6 列</p>
          </TooltipContent>
        </Tooltip>
        <Label htmlFor="filter-toggle" className="cursor-pointer">
          过滤展示
        </Label>
        <Switch id="filter-toggle" checked={filterOn} onCheckedChange={setFilterOn} />
      </div>
      {filterOn ? (
        <FilteredTableView
          html={chunk.content}
          overrides={overrides}
          onOverrideChange={handleOverride}
          readOnly={readOnly}
          onChange={onChange}
        />
      ) : (
        <EditableTableHtml
          html={chunk.content}
          readOnly={readOnly}
          mustEdit={mustEdit}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function FilteredTableView({
  html,
  overrides,
  onOverrideChange,
  readOnly,
  onChange,
}: {
  html: string;
  overrides: Record<string, number>;
  onOverrideChange: (key: string, sourceIdx: number | undefined) => void;
  readOnly?: boolean;
  onChange?: (v: string) => void;
}) {
  const { aiRejectionReason } = useContext(DetailRecordContext);
  const mismatchSourceLabel = aiRejectionReason
    ? REJECTION_SOURCE_LABEL[aiRejectionReason]
    : "签收数据";
  const parsed = useMemo(() => parseTableStructure(html), [html]);
  const autoMap = useMemo(
    () => (parsed ? computeAutoTableMapping(parsed.headerCells) : new Map<string, number>()),
    [parsed],
  );
  if (!parsed) {
    return (
      <div className="rounded border border-dashed border-border p-4 text-xs text-muted-foreground">
        无法解析表格结构，请关闭过滤展示查看原始识别结果
      </div>
    );
  }
  const { headerCells, rows } = parsed;

  const columns = PRODUCT_TABLE_COLUMNS.map((key) => {
    const overrideIdx = overrides[key];
    const sourceIdx = overrideIdx !== undefined ? overrideIdx : autoMap.get(key);
    const originalHeader = sourceIdx !== undefined ? headerCells[sourceIdx] : undefined;
    return {
      key,
      sourceIdx,
      originalHeader,
      isOverridden: overrideIdx !== undefined,
    };
  });

  return (
    <div className="overflow-x-auto text-xs">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((col) => {
              const currentIdx = col.sourceIdx;
              const selectValue = currentIdx !== undefined ? String(currentIdx) : "";
              return (
                <th
                  key={col.key}
                  className="border border-border bg-muted px-4 py-2 text-left align-top font-medium"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="whitespace-nowrap text-sm">{col.key}</span>
                    <Select
                      value={selectValue}
                      onValueChange={(v) => {
                        const idx = parseInt(v, 10);
                        if (Number.isFinite(idx)) onOverrideChange(col.key, idx);
                      }}
                    >
                      <SelectTrigger
                        className="h-5 w-auto max-w-[8rem] gap-1 border-0 bg-transparent px-0 py-0 text-[11px] font-normal text-muted-foreground shadow-none hover:text-foreground focus:ring-0 focus:ring-offset-0 [&>span]:block [&>span]:truncate [&>svg]:size-3 [&>svg]:opacity-50"
                        title={col.originalHeader || undefined}
                      >
                        <SelectValue placeholder="选择列">
                          {col.originalHeader || "选择列"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {headerCells.map((h, i) => (
                          <SelectItem key={i} value={String(i)} className="text-xs">
                            {h || `第 ${i + 1} 列`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {columns.map((col) => {
                if (col.sourceIdx === undefined) {
                  return (
                    <td
                      key={col.key}
                      className="border border-border px-4 py-2 text-sm italic leading-loose text-muted-foreground"
                    >
                      —
                    </td>
                  );
                }
                const sourceIdx = col.sourceIdx;
                const val = row[sourceIdx] ?? "";
                const mismatch =
                  PRODUCT_QUANTITY_KEYS.has(col.key)
                    ? computeMismatch(rowIdx, col.key, val)
                    : null;
                const editable = !readOnly && !!onChange;
                const handleBlur = (e: React.FocusEvent<HTMLSpanElement>) => {
                  if (!onChange) return;
                  const next = (e.currentTarget.textContent ?? "").trim();
                  if (next === val) return;
                  onChange(updateHtmlTableCell(html, rowIdx, sourceIdx, next));
                };
                return (
                  <td
                    key={col.key}
                    className="whitespace-nowrap border border-border px-4 py-2 text-sm leading-loose"
                  >
                    <span
                      contentEditable={editable}
                      suppressContentEditableWarning
                      spellCheck={false}
                      onBlur={handleBlur}
                      className={cn(
                        "inline-block min-w-[1ch] outline-none",
                        editable &&
                          "cursor-text rounded px-0.5 hover:bg-muted/50 focus:bg-muted/70",
                      )}
                      style={mismatch ? { color: "#dc2626" } : undefined}
                    >
                      {val}
                    </span>
                    {mismatch && (
                      <span
                        contentEditable={false}
                        className="ml-0.5 text-xs"
                        style={{ color: "#dc2626" }}
                      >
                        （{mismatchSourceLabel}：{mismatch.safeThird}）
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


