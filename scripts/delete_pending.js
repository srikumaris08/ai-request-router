/**
 * delete_pending.js
 * -----------------
 * Removes all customer_requests where the category was never resolved by the AI
 * (categorySnapshot: null). These appear as "Pending" in the dashboard.
 *
 * Run with:
 *   mongosh cognifyr_db scripts/delete_pending.js
 */

print('\n── Scanning for "Pending" (categorySnapshot: null) records ──────────────');

const targets = db.customer_requests.find(
  { categorySnapshot: null },
  { _id: 1, status: 1, createdAt: 1 }
).toArray();

if (targets.length === 0) {
  print('✅  No records with categorySnapshot: null found. Nothing to delete.');
} else {
  print(`Found ${targets.length} record(s):`);
  targets.forEach(r => print(`  • _id=${r._id}  status=${r.status}  created=${r.createdAt}`));

  const result = db.customer_requests.deleteMany({ categorySnapshot: null });
  print(`\n🗑️  Deleted ${result.deletedCount} record(s).`);
}

print('\nDone.\n');
