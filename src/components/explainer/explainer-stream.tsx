"use client";

interface ExplainerStreamProps {
  text: string;
}

export function ExplainerStream({ text }: ExplainerStreamProps) {
  const words = text.split(/(\s+)/);
  return (
    <div className="text-sm leading-relaxed text-foreground">
      {words.map((word, i) => (
        <span
          key={`${i}-${word.slice(0, 20)}`}
          className="explainer-word inline"
          style={{ "--word-index": Math.min(i, 50) } as React.CSSProperties}
        >
          {word}
        </span>
      ))}
    </div>
  );
}
