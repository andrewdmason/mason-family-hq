import { notFound } from "next/navigation";
import { getLesson } from "@/app/practice/lessons/actions";
import { TwoColumnLayout } from "@/components/layout/two-column-layout";
import { SingleLessonView } from "@/components/lessons/single-lesson-view";
import { LessonFocusPanel } from "@/components/lessons/lesson-focus-panel";
import { LessonViewProvider } from "@/components/lessons/lesson-view-context";

export const metadata = {
  title: "Lesson",
};

export default async function LessonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let result;
  try {
    result = await getLesson(id);
  } catch {
    notFound();
  }

  const { lesson, neighbors, index } = result;

  return (
    <LessonViewProvider lesson={lesson} neighbors={neighbors} index={index}>
      <TwoColumnLayout
        left={<SingleLessonView />}
        right={<LessonFocusPanel />}
      />
    </LessonViewProvider>
  );
}
