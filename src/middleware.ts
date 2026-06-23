import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // sw.js is excluded so the service worker is always served as a JS file at
    // root scope — never bounced to /login by the auth gate, which would break
    // registration (and the SW is fetched/updated independent of session state).
    "/((?!_next/static|_next/image|favicon.ico|sw.js|app-manifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
