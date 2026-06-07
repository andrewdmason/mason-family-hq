import { createClient } from "@/lib/supabase/server";
import { RepertoireList } from "@/components/repertoire/repertoire-list";
import type { Piece, WorkWithPieces } from "@/lib/types";

export const metadata = {
  title: "Repertoire",
};

export default async function RepertoirePage() {
  const supabase = await createClient();

  const [{ data: pieces }, { data: works }] = await Promise.all([
    supabase.from("pieces").select("*").order("name"),
    supabase.from("works").select("*, pieces(*)").order("name"),
  ]);

  return (
    <RepertoireList
      pieces={(pieces as Piece[]) ?? []}
      works={(works as WorkWithPieces[]) ?? []}
    />
  );
}
