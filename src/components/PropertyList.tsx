import { Copy } from "lucide-react";
import { IconButton } from "./ui/IconButton";
import type { DetailProperty } from "../lib/details";

/** A definition list of label/value rows, with copy buttons where useful. */
export default function PropertyList({
  properties,
  className,
}: {
  properties: DetailProperty[];
  className?: string;
}) {
  return (
    <dl className={className ? `properties ${className}` : "properties"}>
      {properties.map((prop) => (
        <div className="prop-row" key={prop.label}>
          <dt className="prop-label">{prop.label}</dt>
          <dd className="prop-value">
            <span>{prop.value}</span>
            {prop.copy && (
              <IconButton
                label={`Copy ${prop.label.toLowerCase()}`}
                size={28}
                tooltip={false}
                onClick={() => void navigator.clipboard?.writeText(prop.copy ?? "")}
              >
                <Copy aria-hidden="true" />
              </IconButton>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}