import Link from "next/link";
import { Upscaler } from "@/components/upscaler/upscaler";

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <rect x="2" y="12" width="10" height="10" rx="2" className="fill-foreground/30" />
      <rect x="6" y="2" width="16" height="16" rx="3" className="fill-foreground" />
      <path d="M11 13l6-6M13 7h4v4" className="stroke-background" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Home() {
  return (
    <>
      <a
        href="#app"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-3 focus:ring-ring/50"
      >
        Skip to upscaler
      </a>
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Logo /> PrintReady
          </Link>
          <nav aria-label="Main">
            <ul className="flex items-center gap-1 text-sm">
              {[
                ["#app", "Upscale"],
                ["#how-it-works", "How it works"],
                ["#api", "API"],
              ].map(([href, label]) => (
                <li key={href}>
                  <a
                    href={href}
                    className="rounded-md px-2.5 py-1.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="app" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Upscale images with AI, at the exact size you need</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            Real-ESRGAN super-resolution adds real detail — not browser stretching. Choose ×2 or ×4 or type exact pixel dimensions, set
            the print DPI, compare before and after, then download.
          </p>
        </div>
        <Upscaler />
      </main>

      <section id="how-it-works" className="scroll-mt-4 border-t bg-muted/30">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-3">
          <div>
            <h2 className="text-sm font-semibold">AI super-resolution</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              A Real-ESRGAN model reconstructs detail at ×2 or ×4. Custom sizes run the nearest AI pass, then a Lanczos resample to the
              exact pixel size you asked for. Every output is read back and verified before you can download it.
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold">Pixels vs DPI</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Pixel dimensions are the image&apos;s real resolution. DPI is metadata telling printers how densely to place those pixels:
              3840 px at 300 DPI prints 12.8 in (32.51 cm) wide. Changing DPI never adds detail.
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold">Privacy</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Images are uploaded only when you click Upscale, stored under random names, never logged, and deleted automatically
              shortly after processing — or immediately when you remove them. Camera EXIF data such as GPS is not copied to the output.
            </p>
          </div>
        </div>
      </section>

      <section id="api" className="scroll-mt-4 border-t">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <h2 className="text-sm font-semibold">API</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            The interface uses a small JSON API. Processing is asynchronous: create a job, poll its status, then download the file from
            the signed, expiring URL.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
{`POST   /api/upscale                 multipart: image, scale=2|4, width?, height?, lockAspect,
                                    dpi, format=png|jpeg|webp|tiff, quality?, model?,
                                    faceEnhance=none|gfpgan|codeformer,
                                    tileSize?=256|400|512|1024                 → 202 { job }
GET    /api/upscale/:jobId          → { status: queued|processing|completed|failed, output, downloadUrl }
GET    /api/upscale/:jobId/download?exp=…&sig=…   → the file (attachment)
DELETE /api/upscale/:jobId          → cancel and delete immediately`}
          </pre>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto max-w-7xl px-4 py-6 text-xs text-muted-foreground sm:px-6">
          PrintReady · Real-ESRGAN © Xintao Wang et al., BSD-3-Clause
        </div>
      </footer>
    </>
  );
}
