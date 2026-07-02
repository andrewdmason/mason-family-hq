import { RecordingsList } from "@/components/recordings/recordings-list";
import { getRecordings } from "./actions";

export const metadata = {
  title: "Recordings",
};

export default async function RecordingsPage() {
  const recordings = await getRecordings();

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
      <h2 className="text-xl font-semibold tracking-tight mb-4">Recordings</h2>
      <RecordingsList initial={recordings} showRecordButton />
    </div>
  );
}
