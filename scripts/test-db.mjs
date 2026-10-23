import postgres from 'postgres';

if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile('.env.local'); } catch {}
  try { process.loadEnvFile('.env'); } catch {}
}

const DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;


async function main() {
  const sql = postgres(DATABASE_URL);
  
  const tables = await sql`
    select table_name, (xpath('/row/cnt/text()', xml_count))[1]::text::int as row_count
    from (
      select table_name, 
             query_to_xml(format('select count(*) as cnt from %I.%I', table_schema, table_name), false, true, '') as xml_count
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    ) t
    order by row_count desc nulls last;
  `;
  console.log("Table row counts:");
  for (const t of tables) {
    if (t.row_count > 0) {
      console.log(`  ${t.table_name}: ${t.row_count}`);
    }
  }

  const businesses = await sql`select * from public.businesses limit 5`;
  console.log("\nBusinesses count:", businesses.length);
  if (businesses.length > 0) console.log("Sample business:", businesses[0]);

  const branches = await sql`select * from public.branches limit 5`;
  console.log("\nBranches count:", branches.length);
  if (branches.length > 0) console.log("Sample branch:", branches[0]);

  const staff = await sql`select * from public.staff limit 5`;
  console.log("\nStaff count:", staff.length);
  if (staff.length > 0) console.log("Sample staff:", staff[0]);

  await sql.end();
}

main().catch(console.error);
