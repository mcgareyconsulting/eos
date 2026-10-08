import Image from "next/image";
import Link from "next/link";
import { verifySession } from "@/lib/firebase/session";
import { EnvBadge } from "@/components/env-badge";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next);

  const session = await verifySession();

  // Always the dark card, whatever the app theme — colors are fixed here
  // rather than dark: variants. Background/card neutrals come from the
  // HPB Pulse brand package; brand accents stay on the hpb-* tokens.
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f1730] bg-[radial-gradient(1200px_600px_at_50%_-10%,#1d2e63_0%,#0f1730_60%)] px-4 text-[#e8ecf5]">
      <main className="w-full max-w-[560px] rounded-3xl bg-[#0b1226] px-8 pb-12 pt-14 sm:px-14 shadow-[0_30px_80px_rgba(0,0,0,0.7)]">
        <EnvBadge className="mb-4" />
        {/* Self-contained animation (CSS inside the SVG); honors
            prefers-reduced-motion. The SVG's viewBox carries 45 units of
            transparent margin per side (of the 515-wide artwork) so the
            pulse glow isn't clipped at the image box; the negative 8.74%
            margins (45/515) let that margin bleed into the card padding so
            the letters still span the content width. */}
        <Image
          src="/brand/hpb-pulse-animated-dark.svg"
          alt="HPB Pulse"
          width={526}
          height={211}
          unoptimized
          preload
          className="h-auto max-w-none"
          style={{
            width: "117.48%",
            margin: "-8.74% -8.74% calc(2.5rem - 8.74%)",
          }}
        />
        <h1 className="mb-2 text-center text-2xl font-semibold">
          Sign in to HPB Pulse
        </h1>
        <p className="mb-8 text-center text-base text-[#9aa3b8]">
          {session
            ? "You're already signed in."
            : "Use your High Plains Bank Google account."}
        </p>

        {session ? (
          <Link
            href={next}
            className="block w-full rounded-full bg-hpb-green px-4 py-4 text-center text-base font-bold text-white hover:opacity-90"
          >
            Continue to app
          </Link>
        ) : (
          <LoginForm next={next} />
        )}
      </main>
    </div>
  );
}

function safeNext(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/home";
}
