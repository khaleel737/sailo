"use client";

/**
 * A labelled switch with a line of explanation under it.
 *
 * A real switch now, not a checkbox wearing a label: a settings row answers
 * "is this on?", and a sliding thumb is the shape of that answer everywhere
 * else the seller lives. The input underneath is still a checkbox — same
 * name, same FormData, same `defaultChecked` — so nothing that reads this
 * form changed; only what the thumb sees did.
 *
 * The track goes brand green when on (the leaf's yes), the thumb slides
 * 16px over 150ms decelerating, RTL slides the other way, and the focus
 * ring rides the track via `peer-focus-visible` since the input itself is
 * visually hidden.
 */
export function Toggle({
  name,
  label,
  description,
  defaultChecked,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked?: boolean;
  /** Pass both to drive the toggle from the form's own state. */
  checked?: boolean;
  onChange?: (next: boolean) => void;
}) {
  const controlled = checked !== undefined && onChange !== undefined;

  return (
    <label className="group flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
      <input
        type="checkbox"
        name={name}
        {...(controlled
          ? { checked, onChange: (e) => onChange(e.target.checked) }
          : { defaultChecked })}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-ink-300 transition-colors duration-150 group-active:bg-ink-400 peer-checked:bg-brand-600 peer-checked:group-active:bg-brand-700 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink-900 peer-checked:[&>span]:translate-x-4 rtl:peer-checked:[&>span]:-translate-x-4"
      >
        <span className="absolute start-0.5 top-0.5 size-4 rounded-full bg-white shadow-xs transition-transform duration-150 ease-[var(--ease-out-quint)]" />
      </span>
      <span>
        <span className="block text-sm font-medium text-ink-900">{label}</span>
        <span className="block text-xs text-ink-500">{description}</span>
      </span>
    </label>
  );
}
