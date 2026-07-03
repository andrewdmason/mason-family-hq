/** Shared view types for the Mason Bucks app. */

export type BucksSource =
  | "reading"
  | "journal"
  | "task"
  | "redemption"
  | "migration"
  | "adjustment"
  | "games";

/** A single ledger row, shaped for the wallet history list. */
export type BucksLedgerEntry = {
  id: string;
  amount: number;
  source: BucksSource;
  /** Human label for the row (note when present, else a source default). */
  label: string;
  createdAt: string;
};

/** An earning task as a kid sees it in "ways to earn". */
export type BucksEarnTask = {
  id: string;
  title: string;
  unitValue: number;
  unitLabel: string;
  isOneTime: boolean;
  /** null = shared by both kids. */
  audienceUserId: string | null;
  /** This kid's claims on this task still awaiting an adult. */
  pendingClaims: number;
};

/** A prize as a kid sees it in the shop. */
export type BucksPrize = {
  id: string;
  title: string;
  price: number;
  imageUrl: string | null;
  audienceUserId: string | null;
  /** Whether the viewing kid can currently afford it. */
  affordable: boolean;
};

/** Everything the wallet page renders for one kid. */
export type BucksWallet = {
  balance: number;
  history: BucksLedgerEntry[];
  earnTasks: BucksEarnTask[];
  prizes: BucksPrize[];
  /** This kid's own arbitrary Bucks requests still awaiting an adult. */
  pendingRequests: number;
};

/**
 * A pending claim in the adult approval queue — either a kid claiming a task or a
 * task-less "just give me N Bucks" request. `taskTitle` is null for a request; use
 * the `note` in that case.
 */
export type BucksAdminClaim = {
  id: string;
  /** The originating task's title, or null for an arbitrary request. */
  taskTitle: string | null;
  /** The kid's explanation, on arbitrary requests. */
  note: string | null;
  kidUserId: string;
  kidName: string;
  quantity: number;
  unitValue: number;
  amount: number;
  claimedAt: string;
};

/** An unfulfilled redemption in the adult fulfillment list. */
export type BucksAdminRedemption = {
  id: string;
  prizeTitle: string;
  kidUserId: string;
  kidName: string;
  price: number;
  redeemedAt: string;
};

/** An earning task in the adult console. */
export type BucksAdminTask = {
  id: string;
  title: string;
  unitValue: number;
  unitLabel: string;
  isOneTime: boolean;
  audienceUserId: string | null;
  archivedAt: string | null;
};

/** A prize in the adult console. */
export type BucksAdminPrize = {
  id: string;
  title: string;
  price: number;
  imageUrl: string | null;
  purchaseUrl: string | null;
  audienceUserId: string | null;
  archivedAt: string | null;
};

/** A kid as the adult management view knows them, with their current balance. */
export type BucksKidSummary = {
  userId: string;
  email: string;
  name: string;
  balance: number;
};

/** A ledger row in the combined adult history, tagged with whose wallet it's from. */
export type BucksAdminLedgerEntry = BucksLedgerEntry & {
  kidUserId: string;
  kidName: string;
};

/** Everything the unified adult management view renders. */
export type BucksAdminData = {
  kids: BucksKidSummary[];
  tasks: BucksAdminTask[];
  prizes: BucksAdminPrize[];
  claims: BucksAdminClaim[];
  redemptions: BucksAdminRedemption[];
  history: BucksAdminLedgerEntry[];
};
