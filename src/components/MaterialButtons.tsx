import { ExternalLink, Eye, MoreHorizontal } from "lucide-react";
import { IconButton } from "./ui/IconButton";
import { Menu, type MenuItemSpec } from "./ui/Menu";

/** Overflow is always visible; extra shortcuts also appear on focus and coarse pointers. */
export function MaterialButtons({ actions, menu = [], label = "More actions" }: {
  actions: MenuItemSpec[]; menu?: MenuItemSpec[]; label?: string;
}) {
  const primary = actions.find((action) => action.id !== "preview");
  const preview = actions.find((action) => action.id === "preview");
  return <span className="material-buttons" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key !== "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation(); }}>
    {preview && <IconButton className="material-shortcut" label={preview.label} size={28} disabled={preview.disabled} onClick={preview.onSelect}><Eye aria-hidden="true" /></IconButton>}
    {primary && <IconButton className="material-shortcut" label={primary.label} size={28} disabled={primary.disabled} onClick={primary.onSelect}><ExternalLink aria-hidden="true" /></IconButton>}
    <Menu label={label} items={[...actions, ...menu]} trigger={<IconButton label={label} size={28} tooltip={false}><MoreHorizontal aria-hidden="true" /></IconButton>} />
  </span>;
}
