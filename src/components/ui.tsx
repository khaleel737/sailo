import * as React from "react";
import { cn } from "@/lib/utils";

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        {
          sm: "h-8 px-3 text-xs",
          md: "h-10 px-4 text-sm",
          lg: "h-12 px-6 text-base",
        }[size],
        {
          primary: "bg-ink-900 text-white hover:bg-ink-800 active:bg-ink-950",
          secondary:
            "border border-ink-200 bg-white text-ink-900 hover:bg-ink-50",
          ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
          danger: "bg-red-600 text-white hover:bg-red-700",
        }[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900",
        "placeholder:text-ink-400 transition",
        "focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/10",
        "disabled:bg-ink-50 disabled:text-ink-400",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900",
        "placeholder:text-ink-400 transition",
        "focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/10",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900",
        "transition focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/10",
        className,
      )}
      {...props}
    />
  );
}

export function Label({
  className,
  children,
  hint,
  ...props
}: React.ComponentProps<"label"> & { hint?: string }) {
  return (
    <label
      className={cn("mb-1.5 block text-sm font-medium text-ink-800", className)}
      {...props}
    >
      {children}
      {hint ? (
        <span className="ml-1.5 font-normal text-ink-400">{hint}</span>
      ) : null}
    </label>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} hint={hint}>
        {label}
      </Label>
      {children}
    </div>
  );
}

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-ink-200 bg-white shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.ComponentProps<"span"> & {
  tone?: "neutral" | "green" | "amber" | "red" | "blue";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        {
          neutral: "bg-ink-100 text-ink-700",
          green: "bg-emerald-100 text-emerald-800",
          amber: "bg-amber-100 text-amber-800",
          red: "bg-red-100 text-red-700",
          blue: "bg-blue-100 text-blue-800",
        }[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Alert({
  tone = "error",
  children,
}: {
  tone?: "error" | "success";
  children: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl border px-3 py-2 text-sm",
        tone === "error"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700",
      )}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 px-6 py-14 text-center">
      {icon ? <div className="mb-3 text-ink-300">{icon}</div> : null}
      <p className="font-medium text-ink-900">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
