"use client";

import { useRef, useState } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  awardBucks,
  createEarningTask,
  createPrize,
  grantTaskForKid,
  redeemPrizeForKid,
  updateEarningTask,
  updatePrize,
  attachPrizeImage,
} from "@/app/(bucks)/bucks/actions";
import { uploadPrizeImage } from "@/lib/bucks/prize-image-upload";
import { useBucksAction } from "@/lib/bucks/use-bucks-action";
import { SHARED, audienceEmail, audienceValue } from "@/components/bucks/audience";
import type {
  BucksAdminPrize,
  BucksAdminTask,
  BucksKidSummary,
} from "@/lib/bucks/types";

function AudienceSelect({
  kids,
  value,
  onChange,
}: {
  kids: BucksKidSummary[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? SHARED)}>
      <SelectTrigger size="sm" aria-label="Who is this for">
        <SelectValue>
          {value === SHARED
            ? "Both kids"
            : kids.find((k) => k.email === value)?.name ?? "Both kids"}
        </SelectValue>
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

// Each form's state is initialized from props on mount. The exported dialogs key
// the body on `open` so it remounts (and resets) every time it's opened, which
// keeps the reset out of an effect.

// ---- Earning task create / edit ------------------------------------------

function TaskFormBody({
  onOpenChange,
  kids,
  task,
  defaultAudience,
}: {
  onOpenChange: (v: boolean) => void;
  kids: BucksKidSummary[];
  task?: BucksAdminTask;
  defaultAudience: string;
}) {
  const editing = !!task;
  const { pending, error, run } = useBucksAction();
  const [title, setTitle] = useState(task?.title ?? "");
  const [value, setValue] = useState(task?.unitValue ?? 10);
  const [unit, setUnit] = useState(task?.unitLabel ?? "time");
  const [oneTime, setOneTime] = useState(task?.isOneTime ?? false);
  const [audience, setAudience] = useState(
    task ? audienceValue(task.audienceUserId, kids) : defaultAudience
  );

  function submit() {
    run(async () => {
      const payload = {
        title,
        unitValue: value,
        unitLabel: unit,
        isOneTime: oneTime,
        audienceEmail: audienceEmail(audience),
      };
      if (task) await updateEarningTask({ taskId: task.id, ...payload });
      else await createEarningTask(payload);
      onOpenChange(false);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit task" : "New earning task"}</DialogTitle>
        <DialogDescription>
          A way for a kid to earn Bucks. They claim it; you approve.
        </DialogDescription>
      </DialogHeader>
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
      <div className="flex flex-wrap items-center gap-4">
        <AudienceSelect kids={kids} value={audience} onChange={setAudience} />
        <Label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={oneTime} onCheckedChange={setOneTime} />
          One-time
        </Label>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending || !title.trim()}>
          {editing ? "Save" : "Add task"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function TaskFormDialog({
  open,
  onOpenChange,
  kids,
  task,
  defaultAudience = SHARED,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kids: BucksKidSummary[];
  task?: BucksAdminTask;
  defaultAudience?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <TaskFormBody
          key={String(open)}
          onOpenChange={onOpenChange}
          kids={kids}
          task={task}
          defaultAudience={defaultAudience}
        />
      </DialogContent>
    </Dialog>
  );
}

// ---- Claim an earning task for a kid (instant grant) ---------------------

function ClaimForBody({
  onOpenChange,
  task,
  kids,
  defaultUserId,
}: {
  onOpenChange: (v: boolean) => void;
  task: BucksAdminTask;
  kids: BucksKidSummary[];
  defaultUserId?: string;
}) {
  const { pending, error, run } = useBucksAction();
  // A per-kid task can only be claimed for that kid; a shared one for anyone.
  const eligible = task.audienceUserId
    ? kids.filter((k) => k.userId === task.audienceUserId)
    : kids;
  const preferred = task.audienceUserId ?? defaultUserId ?? eligible[0]?.userId ?? "";
  const [userId, setUserId] = useState(
    eligible.some((k) => k.userId === preferred) ? preferred : eligible[0]?.userId ?? ""
  );
  const [qty, setQty] = useState(1);

  const selected = kids.find((k) => k.userId === userId);

  function submit() {
    run(async () => {
      await grantTaskForKid(task.id, userId, qty);
      onOpenChange(false);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Claim {task.title}</DialogTitle>
        <DialogDescription>
          Grants the Bucks straight away — no approval needed.
        </DialogDescription>
      </DialogHeader>
      <Select value={userId} onValueChange={(v) => v && setUserId(v)}>
        <SelectTrigger size="sm" aria-label="Claim for which kid">
          <SelectValue>{selected?.name ?? "Pick a kid"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {eligible.map((k) => (
            <SelectItem key={k.userId} value={k.userId}>
              {k.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground">
          How many {task.unitLabel}s?
        </label>
        <Input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          className="h-8 w-20"
        />
        <span className="text-sm tabular-nums text-muted-foreground">
          = {task.unitValue * qty} Bucks
        </span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending || !userId}>
          {pending ? "Granting…" : "Grant Bucks"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function ClaimForDialog({
  open,
  onOpenChange,
  task,
  kids,
  defaultUserId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  task: BucksAdminTask;
  kids: BucksKidSummary[];
  defaultUserId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ClaimForBody
          key={String(open)}
          onOpenChange={onOpenChange}
          task={task}
          kids={kids}
          defaultUserId={defaultUserId}
        />
      </DialogContent>
    </Dialog>
  );
}

// ---- Prize create / edit -------------------------------------------------

function PrizeFormBody({
  onOpenChange,
  kids,
  prize,
  defaultAudience,
}: {
  onOpenChange: (v: boolean) => void;
  kids: BucksKidSummary[];
  prize?: BucksAdminPrize;
  defaultAudience: string;
}) {
  const editing = !!prize;
  const { pending, error, run } = useBucksAction();
  const [title, setTitle] = useState(prize?.title ?? "");
  const [price, setPrice] = useState(prize?.price ?? 100);
  const [audience, setAudience] = useState(
    prize ? audienceValue(prize.audienceUserId, kids) : defaultAudience
  );
  const [purchaseUrl, setPurchaseUrl] = useState(prize?.purchaseUrl ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  function submit() {
    run(async () => {
      const payload = {
        title,
        price,
        audienceEmail: audienceEmail(audience),
        purchaseUrl,
      };
      let prizeId = prize?.id;
      if (prize) await updatePrize({ prizeId: prize.id, ...payload });
      else prizeId = (await createPrize(payload)).prizeId;

      const file = fileRef.current?.files?.[0];
      if (file && prizeId) {
        const path = await uploadPrizeImage(prizeId, file);
        await attachPrizeImage(prizeId, path);
      }
      onOpenChange(false);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit prize" : "New prize"}</DialogTitle>
        <DialogDescription>Something a kid can spend their Bucks on.</DialogDescription>
      </DialogHeader>
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
        aria-label="Purchase link"
      />
      <div className="flex flex-wrap items-center gap-3">
        <AudienceSelect kids={kids} value={audience} onChange={setAudience} />
        <Input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="h-8 w-auto text-xs"
          aria-label={editing ? "Replace prize image" : "Prize image"}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending || !title.trim()}>
          {editing ? "Save" : "Add prize"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function PrizeFormDialog({
  open,
  onOpenChange,
  kids,
  prize,
  defaultAudience = SHARED,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kids: BucksKidSummary[];
  prize?: BucksAdminPrize;
  defaultAudience?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <PrizeFormBody
          key={String(open)}
          onOpenChange={onOpenChange}
          kids={kids}
          prize={prize}
          defaultAudience={defaultAudience}
        />
      </DialogContent>
    </Dialog>
  );
}

// ---- Manual award --------------------------------------------------------

function AwardBody({
  onOpenChange,
  kids,
  defaultUserId,
}: {
  onOpenChange: (v: boolean) => void;
  kids: BucksKidSummary[];
  defaultUserId?: string;
}) {
  const { pending, error, run } = useBucksAction();
  const [userId, setUserId] = useState(defaultUserId || kids[0]?.userId || "");
  const [amount, setAmount] = useState(10);
  const [note, setNote] = useState("");

  function submit() {
    run(async () => {
      await awardBucks({ userId, amount, note });
      onOpenChange(false);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Award Bucks</DialogTitle>
        <DialogDescription>
          A one-off grant straight to a kid&apos;s balance.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={userId} onValueChange={(v) => v && setUserId(v)}>
          <SelectTrigger size="sm" aria-label="Who gets the Bucks">
            <SelectValue>
              {kids.find((k) => k.userId === userId)?.name ?? "Pick a kid"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {kids.map((k) => (
              <SelectItem key={k.userId} value={k.userId}>
                {k.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      <Input
        placeholder="Note (e.g. Helped a neighbor rake leaves)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="Award note"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending || !note.trim() || !userId}>
          Award Bucks
        </Button>
      </DialogFooter>
    </>
  );
}

export function AwardDialog({
  open,
  onOpenChange,
  kids,
  defaultUserId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kids: BucksKidSummary[];
  defaultUserId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <AwardBody
          key={String(open)}
          onOpenChange={onOpenChange}
          kids={kids}
          defaultUserId={defaultUserId}
        />
      </DialogContent>
    </Dialog>
  );
}

// ---- Redeem on a kid's behalf --------------------------------------------

function RedeemAsBody({
  onOpenChange,
  prize,
  kids,
  defaultUserId,
}: {
  onOpenChange: (v: boolean) => void;
  prize: BucksAdminPrize;
  kids: BucksKidSummary[];
  defaultUserId?: string;
}) {
  const { pending, error, run } = useBucksAction();
  // A per-kid prize can only be redeemed by that kid; a shared one by anyone.
  const eligible = prize.audienceUserId
    ? kids.filter((k) => k.userId === prize.audienceUserId)
    : kids;
  const preferred = prize.audienceUserId ?? defaultUserId ?? eligible[0]?.userId ?? "";
  const [userId, setUserId] = useState(
    eligible.some((k) => k.userId === preferred) ? preferred : eligible[0]?.userId ?? ""
  );

  const selected = kids.find((k) => k.userId === userId);
  const canAfford = !selected || selected.balance >= prize.price;

  function submit() {
    run(async () => {
      await redeemPrizeForKid(prize.id, userId);
      onOpenChange(false);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Redeem {prize.title}</DialogTitle>
        <DialogDescription>
          Spends {prize.price.toLocaleString()} Bucks from the kid you pick.
        </DialogDescription>
      </DialogHeader>
      <Select value={userId} onValueChange={(v) => v && setUserId(v)}>
        <SelectTrigger size="sm" aria-label="Redeem for which kid">
          <SelectValue>
            {kids.find((k) => k.userId === userId)?.name ?? "Pick a kid"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {eligible.map((k) => (
            <SelectItem key={k.userId} value={k.userId}>
              {k.name} · {k.balance.toLocaleString()} Bucks
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!canAfford && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {selected?.name} only has {selected?.balance.toLocaleString()} Bucks.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending || !userId || !canAfford}>
          {pending ? "Redeeming…" : "Redeem"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function RedeemAsDialog({
  open,
  onOpenChange,
  prize,
  kids,
  defaultUserId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prize: BucksAdminPrize;
  kids: BucksKidSummary[];
  defaultUserId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <RedeemAsBody
          key={String(open)}
          onOpenChange={onOpenChange}
          prize={prize}
          kids={kids}
          defaultUserId={defaultUserId}
        />
      </DialogContent>
    </Dialog>
  );
}
