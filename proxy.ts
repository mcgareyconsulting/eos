import type { NextRequest } from "next/server";
import { gateRequest } from "@/lib/firebase/proxy";

export function proxy(request: NextRequest) {
  return gateRequest(request);
}

export const config = {
  matcher: [
    // Match all paths except static assets and image optimizer
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
