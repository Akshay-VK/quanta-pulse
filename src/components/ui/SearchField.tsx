import { useEffect, useRef, useState, type RefObject } from "react";
import { Search, X } from "lucide-react";
import { cx } from "../../lib/cx";
import { IconButton } from "./IconButton";

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name for the input. */
  label?: string;
  /** Debounce before emitting changes; 0 emits immediately. */
  debounceMs?: number;
  autoFocus?: boolean;
  className?: string;
  inputRef?: RefObject<HTMLInputElement>;
}

/** A search input with a leading glyph, clear button and 150 ms debounce. */
export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  label = "Search",
  debounceMs = 150,
  autoFocus,
  className,
  inputRef,
}: SearchFieldProps) {
  const [text, setText] = useState(value);
  const emitted = useRef(value);

  // Adopt external changes (filter clear, Esc elsewhere) without clobbering typing.
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    if (text === emitted.current) return;
    const timer = window.setTimeout(() => {
      emitted.current = text;
      onChange(text);
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [text, debounceMs, onChange]);

  const clear = () => {
    emitted.current = "";
    setText("");
    onChange("");
  };

  return (
    <div className={cx("search-field", className)}>
      <Search className="search-field-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        className="search-field-input"
        value={text}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && text) {
            event.stopPropagation();
            clear();
          }
        }}
      />
      {text && (
        <IconButton
          label="Clear search"
          size={28}
          tooltip={false}
          className="search-field-clear"
          onClick={clear}
        >
          <X aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}