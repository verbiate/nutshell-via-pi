import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="font-serif text-[34px] font-semibold tracking-tight text-espresso">
          <span className="text-b-teal">(</span>
          nutshell
          <span className="text-lav">)</span>
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          AI-powered ebook reader for deep understanding
        </p>
        <div className="mt-6">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-full bg-grad px-6 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_-12px_rgba(241,104,245,.6)] transition-transform hover:saturate-110 active:translate-y-px"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
