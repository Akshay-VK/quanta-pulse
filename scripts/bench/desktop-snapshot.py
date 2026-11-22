"""Measure production snapshot SQL and row materialization under an uncontended lock."""
import json
import re
import sqlite3
import statistics
import sys
import tempfile
import threading
import time
from pathlib import Path

root = Path(__file__).resolve().parents[2]
db = (root / "src-tauri/src/db.rs").read_text()
attention = (root / "src-tauri/src/attention.rs").read_text()
scope = db.split("pub fn list_resources(", 1)[1]
resource_sql = re.search(r'String::from\(\s*"(SELECT.*?)",', scope, re.S)[1]
resource_sql += " " + re.search(r'" (ORDER BY COALESCE.*?)"', scope)[1]
course_scope = db.split("pub fn list_courses(", 1)[1]
course_sql = re.search(r'"(SELECT.*?)"', course_scope, re.S)[1]
unread_scope = attention.split("pub fn unread_resource_ids(", 1)[1]
unread_sql = re.search(r'"(SELECT.*?)"', unread_scope, re.S)[1]
unread_sql = unread_sql.replace("{UNREAD_RESOURCE_EVENTS}", re.search(r'const UNREAD_RESOURCE_EVENTS: &str =\s*"(.*?)"', attention)[1])
size = int(sys.argv[1])
lock = threading.Lock()
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / "fixture.sqlite"
    with sqlite3.connect(path) as conn:
        conn.executescript((root / "src-tauri/migrations/0001_init.sql").read_text())
        conn.executescript((root / "src-tauri/migrations/0005_inbox_dismissals.sql").read_text())
        conn.executescript((root / "src-tauri/migrations/0006_course_display_name.sql").read_text())
        conn.executemany("INSERT INTO courses(id,external_course_id,name,url,first_seen_at) VALUES(?,?,?,?,'2026-11-20')",
                         ((i, str(i), f"Synthetic Course {i}", "https://example.test/course") for i in range(1, 101)))
        conn.executemany("""INSERT INTO resources(id,external_resource_id,course_id,title,url,resource_type,
                            uploaded_at,section_path,first_seen_at) VALUES(?,?,?,?,?,?,?,?,'2026-11-20')""",
                         ((i, f"fixture:{i}", ((i - 1) % 100) + 1, f"Lecture {i} regression",
                           f"https://example.test/resource/{i}", "pdf", "2026-11-20T12:00:00Z",
                           json.dumps([f"Unit {(i - 1) % 9}", "Lectures"])) for i in range(1, size + 1)))
        conn.executemany("""INSERT INTO change_events(resource_id,course_id,change_type,title,deduplication_key,detected_at)
                            VALUES(?,?,'new','Synthetic',?,'2026-11-20')""",
                         ((i, ((i - 1) % 100) + 1, str(i)) for i in range(10, size + 1, 10)))
    samples = []
    with sqlite3.connect(path) as conn:
        for _ in range(21):
            with lock:
                start = time.perf_counter_ns()
                conn.execute("BEGIN")
                courses = conn.execute(course_sql).fetchall()
                rows = conn.execute(resource_sql).fetchall()
                unread = conn.execute(unread_sql).fetchall()
                conn.commit()
                samples.append((time.perf_counter_ns() - start) / 1e6)
            assert len(courses) == 100 and len(rows) == size and len(unread) == size // 10
    warm = sorted(samples[1:])
    print(json.dumps(dict(size=size, sqlite=sqlite3.sqlite_version, coldLockMs=samples[0],
                          warmLockP50Ms=statistics.median(warm), warmLockP95Ms=warm[18])))
