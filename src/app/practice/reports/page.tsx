import dynamic from "next/dynamic";
import { StreakCard } from "@/components/reports/streak-card";
import {
  getWeeklyPracticeData,
  getPieceBreakdownData,
  getStreakData,
} from "./actions";

const WeeklyChart = dynamic(() =>
  import("@/components/reports/weekly-chart").then((m) => m.WeeklyChart)
);

const PieceBreakdown = dynamic(() =>
  import("@/components/reports/piece-breakdown").then((m) => m.PieceBreakdown)
);

export const metadata = {
  title: "Reports",
};

export default async function ReportsPage() {
  const [weeklyData, breakdownData, streakData] = await Promise.all([
    getWeeklyPracticeData(),
    getPieceBreakdownData("30d"),
    getStreakData(),
  ]);

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
      <h2 className="text-xl font-semibold tracking-tight mb-4">Reports</h2>
      <div className="space-y-6">
        <StreakCard data={streakData} />
        <WeeklyChart data={weeklyData} />
        <PieceBreakdown initialData={breakdownData} />
      </div>
    </div>
  );
}
