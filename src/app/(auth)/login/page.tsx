import { LoginButton } from "@/components/auth/login-button";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <div className="text-center">
        <h1 className="text-[28px] font-semibold text-slate-900">BusyReader</h1>
        <p className="mt-2 max-w-[400px] text-base text-slate-500">
          AI-powered ebook reader for deep understanding
        </p>
      </div>
      <div className="mt-6">
        <LoginButton />
      </div>
    </div>
  );
}
