"use client";


/** A labelled switch with a line of explanation under it. */

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
    <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
      <input
        type="checkbox"
        name={name}
        {...(controlled
          ? { checked, onChange: (e) => onChange(e.target.checked) }
          : { defaultChecked })}
        className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
      />
      <span>
        <span className="block text-sm font-medium text-ink-900">{label}</span>
        <span className="block text-xs text-ink-500">{description}</span>
      </span>
    </label>
  );
}
