import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <h1 className="text-[28px] font-semibold text-slate-900">Nutshell</h1>
        <p className="mt-2 text-base text-slate-500">
          AI-powered ebook reader for deep understanding
        </p>
        <div className="mt-6">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
