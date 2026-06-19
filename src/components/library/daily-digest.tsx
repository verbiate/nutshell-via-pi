import { Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DailyDigestProps {
  imageSrc: string | null;
}

export function DailyDigest({ imageSrc }: DailyDigestProps) {
  return (
    <aside
      className={`relative flex min-h-[320px] overflow-hidden rounded-2xl text-paper ${
        imageSrc ? "" : "bg-espresso"
      }`}
    >
      {imageSrc && (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${imageSrc})` }}
            aria-hidden
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-espresso/85 via-espresso/55 to-espresso/30"
            aria-hidden
          />
        </>
      )}
      <div className="relative flex flex-col justify-between p-8">
        <div className="space-y-5">
          <img
            src="/images/nutshell_badge_white.svg"
            alt=""
            className="h-6 w-auto"
          />
          <p className="font-serif text-[24px] leading-snug">
            Your daily digest, ready when you are.
          </p>
          <p className="text-sm text-paper/80">
            A short audio catch-up from your shelf, brewed fresh.
          </p>
        </div>
        <Button className="mt-8 w-fit bg-b-orange text-white hover:bg-b-orange/90">
          <Headphones className="mr-2 h-4 w-4" />
          Listen now
        </Button>
      </div>
    </aside>
  );
}
