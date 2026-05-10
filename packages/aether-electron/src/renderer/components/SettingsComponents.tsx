import React, { type ReactNode } from "react";

// ─── Settings Section Container ─────────────────────────────────────

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <div className="mb-10">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          {title}
        </h2>
        {description && (
          <p className="text-xs text-gray-500 mt-1">{description}</p>
        )}
      </div>
      <div className="bg-[#14141a] border border-[#1e1e24] rounded-xl overflow-hidden divide-y divide-[#1e1e24]">
        {children}
      </div>
    </div>
  );
}

// ─── Settings Row (container for one setting) ───────────────────────

interface SettingsRowProps {
  label: string;
  description: string;
  children: ReactNode;
  beta?: boolean;
  danger?: boolean;
}

export function SettingsRow({ label, description, children, beta, danger }: SettingsRowProps) {
  return (
    <div
      className={`flex items-center justify-between px-5 py-3.5 transition-colors ${
        danger
          ? "hover:bg-red-500/5"
          : "hover:bg-[#ffffff06]"
      }`}
    >
      <div className="min-w-0 flex-1 mr-4">
        <div className="flex items-center gap-2">
          <p className={`text-sm font-medium ${danger ? "text-red-400" : "text-gray-200"}`}>
            {label}
          </p>
          {beta && (
            <span className="text-[10px] font-medium text-[#a78bfa] bg-[#a78bfa]/10 px-1.5 py-0.5 rounded">
              BETA
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

// ─── Toggle Switch (boolean setting) ────────────────────────────────

interface SettingsToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function SettingsToggle({ checked, onChange, disabled }: SettingsToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`
        relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0
        ${checked ? "bg-[#a78bfa]" : "bg-[#2a2a33]"}
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:opacity-90"}
      `}
    >
      <span
        className={`
          inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform
          ${checked ? "translate-x-[18px]" : "translate-x-[3px]"}
        `}
      />
    </button>
  );
}

// ─── Select Dropdown ────────────────────────────────────────────────

interface SettingsSelectProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SettingsSelect({ value, options, onChange, disabled }: SettingsSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="
        text-xs bg-[#1e1e24] border border-[#2a2a33] text-gray-200 rounded-lg
        px-3 py-1.5 outline-none focus:border-[#a78bfa]/50 focus:ring-1 focus:ring-[#a78bfa]/20
        disabled:opacity-40 disabled:cursor-not-allowed
        min-w-[120px]
      "
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// ─── Text Input ─────────────────────────────────────────────────────

interface SettingsInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "number";
  disabled?: boolean;
  monospace?: boolean;
  width?: string;
}

export function SettingsInput({
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  monospace,
  width,
}: SettingsInputProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`
        text-xs bg-[#1e1e24] border border-[#2a2a33] text-gray-200 rounded-lg
        px-3 py-1.5 outline-none focus:border-[#a78bfa]/50 focus:ring-1 focus:ring-[#a78bfa]/20
        disabled:opacity-40 disabled:cursor-not-allowed
        ${monospace ? "font-mono" : ""}
        ${width || "min-w-[160px]"}
      `}
    />
  );
}

// ─── Slider (range setting) ─────────────────────────────────────────

interface SettingsSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function SettingsSlider({ value, min, max, step = 1, suffix, onChange, disabled }: SettingsSliderProps) {
  return (
    <div className="flex items-center gap-3 min-w-[180px]">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="
          flex-1 h-1 rounded-full appearance-none cursor-pointer
          bg-[#2a2a33]
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-3.5
          [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-[#a78bfa]
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-webkit-slider-thumb]:shadow-sm
          disabled:opacity-40 disabled:cursor-not-allowed
        "
      />
      <span className="text-xs font-mono text-gray-400 w-12 text-right tabular-nums shrink-0">
        {value}{suffix}
      </span>
    </div>
  );
}

// ─── Button (for actions like "Reset", "Clear", "Test") ────────────

interface SettingsButtonProps {
  label: string;
  onClick: () => void;
  variant?: "default" | "danger" | "primary";
  disabled?: boolean;
}

export function SettingsButton({ label, onClick, variant = "default", disabled }: SettingsButtonProps) {
  const variants = {
    default: "text-[#a78bfa] hover:text-[#c4b5fd]",
    danger: "text-red-400 hover:text-red-300",
    primary: "text-white bg-[#a78bfa] hover:bg-[#b99cfb] px-3 py-1.5 rounded-lg",
  };

  const base = variant === "primary"
    ? variants.primary
    : `text-xs transition-colors ${variants[variant]}`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {label}
    </button>
  );
}

// ─── Tag Group (multi-select chips) ─────────────────────────────────

interface SettingsTagGroupProps {
  tags: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
}

export function SettingsTagGroup({ tags, selected, onChange, disabled }: SettingsTagGroupProps) {
  const toggle = (tag: string) => {
    if (selected.includes(tag)) {
      onChange(selected.filter((t) => t !== tag));
    } else {
      onChange([...selected, tag]);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5 max-w-[280px] justify-end">
      {tags.map((tag) => {
        const active = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            disabled={disabled}
            onClick={() => toggle(tag)}
            className={`
              text-[11px] px-2 py-0.5 rounded-full transition-colors
              ${active
                ? "bg-[#a78bfa]/20 text-[#a78bfa] border border-[#a78bfa]/30"
                : "bg-[#1e1e24] text-gray-400 border border-[#2a2a33] hover:border-[#a78bfa]/20"
              }
              disabled:opacity-40 disabled:cursor-not-allowed
            `}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}

// ─── Key-Value Editor (for custom headers / env vars) ───────────────

export interface KeyValuePair {
  key: string;
  value: string;
}

interface SettingsKeyValueEditorProps {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  disabled?: boolean;
}

export function SettingsKeyValueEditor({
  pairs,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  disabled,
}: SettingsKeyValueEditorProps) {
  const update = (index: number, field: "key" | "value", val: string) => {
    const next = pairs.map((p, i) => (i === index ? { ...p, [field]: val } : p));
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(pairs.filter((_, i) => i !== index));
  };

  const add = () => {
    onChange([...pairs, { key: "", value: "" }]);
  };

  return (
    <div className="flex flex-col gap-1.5 min-w-[240px]">
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            value={pair.key}
            onChange={(e) => update(i, "key", e.target.value)}
            placeholder={keyPlaceholder}
            disabled={disabled}
            className="flex-1 text-[11px] font-mono bg-[#1e1e24] border border-[#2a2a33] text-gray-200 rounded
              px-2 py-1 outline-none focus:border-[#a78bfa]/50 min-w-0 w-24"
          />
          <span className="text-gray-600 text-[11px]">:</span>
          <input
            type="text"
            value={pair.value}
            onChange={(e) => update(i, "value", e.target.value)}
            placeholder={valuePlaceholder}
            disabled={disabled}
            className="flex-1 text-[11px] font-mono bg-[#1e1e24] border border-[#2a2a33] text-gray-200 rounded
              px-2 py-1 outline-none focus:border-[#a78bfa]/50 min-w-0 w-24"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => remove(i)}
            className="text-gray-500 hover:text-red-400 transition-colors disabled:opacity-40 shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={add}
        className="text-[11px] text-[#a78bfa] hover:text-[#c4b5fd] transition-colors self-start disabled:opacity-40"
      >
        + Add {keyPlaceholder.toLowerCase()}
      </button>
    </div>
  );
}
