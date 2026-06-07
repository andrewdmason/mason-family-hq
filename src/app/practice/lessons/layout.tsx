// The lessons index is a client component, so it can't export metadata itself —
// this server layout supplies the "Lessons" title for it (child routes like a
// single lesson override with their own title).
export const metadata = {
  title: "Lessons",
};

export default function LessonsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
