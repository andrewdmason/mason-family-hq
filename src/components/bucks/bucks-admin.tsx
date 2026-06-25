"use client";

import { useRef, useState } from "react";
import { Check, Plus, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  approveClaim,
  archiveEarningTask,
  archivePrize,
  createEarningTask,
  createPrize,
  fulfillRedemption,
  rejectClaim,
  attachPrizeImage,
  type BucksKid,
  type BucksManageData,
} from "@/app/(bucks)/bucks/manage/actions";
import { uploadPrizeImage } from "@/lib/bucks/prize-image-upload";
import { useBucksAction } from "@/lib/bucks/use-bucks-action";

const SHARED = "__shared__";

function AudienceSelect({
  kids,
  value,
  onChange,
}: {
  kids: BucksKid[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? SHARED)}>
      <SelectTrigger size="sm" aria-label="Who can earn / redeem this">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SHARED}>Both kids</SelectItem>
        {kids.map((k) => (
          <SelectItem key={k.email} value={k.email}>
            {k.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function audienceEmail(value: string): string | null {
  return value === SHARED ? null : value;
}

function audienceLabel(userId: string | null, kids: BucksKid[]): string {
  if (!userId) return "Both kids";
  return kids.find((k) => k.userId === userId)?.name ?? "One kid";
}

// ---- Approvals -----------------------------------------------------------

function ApprovalsSection({ data }: { data: BucksManageData }) {
  const { pending, error, run } = useBucksAction();
  if (data.claims.length === 0) return null;
  return (
    <section>
      <h2 className="font-serif text-lg text-foreground">Pending approvals</h2>
      <div className="mt-3 space-y-2">
        {data.claims.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                {c.kidName} claimed “{c.taskTitle}”
              </p>
              <p className="text-xs text-muted-foreground">
                {c.quantity} × {c.unitValue} = {c.amount} Bucks
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                size="sm"
                onClick={() => run(() => approveClaim(c.id))}
                disabled={pending}
              >
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => run(() => rejectClaim(c.id))}
                disabled={pending}
              >
                <X className="h-3.5 w-3.5" /> Reject
              </Button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

// ---- Redemptions to fulfill ----------------------------------------------

function RedemptionsSection({ data }: { data: BucksManageData }) {
  const { pending, error, run } = useBucksAction();
  if (data.redemptions.length === 0) return null;
  return (
    <section>
      <h2 className="font-serif text-lg text-foreground">To hand out</h2>
      <div className="mt-3 space-y-2">
        {data.redemptions.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                {r.kidName} redeemed “{r.prizeTitle}”
              </p>
              <p className="text-xs text-muted-foreground">{r.price} Bucks</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(() => fulfillRedemption(r.id))}
              disabled={pending}
            >
              <Check className="h-3.5 w-3.5" /> Mark given
            </Button>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

// ---- Earning tasks -------------------------------------------------------

function TasksSection({ data }: { data: BucksManageData }) {
  const { pending, error, run } = useBucksAction();
  const [title, setTitle] = useState("");
  const [value, setValue] = useState(10);
  const [unit, setUnit] = useState("time");
  const [oneTime, setOneTime] = useState(false);
  const [audience, setAudience] = useState(SHARED);

  function create() {
    run(async () => {
      await createEarningTask({
        title,
        unitValue: value,
        unitLabel: unit,
        isOneTime: oneTime,
        audienceEmail: audienceEmail(audience),
      });
      setTitle("");
      setValue(10);
      setUnit("time");
      setOneTime(false);
      setAudience(SHARED);
    });
  }

  return (
    <section>
      <h2 className="font-serif text-lg text-foreground">Ways to earn</h2>
      <div className="mt-3 space-y-2">
        {data.tasks.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">{t.title}</p>
              <p className="text-xs text-muted-foreground">
                {t.unitValue} / {t.unitLabel} · {audienceLabel(t.audienceUserId, data.kids)}
                {t.isOneTime && " · one-time"}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => run(() => archiveEarningTask(t.id))}
              disabled={pending}
            >
              Archive
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-dashed border-border p-3">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Plus className="h-4 w-4" /> New earning task
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            placeholder="Title (e.g. Play a board game)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={value}
              onChange={(e) => setValue(Math.max(1, Number(e.target.value) || 1))}
              className="w-24"
              aria-label="Bucks per unit"
            />
            <span className="text-sm text-muted-foreground">Bucks /</span>
            <Input
              placeholder="unit (game, page)"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="flex-1"
              aria-label="Unit label"
            />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <AudienceSelect kids={data.kids} value={audience} onChange={setAudience} />
          <Label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={oneTime} onCheckedChange={setOneTime} />
            One-time
          </Label>
          <Button size="sm" onClick={create} disabled={pending || !title.trim()}>
            Add task
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

// ---- Prizes --------------------------------------------------------------

function PrizesSection({ data }: { data: BucksManageData }) {
  const { pending, error, run } = useBucksAction();
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState(100);
  const [audience, setAudience] = useState(SHARED);
  const fileRef = useRef<HTMLInputElement>(null);

  function create() {
    run(async () => {
      const { prizeId } = await createPrize({
        title,
        price,
        audienceEmail: audienceEmail(audience),
      });
      const file = fileRef.current?.files?.[0];
      if (file) {
        const path = await uploadPrizeImage(prizeId, file);
        await attachPrizeImage(prizeId, path);
      }
      setTitle("");
      setPrice(100);
      setAudience(SHARED);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <section>
      <h2 className="font-serif text-lg text-foreground">Prizes</h2>
      <div className="mt-3 space-y-2">
        {data.prizes.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt={p.title} className="h-full w-full object-contain" />
                ) : (
                  <Trophy className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{p.title}</p>
                <p className="text-xs text-muted-foreground">
                  {p.price} Bucks · {audienceLabel(p.audienceUserId, data.kids)}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => run(() => archivePrize(p.id))}
              disabled={pending}
            >
              Archive
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-dashed border-border p-3">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Plus className="h-4 w-4" /> New prize
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            placeholder="Title (e.g. Lego set)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={price}
              onChange={(e) => setPrice(Math.max(1, Number(e.target.value) || 1))}
              className="w-28"
              aria-label="Price in Bucks"
            />
            <span className="text-sm text-muted-foreground">Bucks</span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <AudienceSelect kids={data.kids} value={audience} onChange={setAudience} />
          <Input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="h-8 w-auto text-xs"
            aria-label="Prize image"
          />
          <Button size="sm" onClick={create} disabled={pending || !title.trim()}>
            Add prize
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

export function BucksAdmin({ data }: { data: BucksManageData }) {
  return (
    <div className="mt-6 space-y-8">
      <ApprovalsSection data={data} />
      <RedemptionsSection data={data} />
      <TasksSection data={data} />
      <PrizesSection data={data} />
    </div>
  );
}
