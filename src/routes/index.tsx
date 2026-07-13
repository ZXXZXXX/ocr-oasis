import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  Pencil,
  Type,
  Heading,
  Table as TableIcon,
  Image as ImageIcon,
  MoreHorizontal,
  Search,
} from "lucide-react";




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

function fabricateResult(images: UploadedImage[]) {
  const results: Partial<Record<DocType, DocPage[]>> = {};
  const deliveryImgs = images.filter((i) => i.docType === "delivery_note");
  const shippingImgs = images.filter((i) => i.docType === "shipping_slip");

  if (deliveryImgs.length) {
    results.delivery_note = deliveryImgs.map((img) => ({
      imageId: img.id,
      sourceImage: img.name,
      pageBox: [0, 0, img.width, img.height],
      chunks: mockDeliveryChunks(),
    }));
  }
  if (shippingImgs.length) {
    results.shipping_slip = shippingImgs.map((img) => ({
      imageId: img.id,
      sourceImage: img.name,
      pageBox: [0, 0, img.width, img.height],
      chunks: mockShippingChunks(),
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
  const now = Date.now();
  type Seed = {
    minutesAgo: number;
    mode: "high" | "mid" | "low";
    signatureStatus: SignatureStatus;
    status: Extract<Status, "pending_review" | "verified">;
    aiVerdict: AiVerdict;
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
  ];
  const docTypes: DocType[] = ["delivery_note", "shipping_slip"];
  return seeds.map((s, idx) => {
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
    // 只对送货单执行 OCR
    const results: Partial<Record<DocType, DocPage[]>> = {};
    const dImg = images.find((i) => i.docType === "delivery_note")!;
    const rand = createRand(idx + 1);
    results.delivery_note = [
      {
        imageId: dImg.id,
        sourceImage: dImg.name,
        pageBox: [0, 0, dImg.width, dImg.height],
        chunks: adjustChunkConfidences(mockDeliveryChunks(), s.mode, rand),
      },
    ];
    const allPages = Object.values(results).flat() as DocPage[];
    const who = pickDriver(idx);
    const createdAt = now - s.minutesAgo * 60_000;
    return {
      id: makeKaOrderId(createdAt, 1_000_000 + idx * 137),
      createdAt,
      status: s.status,
      progress: 100,
      confidence: averageConfidence(allPages),
      deliveryCount: 1,
      shippingCount: 1,
      images,
      results,
      driver: who.driver,
      plateNo: who.plate,
      signatureStatus: s.signatureStatus,
      aiVerdict: s.aiVerdict,
      verifiedAt: s.status === "verified" ? now - (s.minutesAgo - 10) * 60_000 : undefined,
      verifiedBy: s.status === "verified" ? CURRENT_USER : undefined,
      shippingSlipNo: makeShippingSlipNo(createdAt, 1_000 + idx * 137),
    };

  });
}

// ---------- Main Workbench ----------
function Workbench() {
  const [records, setRecords] = useState<OcrRecord[]>(() => seedRecords());

  const [progressMinimized, setProgressMinimized] = useState(false);
  const [progressDismissed, setProgressDismissed] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Filters
  const [filterOpen, setFilterOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [confRange, setConfRange] = useState<[number, number]>([0, 100]);
  const [quickStatus, setQuickStatus] = useState<"all" | "pending_review">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());




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
            const result = fabricateResult(r.images);
            // AI 结论：置信度 >= 80 通过，否则不通过
            const verdict: AiVerdict = result.confidence >= 80 ? "pass" : "fail";
            return {
              ...r,
              progress: 100,
              status: "pending_review",
              confidence: result.confidence,
              results: result.results,
              aiVerdict: verdict,
            };
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
    const fromT = dateFrom ? new Date(dateFrom).getTime() : -Infinity;
    const toT = dateTo ? new Date(dateTo).getTime() + 86400000 : Infinity;
    return records.filter((r) => {
      if (quickStatus !== "all" && r.status !== quickStatus) return false;
      if (r.createdAt < fromT || r.createdAt > toT) return false;
      if (r.status !== "recognizing" && r.status !== "failed" && r.status !== "queued" && r.confidence != null) {
        if (r.confidence < confRange[0] || r.confidence > confRange[1]) return false;
      } else {
        if (confRange[0] > 0 || confRange[1] < 100) return false;
      }
      if (searchQuery.trim()) {
        const kaMatch = fuzzyMatch(searchQuery, r.id);
        const shippingMatch = r.shippingSlipNo ? fuzzyMatch(searchQuery, r.shippingSlipNo) : false;
        if (!kaMatch && !shippingMatch) return false;
      }
      return true;
    });
  }, [records, dateFrom, dateTo, confRange, quickStatus, searchQuery]);


  const filterActive = !!dateFrom || !!dateTo || confRange[0] > 0 || confRange[1] < 100;

  const selectableIds = filteredRecords

    .filter((r) => r.status !== "recognizing" && r.status !== "queued" && r.status !== "failed")
    .map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleSelectAll() {
    setSelected((prev) => {
      if (allSelected) return new Set();
      const n = new Set(prev);
      selectableIds.forEach((id) => n.add(id));
      return n;
    });
  }

  // 手动模拟：从用户系统同步若干条新的验收任务，先进入排队，由调度器按创建时间升序识别
  const syncCounter = useRef(0);
  function syncNewTask() {
    syncCounter.current += 1;
    const seq = syncCounter.current;
    const docTypes: DocType[] = ["delivery_note", "shipping_slip"];
    const count = Math.floor(Math.random() * 21); // 0 ~ 20
    const nowTs = Date.now();

    const newRecords: OcrRecord[] = Array.from({ length: count }, (_, i) => {
      const who = pickDriver(records.length + seq + i);
      const signatureStatus: SignatureStatus = Math.random() < 0.6 ? "perfect" : "partial";
      const rid = uid();
      const images: UploadedImage[] = docTypes.map((dt) => ({
        id: `img-${rid}-${dt}`,
        name: `${dt === "delivery_note" ? "delivery" : "shipping"}_${rid}.jpg`,
        url: placeholderImg(
          1920,
          720,
          dt === "delivery_note" ? "送货单（同步）" : "出货传票（参考）",
        ),
        docType: dt,
        width: 1920,
        height: 720,
      }));
      return {
        id: makeKaOrderId(nowTs + i, Math.floor(Math.random() * 10_000_000)),
        createdAt: nowTs + i,
        status: "queued" as Status,
        progress: 0,
        deliveryCount: 1,
        shippingCount: 1,
        images,
        driver: who.driver,
        plateNo: who.plate,
        signatureStatus,
        shippingSlipNo: makeShippingSlipNo(nowTs + i, Math.floor(Math.random() * 100_000)),
      };

    });


    if (newRecords.length === 0) {
      toast.info("本次未同步到新任务");
      return;
    }

    setRecords((p) => [...newRecords, ...p]);
    setProgressDismissed(false);
    setProgressMinimized(false);
    toast.success(`已同步 ${newRecords.length} 条新任务`);
  }


  // 提交人工验收结论 → 状态置为已验收，模拟自动回传用户系统
  function submitVerification(id: string) {
    const target = records.find((r) => r.id === id);
    if (!target) return;
    if (target.status !== "pending_review") {
      toast.error("该任务当前状态无法提交验收");
      return;
    }
    setRecords((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: "verified",
              verifiedAt: Date.now(),
              verifiedBy: CURRENT_USER,
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
      aiVerdict: target.aiVerdict,
    });
    toast.success("验收结论已提交，结果已回传至用户系统");
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

  function confirmChunk(recordId: string, docType: DocType, pageIdx: number, chunkId: string) {
    mutateChunk(recordId, docType, pageIdx, chunkId, (c) => ({
      ...c,
      confirmed: !c.confirmed,
      lastEdit: !c.confirmed ? { by: CURRENT_USER, at: new Date().toISOString() } : c.lastEdit,
    }));
  }

  function replaceResults(recordId: string, results: NonNullable<OcrRecord["results"]>) {
    setRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, results } : r)));
  }

  function buildExport(r: OcrRecord) {
    if (!r.results) return {};
    const documents = (Object.entries(r.results) as [DocType, DocPage[]][])
      .map(([docType, pages]) =>
        pages.map((p) => ({
          documentType: docType,
          source_image: p.sourceImage,
          page_box: p.pageBox,
          chunks: p.chunks.map((c) => ({
            bbox: c.bbox,
            label: c.label,
            content: c.content,
            ...(c.confidence != null ? { confidence: c.confidence } : {}),
            ...(c.edited
              ? {
                  edited: true,
                  original: c.original,
                  lastEdit: c.lastEdit ?? null,
                }
              : c.confirmed
                ? {
                    confirmed: true,
                    reviewedBy: c.lastEdit ?? null,
                  }
                : {}),
          })),
        })),
      )
      .flat();
    return {
      taskId: r.id,
      createdAt: new Date(r.createdAt).toISOString(),
      overallConfidence: (r.confidence ?? 0) / 100,
      documents,
    };
  }



  function deleteRecord(id: string) {
    setRecords((p) => p.filter((r) => r.id !== id));
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    if (detailId === id) setDetailId(null);
  }

  function resetFilters() {
    setDateFrom("");
    setDateTo("");
    setConfRange([0, 100]);
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
            <Button onClick={syncNewTask} className="gap-2" variant="outline">
              <RotateCcw className="size-4" />
              手动同步新任务
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-6 py-6">
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatCard label="验收任务" value={records.length} />
            <StatCard
              label="待审核任务"
              value={records.filter((r) => r.status === "pending_review").length}
              accent="warning"
            />
            <StatCard
              label="已审核任务"
              value={records.filter((r) => r.status === "verified").length}
              accent="success"
            />
          </div>


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

                {selected.size > 0 && (
                  <span className="mr-1 text-xs text-muted-foreground">已选 {selected.size}</span>
                )}
                <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
                  <span className="text-sm font-medium">仅查看待审核</span>
                  <Switch
                    checked={quickStatus === "pending_review"}
                    onCheckedChange={(checked) =>
                      setQuickStatus(checked ? "pending_review" : "all")
                    }
                    aria-label="仅查看待审核"
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
                        <Label className="text-xs text-muted-foreground">创建时间范围</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="h-9 flex-1"
                          />
                          <span className="text-xs text-muted-foreground">至</span>
                          <Input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="h-9 flex-1"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-muted-foreground">置信度评分范围</Label>
                          <span className="text-xs tabular-nums text-foreground">
                            {confRange[0]} – {confRange[1]}
                          </span>
                        </div>
                        <div className="px-1 pt-3">
                          <Slider
                            min={0}
                            max={100}
                            step={1}
                            minStepsBetweenThumbs={1}
                            value={confRange}
                            onValueChange={(v) =>
                              setConfRange([v[0] ?? 0, v[1] ?? 100] as [number, number])
                            }
                          />
                          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                            <span>0</span>
                            <span>50</span>
                            <span>100</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end border-t border-border bg-muted/30 px-4 py-2">
                      <Button size="sm" onClick={() => setFilterOpen(false)}>
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
                  <TableHead className="w-[44px]">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={toggleSelectAll}
                      disabled={selectableIds.length === 0}
                      aria-label="全选"
                    />
                  </TableHead>
                  <TableHead className="w-[200px]">KA 订单号</TableHead>
                  <TableHead className="w-[150px]">同步时间</TableHead>
                  <TableHead>签收状态</TableHead>
                  <TableHead>置信度</TableHead>
                  <TableHead>AI 结论</TableHead>
                  <TableHead>审核状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>

                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-16 text-center">

                      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-muted-foreground">
                        <div className="grid size-12 place-items-center rounded-full bg-secondary">
                          <FileText className="size-5" />
                        </div>
                        <div className="text-sm">
                          {records.length === 0 ? "还没有审核单记录" : "没有符合当前筛选条件的记录"}
                        </div>
                        {records.length === 0 ? (
                          <Button variant="outline" size="sm" onClick={syncNewTask}>
                            <RotateCcw className="mr-1 size-4" /> 手动同步新任务
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={resetFilters}>
                            <RotateCcw className="mr-1 size-4" /> 重置筛选
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {filteredRecords.map((r) => {
                  const inProgress = r.status === "recognizing" || r.status === "queued";
                  const canSelect = !inProgress && r.status !== "failed";
                  const pending = !inProgress && r.status !== "failed" ? pendingLowConf(r) : 0;
                  return (
                    <TableRow key={r.id} className="hover:bg-muted/30">
                      <TableCell>
                        <Checkbox
                          checked={selected.has(r.id)}
                          disabled={!canSelect}
                          onCheckedChange={() => toggleSelect(r.id)}
                          aria-label="选择"
                        />
                      </TableCell>
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
                          <span className="text-xs text-muted-foreground">—</span>
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
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <StatusBadge status={r.status} pending={pending} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {r.status === "pending_review" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-sm font-semibold text-primary hover:bg-primary/10 hover:text-primary"
                              onClick={() => setDetailId(r.id)}
                            >
                              审核
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-sm font-semibold"
                            disabled={inProgress || r.status === "failed"}
                            onClick={() => setDetailId(r.id)}
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

        <Sheet open={!!detailRecord} onOpenChange={(o) => !o && setDetailId(null)}>
          <SheetContent
            side="right"
            className="flex w-[75vw] flex-col gap-0 p-0 sm:max-w-[75vw] [&>button]:hidden"
          >
            {detailRecord && detailRecord.results && (
              <DetailView
                record={detailRecord}
                onChange={(docType, pageIdx, chunkId, val) =>
                  updateChunk(detailRecord.id, docType, pageIdx, chunkId, val)
                }
                onConfirm={(docType, pageIdx, chunkId) =>
                  confirmChunk(detailRecord.id, docType, pageIdx, chunkId)
                }
                onReplaceResults={(results) => replaceResults(detailRecord.id, results)}
                onSubmit={() => {
                  submitVerification(detailRecord.id);
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
function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "primary" | "success" | "warning";
}) {
  const tone =
    accent === "primary"
      ? "text-primary"
      : accent === "success"
        ? "text-[color:var(--success)]"
        : accent === "warning"
          ? "text-[color:var(--warning-foreground)]"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</div>
    </div>
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

function ConfidenceBadge({ score }: { score: number }) {
  const tone =
    score >= 90
      ? "text-[color:var(--success)] bg-[color:var(--success)]/10"
      : score >= 80
        ? "text-primary bg-primary/10"
        : "text-[color:var(--warning-foreground)] bg-[color:var(--warning)]/25";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums",
        tone,
      )}
    >
      {score}
    </span>
  );
}

// ---------- Detail view ----------
function DetailView({
  record,
  onChange,
  onConfirm,
  onReplaceResults,
  onSubmit,
}: {
  record: OcrRecord;
  onChange: (docType: DocType, pageIdx: number, chunkId: string, value: string) => void;
  onConfirm: (docType: DocType, pageIdx: number, chunkId: string) => void;
  onReplaceResults: (results: NonNullable<OcrRecord["results"]>) => void;
  onSubmit: () => void;
}) {


  const pending = pendingLowConf(record);
  const availableDocTypes = Object.keys(record.results ?? {}) as DocType[];
  const shippingRefImgs = record.images.filter((i) => i.docType === "shipping_slip");
  type TabValue = DocType | "shipping_ref";
  const [activeTab, setActiveTab] = useState<TabValue>(availableDocTypes[0] ?? "shipping_ref");

  const [editing, setEditing] = useState(false);
  // snapshot taken on entering edit mode — used to cancel
  const snapshotRef = useRef<NonNullable<OcrRecord["results"]> | null>(null);

  function startEdit() {
    // deep-clone current results so cancel can restore
    snapshotRef.current = JSON.parse(JSON.stringify(record.results ?? {})) as NonNullable<
      OcrRecord["results"]
    >;
    setEditing(true);
  }
  function cancelEdit() {
    if (snapshotRef.current) onReplaceResults(snapshotRef.current);
    snapshotRef.current = null;
    setEditing(false);
    toast.info("已取消本次修改");
  }
  function submitEdit() {
    snapshotRef.current = null;
    setEditing(false);
    toast.success("修改已提交");
  }

  return (
    <>
      <SheetHeader className="border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <SheetTitle className="flex flex-wrap items-center gap-2">
              验收任务详情
              <StatusBadge status={record.status} pending={pending} />
              {record.aiVerdict && <VerdictBadge value={record.aiVerdict} />}
              <SignatureBadge value={record.signatureStatus} />
              <ConfidenceBadge score={record.confidence ?? 0} />
              {editing && (
                <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                  <Pencil className="size-3" /> 编辑中
                </span>
              )}
            </SheetTitle>
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
                {record.status === "pending_review" && (
                  <Button variant="outline" onClick={startEdit} className="gap-2">
                    <Pencil className="size-4" /> 编辑识别结果
                  </Button>
                )}
                {record.status === "pending_review" && (
                  <Button onClick={onSubmit} className="gap-2">
                    <CheckCircle2 className="size-4" /> 提交验收结论
                  </Button>
                )}
                {record.status === "verified" && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[color:var(--success)]/15 px-2 py-1 text-xs text-[color:var(--success)]">
                    <CheckCircle2 className="size-3.5" /> 已验收并回传
                  </span>
                )}
              </>
            )}
            <SheetClose asChild>
              <Button variant="outline" size="icon" className="shrink-0" aria-label="关闭">
                <X className="size-4" />
              </Button>
            </SheetClose>
          </div>
        </div>
      </SheetHeader>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="border-b border-border bg-muted/20 px-6 py-2">
          <TabsList>
            {availableDocTypes.map((dt) => {
              const pages = record.results![dt]!;
              return (
                <TabsTrigger key={dt} value={dt} className="gap-2">
                  {dt === "delivery_note" ? (
                    <Truck className="size-3.5" />
                  ) : (
                    <ScrollText className="size-3.5" />
                  )}
                  {DOC_LABEL[dt]}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                    {pages.length}
                  </span>
                </TabsTrigger>
              );
            })}
            {shippingRefImgs.length > 0 && (
              <TabsTrigger value="shipping_ref" className="gap-2">
                <ScrollText className="size-3.5" />
                出货传票（参考）
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {shippingRefImgs.length}
                </span>
              </TabsTrigger>
            )}
          </TabsList>

        </div>

        {availableDocTypes.map((dt) => {
          const pages = record.results![dt]!;
          const imgs = record.images.filter((i) => i.docType === dt);
          return (
            <TabsContent
              key={dt}
              value={dt}
              className="flex-1 overflow-hidden data-[state=inactive]:hidden"
            >
              <DocPanel
                docType={dt}
                pages={pages}
                images={imgs}
                editing={editing}
                onChange={(pageIdx, chunkId, v) => onChange(dt, pageIdx, chunkId, v)}
                onConfirm={(pageIdx, chunkId) => onConfirm(dt, pageIdx, chunkId)}
              />
            </TabsContent>
          );
        })}

        {shippingRefImgs.length > 0 && (
          <TabsContent
            value="shipping_ref"
            className="flex-1 overflow-auto px-6 pb-6 pt-4 data-[state=inactive]:hidden"
          >
            <div className="mb-3 text-xs text-muted-foreground">
              出货传票仅作参考图查看，不参与 OCR 识别与结构化提取。
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {shippingRefImgs.map((img) => (
                <div
                  key={img.id}
                  className="overflow-hidden rounded-lg border border-border bg-muted/20"
                >
                  <img src={img.url} alt={img.name} className="h-auto w-full object-contain" />
                  <div className="border-t border-border bg-primary/10 px-3 py-1.5 text-xs text-foreground">
                    {img.name}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        )}

      </Tabs>


      {editing && (
        <div className="shrink-0 border-t border-border bg-muted/30 px-6 py-3">
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={cancelEdit} className="gap-2">
              <X className="size-4" /> 取消
            </Button>
            <Button onClick={submitEdit} className="gap-2">
              <CheckCircle2 className="size-4" /> 提交
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function DocPanel({
  pages,
  images,
  editing,
  onChange,
  onConfirm,
}: {
  docType: DocType;
  pages: DocPage[];
  images: UploadedImage[];
  editing: boolean;
  onChange: (pageIdx: number, chunkId: string, value: string) => void;
  onConfirm: (pageIdx: number, chunkId: string) => void;
}) {
  const [pageIdx, setPageIdx] = useState(0);
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const page = pages[pageIdx];
  const image = images.find((i) => i.id === page?.imageId) ?? images[pageIdx];
  const scrollRef = useRef<HTMLDivElement>(null);
  const chunkRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
    <div className="grid h-full grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {/* Preview with bbox overlay */}
      <div className="flex flex-col overflow-hidden border-r border-border bg-muted/30">
        {pages.length > 1 && (
          <div className="flex items-center gap-1 border-b border-border bg-background/60 px-3 py-2">
            {pages.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setPageIdx(i);
                  setActiveChunkId(null);
                }}
                className={cn(
                  "rounded px-2 py-0.5 text-xs",
                  i === pageIdx
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                第 {i + 1} 页
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 flex items-center justify-center overflow-auto p-4">
          {image && page ? (
            <ImageWithBoxes
              image={image}
              page={page}
              activeChunkId={activeChunkId}
              onSelect={setActiveChunkId}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              未上传该类别的图片
            </div>
          )}
        </div>
      </div>

      {/* Chunks editor */}
      <div ref={scrollRef} className="flex flex-col overflow-y-auto">
        <div className="space-y-3 px-5 py-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">
              识别分块 · {page?.chunks.length ?? 0}
            </h3>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              {!editing && (
                <span className="text-muted-foreground">点击顶部「编辑」进入编辑态</span>
              )}
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-sm bg-[color:var(--success)]" />高
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-sm bg-primary" />中
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-sm bg-[color:var(--warning)]" />低 &lt; 80
              </span>
            </div>
          </div>
          {page?.chunks.map((c) => (
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
                onConfirm={() => onConfirm(pageIdx, c.id)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ImageWithBoxes({
  image,
  page,
  activeChunkId,
  onSelect,
}: {
  image: UploadedImage;
  page: DocPage;
  activeChunkId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [w, h] = [page.pageBox[2] || image.width, page.pageBox[3] || image.height];
  const activeChunk = page.chunks.find((c) => c.id === activeChunkId);
  let transform = "translate(0%, 0%) scale(1)";
  if (activeChunk) {
    const [x1, y1, x2, y2] = activeChunk.bbox;
    const bw = Math.max(1, x2 - x1 + 20); // 左右各加 10px
    const fx = (x1 + x2) / 2 / w;
    const fy = (y1 + y2) / 2 / h;
    // 以所选框宽度 + 20px 作为可视宽度限制，按容器宽度缩放
    const scale = Math.min(4, Math.max(1, w / bw));
    const tx = (0.5 - fx) * 100;
    const ty = (0.5 - fy) * 100;
    transform = `translate(${tx}%, ${ty}%) scale(${scale})`;
  }
  return (
    <div className="flex h-full w-full max-w-full flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex-1 flex items-center justify-center overflow-auto p-4">
        <div
          className="relative w-full max-w-full overflow-hidden"
          style={{ aspectRatio: `${w} / ${h}` }}
        >
          <div
            className="absolute inset-0 transition-transform duration-500 ease-out"
            style={{ transform, transformOrigin: "50% 50%" }}
          >
            <img
              src={image.url}
              alt={image.name}
              className="absolute inset-0 h-full w-full object-contain"
            />
            <div className="absolute inset-0">
              {page.chunks.map((c) => {
                const [x1, y1, x2, y2] = c.bbox;
                const tone = confidenceTone(c.confidence);
                const isActive = c.id === activeChunkId;
                const color =
                  tone === "low"
                    ? "border-[color:var(--warning)] bg-[color:var(--warning)]/15"
                    : tone === "mid"
                      ? "border-primary bg-primary/10"
                      : "border-[color:var(--success)]/70 bg-[color:var(--success)]/5";
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => onSelect(c.id)}
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
                    title={`${c.label}${c.confidence != null ? ` · ${Math.round(c.confidence * 100)}%` : ""}`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-primary/20 bg-primary/5 px-3 py-1.5 text-xs text-primary">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{image.name}</span>
          <span className="text-primary/70">
            · {w} × {h}
          </span>
        </div>
        {activeChunkId && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 border-primary/30 px-2 text-xs text-primary hover:bg-primary/10"
            onClick={() => onSelect(null)}
          >
            <Minimize2 className="size-3" /> 取消聚焦
          </Button>
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
  onConfirm,
}: {
  chunk: Chunk;
  active: boolean;
  editing: boolean;
  onFocus: () => void;
  onChange: (newContent: string) => void;
  onConfirm: () => void;
}) {
  const tone = confidenceTone(chunk.confidence);
  const isLow =
    chunk.label !== "Image" && chunk.confidence != null && chunk.confidence < LOW_CONF_THRESHOLD;
  const needsReview = isLow && !chunk.edited && !chunk.confirmed;

  const meta = LABEL_META[chunk.label];
  const Icon = meta.icon;

  const borderCls = needsReview
    ? "border-[color:var(--warning)]/70"
    : tone === "low"
      ? "border-[color:var(--warning)]/40"
      : tone === "mid"
        ? "border-primary/40"
        : "border-border";

  const bgCls = needsReview ? "bg-[color:var(--warning)]/5" : "bg-card";

  return (
    <div
      onClick={onFocus}
      className={cn(
        "rounded-lg border p-3 transition-all",
        borderCls,
        bgCls,
        active && "ring-2 ring-primary ring-offset-1",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
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
                "tabular-nums",
                needsReview
                  ? "text-[color:var(--warning-foreground)]"
                  : tone === "mid"
                    ? "text-primary"
                    : "text-muted-foreground",
              )}
            >
              置信度 {Math.round(chunk.confidence * 100)}%{needsReview && " · 待人工核验"}
            </span>
          ) : (
            <span className="text-muted-foreground">未评分</span>
          )}
        </div>
      </div>

      <ChunkContentEditor
        chunk={chunk}
        onChange={onChange}
        mustEdit={needsReview}
        readOnly={!editing}
      />

      {isLow && chunk.label !== "Image" && editing && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
          <span className="text-muted-foreground">
            {needsReview
              ? "若识别结果正确，可直接确认；如有错误请在上方修改。"
              : chunk.edited
                ? "已通过修改。"
                : "已确认无需修改。"}
          </span>
          <Button
            type="button"
            size="sm"
            variant={chunk.confirmed && !chunk.edited ? "secondary" : "outline"}
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={(e) => {
              e.stopPropagation();
              onConfirm();
            }}
            disabled={chunk.edited}
          >
            <CheckCircle2 className="size-3" />
            {chunk.confirmed && !chunk.edited ? "取消确认" : "标记为无需更改"}
          </Button>
        </div>
      )}

      {chunk.lastEdit && (
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {chunk.edited ? "最近修改" : "确认于"}：{fmtEditLog(chunk.lastEdit)}
        </div>
      )}
    </div>
  );
}

function AutoResizeTextarea({ value, className, ...props }: React.ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <Textarea
      ref={ref}
      value={value}
      className={cn("resize-none overflow-hidden", className)}
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
  const roCls = readOnly ? "cursor-default bg-muted/40" : "";

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
      <div className="space-y-2">
        <EditableTableHtml
          html={chunk.content}
          readOnly={!!readOnly}
          mustEdit={mustEdit}
          onChange={onChange}
        />
        {!readOnly && (
          <details>
            <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
              编辑表格 HTML 源码
            </summary>
            <AutoResizeTextarea
              value={chunk.content}
              onChange={(e) => onChange(e.target.value)}
              className={cn("mt-1.5 min-h-32 font-mono text-[11px]", ring)}
            />
          </details>
        )}
      </div>
    );
  }

  // Section-Header / Text: edit plain text; store back as <p>...</p>
  const text = htmlToText(chunk.content);
  const isMulti = text.length > 60 || text.includes("\n");
  const handle = (v: string) => onChange(textToHtml(v));

  return isMulti ? (
    <AutoResizeTextarea
      value={text}
      readOnly={readOnly}
      onChange={(e) => handle(e.target.value)}
      className={cn("min-h-16", ring, roCls)}
    />
  ) : (
    <AutoResizeTextarea
      value={text}
      readOnly={readOnly}
      onChange={(e) => handle(e.target.value)}
      className={cn("min-h-9", ring, roCls)}
    />
  );
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
  const ref = useRef<HTMLDivElement>(null);
  // 仅在外部 html 与当前 DOM 不一致时同步，避免编辑中光标跳动
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerHTML !== html) el.innerHTML = html;
  }, [html]);

  return (
    <div
      className={cn(
        "max-h-60 overflow-auto rounded border bg-background p-2 text-xs outline-none transition-colors",
        "[&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:px-1.5 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-1.5 [&_th]:py-1",
        readOnly
          ? "border-border"
          : mustEdit
            ? "border-[color:var(--warning)] focus-within:ring-2 focus-within:ring-[color:var(--warning)]"
            : "border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30",
        !readOnly && "[&_td]:cursor-text [&_th]:cursor-text",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={ref}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        spellCheck={false}
        onInput={(e) => onChange((e.currentTarget as HTMLDivElement).innerHTML)}
      />
    </div>
  );
}
