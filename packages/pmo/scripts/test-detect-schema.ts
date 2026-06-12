/**
 * Quick test: run detectSchema on the real hackathon Excel file.
 * Usage: npx tsx packages/pmo/scripts/test-detect-schema.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectSchema } from '../src/backend/ingestion/detect-schema.ts';

const filePath = resolve(
  import.meta.dirname,
  '../../../hackathon/data/PMO_02_RA_Timesheet_Monitoring.xlsx',
);

console.log(`\n📄 Loading: ${filePath}\n`);
const buffer = readFileSync(filePath);

const result = await detectSchema(buffer);

// Summary
console.log('═══ WORKBOOK META ═══');
console.log(`  Sheets processed: ${result.workbookMeta.sheetCount}`);
console.log(`  Excluded sheets:  ${result.workbookMeta.excludedSheets.join(', ') || '(none)'}`);
console.log(`  Total rows:       ${result.workbookMeta.totalRows}`);
console.log();

console.log('═══ VALIDATION ═══');
console.log(`  Status:           ${result.validation.status}`);
console.log(`  Confidence:       ${result.validation.workbookConfidence}`);
if (result.validation.issues.length > 0) {
  console.log(`  Issues (${result.validation.issues.length}):`);
  for (const issue of result.validation.issues) {
    console.log(`    [${issue.severity}] ${issue.tableId}.${issue.field ?? '*'}: ${issue.message}`);
  }
}
console.log();

console.log('═══ TABLE MAPPINGS ═══');
for (const table of result.tables) {
  console.log(
    `\n  📊 ${table.tableId} (sheet: "${table.sourceSheet}", headerRow: ${table.headerRow})`,
  );
  console.log(`     Confidence: ${table.tableConfidence}`);
  if (table.unmappedRequired.length > 0) {
    console.log(`     ❌ Unmapped required: ${table.unmappedRequired.join(', ')}`);
  }
  if (table.ambiguous.length > 0) {
    console.log(`     ⚠️  Ambiguous: ${table.ambiguous.join(', ')}`);
  }
  console.log('     Mappings:');
  for (const m of table.mappings) {
    const statusIcon = m.status === 'auto_accept' ? '✅' : m.status === 'needs_review' ? '⚠️' : '❌';
    console.log(
      `       ${statusIcon} ${m.sourceColumn} → ${m.canonicalField} (${m.confidence.toFixed(2)}) [${m.status}]`,
    );
  }
}
console.log();
