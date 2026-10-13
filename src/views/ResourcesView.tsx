import { useMemo, useState } from "react";
import { filterResources, type FeedKind } from "../lib/filter";
import { resourceLinks } from "../lib/open";
import { fileTone } from "../lib/filetype";
import { describeUpload, formatBytes, formatCompact } from "../lib/format";
import type { Course, Resource } from "../lib/types";
import PageHeader from "../components/PageHeader";
import OpenActions from "../components/OpenActions";
import { formatSectionPath } from "../lib/sectionPath";

interface Props {
  resources: Resource[];
  courses: Course[];
  onOpen: (url: string) => void;
}

export default function ResourcesView({ resources, courses, onOpen }: Props) {
  const [search, setSearch] = useState("");
  const [courseId, setCourseId] = useState<number | null>(null);
  const [type, setType] = useState<string>("");

  const types = useMemo(
    () => [...new Set(resources.map((r) => r.resourceType))].sort(),
    [resources],
  );

  const rows = filterResources(resources, {
    kind: "all" as FeedKind,
    courseId,
    search,
  }).filter((r) => (type ? r.resourceType === type : true));

  return (
    <div>
      <PageHeader
        title="Resource library"
        subtitle={`${rows.length} of ${resources.length} resources · ${types.length} file types`}
      />
      <div className="filters">
        <select
          aria-label="Filter by course"
          value={courseId ?? ""}
          onChange={(e) => setCourseId(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">All courses</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.shortName || c.name}
            </option>
          ))}
        </select>
        <select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search titles…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <div className="empty">No resources match.</div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>Title</th>
              <th>Course</th>
              <th>Section</th>
              <th>Type</th>
              <th>Upload / publication</th>
              <th>Availability</th>
              <th style={{ textAlign: "right" }}>Links</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const upload = describeUpload(r);
              const available = r.availabilityStatus === "available";
              return (
                <tr key={r.id}>
                  <td>
                    <button
                      className="btn-link"
                      title={
                        r.sourcePageUrl
                          ? "Open the page listing this resource"
                          : "Open the file directly"
                      }
                      onClick={() =>
                        onOpen(r.sourcePageUrl ?? r.url)
                      }
                    >
                      {r.title}
                    </button>
                    {r.sizeBytes ? (
                      <span className="faint small"> · {formatBytes(r.sizeBytes)}</span>
                    ) : null}
                  </td>
                  <td className="muted">{r.courseName ?? "—"}</td>
                  <td className="muted">{formatSectionPath(r)}</td>
                  <td className={`file-type ${fileTone(r.resourceType)}`}>
                    <span className="file-dot" aria-hidden="true" />
                    {r.resourceType}
                  </td>
                  <td className="muted">
                    {upload.source === "unavailable" ? (
                      <span className="faint">Upload date unavailable</span>
                    ) : (
                      <>
                        {upload.label}
                        {upload.note && <span className="faint small"> ({upload.note})</span>}
                      </>
                    )}
                  </td>
                  <td className="muted">
                    <span className={available ? "text-ok" : "text-danger"}>
                      {available ? "Available" : r.availabilityStatus}
                    </span>
                    <div className="faint small">
                      checked {formatCompact(r.lastCheckedAt)}
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <OpenActions links={resourceLinks(r)} onOpen={onOpen} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
