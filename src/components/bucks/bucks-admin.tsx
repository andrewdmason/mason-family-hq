"use client";

import { useRef, useState } from "react";
import { Check, ExternalLink, Plus, Trophy, X } from "lucide-react";
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
  awardBucks,
  createEarningTask,
  updateEarningTask,
  createPrize,
  updatePrize,
  fulfillRedemption,
  rejectClaim,
  attachPrizeImage,
  type BucksKid,
  type BucksManageData,
} from "@/app/(bucks)/bucks/manage/actions";
import type { BucksAdminPrize, BucksAdminTask } from "@/lib/bucks/types";
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

/** The AudienceSelect value (email or SHARED) for a stored audience user id. */
function audienceValue(userId: string | null, kids: BucksKid[]): string {
  if (!userId) return SHARED;
  return kids.find((k) => k.userId === userId)?.email ?? SHARED;
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

// ---- Manual awards -------------------------------------------------------

function AwardSection({ data }: { data: BucksManageData }) {
  const { pending, error, run } = useBucksAction();
  const [userId, setUserId] = useState(data.kids[0]?.userId ?? "");
  const [amount, setAmount] = useState(10);
  const [note, setNote] = useState("");

  if (data.kids.length === 0) return null;

  function award() {
    run(async () => {
      await awardBucks({ userId, amount, note });
      setAmount(10);
      setNote("");
    });
  }

  return (
    <section>
      <h2 className="font-serif text-lg text-foreground">Award Bucks</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Hand out Bucks for one-off stuff — adds straight to the kid&apos;s balance.
      </p>
      <div className="mt-3 rounded-lg border border-dashed border-border p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Select value={userId} onValueChange={(v) => v && setUserId(v)}>
            <SelectTrigger size="sm" aria-label="Who gets the Bucks">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.kids.map((k) => (
                <SelectItem key={k.userId} value={k.userId}>
                  {k.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
              className="w-24"
              aria-label="Bucks to award"
            />
            <span className="text-sm text-muted-foreground">Bucks</span>
          </div>
        </div>
        <Input
          className="mt-2"
          placeholder="Note (e.g. Helped a neighbor rake leaves)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Award note"
        />
        <div className="mt-2">
          <Button
            size="sm"
            onClick={award}
            disabled={pending || !note.trim() || !userId}
          >
            Award Bucks
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

// ---- Earning tasks -------------------------------------------------------

function TaskRow({ task, kids }: { task: BucksAdminTask; kids: BucksKid[] }) {
  const { pending, error, run } = useBucksAction();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [value, setValue] = useState(task.unitValue);
  const [unit, setUnit] = useState(task.unitLabel);
  const [oneTime, setOneTime] = useState(task.isOneTime);
  const [audience, setAudience] = useState(audienceValue(task.audienceUserId, kids));

  function save() {
    run(async () => {
      await updateEarningTask({
        taskId: task.id,
        title,
        unitValue: value,
        unitLabel: unit,
        isOneTime: oneTime,
        audienceEmail: audienceEmail(audience),
      });
      setEditing(false);
    });
  }

  function cancel() {
    setTitle(task.title);
    setValue(task.unitValue);
    setUnit(task.unitLabel);
    setOneTime(task.isOneTime);
    setAudience(audienceValue(task.audienceUserId, kids));
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-border p-3">
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
          <AudienceSelect kids={kids} value={audience} onChange={setAudience} />
          <Label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={oneTime} onCheckedChange={setOneTime} />
            One-time
          </Label>
          <Button size="sm" onClick={save} disabled={pending || !title.trim()}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={cancel} disabled={pending}>
            Cancel
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground">{task.title}</p>
          <p className="text-xs text-muted-foreground">
            {task.unitValue} / {task.unitLabel} · {audienceLabel(task.audienceUserId, kids)}
            {task.isOneTime && " · one-time"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={pending}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => run(() => archiveEarningTask(task.id))}
            disabled={pending}
          >
            Archive
          </Button>
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

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
          <TaskRow key={t.id} task={t} kids={data.kids} />
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

function PrizeRow({ prize, kids }: { prize: BucksAdminPrize; kids: BucksKid[] }) {
  const { pending, error, run } = useBucksAction();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(prize.title);
  const [price, setPrice] = useState(prize.price);
  const [audience, setAudience] = useState(audienceValue(prize.audienceUserId, kids));
  const [purchaseUrl, setPurchaseUrl] = useState(prize.purchaseUrl ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  function save() {
    run(async () => {
      await updatePrize({
        prizeId: prize.id,
        title,
        price,
        audienceEmail: audienceEmail(audience),
        purchaseUrl,
      });
      const file = fileRef.current?.files?.[0];
      if (file) {
        const path = await uploadPrizeImage(prize.id, file);
        await attachPrizeImage(prize.id, path);
      }
      if (fileRef.current) fileRef.current.value = "";
      setEditing(false);
    });
  }

  function cancel() {
    setTitle(prize.title);
    setPrice(prize.price);
    setAudience(audienceValue(prize.audienceUserId, kids));
    setPurchaseUrl(prize.purchaseUrl ?? "");
    if (fileRef.current) fileRef.current.value = "";
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-border p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (e.g. Lego set)"
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
          <Input
            type="url"
            inputMode="url"
            placeholder="Where to buy (optional, https://…)"
            value={purchaseUrl}
            onChange={(e) => setPurchaseUrl(e.target.value)}
            className="sm:col-span-2"
            aria-label="Purchase link"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <AudienceSelect kids={kids} value={audience} onChange={setAudience} />
          <Input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="h-8 w-auto text-xs"
            aria-label="Replace prize image"
          />
          <Button size="sm" onClick={save} disabled={pending || !title.trim()}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={cancel} disabled={pending}>
            Cancel
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
            {prize.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={prize.imageUrl} alt={prize.title} className="h-full w-full object-contain" />
            ) : (
              <Trophy className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{prize.title}</p>
            <p className="text-xs text-muted-foreground">
              {prize.price} Bucks · {audienceLabel(prize.audienceUserId, kids)}
            </p>
            {prize.purchaseUrl && (
              <a
                href={prize.purchaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-700 hover:underline dark:text-amber-400"
              >
                <ExternalLink className="h-3 w-3" /> Where to buy
              </a>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={pending}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => run(() => archivePrize(prize.id))}
            disabled={pending}
          >
            Archive
          </Button>
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function PrizesSection({ data }: { data: BucksManageData }) {
  const { pending, error, run } = useBucksAction();
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState(100);
  const [audience, setAudience] = useState(SHARED);
  const [purchaseUrl, setPurchaseUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function create() {
    run(async () => {
      const { prizeId } = await createPrize({
        title,
        price,
        audienceEmail: audienceEmail(audience),
        purchaseUrl,
      });
      const file = fileRef.current?.files?.[0];
      if (file) {
        const path = await uploadPrizeImage(prizeId, file);
        await attachPrizeImage(prizeId, path);
      }
      setTitle("");
      setPrice(100);
      setAudience(SHARED);
      setPurchaseUrl("");
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <section>
      <h2 className="font-serif text-lg text-foreground">Prizes</h2>
      <div className="mt-3 space-y-2">
        {data.prizes.map((p) => (
          <PrizeRow key={p.id} prize={p} kids={data.kids} />
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
          <Input
            type="url"
            inputMode="url"
            placeholder="Where to buy (optional, https://…)"
            value={purchaseUrl}
            onChange={(e) => setPurchaseUrl(e.target.value)}
            className="sm:col-span-2"
            aria-label="Purchase link"
          />
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
      <AwardSection data={data} />
      <TasksSection data={data} />
      <PrizesSection data={data} />
    </div>
  );
}
