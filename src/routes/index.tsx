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
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: Workbench,
});

// ---------- Types ----------
type DocType = "delivery_note" | "shipping_slip";
type Status = "recognizing" | "done" | "failed";

interface UploadedImage {
  id: string;
  name: string;
  url: string;
  docType: DocType;
}

interface FieldValue {
  value: string;
  confidence: number; // 0-1
  edited?: boolean;
  original?: string;
}

interface LineItem {
  materialCode: FieldValue;
  materialName: FieldValue;
  spec: FieldValue;
  quantity: FieldValue;
  unit: FieldValue;
}

interface OcrRecord {
  id: string;
  createdAt: string;
  status: Status;
  progress: number; // 0-100
  confidence?: number; // 0-100
  deliveryCount: number;
  shippingCount: number;
  images: UploadedImage[];
  // result fields (populated when done)
  fields?: {
    documentType: FieldValue;
    documentNo: FieldValue;
    documentDate: FieldValue;
    customerName: FieldValue;
    deliveryAddress: FieldValue;
    contact: FieldValue;
  };
  items?: LineItem[];
}

// ---------- Helpers ----------
const uid = () => Math.random().toString(36).slice(2, 10);

function randomField(pool: string[], forceLow = false): FieldValue {
  const value = pool[Math.floor(Math.random() * pool.length)];
  const confidence = forceLow
    ? 0.5 + Math.random() * 0.25
    : Math.random() < 0.35
    ? 0.55 + Math.random() * 0.3
    : 0.88 + Math.random() * 0.11;
  return { value, confidence: Math.min(0.99, confidence) };
}

function fabricateResult(images: UploadedImage[]): {
  fields: NonNullable<OcrRecord["fields"]>;
  items: LineItem[];
  confidence: number;
} {
  const customers = ["招商局物流集团", "顺丰供应链有限公司", "京东物流华南分公司", "深圳华强科技"];
  const addresses = [
    "深圳市南山区科技园南区T3栋",
    "广州市黄埔区开发大道128号",
    "东莞市松山湖大学路9号",
  ];
  const contacts = ["李经理 13800000000", "王主管 13911112222", "张先生 13566667777"];
  const materials = [
    ["A1001", "六角螺丝", "M3x10", "螺丝厂A"],
    ["A1002", "垫片", "M4", "五金厂B"],
    ["B2001", "铝合金外壳", "200x120", "结构件厂"],
    ["C3050", "PCB主板", "V2.1", "电子厂C"],
  ];
  const fields = {
    documentType: {
      value: images.some((i) => i.docType === "delivery_note") ? "送货单" : "出货传票",
      confidence: 0.98,
    },
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
      quantity: randomField([String(1 + Math.floor(Math.random() * 50))], Math.random() < 0.2),
      unit: randomField(["箱", "件", "个", "套"]),
    };
  });
  const all: FieldValue[] = [
    ...Object.values(fields),
    ...items.flatMap((i) => Object.values(i)),
  ];
  const avg = all.reduce((s, f) => s + f.confidence, 0) / all.length;
  return { fields, items, confidence: Math.round(avg * 100) };
}

function confidenceTone(c: number) {
  if (c >= 0.9) return "high";
  if (c >= 0.8) return "mid";
  return "low";
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
        <div className="text-xs text-muted-foreground">支持 JPG / PNG，单张 ≤ 3MB，最多 {max} 张</div>
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

// ---------- Main Workbench ----------
function Workbench() {
  const [records, setRecords] = useState<OcrRecord[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [deliveryImgs, setDeliveryImgs] = useState<UploadedImage[]>([]);
  const [shippingImgs, setShippingImgs] = useState<UploadedImage[]>([]);

  const [progressMinimized, setProgressMinimized] = useState(false);
  const [progressDismissed, setProgressDismissed] = useState(true); // hidden until first task
  const [detailId, setDetailId] = useState<string | null>(null);

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
              fields: result.fields,
              items: result.items,
            };
          }
          return { ...r, progress: next };
        }),
      );
    }, 500);
    return () => clearInterval(t);
  }, [activeRecords.length]);

  function addFiles(target: DocType, files: FileList) {
    const bucket = target === "delivery_note" ? deliveryImgs : shippingImgs;
    const setter = target === "delivery_note" ? setDeliveryImgs : setShippingImgs;
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
    if (arr.length < files.length) toast.warning(`单个类型最多 6 张，已截断`);
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
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
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

  function updateField(recordId: string, path: string, value: string) {
    setRecords((prev) =>
      prev.map((r) => {
        if (r.id !== recordId || !r.fields) return r;
        const [scope, key, idxStr, sub] = path.split(".");
        if (scope === "field" && r.fields[key as keyof typeof r.fields]) {
          const f = r.fields[key as keyof typeof r.fields];
          return {
            ...r,
            fields: {
              ...r.fields,
              [key]: { ...f, value, edited: true, original: f.original ?? f.value },
            },
          };
        }
        if (scope === "item" && r.items) {
          const idx = Number(idxStr);
          const items = r.items.map((it, i) => {
            if (i !== idx) return it;
            const f = it[sub as keyof LineItem];
            return {
              ...it,
              [sub]: { ...f, value, edited: true, original: f.original ?? f.value },
            };
          });
          return { ...r, items };
        }
        return r;
      }),
    );
  }

  function downloadJson(r: OcrRecord) {
    if (!r.fields || !r.items) return;
    const payload = {
      taskId: r.id,
      exportedAt: new Date().toISOString(),
      documents: [
        {
          documentId: r.id,
          documentType:
            r.fields.documentType.value === "送货单" ? "delivery_note" : "shipping_slip",
          validationStatus: "confirmed",
          fields: {
            documentNo: r.fields.documentNo.value,
            documentDate: r.fields.documentDate.value,
            customerName: r.fields.customerName.value,
            deliveryAddress: r.fields.deliveryAddress.value,
            contact: r.fields.contact.value,
          },
          items: r.items.map((it, i) => ({
            lineNo: i + 1,
            materialCode: it.materialCode.value,
            materialName: it.materialName.value,
            specification: it.spec.value,
            quantity: Number(it.quantity.value) || it.quantity.value,
            unit: it.unit.value,
          })),
          metadata: {
            overallConfidence: (r.confidence ?? 0) / 100,
            confirmedByUser: true,
          },
        },
      ],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
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

  function deleteRecord(id: string) {
    setRecords((p) => p.filter((r) => r.id !== id));
    if (detailId === id) setDetailId(null);
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
                <h1 className="text-base font-semibold leading-tight">OCR 识别工作台</h1>
                <p className="text-xs text-muted-foreground">送货单 · 出货传票 结构化识别</p>
              </div>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="size-4" />
              新建识别
            </Button>
          </div>
        </header>

        {/* Main */}
        <main className="mx-auto max-w-[1400px] px-6 py-6">
          {/* Stat strip */}
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="识别任务" value={records.length} />
            <StatCard label="识别中" value={records.filter((r) => r.status === "recognizing").length} accent="primary" />
            <StatCard
              label="已完成"
              value={records.filter((r) => r.status === "done").length}
              accent="success"
            />
            <StatCard
              label="待核验"
              value={records.filter((r) => r.status === "done" && (r.confidence ?? 100) < 80).length}
              accent="warning"
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="text-sm font-medium">识别记录</div>
              <div className="text-xs text-muted-foreground">最新任务显示在最上方</div>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-[220px]">任务 ID</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>图片数量</TableHead>
                  <TableHead className="w-[240px]">识别进度</TableHead>
                  <TableHead>置信度评分</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-16 text-center">
                      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-muted-foreground">
                        <div className="grid size-12 place-items-center rounded-full bg-secondary">
                          <FileText className="size-5" />
                        </div>
                        <div className="text-sm">还没有识别记录</div>
                        <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                          <Plus className="mr-1 size-4" /> 新建识别
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {records.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs text-foreground">#{r.id}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.createdAt}</TableCell>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Badge variant="secondary" className="gap-1 font-normal">
                          <Truck className="size-3" />
                          送货单 {r.deliveryCount}
                        </Badge>
                        <Badge variant="secondary" className="gap-1 font-normal">
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
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} lowConf={(r.confidence ?? 100) < 80} />
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
                            <Button variant="ghost" size="icon" onClick={() => deleteRecord(r.id)}>
                              <Trash2 className="size-4 text-muted-foreground" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>删除</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </main>

        {/* Create drawer */}
        <Sheet open={createOpen} onOpenChange={setCreateOpen}>
          <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[560px]">
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
                onRemove={(id) => setDeliveryImgs((p) => p.filter((i) => i.id !== id))}
              />
              <UploadZone
                title="出货传票"
                icon={<ScrollText className="size-4" />}
                images={shippingImgs}
                onAdd={(f) => addFiles("shipping_slip", f)}
                onRemove={(id) => setShippingImgs((p) => p.filter((i) => i.id !== id))}
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
                <Button onClick={startOcr} disabled={totalUploads === 0} className="gap-2">
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
                      <span className="font-mono text-muted-foreground">#{r.id}</span>
                      <span className="tabular-nums text-foreground">{Math.round(r.progress)}%</span>
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
        <Sheet open={!!detailRecord} onOpenChange={(o) => !o && setDetailId(null)}>
          <SheetContent
            side="right"
            className="flex w-full flex-col gap-0 p-0 sm:max-w-[960px]"
          >
            {detailRecord && detailRecord.fields && detailRecord.items && (
              <DetailView
                record={detailRecord}
                onChange={(path, val) => updateField(detailRecord.id, path, val)}
                onDownload={() => downloadJson(detailRecord)}
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

function StatusBadge({ status, lowConf }: { status: Status; lowConf: boolean }) {
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
  if (lowConf)
    return (
      <Badge className="gap-1 border-0 bg-[color:var(--warning)]/25 font-normal text-[color:var(--warning-foreground)]">
        <AlertTriangle className="size-3" /> 待核验
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
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums", tone)}>
      {score}
    </span>
  );
}

function DetailView({
  record,
  onChange,
  onDownload,
}: {
  record: OcrRecord;
  onChange: (path: string, value: string) => void;
  onDownload: () => void;
}) {
  const fields = record.fields!;
  const items = record.items!;
  const lowConf = (record.confidence ?? 100) < 80;
  const previewImage = record.images[0];

  return (
    <>
      <SheetHeader className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <SheetTitle className="flex items-center gap-2">
              识别结果
              <ConfidenceBadge score={record.confidence ?? 0} />
              {lowConf && (
                <span className="inline-flex items-center gap-1 text-xs text-[color:var(--warning-foreground)]">
                  <AlertTriangle className="size-3" /> 置信度低于 80，请人工核验高亮字段
                </span>
              )}
            </SheetTitle>
            <SheetDescription className="mt-1 font-mono text-xs">#{record.id}</SheetDescription>
          </div>
          <Button onClick={onDownload} className="gap-2">
            <Download className="size-4" /> 下载 JSON
          </Button>
        </div>
      </SheetHeader>

      <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Preview */}
        <div className="hidden overflow-y-auto border-r border-border bg-muted/30 p-4 md:block">
          <div className="mb-2 text-xs font-medium text-muted-foreground">原始单据预览</div>
          <div className="space-y-3">
            {record.images.map((img) => (
              <div key={img.id} className="overflow-hidden rounded-lg border border-border bg-background">
                <img src={img.url} alt={img.name} className="w-full object-contain" />
                <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                  {img.docType === "delivery_note" ? "送货单" : "出货传票"} · {img.name}
                </div>
              </div>
            ))}
            {!previewImage && (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                无预览图片
              </div>
            )}
          </div>
        </div>

        {/* Fields */}
        <div className="flex flex-col overflow-hidden">
          <Tabs defaultValue="basic" className="flex flex-1 flex-col overflow-hidden">
            <TabsList className="mx-4 mt-3 self-start">
              <TabsTrigger value="basic">基础信息</TabsTrigger>
              <TabsTrigger value="items">明细信息</TabsTrigger>
              <TabsTrigger value="json">JSON 预览</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="flex-1 overflow-y-auto px-4 pb-6 pt-3">
              <div className="space-y-3">
                <EditableField
                  label="单据类型"
                  field={fields.documentType}
                  onChange={(v) => onChange("field.documentType", v)}
                />
                <EditableField
                  label="单据编号"
                  field={fields.documentNo}
                  onChange={(v) => onChange("field.documentNo", v)}
                />
                <EditableField
                  label="日期"
                  field={fields.documentDate}
                  onChange={(v) => onChange("field.documentDate", v)}
                />
                <EditableField
                  label="客户名称"
                  field={fields.customerName}
                  onChange={(v) => onChange("field.customerName", v)}
                />
                <EditableField
                  label="送货地址"
                  field={fields.deliveryAddress}
                  multiline
                  onChange={(v) => onChange("field.deliveryAddress", v)}
                />
                <EditableField
                  label="联系人"
                  field={fields.contact}
                  onChange={(v) => onChange("field.contact", v)}
                />
              </div>
            </TabsContent>

            <TabsContent value="items" className="flex-1 overflow-auto px-4 pb-6 pt-3">
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
                    {items.map((it, idx) => (
                      <tr key={idx} className="border-t border-border">
                        <td className="px-2 py-1.5 text-xs text-muted-foreground">{idx + 1}</td>
                        {(["materialCode", "materialName", "spec", "quantity", "unit"] as const).map(
                          (k) => (
                            <td key={k} className="px-1.5 py-1">
                              <CellInput
                                field={it[k]}
                                onChange={(v) => onChange(`item.${idx}.${k}`, v)}
                              />
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="json" className="flex-1 overflow-auto px-4 pb-6 pt-3">
              <pre className="max-h-full overflow-auto rounded-lg border border-border bg-muted/40 p-4 text-xs leading-relaxed">
                {JSON.stringify(buildExport(record), null, 2)}
              </pre>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}

function buildExport(r: OcrRecord) {
  if (!r.fields || !r.items) return {};
  return {
    taskId: r.id,
    documentType:
      r.fields.documentType.value === "送货单" ? "delivery_note" : "shipping_slip",
    fields: Object.fromEntries(
      Object.entries(r.fields).map(([k, v]) => [k, v.value]),
    ),
    items: r.items.map((it, i) => ({
      lineNo: i + 1,
      materialCode: it.materialCode.value,
      materialName: it.materialName.value,
      specification: it.spec.value,
      quantity: Number(it.quantity.value) || it.quantity.value,
      unit: it.unit.value,
    })),
  };
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
  const ringCls =
    tone === "low"
      ? "border-[color:var(--warning)] bg-[color:var(--warning)]/10 focus-visible:ring-[color:var(--warning)]"
      : tone === "mid"
      ? "border-primary/40"
      : "";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <div className="flex items-center gap-2 text-[11px]">
          {field.edited && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">已修改</span>
          )}
          <span
            className={cn(
              "tabular-nums",
              tone === "low"
                ? "text-[color:var(--warning-foreground)]"
                : tone === "mid"
                ? "text-primary"
                : "text-muted-foreground",
            )}
          >
            置信度 {Math.round(field.confidence * 100)}%
            {tone === "low" && " ⚠"}
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
  return (
    <div className="relative">
      <input
        value={field.value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none transition-colors focus:border-primary",
          tone === "low"
            ? "border-[color:var(--warning)] bg-[color:var(--warning)]/10"
            : "border-transparent hover:border-border",
        )}
      />
      {tone === "low" && (
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[color:var(--warning-foreground)]">
          {Math.round(field.confidence * 100)}%
        </span>
      )}
    </div>
  );
}
