"use client";

import { sanitizeNumericDraft, type NumericDraftOptions } from "@/lib/ui/numeric-draft";

type NumericFieldProps = {
  value: string;
  onChange: (draft: string) => void;
  onBlur?: () => void;
  "aria-label": string;
  className?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  /** Mobile keyboard: decimal for fractions, numeric for integers. */
  inputMode?: "decimal" | "numeric";
  allowDecimal?: boolean;
  /** Kept for call-site documentation; validation runs on save, not via HTML number attrs. */
  min?: number;
  max?: number;
  step?: number | string;
  "data-testid"?: string;
};

/**
 * Controlled numeric text field that stays blank when cleared.
 * Uses inputMode for the mobile numeric keyboard; never coerces "" to 0 while typing.
 */
export function NumericField({
  value,
  onChange,
  onBlur,
  className = "field",
  placeholder,
  required,
  disabled,
  id,
  name,
  inputMode,
  allowDecimal,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: NumericFieldProps) {
  const decimal = allowDecimal ?? inputMode === "decimal";
  const options: NumericDraftOptions = { allowDecimal: decimal };

  return (
    <input
      id={id}
      name={name}
      className={className}
      type="text"
      inputMode={inputMode ?? (decimal ? "decimal" : "numeric")}
      autoComplete="off"
      enterKeyHint="done"
      aria-label={ariaLabel}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      value={value}
      data-testid={testId}
      onChange={(event) => onChange(sanitizeNumericDraft(event.target.value, options))}
      onBlur={onBlur}
    />
  );
}
