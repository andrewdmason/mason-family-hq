"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rate3 } from "@/lib/baseball/stats";

const COLORS = { avg: "#2563eb", ops: "#d97706" };

export type TrendPoint = { label: string; AVG: number | null; OPS: number | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-sm">
      <div className="font-medium text-foreground">{label}</div>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <div key={p.name} className="flex items-center gap-2 text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          {p.name}: <span className="text-foreground">{rate3(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function CareerTrendChart({ points }: { points: TrendPoint[] }) {
  // A single season makes a line meaningless; the table already shows the value.
  if (points.length < 2) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">AVG &amp; OPS by season</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 12, bottom: 8, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" width={44} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="AVG" name="AVG" stroke={COLORS.avg} strokeWidth={2} dot connectNulls />
              <Line type="monotone" dataKey="OPS" name="OPS" stroke={COLORS.ops} strokeWidth={2} dot connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
