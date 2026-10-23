import postgres from 'postgres';

if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile('.env.local'); } catch {}
  try { process.loadEnvFile('.env'); } catch {}
}

const DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;


async function main() {
  const sql = postgres(DATABASE_URL);
  
  for (const table of ['businesses', 'branches', 'staff', 'business_settings']) {
    const cols = await sql`
      select column_name, data_type, column_default, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = ${table}
      order by ordinal_position
    `;
    console.log(`\n=== Table: ${table} ===`);
    for (const c of cols) {
      console.log(`  ${c.column_name}: ${c.data_type} (default: ${c.column_default}, nullable: ${c.is_nullable})`);
    }
  }

  await sql.end();
}

main().catch(console.error);
