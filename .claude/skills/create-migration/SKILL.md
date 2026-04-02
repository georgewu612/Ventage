---
name: create-migration
description: Create a Supabase migration file with RLS policies following project conventions
disable-model-invocation: true
allowed-tools: Read, Write, Bash, Glob, Grep
---

Create a Supabase migration for: $ARGUMENTS

## Rules (from CLAUDE.md)

- Place in `supabase/migrations/`
- File name: `YYYYMMDD_description.sql`
- Use `IF NOT EXISTS` to avoid duplicate creation
- All tables must have RLS enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`)
- Use `gen_random_uuid()` for primary keys
- Use `TIMESTAMP WITH TIME ZONE` for time fields
- Include appropriate indexes for query performance

## Steps

1. Read existing migrations in `supabase/migrations/` to understand current schema
2. Generate the migration SQL following the rules above
3. Create the `supabase/migrations/` directory if it doesn't exist
4. Write the migration file with today's date prefix
5. Report what was created and what tables/columns were added
