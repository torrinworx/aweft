-- Flatten the logs battery's documents out of the store's rows, for a reader that speaks SQL
-- (a Metabase, a dashboard). Apply by hand against the database the store writes; nothing in
-- the battery runs it. Re-runnable: every view is CREATE OR REPLACE, dropped first so a column
-- can change shape.
--
-- The store keeps each observable as a row in aweft_rows with a jsonb `slots` column (design
-- 163): a visit's root row holds its scalar fields, and each entry is a row of its own under
-- the visit's `entries` array. These views read those two shapes back.

DROP VIEW IF EXISTS aweft_log_entries;
DROP VIEW IF EXISTS aweft_log_visits;

-- One row per visit or process document: the fields the root row holds.
CREATE VIEW aweft_log_visits AS
SELECT
	r.doc AS id,
	r.slots ->> 'kind'                       AS kind,
	r.slots ->> 'user'                       AS "user",
	r.slots ->> 'build'                      AS build,
	(r.slots ->> 'startedAt')::bigint        AS started_at,
	to_timestamp((r.slots ->> 'startedAt')::bigint / 1000.0) AS started,
	NULLIF(r.slots ->> 'endedAt', '')::bigint AS ended_at,
	COALESCE((r.slots ->> 'errors')::int, 0) AS errors
FROM aweft_rows r
WHERE r.parent IS NULL
  AND (r.doc LIKE 'visit:%' OR r.doc LIKE 'process:%');

-- One row per entry, joined to its visit: the entry rows are the objects under the `entries`
-- array of a visit's root.
CREATE VIEW aweft_log_entries AS
SELECT
	e.doc                                    AS visit,
	(e.slots ->> 'at')::bigint               AS at,
	to_timestamp((e.slots ->> 'at')::bigint / 1000.0) AS at_time,
	e.slots ->> 'side'                       AS side,
	e.slots ->> 'kind'                       AS kind,
	e.slots ->> 'name'                       AS name,
	e.slots ->> 'message'                    AS message,
	e.slots ->> 'status'                     AS status,
	e.slots ->> 'path'                       AS path,
	NULLIF(e.slots ->> 'ms', '')::numeric    AS ms,
	e.slots                                  AS fields
FROM aweft_rows e
JOIN aweft_rows arr ON arr.doc = e.doc AND arr.id = e.parent AND arr.slot = 'entries'
JOIN aweft_rows root ON root.doc = e.doc AND root.id = arr.parent AND root.parent IS NULL;
