import { useId, useRef, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { api } from "../../lib/api";

export default function CourseRenameDialog({ courseId, name, onClose, onChanged }: {
  courseId: number;
  name: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const titleId = useId();
  const bodyId = useId();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await api.setCourseDisplayName(courseId, value.trim() || null);
    } catch (cause) {
      setError(String(cause));
      setSaving(false);
      savingRef.current = false;
      return;
    }
    onClose();
    void onChanged();
  }

  return (
    <Dialog
      open
      role="alertdialog"
      labelledBy={titleId}
      describedBy={bodyId}
      className="dialog-confirm course-rename-dialog"
      onOpenChange={(open) => { if (!open && !savingRef.current) onClose(); }}
    >
      <h2 id={titleId} className="dialog-title">Rename course</h2>
      <form onSubmit={(event) => void save(event)}>
        <div id={bodyId} className="dialog-body">
          <p>Only changes how this course appears in Pulse.</p>
          <input
            id="course-alias-input"
            className="text-field course-rename-input"
            aria-label="Course name"
            value={value}
            disabled={saving}
            onChange={(event) => setValue(event.target.value)}
          />
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="dialog-footer">
          <Button disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" className="dialog-primary" loading={saving}>Save</Button>
        </div>
      </form>
    </Dialog>
  );
}
