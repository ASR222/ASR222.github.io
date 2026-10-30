---
title: Bronze, silver, gold in T-SQL
description: A SQL Server warehouse for a fictional B2B SaaS company, covering what each medallion layer does, the dirty data silver fixes, the star schema, and the SQL tests that check it.
date: 2026-09-15
kind: technical
tags: [SQL Server, Data modeling, Data quality]
draft: false
---

NovaCRM is a made-up B2B SaaS company with a real-looking problem. Its ERP system holds subscriptions, invoices and usage metering. Its CRM system holds accounts, contacts and support tickets. The two don't talk to each other, and executives want MRR, churn and plan performance on one screen.

I built the warehouse for it in SQL Server, all in T-SQL, with three layers: bronze for raw landing, silver for cleaned data, gold for a star schema. The source data is synthetic. A Python script (`scripts/seed/generate_synthetic_data.py`) writes six CSVs and plants specific quality problems on purpose, so the silver layer has something real to fix and the tests have something real to catch.

## Bronze: land everything

Every source column in bronze is `NVARCHAR(255)`, with no primary keys and no casting, so a bad date or a stray character never makes the load fail. `BULK INSERT` loads each CSV, and every run is a full refresh: truncate, then load. The script uses `TRUNCATE` rather than `DELETE` because it is minimally logged and doesn't fire triggers. From `scripts/01_bronze/02_load_bronze.sql`:

```sql
TRUNCATE TABLE bronze.erp_subscriptions;
TRUNCATE TABLE bronze.erp_invoices;
-- ...
```

Bronze holds exactly what the source exported, and all the judgement happens one layer up.

## Silver: fix what you can, flag what you can't

`scripts/02_silver/02_transform_silver.sql` is the cleaning script. It is also a full refresh from bronze, written as `INSERT ... SELECT`. Casting uses `TRY_CAST` and `TRY_CONVERT` throughout, so an unparseable value becomes `NULL` instead of stopping the load.

These are the problems the generator plants, and what silver does with each (from `TESTING.md`):

| Problem | Where | Fix in silver |
| --- | --- | --- |
| Mixed date formats (`YYYY-MM-DD`, `MM/DD/YYYY`, more) | all date columns | `TRY_CONVERT(DATE, ...)` |
| `starter` / `STARTER` / `Starter` | plan_code, status | `UPPER()` / `LOWER()` |
| `US` / `USA` / `United States` | accounts.country | `CASE` mapping |
| `Y`, `yes`, `1`, `true` and their opposites | accounts.is_active | `CASE` to `BIT` |
| About 5 duplicate invoice IDs | invoices | `ROW_NUMBER()` dedup |
| About 0.5% negative API call counts | usage_metrics | `ABS()` |
| About 3% satisfaction scores outside 1 to 5 | support_tickets | out of range becomes `NULL` |
| About 2% NULL company names | accounts | kept, flagged by checks |
| About 1% subscriptions pointing at accounts that don't exist | subscriptions | kept, flagged by checks |
| About 3% duplicate emails | contacts | warning only |

Here is the code for two of them. The invoice dedup keeps one row per `invoice_id`, with the highest amount as a deterministic tiebreaker:

```sql
ROW_NUMBER() OVER (
    PARTITION BY TRY_CAST(invoice_id AS INT)
    ORDER BY TRY_CAST(amount AS DECIMAL(10,2)) DESC
) AS rn
-- ...
WHERE rn = 1;  -- Keep only the first row per invoice_id
```

The satisfaction fix nulls the score but keeps the ticket. The comment in the script gives the reason: the ticket itself is valid data, only the score is suspect.

```sql
CASE
    WHEN TRY_CAST(satisfaction AS INT) BETWEEN 1 AND 5
        THEN TRY_CAST(satisfaction AS INT)
    ELSE NULL
END AS satisfaction,
```

Silver also drops rows it can't use at all: a subscription with no parseable `start_date`, or a ticket with no parseable `created_date`, never makes it in.

## Gold: a star schema

The gold layer is one fact table and three dimensions.

| Table | Grain or source | Notes |
| --- | --- | --- |
| `fact_subscription_events` | one row per subscription per month it was active | event type, MRR, MRR change, invoices, usage, support |
| `dim_customer` | silver accounts plus contact and ticket rollups | loaded with `MERGE`, SCD Type 1 |
| `dim_plan` | distinct plan code and billing cycle | plan name, tier, list price |
| `dim_date` | generated, 2022-01-01 to 2026-12-31 | `date_key` as a `YYYYMMDD` integer, fiscal quarter |

The fact load in `scripts/03_gold/04_load_fact.sql` builds a monthly spine by cross-joining subscriptions with the months in `dim_date`, keeps the months where each subscription was live, and labels each row `new`, `churn`, `expired` or `active`. Invoices, usage and tickets are aggregated per month and left-joined on. Then a second pass fills in `mrr_change` with `LAG()`:

```sql
f.mrr_amount - ISNULL(
    LAG(f.mrr_amount) OVER (
        PARTITION BY dc.account_id
        ORDER BY f.date_key
    ), 0
) AS calculated_mrr_change
```

`dim_customer` already carries `effective_date`, `expiry_date` and `is_current`, but the load is Type 1: a changed attribute overwrites the row. The Type 2 path is written out in a comment block above the `MERGE` (expire the old row, insert a new one, add a filtered unique index on `is_current = 1`) and not implemented.

On top of gold sit five reporting views: MRR trends, churn, customer segments, plan performance and growth metrics.

## How it is tested

`TESTING.md` sets out four steps: prevent (silver fixes known issues), detect (checks after each silver load), report (every check returns a structured row) and reconcile (gold is checked against silver). Every test is a SQL script that returns result sets, most of them a check name, a violation count and a status of `PASS`, `FAIL` or `WARNING`.

| Layer | Script | What it checks |
| --- | --- | --- |
| Bronze | `test_bronze_row_counts.sql` | each table loaded close to its expected size (about 2,000 accounts, 100,000 usage rows) |
| Silver | `test_silver_nulls.sql` | required columns are filled |
| Silver | `test_silver_duplicates.sql` | primary keys are unique, so the invoice dedup worked |
| Silver | `test_silver_referential.sql` | every foreign key points at a real parent |
| Silver | `03_quality_checks.sql` | 20+ checks in five groups: missing values, duplicates, referential integrity, domain and range, consistency |
| Gold | `test_gold_orphan_keys.sql` | every fact key exists in its dimension |
| Gold | `test_gold_aggregation.sql` | gold totals reconcile with silver |

Some tests are expected to fail. The referential test for subscriptions should report `FAIL`, because the generator planted those orphans. `TESTING.md` notes that in a real pipeline they would go to a data steward. A test that can't fail on known-bad data isn't testing much.

The consistency checks catch things a type system can't: an `end_date` before its `start_date`, active subscriptions with an end date (warning), churned or expired ones without one (warning).

## Following the orphans through

`TESTING.md` says orphan subscriptions are loaded with a `NULL` account_id, but the generator actually plants two separate problems: about 1% of subscriptions get account IDs that don't exist (numbers above the real range), and another 1% get no account_id at all. The first kind is what the referential check `CHK_3.1` looks for. The `NULL` check `CHK_1.2` only sees the second.

Then in gold, the fact load joins customers with an `INNER JOIN`, so those subscriptions drop out of the fact table. That is why the reconciliation test compares silver and gold invoice revenue with a tolerance:

```sql
CASE
    WHEN ABS(
        ISNULL((SELECT SUM(amount) FROM silver.invoices), 0) -
        ISNULL((SELECT SUM(invoice_amount) FROM gold.fact_subscription_events), 0)
    ) / NULLIF((SELECT SUM(amount) FROM silver.invoices), 1) < 0.10
    THEN 'PASS (within 10%)'
    ELSE 'WARNING (>10% variance)'
END AS status;
```

The same file checks that the fact table never has more customers than the current dimension, and that no fact row is dated in the future.

## What it doesn't do

- The tests are scripts you run in SSMS and read. Nothing fails a build. `TESTING.md` says the structured output "could feed into an alerting system", but that hasn't been built yet.
- SCD Type 2 is designed but not built.
- Apart from the `MERGE` into `dim_customer`, every load is a full refresh. There is no incremental load.

The repo is [B2B-SaaS-Data-Warehouse-Analytics-SQL-Server](https://github.com/ASR222/B2B-SaaS-Data-Warehouse-Analytics-SQL-Server). `DATA_CATALOG.md` documents every column.
