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
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Sparkles,
  Trash2,
  Eye,
  Filter,
  RotateCcw,
  Pencil,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: Workbench,
});

// ---------- Constants / current user ----------
const CURRENT_USER = "审核员 · 李婷";

// ---------- Types ----------
type DocType = "delivery_note" | "shipping_slip";
type Status = "recognizing" | "done" | "failed";

const DOC_LABEL: Record<DocType, string> = {
  delivery_note: "送货单",
  shipping_slip: "出货传票",
};

interface UploadedImage {
  id: string;
  name: string;
  url: string;
  docType: DocType;
}

interface EditLog {
  by: string;
  at: string; // ISO
}

interface FieldValue {
  value: string;
  confidence: number; // 0-1
  edited?: boolean;
  original?: string;
  lastEdit?: EditLog;
}

interface LineItem {
  materialCode: FieldValue;
  materialName: FieldValue;
  spec: FieldValue;
  quantity: FieldValue;
  unit: FieldValue;
}

interface DocResult {
  fields: {
    documentNo: FieldValue;
    documentDate: FieldValue;
    customerName: FieldValue;
    deliveryAddress: FieldValue;
    contact: FieldValue;
  };
  items: LineItem[];
}

interface OcrRecord {
  id: string;
  createdAt: number; // timestamp
  status: Status;
  progress: number;
  confidence?: number;
  deliveryCount: number;
  shippingCount: number;
  images: UploadedImage[];
  results?: Partial<Record<DocType, DocResult>>;
}

// ---------- Helpers ----------
const uid = () => Math.random().toString(36).slice(2, 10);

const fmtTime = (t: number) =>
  new Date(t).toLocaleString("zh-CN", { hour12: false });

function randomField(pool: string[], forceLow = false): FieldValue {
  const value = pool[Math.floor(Math.random() * pool.length)];
  const confidence = forceLow
    ? 0.5 + Math.random() * 0.25
    : Math.random() < 0.3
    ? 0.55 + Math.random() * 0.3
    : 0.88 + Math.random() * 0.11;
  return { value, confidence: Math.min(0.99, confidence) };
}

function fabricateDoc(): DocResult {
  const customers = [
    "招商局物流集团",
    "顺丰供应链有限公司",
    "京东物流华南分公司",
    "深圳华强科技",
  ];
  const addresses = [
    "深圳市南山区科技园南区T3栋",
    "广州市黄埔区开发大道128号",
    "东莞市松山湖大学路9号",
  ];
  const contacts = [
    "李经理 13800000000",
    "王主管 13911112222",
    "张先生 13566667777",
  ];
  const materials: [string, string, string][] = [
    ["A1001", "六角螺丝", "M3x10"],
    ["A1002", "垫片", "M4"],
    ["B2001", "铝合金外壳", "200x120"],
    ["C3050", "PCB主板", "V2.1"],
  ];
  const fields = {
    documentNo: randomField(["DN20260710001", "SH20260710A22", "DN20260709088"]),
    documentDate: randomField(["2026-07-10", "2026-07-09", "2026-07-08"]),
    customerName: randomField(customers, Math.random() < 0.5),
    deliveryAddress: randomField(addresses, Math.random() < 0.4),
    contact: randomField(contacts),
  };
  const itemCount = 2 + Math.floor(Math.random() * 3);
  const items: LineItem[] = Array.from({ length: itemCount }).map(() => {
    const m = materials[Math.floor(Math.random() * materials.length)];
    return {
      materialCode: randomField([m[0]]),
      materialName: randomField([m[1]]),
      spec: randomField([m[2]]),
      quantity: randomField(
        [String(1 + Math.floor(Math.random() * 50))],
        Math.random() < 0.2,
      ),
      unit: randomField(["箱", "件", "个", "套"]),
    };
  });
  return { fields, items };
}

function fabricateResult(images: UploadedImage[]) {
  const results: Partial<Record<DocType, DocResult>> = {};
  const hasDelivery = images.some((i) => i.docType === "delivery_note");
  const hasShipping = images.some((i) => i.docType === "shipping_slip");
  if (hasDelivery) results.delivery_note = fabricateDoc();
  if (hasShipping) results.shipping_slip = fabricateDoc();
  const all: FieldValue[] = [];
  (Object.values(results) as DocResult[]).forEach((d) => {
    all.push(...Object.values(d.fields));
    d.items.forEach((it) => all.push(...Object.values(it)));
  });
  const avg = all.reduce((s, f) => s + f.confidence, 0) / all.length;
  return { results, confidence: Math.round(avg * 100) };
}

function confidenceTone(c: number) {
  if (c >= 0.9) return "high";
  if (c >= 0.8) return "mid";
  return "low";
}

function collectFields(r: OcrRecord): FieldValue[] {
  if (!r.results) return [];
  const arr: FieldValue[] = [];
  (Object.values(r.results) as DocResult[]).forEach((d) => {
    arr.push(...Object.values(d.fields));
    d.items.forEach((it) => arr.push(...Object.values(it)));
  });
  return arr;
}

function pendingLowConf(r: OcrRecord): number {
  return collectFields(r).filter((f) => f.confidence < 0.8 && !f.edited).length;
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
              <img
                src={img.url}
                alt={img.name}
                className="h-full w-full object-cover"
              />
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

// ---------- Main Workbench ----------
function Workbench() {
  const [records, setRecords] = useState<OcrRecord[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [deliveryImgs, setDeliveryImgs] = useState<UploadedImage[]>([]);
  const [shippingImgs, setShippingImgs] = useState<UploadedImage[]>([]);

  const [progressMinimized, setProgressMinimized] = useState(false);
  const [progressDismissed, setProgressDismissed] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [confRange, setConfRange] = useState<[number, number]>([0, 100]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const activeRecords = useMemo(
    () => records.filter((r) => r.status === "recognizing"),
    [records],
  );

  const detailRecord = records.find((r) => r.id === detailId) ?? null;

  // Simulate progress
  useEffect(() => {
    if (activeRecords.length === 0) return;
    const t = setInterval(() => {
      setRecords((prev) =>
        prev.map((r) => {
          if (r.status !== "recognizing") return r;
          const next = Math.min(100, r.progress + 4 + Math.random() * 6);
          if (next >= 100) {
            const result = fabricateResult(r.images);
            return {
              ...r,
              progress: 100,
              status: "done",
              confidence: result.confidence,
              results: result.results,
            };
          }
          return { ...r, progress: next };
        }),
      );
    }, 500);
    return () => clearInterval(t);
  }, [activeRecords.length]);

  const filteredRecords = useMemo(() => {
    const fromT = dateFrom ? new Date(dateFrom).getTime() : -Infinity;
    const toT = dateTo ? new Date(dateTo).getTime() + 86400000 : Infinity;
    return records.filter((r) => {
      if (r.createdAt < fromT || r.createdAt > toT) return false;
      if (r.status === "done" && r.confidence != null) {
        if (r.confidence < confRange[0] || r.confidence > confRange[1])
          return false;
      } else {
        // recognizing/failed records: exclude when range is narrowed away from full
        if (confRange[0] > 0 || confRange[1] < 100) return false;
      }
      return true;
    });
  }, [records, dateFrom, dateTo, confRange]);

  const filterActive =
    !!dateFrom || !!dateTo || confRange[0] > 0 || confRange[1] < 100;

  const selectableIds = filteredRecords
    .filter((r) => r.status === "done")
    .map((r) => r.id);
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
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

  function addFiles(target: DocType, files: FileList) {
    const bucket = target === "delivery_note" ? deliveryImgs : shippingImgs;
    const setter =
      target === "delivery_note" ? setDeliveryImgs : setShippingImgs;
    const remaining = 6 - bucket.length;
    const arr = Array.from(files).slice(0, remaining);
    const valid: UploadedImage[] = [];
    for (const f of arr) {
      if (!/image\/(jpeg|png)/.test(f.type)) {
        toast.error(`${f.name}：仅支持 JPG / PNG`);
        continue;
      }
      if (f.size > 3 * 1024 * 1024) {
        toast.error(`${f.name}：超过 3MB`);
        continue;
      }
      valid.push({
        id: uid(),
        name: f.name,
        url: URL.createObjectURL(f),
        docType: target,
      });
    }
    if (arr.length < files.length) toast.warning("单个类型最多 6 张，已截断");
    setter([...bucket, ...valid]);
  }

  function startOcr() {
    const images = [...deliveryImgs, ...shippingImgs];
    if (images.length === 0) {
      toast.error("请至少上传一张图片");
      return;
    }
    const record: OcrRecord = {
      id: uid(),
      createdAt: Date.now(),
      status: "recognizing",
      progress: 4,
      deliveryCount: deliveryImgs.length,
      shippingCount: shippingImgs.length,
      images,
    };
    setRecords((p) => [record, ...p]);
    setCreateOpen(false);
    setDeliveryImgs([]);
    setShippingImgs([]);
    setProgressDismissed(false);
    setProgressMinimized(false);
    toast.success("识别任务已创建");
  }

  function updateField(
    recordId: string,
    docType: DocType,
    path: string, // "field.customerName" or "item.0.materialCode"
    value: string,
  ) {
    setRecords((prev) =>
      prev.map((r) => {
        if (r.id !== recordId || !r.results) return r;
        const doc = r.results[docType];
        if (!doc) return r;
        const editLog: EditLog = {
          by: CURRENT_USER,
          at: new Date().toISOString(),
        };
        const [scope, key, sub] = path.split(".");
        if (scope === "field") {
          const f = doc.fields[key as keyof DocResult["fields"]];
          if (f.value === value) return r;
          const newDoc: DocResult = {
            ...doc,
            fields: {
              ...doc.fields,
              [key]: {
                ...f,
                value,
                edited: true,
                original: f.original ?? f.value,
                lastEdit: editLog,
              },
            },
          };
          return { ...r, results: { ...r.results, [docType]: newDoc } };
        }
        if (scope === "item") {
          const idx = Number(key);
          const items = doc.items.map((it, i) => {
            if (i !== idx) return it;
            const f = it[sub as keyof LineItem];
            if (f.value === value) return it;
            return {
              ...it,
              [sub]: {
                ...f,
                value,
                edited: true,
                original: f.original ?? f.value,
                lastEdit: editLog,
              },
            };
          });
          const newDoc: DocResult = { ...doc, items };
          return { ...r, results: { ...r.results, [docType]: newDoc } };
        }
        return r;
      }),
    );
  }

  function buildExport(r: OcrRecord) {
    if (!r.results) return {};
    const docs = (Object.entries(r.results) as [DocType, DocResult][]).map(
      ([docType, d]) => ({
        documentType: docType,
        fields: Object.fromEntries(
          Object.entries(d.fields).map(([k, v]) => [
            k,
            {
              value: v.value,
              confidence: Number(v.confidence.toFixed(3)),
              edited: !!v.edited,
              lastEdit: v.lastEdit ?? null,
            },
          ]),
        ),
        items: d.items.map((it, i) => ({
          lineNo: i + 1,
          materialCode: it.materialCode.value,
          materialName: it.materialName.value,
          specification: it.spec.value,
          quantity: Number(it.quantity.value) || it.quantity.value,
          unit: it.unit.value,
        })),
      }),
    );
    return {
      taskId: r.id,
      createdAt: new Date(r.createdAt).toISOString(),
      overallConfidence: (r.confidence ?? 0) / 100,
      documents: docs,
    };
  }

  function downloadJson(r: OcrRecord) {
    const pending = pendingLowConf(r);
    if (pending > 0) {
      toast.error(`还有 ${pending} 项低置信度字段未修改，无法导出`);
      return;
    }
    const blob = new Blob([JSON.stringify(buildExport(r), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ocr-${r.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("JSON 已下载");
  }

  function downloadBatch() {
    const targets = records.filter(
      (r) => selected.has(r.id) && r.status === "done",
    );
    if (targets.length === 0) return;
    const stillPending = targets.filter((r) => pendingLowConf(r) > 0);
    if (stillPending.length > 0) {
      toast.error(
        `其中 ${stillPending.length} 条记录仍有低置信度字段未核验，无法批量下载`,
      );
      return;
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      exportedBy: CURRENT_USER,
      count: targets.length,
      tasks: targets.map(buildExport),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ocr-batch-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已批量下载 ${targets.length} 条识别结果`);
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

  const totalUploads = deliveryImgs.length + shippingImgs.length;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </div>
              <div>
                <h1 className="text-base font-semibold leading-tight">
                  OCR 识别工作台
                </h1>
                <p className="text-xs text-muted-foreground">
                  送货单 · 出货传票 结构化识别
                </p>
              </div>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="size-4" />
              新建识别
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-6 py-6">
          {/* Stat strip */}
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="识别任务" value={records.length} />
            <StatCard
              label="识别中"
              value={records.filter((r) => r.status === "recognizing").length}
              accent="primary"
            />
            <StatCard
              label="已完成"
              value={records.filter((r) => r.status === "done").length}
              accent="success"
            />
            <StatCard
              label="待核验"
              value={
                records.filter(
                  (r) => r.status === "done" && (r.confidence ?? 100) < 80,
                ).length
              }
              accent="warning"
            />
          </div>

          {/* Filter bar - collapsible */}
          <div className="mb-4 rounded-xl border border-border bg-card">
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-3 text-left"
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <Filter className="size-4 text-primary" />
                筛选
                {filterActive && (
                  <Badge variant="secondary" className="ml-1 h-5 gap-1 font-normal">
                    已启用
                  </Badge>
                )}
                {filterActive && !filterOpen && (
                  <span className="ml-1 truncate text-xs font-normal text-muted-foreground">
                    {dateFrom || dateTo
                      ? `${dateFrom || "…"} 至 ${dateTo || "…"}`
                      : ""}
                    {(dateFrom || dateTo) &&
                      (confRange[0] > 0 || confRange[1] < 100) &&
                      " · "}
                    {(confRange[0] > 0 || confRange[1] < 100) &&
                      `置信度 ${confRange[0]}–${confRange[1]}`}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {filterActive && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      resetFilters();
                    }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <RotateCcw className="size-3.5" />
                    重置
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    "size-4 text-muted-foreground transition-transform",
                    filterOpen && "rotate-180",
                  )}
                />
              </div>
            </button>
            {filterOpen && (
              <div className="border-t border-border px-5 py-4">
                <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs text-muted-foreground">
                      创建时间范围
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="h-9 w-[160px]"
                      />
                      <span className="text-xs text-muted-foreground">至</span>
                      <Input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="h-9 w-[160px]"
                      />
                    </div>
                  </div>
                  <div className="flex min-w-[280px] flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">
                        置信度评分范围
                      </Label>
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
                          setConfRange([
                            v[0] ?? 0,
                            v[1] ?? 100,
                          ] as [number, number])
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
              </div>
            )}
          </div>


          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium">识别记录</span>
                <span className="text-xs text-muted-foreground">
                  共 {filteredRecords.length} 条
                  {filterActive && ` / 全部 ${records.length}`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {selected.size > 0 && (
                  <span className="text-xs text-muted-foreground">
                    已选 {selected.size}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={selected.size === 0}
                  onClick={downloadBatch}
                >
                  <Download className="size-3.5" />
                  批量下载 JSON
                </Button>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-[44px]">
                    <Checkbox
                      checked={
                        allSelected ? true : someSelected ? "indeterminate" : false
                      }
                      onCheckedChange={toggleSelectAll}
                      disabled={selectableIds.length === 0}
                      aria-label="全选"
                    />
                  </TableHead>
                  <TableHead className="w-[160px]">任务 ID</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>图片数量</TableHead>
                  <TableHead className="w-[220px]">识别进度</TableHead>
                  <TableHead>置信度评分</TableHead>
                  <TableHead>状态</TableHead>
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
                          {records.length === 0
                            ? "还没有识别记录"
                            : "没有符合当前筛选条件的记录"}
                        </div>
                        {records.length === 0 ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCreateOpen(true)}
                          >
                            <Plus className="mr-1 size-4" /> 新建识别
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={resetFilters}
                          >
                            <RotateCcw className="mr-1 size-4" /> 重置筛选
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {filteredRecords.map((r) => {
                  const canSelect = r.status === "done";
                  const pending = r.status === "done" ? pendingLowConf(r) : 0;
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
                      <TableCell className="font-mono text-xs text-foreground">
                        #{r.id}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtTime(r.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Badge
                            variant="secondary"
                            className="gap-1 font-normal"
                          >
                            <Truck className="size-3" />
                            送货单 {r.deliveryCount}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className="gap-1 font-normal"
                          >
                            <ScrollText className="size-3" />
                            传票 {r.shippingCount}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Progress value={r.progress} className="h-1.5 w-32" />
                          <span className="w-10 text-xs tabular-nums text-muted-foreground">
                            {Math.round(r.progress)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.confidence != null ? (
                          <ConfidenceBadge score={r.confidence} />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={r.status}
                          lowConf={(r.confidence ?? 100) < 80}
                          pending={pending}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={r.status !== "done"}
                                onClick={() => setDetailId(r.id)}
                              >
                                <Eye className="size-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>查看识别结果</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={r.status !== "done"}
                                onClick={() => downloadJson(r)}
                              >
                                <Download className="size-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>下载 JSON</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteRecord(r.id)}
                              >
                                <Trash2 className="size-4 text-muted-foreground" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>删除</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </main>

        {/* Create drawer */}
        <Sheet open={createOpen} onOpenChange={setCreateOpen}>
          <SheetContent
            side="right"
            className="flex w-full flex-col gap-0 p-0 sm:max-w-[560px]"
          >
            <SheetHeader className="border-b border-border px-6 py-4">
              <SheetTitle>新建识别任务</SheetTitle>
              <SheetDescription>
                分别上传送货单和出货传票的图片，系统将自动完成 OCR 与结构化识别。
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <UploadZone
                title="送货单"
                icon={<Truck className="size-4" />}
                images={deliveryImgs}
                onAdd={(f) => addFiles("delivery_note", f)}
                onRemove={(id) =>
                  setDeliveryImgs((p) => p.filter((i) => i.id !== id))
                }
              />
              <UploadZone
                title="出货传票"
                icon={<ScrollText className="size-4" />}
                images={shippingImgs}
                onAdd={(f) => addFiles("shipping_slip", f)}
                onRemove={(id) =>
                  setShippingImgs((p) => p.filter((i) => i.id !== id))
                }
              />
            </div>
            <SheetFooter className="flex-row items-center justify-between border-t border-border bg-muted/30 px-6 py-3 sm:justify-between">
              <div className="text-xs text-muted-foreground">
                共 <span className="font-medium text-foreground">{totalUploads}</span> 张图片
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  取消
                </Button>
                <Button
                  onClick={startOcr}
                  disabled={totalUploads === 0}
                  className="gap-2"
                >
                  <Sparkles className="size-4" /> 开始 OCR 识别
                </Button>
              </div>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {/* Progress floating card */}
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
                      <span className="font-mono text-muted-foreground">
                        #{r.id}
                      </span>
                      <span className="tabular-nums text-foreground">
                        {Math.round(r.progress)}%
                      </span>
                    </div>
                    <Progress value={r.progress} className="h-1.5" />
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {r.images.length} 张图片 · 正在进行结构化识别
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

        {/* Detail drawer */}
        <Sheet
          open={!!detailRecord}
          onOpenChange={(o) => !o && setDetailId(null)}
        >
          <SheetContent
            side="right"
            className="flex w-full flex-col gap-0 p-0 sm:max-w-[1080px]"
          >
            {detailRecord && detailRecord.results && (
              <DetailView
                record={detailRecord}
                onChange={(docType, path, val) =>
                  updateField(detailRecord.id, docType, path, val)
                }
                onDownload={() => downloadJson(detailRecord)}
                buildExport={buildExport}
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
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>
        {value}
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  lowConf,
  pending,
}: {
  status: Status;
  lowConf: boolean;
  pending: number;
}) {
  if (status === "recognizing")
    return (
      <Badge variant="secondary" className="gap-1 font-normal">
        <Loader2 className="size-3 animate-spin" /> 识别中
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge variant="destructive" className="gap-1 font-normal">
        <AlertTriangle className="size-3" /> 识别异常
      </Badge>
    );
  if (pending > 0)
    return (
      <Badge className="gap-1 border-0 bg-[color:var(--warning)]/25 font-normal text-[color:var(--warning-foreground)]">
        <AlertTriangle className="size-3" /> 待核验 · {pending}
      </Badge>
    );
  if (lowConf)
    return (
      <Badge className="gap-1 border-0 bg-[color:var(--success)]/15 font-normal text-[color:var(--success)]">
        <CheckCircle2 className="size-3" /> 已核验
      </Badge>
    );
  return (
    <Badge className="gap-1 border-0 bg-[color:var(--success)]/15 font-normal text-[color:var(--success)]">
      <CheckCircle2 className="size-3" /> 已完成
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
  onDownload,
  buildExport,
}: {
  record: OcrRecord;
  onChange: (docType: DocType, path: string, value: string) => void;
  onDownload: () => void;
  buildExport: (r: OcrRecord) => unknown;
}) {
  const pending = pendingLowConf(record);
  const availableDocTypes = (Object.keys(record.results ?? {}) as DocType[]);
  const [activeTab, setActiveTab] = useState<DocType | "json">(
    availableDocTypes[0] ?? "json",
  );

  return (
    <>
      <SheetHeader className="border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <SheetTitle className="flex flex-wrap items-center gap-2">
              识别结果
              <ConfidenceBadge score={record.confidence ?? 0} />
              {pending > 0 ? (
                <span className="inline-flex items-center gap-1 text-xs text-[color:var(--warning-foreground)]">
                  <AlertTriangle className="size-3" />
                  尚有 {pending} 项低置信度字段需要人工核验后才能下载
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-[color:var(--success)]">
                  <CheckCircle2 className="size-3" />
                  已全部通过核验
                </span>
              )}
            </SheetTitle>
            <SheetDescription className="mt-1 font-mono text-xs">
              #{record.id} · {fmtTime(record.createdAt)}
            </SheetDescription>
          </div>
          <Button
            onClick={onDownload}
            disabled={pending > 0}
            className="gap-2"
          >
            <Download className="size-4" /> 下载 JSON
          </Button>
        </div>
      </SheetHeader>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as DocType | "json")}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="border-b border-border bg-muted/20 px-6 py-2">
          <TabsList>
            {availableDocTypes.map((dt) => {
              const imgs = record.images.filter((i) => i.docType === dt);
              return (
                <TabsTrigger key={dt} value={dt} className="gap-2">
                  {dt === "delivery_note" ? (
                    <Truck className="size-3.5" />
                  ) : (
                    <ScrollText className="size-3.5" />
                  )}
                  {DOC_LABEL[dt]}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                    {imgs.length}
                  </span>
                </TabsTrigger>
              );
            })}
            <TabsTrigger value="json">JSON 预览</TabsTrigger>
          </TabsList>
        </div>

        {availableDocTypes.map((dt) => {
          const doc = record.results![dt]!;
          const imgs = record.images.filter((i) => i.docType === dt);
          return (
            <TabsContent
              key={dt}
              value={dt}
              className="flex-1 overflow-hidden data-[state=inactive]:hidden"
            >
              <DocPanel
                docType={dt}
                doc={doc}
                images={imgs}
                onChange={(path, v) => onChange(dt, path, v)}
              />
            </TabsContent>
          );
        })}

        <TabsContent
          value="json"
          className="flex-1 overflow-auto px-6 pb-6 pt-4 data-[state=inactive]:hidden"
        >
          <pre className="max-h-full overflow-auto rounded-lg border border-border bg-muted/40 p-4 text-xs leading-relaxed">
            {JSON.stringify(buildExport(record), null, 2)}
          </pre>
        </TabsContent>
      </Tabs>
    </>
  );
}

function DocPanel({
  docType,
  doc,
  images,
  onChange,
}: {
  docType: DocType;
  doc: DocResult;
  images: UploadedImage[];
  onChange: (path: string, value: string) => void;
}) {
  return (
    <div className="grid h-full grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Preview */}
      <div className="overflow-y-auto border-r border-border bg-muted/30 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">
            {DOC_LABEL[docType]}原图
          </div>
          <span className="text-[11px] text-muted-foreground">
            {images.length} 张
          </span>
        </div>
        <div className="space-y-3">
          {images.map((img) => (
            <div
              key={img.id}
              className="overflow-hidden rounded-lg border border-border bg-background"
            >
              <img
                src={img.url}
                alt={img.name}
                className="w-full object-contain"
              />
              <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                {img.name}
              </div>
            </div>
          ))}
          {images.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              未上传该类别的图片
            </div>
          )}
        </div>
      </div>

      {/* Fields + items */}
      <div className="flex flex-col overflow-y-auto">
        <div className="space-y-4 px-5 py-5">
          <section>
            <h3 className="mb-3 text-sm font-medium text-foreground">
              基础信息
            </h3>
            <div className="space-y-3">
              <EditableField
                label="单据编号"
                field={doc.fields.documentNo}
                onChange={(v) => onChange("field.documentNo", v)}
              />
              <EditableField
                label="日期"
                field={doc.fields.documentDate}
                onChange={(v) => onChange("field.documentDate", v)}
              />
              <EditableField
                label="客户名称"
                field={doc.fields.customerName}
                onChange={(v) => onChange("field.customerName", v)}
              />
              <EditableField
                label="送货地址"
                field={doc.fields.deliveryAddress}
                multiline
                onChange={(v) => onChange("field.deliveryAddress", v)}
              />
              <EditableField
                label="联系人"
                field={doc.fields.contact}
                onChange={(v) => onChange("field.contact", v)}
              />
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-medium text-foreground">
              明细信息
            </h3>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">序</th>
                    <th className="px-2 py-2 text-left">物料编码</th>
                    <th className="px-2 py-2 text-left">品名</th>
                    <th className="px-2 py-2 text-left">规格</th>
                    <th className="px-2 py-2 text-left">数量</th>
                    <th className="px-2 py-2 text-left">单位</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.items.map((it, idx) => (
                    <tr key={idx} className="border-t border-border align-top">
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        {idx + 1}
                      </td>
                      {(
                        [
                          "materialCode",
                          "materialName",
                          "spec",
                          "quantity",
                          "unit",
                        ] as const
                      ).map((k) => (
                        <td key={k} className="px-1.5 py-1">
                          <CellInput
                            field={it[k]}
                            onChange={(v) => onChange(`item.${idx}.${k}`, v)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function fmtEditLog(e: EditLog) {
  const d = new Date(e.at);
  const t = d.toLocaleString("zh-CN", { hour12: false });
  return `${e.by} · ${t}`;
}

function EditableField({
  label,
  field,
  multiline,
  onChange,
}: {
  label: string;
  field: FieldValue;
  multiline?: boolean;
  onChange: (v: string) => void;
}) {
  const tone = confidenceTone(field.confidence);
  const mustEdit = tone === "low" && !field.edited;
  const ringCls = mustEdit
    ? "border-[color:var(--warning)] bg-[color:var(--warning)]/10 focus-visible:ring-[color:var(--warning)]"
    : tone === "low"
    ? "border-[color:var(--warning)]/60"
    : tone === "mid"
    ? "border-primary/40"
    : "";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {label}
          {mustEdit && (
            <span className="text-[color:var(--warning-foreground)]">*</span>
          )}
        </Label>
        <div className="flex items-center gap-2 text-[11px]">
          {field.edited && (
            <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary">
              <Pencil className="size-2.5" /> 已修改
            </span>
          )}
          <span
            className={cn(
              "tabular-nums",
              mustEdit
                ? "text-[color:var(--warning-foreground)]"
                : tone === "mid"
                ? "text-primary"
                : "text-muted-foreground",
            )}
          >
            置信度 {Math.round(field.confidence * 100)}%
            {mustEdit && " · 需人工确认"}
          </span>
        </div>
      </div>
      {multiline ? (
        <Textarea
          value={field.value}
          onChange={(e) => onChange(e.target.value)}
          className={cn("min-h-16 resize-none", ringCls)}
        />
      ) : (
        <Input
          value={field.value}
          onChange={(e) => onChange(e.target.value)}
          className={ringCls}
        />
      )}
      {field.lastEdit && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          最近修改：{fmtEditLog(field.lastEdit)}
          {field.original !== undefined && field.original !== field.value && (
            <span className="ml-2 text-muted-foreground/70">
              原值：{field.original}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CellInput({
  field,
  onChange,
}: {
  field: FieldValue;
  onChange: (v: string) => void;
}) {
  const tone = confidenceTone(field.confidence);
  const mustEdit = tone === "low" && !field.edited;
  return (
    <div className="relative">
      <input
        value={field.value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none transition-colors focus:border-primary",
          mustEdit
            ? "border-[color:var(--warning)] bg-[color:var(--warning)]/10 pr-10"
            : field.edited
            ? "border-primary/40"
            : "border-transparent hover:border-border",
        )}
      />
      {mustEdit && (
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-medium text-[color:var(--warning-foreground)]">
          {Math.round(field.confidence * 100)}%
        </span>
      )}
      {field.edited && (
        <div
          className="mt-0.5 truncate text-[10px] text-muted-foreground"
          title={field.lastEdit ? fmtEditLog(field.lastEdit) : ""}
        >
          {field.lastEdit ? `✎ ${fmtEditLog(field.lastEdit)}` : "已修改"}
        </div>
      )}
    </div>
  );
}
