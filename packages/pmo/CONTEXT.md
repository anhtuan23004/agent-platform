# PMO domain glossary

Terms meaningful to PMO operators and contributors. Not an implementation map.

## Roles

### PMO Operator (`pmo.operator`)

A tenant member who may upload workbooks, confirm ingestion review gates (mapping, normalization, publish), and read PMO data and session status.

Permissions: `pmo.ingestion.upload`, `pmo.ingestion.confirm`, `pmo.ingestion.read`, `pmo.data.read`.

### PMO Viewer (`pmo.viewer`)

A tenant member with read-only access to published PMO data and ingestion session status. Cannot upload workbooks or confirm review gates.

Permissions: `pmo.ingestion.read`, `pmo.data.read`.

## Ingestion

### Ingestion Session

The unit of work for one PMO workbook upload. Tracks planning, profiling, workflow execution, staging, and publish audit from upload through terminal status (`published`, `failed`, or `rejected`).

### Review Gate

A human-in-the-loop checkpoint where an operator must approve or reject before the ingest workflow continues. PMO gates include workbook profiling, column mapping, row normalization, and publish.

### Publish

The act of upserting approved staging changes into canonical PMO tables. After publish, member-week utilization facts are recomputed.

## Analytics

### Member-Week Fact

A persisted read-model row combining a member and calendar week with utilization metrics (planned hours, logged hours, leave, classification). Used for overbook, idle, and mismatch findings.
