import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { Button } from "../src/components/ui/Button";
import { Checkbox } from "../src/components/ui/Checkbox";
import { PasswordField } from "../src/components/ui/PasswordField";
import { SearchField } from "../src/components/ui/SearchField";
import { Select } from "../src/components/ui/Select";
import { Switch } from "../src/components/ui/Switch";
import { TextField } from "../src/components/ui/TextField";
import { ViewTabs } from "../src/components/ui/Tabs";
import { TooltipProvider } from "../src/components/ui/Tooltip";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(node: ReactNode) {
  await act(async () => root.render(<TooltipProvider>{node}</TooltipProvider>));
}

function activate(element: HTMLElement) {
  act(() => element.click());
}

describe("redesign shared controls", () => {
  it("exposes loading buttons as busy and unavailable to activation", async () => {
    const onClick = vi.fn();
    await render(<Button loading onClick={onClick}>Saving</Button>);
    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.disabled).toBe(true);
    activate(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("preserves password masking while exposing a named reveal action", async () => {
    await render(<PasswordField aria-label="Password" value="secret" onChange={() => {}} />);
    const input = container.querySelector("input")!;
    expect(input.type).toBe("password");
    activate(container.querySelector('button[aria-label="Show password"]')!);
    expect(input.type).toBe("text");
    expect(container.querySelector('button[aria-label="Hide password"]')).toBeTruthy();
  });

  it("connects invalid field copy to the input and keeps disabled inputs inert", async () => {
    await render(
      <>
        <TextField label="Course name" error="Enter a name" value="" onChange={() => {}} />
        <SearchField label="Search files" value="" disabled onChange={() => {}} />
      </>,
    );
    const field = container.querySelector(".text-field") as HTMLInputElement;
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(field.getAttribute("aria-describedby")!)?.textContent).toContain("Enter a name");
    expect((container.querySelector(".search-field-input") as HTMLInputElement).disabled).toBe(true);
  });

  it("supports mixed checkbox state and emits a boolean when toggled", async () => {
    const onCheckedChange = vi.fn();
    await render(<Checkbox ariaLabel="Select all" checked="indeterminate" onCheckedChange={onCheckedChange} />);
    const checkbox = container.querySelector('[role="checkbox"]')!;
    expect(checkbox.getAttribute("aria-checked")).toBe("mixed");
    activate(checkbox as HTMLElement);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("toggles a named, keyboard-focusable switch", async () => {
    const onCheckedChange = vi.fn();
    await render(<Switch ariaLabel="Keep running" checked={false} onCheckedChange={onCheckedChange} />);
    const toggle = container.querySelector('[role="switch"]') as HTMLElement;
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    expect(toggle.tabIndex).toBe(0);
    activate(toggle);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("moves tab selection and focus together using arrow keys", async () => {
    const onChange = vi.fn();
    await render(<ViewTabs ariaLabel="Sections" value="materials" onChange={onChange} items={[{ id: "materials", label: "Materials" }, { id: "activity", label: "Activity" }]} />);
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    await act(async () => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
    expect(onChange).toHaveBeenCalledWith("activity");
    expect(document.activeElement).toBe(tabs[1]);
  });

  it("opens a named select and changes its value through keyboard activation", async () => {
    const onValueChange = vi.fn();
    await render(<Select ariaLabel="Color scheme" value="light" onValueChange={onValueChange} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />);
    const trigger = container.querySelector('[role="combobox"]') as HTMLElement;
    expect(trigger.getAttribute("aria-label")).toBe("Color scheme");
    trigger.focus();
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true })));
    const darkOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Dark");
    expect(darkOption).toBeTruthy();
    await act(async () => {
      darkOption?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true }));
      darkOption?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    });
    expect(onValueChange).toHaveBeenCalledWith("dark");
  });

  it("clears a controlled search field from Escape and its accessible clear button", async () => {
    const onChange = vi.fn();
    await render(<SearchField label="Search files" value="lecture" debounceMs={0} onChange={onChange} />);
    const input = container.querySelector("input")!;
    expect(input.getAttribute("aria-label")).toBe("Search files");
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(container.querySelector('button[aria-label="Clear search"]')).toBeNull();
  });
});
