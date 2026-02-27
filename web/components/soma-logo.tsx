import { cn } from "@/lib/utils";

interface SomaLogoProps {
  className?: string;
  size?: number;
}

export function SomaLogo({ className, size = 32 }: SomaLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-label="Soma"
      className={cn(className)}
    >
      <text
        x="16"
        y="16"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize="22"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        fontWeight="600"
        fill="var(--primary)"
      >
        S
      </text>
    </svg>
  );
}
