import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function StarRating({
  value,
  count,
  size = "sm",
  showEmpty = false,
  className,
}: {
  value: number | null;
  count?: number;
  size?: "sm" | "md";
  showEmpty?: boolean;
  className?: string;
}) {
  if (value === null && !showEmpty) return null;

  const rating = value ?? 0;
  const px = size === "sm" ? "size-3.5" : "size-4";

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={cn(
              px,
              i <= Math.round(rating)
                ? "fill-amber-400 text-amber-400"
                : "text-current opacity-25",
            )}
          />
        ))}
      </div>
      {value !== null ? (
        <span
          className={cn(
            "text-muted tabular-nums",
            size === "sm" ? "text-xs" : "text-sm",
          )}
        >
          {rating.toFixed(1)}
          {count !== undefined ? ` (${count})` : ""}
        </span>
      ) : (
        <span className="text-muted text-xs">No reviews yet</span>
      )}
    </div>
  );
}
